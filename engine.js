// ACE 랭킹 시스템 - 핵심 두뇌 모듈 (엔진 로직)
// 이 파일은 ELO 레이팅 재계산, 코트 배정 및 수동 대진표 알고리즘과 같은
// 퓨어 비즈니스 로직(Pure Business Logic)만을 포함합니다.

export const ELO_INITIAL = 1500;
export const K_FACTOR = 32;
export const GAME_COUNTS = { 4: 3, 5: 5, 6: 6, 7: 7, 8: 8 };

export const MATCH_PATTERNS = {
    8: [[[0, 4], [1, 5]], [[2, 6], [3, 7]], [[0, 5], [3, 6]], [[1, 4], [2, 7]], [[2, 4], [0, 6]], [[3, 5], [1, 7]], [[0, 7], [3, 4]], [[2, 5], [1, 6]]],
    7: [[[0, 3], [2, 6]], [[1, 4], [2, 5]], [[0, 4], [1, 3]], [[4, 5], [3, 6]], [[1, 6], [2, 3]], [[0, 5], [2, 4]], [[0, 6], [1, 5]]],
    6: [[[0, 2], [1, 4]], [[1, 3], [4, 5]], [[0, 5], [2, 4]], [[0, 3], [1, 2]], [[0, 4], [3, 5]], [[1, 5], [2, 3]]],
    5: [[[0, 2], [1, 4]], [[0, 4], [1, 3]], [[1, 2], [3, 4]], [[0, 3], [2, 4]], [[0, 1], [2, 3]]],
    4: [[[0, 1], [2, 3]], [[0, 3], [1, 2]], [[0, 2], [1, 3]]]
};

export function getSplits(n) {
    const table = {
        4: [4], 5: [5], 6: [6], 7: [7], 8: [4, 4],
        9: [5, 4], 10: [5, 5], 11: [6, 5],
        12: [4, 4, 4], 13: [5, 8], 14: [6, 8], 15: [5, 5, 5],
        16: [5, 6, 5], 17: [6, 6, 5], 18: [6, 6, 6],
        19: [5, 5, 5, 4], 20: [4, 4, 4, 4, 4], 21: [4, 4, 5, 4, 4],
        22: [4, 4, 6, 4, 4], 23: [4, 4, 7, 4, 4], 24: [4, 4, 4, 4, 4, 4]
    };

    if (table[n]) return table[n];
    if (n < 4) return [];

    let best = null, bestG = -1, memo = {};
    function f(rem) {
        if (rem === 0) return [[]]; if (rem < 4) return null; if (memo[rem]) return memo[rem];
        let r = [];
        for (let s = 4; s <= 8; s++) {
            let sub = f(rem - s);
            if (sub) sub.forEach(x => r.push([...x, s].sort((a, b) => a - b)));
        }
        let u = []; let sSet = new Set();
        r.forEach(x => {
            let k = x.join(',');
            if (!sSet.has(k)) { u.push(x); sSet.add(k); }
        });
        return memo[rem] = u;
    }
    const res = f(n);
    if (!res) return [];
    res.forEach(s => {
        let gs = s.reduce((a, b) => a + (GAME_COUNTS[b] || 0), 0);
        if (gs <= 18 && gs > bestG) { bestG = gs; best = s; }
    });
    return best || res[0] || [];
}

export function recalculateAll(context) {
    const { members, matchHistory, rankMap, sessionRankSnapshots, sessionStartRatings } = context;
    try {
        // [v41] 신규 DB 지원: 히스토리에만 있고 회원 목록에 없는 선수를 자동 등재 (로컬 복구용)
        const memberIdSet = new Set(members.map(m => String(m.id)));
        matchHistory.forEach(h => {
            const ids = [...(h.t1_ids || []), ...(h.t2_ids || [])];
            const names = [...(h.t1_names || []), ...(h.t2_names || [])];
            ids.forEach((id, idx) => {
                const sId = String(id);
                if (id && !memberIdSet.has(sId)) {
                    members.push({
                        id: sId,
                        name: names[idx] || "Unknown",
                        rating: ELO_INITIAL,
                        matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0,
                        mmr: ELO_INITIAL,
                        participationArr: [],
                        prevRating: ELO_INITIAL
                    });
                    memberIdSet.add(sId);
                }
            });
        });

        rankMap.clear();
        members.forEach(m => {
            m.rating = ELO_INITIAL; m.matchCount = 0; m.wins = 0; m.losses = 0; m.draws = 0; m.scoreDiff = 0;
            // 누적 MMR: baseMmr(시즌 시작 기준값)으로 리셋 후 재계산 (멱등성 보장)
            m.mmr = m.baseMmr !== undefined ? m.baseMmr : ELO_INITIAL;
            m.participationArr = [];
            m.prevRating = ELO_INITIAL;
            delete m.vRank;
        });

        const memberMap = new Map();
        members.forEach(m => memberMap.set(String(m.id), m));

        const sessionIds = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));

        let previousRanking = [];

        sessionIds.forEach((sId, idx) => {
            const isLastSession = idx === sessionIds.length - 1;
            if (isLastSession) {
                members.forEach(m => m.prevRating = m.rating);
                // [v43] 순위 변동 계산은 경기를 한 번이라도 치른 활성 멤버들 사이의 상대적 순위로 계산함
                previousRanking = members.filter(m => m.matchCount > 0).sort((a, b) => {
                    if (b.rating !== a.rating) return b.rating - a.rating;
                    return String(a.id).localeCompare(String(b.id));
                }).map(m => m.id);
            }

            const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);
            const ratingSnapshot = {};
            const mmrSnapshot = {};
            members.forEach(m => {
                ratingSnapshot[m.id] = m.rating;
                mmrSnapshot[m.id] = m.mmr || ELO_INITIAL;
            });

            const existingMembers = members.filter(m => m.matchCount > 0);
            const newMembers = members.filter(m => m.matchCount === 0);
            existingMembers.sort((a, b) => {
                if (b.rating !== a.rating) return b.rating - a.rating;
                return String(a.id).localeCompare(String(b.id));
            });
            newMembers.sort((a, b) => String(a.id).localeCompare(String(b.id)));
            const finalSorted = [...existingMembers, ...newMembers];
            sessionRankSnapshots[sId] = {};
            finalSorted.forEach((m, idx) => {
                sessionRankSnapshots[sId][m.id] = idx + 1;
            });

            sessionStartRatings[sId] = { ...ratingSnapshot };

            sessionMatches.forEach(h => {
                const team1 = h.t1_ids.map(id => memberMap.get(String(id))).filter(Boolean);
                const team2 = h.t2_ids.map(id => memberMap.get(String(id))).filter(Boolean);
                if (team1.length < 2 || team2.length < 2) return;

                // [시즌제 고도화] 기대승률은 MMR(누적 실력) 기준으로 계산
                const mmr1 = ((mmrSnapshot[team1[0].id] || ELO_INITIAL) + (mmrSnapshot[team1[1].id] || ELO_INITIAL)) / 2;
                const mmr2 = ((mmrSnapshot[team2[0].id] || ELO_INITIAL) + (mmrSnapshot[team2[1].id] || ELO_INITIAL)) / 2;
                const avg1 = ((ratingSnapshot[team1[0].id] || ELO_INITIAL) + (ratingSnapshot[team1[1].id] || ELO_INITIAL)) / 2;
                const avg2 = ((ratingSnapshot[team2[0].id] || ELO_INITIAL) + (ratingSnapshot[team2[1].id] || ELO_INITIAL)) / 2;
                const expected = 1 / (1 + Math.pow(10, (mmr2 - mmr1) / 400));
                let actual = h.score1 > h.score2 ? 1 : (h.score1 < h.score2 ? 0 : 0.5);
                const diff = Math.abs(h.score1 - h.score2);

                const exp1 = 1 / (1 + Math.pow(10, (mmr2 - mmr1) / 400));
                const exp2 = 1 / (1 + Math.pow(10, (mmr1 - mmr2) / 400));

                let act1 = 0.5;
                let act2 = 0.5;
                if (actual === 1) { act1 = 1; act2 = 0; }
                else if (actual === 0) { act1 = 0; act2 = 1; }

                let changeT1 = K_FACTOR * (act1 - exp1);
                let changeT2 = K_FACTOR * (act2 - exp2);

                if (diff >= 6) {
                    changeT1 *= 1.5;
                    changeT2 *= 1.5;
                }

                h.elo_at_match = { t1_before: avg1, t2_before: avg2, mmr1_before: mmr1, mmr2_before: mmr2, expected, change1: changeT1, change2: changeT2 };

                [...team1, ...team2].forEach(p => {
                    p.matchCount++;
                    if (!p.participationArr.includes(sId)) p.participationArr.push(sId);
                });

                team1.forEach(p => {
                    p.rating += changeT1;
                    p.mmr += changeT1;  // MMR 동시 업데이트
                    p.scoreDiff += (h.score1 - h.score2);
                    if (actual === 1) { p.wins++; }
                    else if (actual === 0) { p.losses++; }
                    else { p.draws++; }
                });
                team2.forEach(p => {
                    p.rating += changeT2;
                    p.mmr += changeT2;  // MMR 동시 업데이트
                    p.scoreDiff += (h.score2 - h.score1);
                    if (actual === 0) { p.wins++; }
                    else if (actual === 1) { p.losses++; }
                    else { p.draws++; }
                });
            });

            // [핵심 개선] 세션 경기 처리 후(종료 시점)의 랭킹 스냅샷 기록
            // 대시보드와 동일한 정렬 로직 적용
            const sessionEndSorted = [...members].sort((a, b) => {
                const aActive = a.matchCount > 0;
                const bActive = b.matchCount > 0;
                if (aActive !== bActive) return bActive ? 1 : -1;

                if (b.rating !== a.rating) return b.rating - a.rating;
                if (b.wins !== a.wins) return b.wins - a.wins;
                const bWinRate = b.matchCount > 0 ? b.wins / b.matchCount : 0;
                const aWinRate = a.matchCount > 0 ? a.wins / a.matchCount : 0;
                if (bWinRate !== aWinRate) return bWinRate - aWinRate;
                if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
                return String(a.name).localeCompare(String(b.name));
            });

            sessionRankSnapshots[sId] = {};
            sessionEndSorted.forEach((m, idx) => {
                sessionRankSnapshots[sId][m.id] = idx + 1;
            });

            // 세션 종료 시점의 레이팅 기록
            if (!context.sessionEndRatings) context.sessionEndRatings = {};
            context.sessionEndRatings[sId] = members.reduce((acc, m) => { acc[m.id] = m.rating; return acc; }, {});
        });

        // [v43, v59] 최종 순위 맵 업데이트: UI(랭킹보드)와 동일한 활동성 필터 적용
        const allSessionsSorted = [...sessionIds];
        const recent3 = [...allSessionsSorted].reverse().slice(0, 3);

        const currentRanking = members.filter(m => {
            if (m.matchCount === 0) return false;
            
            const isRecentlyActive = m.participationArr?.some(s => recent3.includes(s.toString()));
            const isCurrentParticipant = (context.applicants && context.applicants.some(a => String(a.id) === String(m.id))) ||
                (context.currentSchedule && context.currentSchedule.some(match =>
                    [...match.t1, ...match.t2].some(p => String(p.id) === String(m.id))
                ));
            
            return isRecentlyActive || isCurrentParticipant;
        }).sort((a, b) => {
            if (b.rating !== a.rating) return b.rating - a.rating;
            if (b.wins !== a.wins) return b.wins - a.wins;
            const bWinRate = b.matchCount > 0 ? b.wins / b.matchCount : 0;
            const aWinRate = a.matchCount > 0 ? a.wins / a.matchCount : 0;
            if (bWinRate !== aWinRate) return bWinRate - aWinRate;
            if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
            return String(a.name).localeCompare(String(b.name));
        });

        currentRanking.forEach((m, idx) => {
            const prevIdx = previousRanking.indexOf(m.id);
            let change = 0;
            if (prevIdx !== -1) change = prevIdx - idx;
            rankMap.set(String(m.id), { rank: idx + 1, change });
        });

    } catch (e) { console.error("Recalculate Error:", e); }
}

export function optimizeCourtRoundLayout(availablePool, numMatches, partners, opponents, matchMode = 'court', gameCounts) {
    let bestMatches = [];
    let bestScore = -Infinity;
    let noImprovementCount = 0; // [v64] 조기 종료를 위한 카운터

    for (let i = 0; i < 2000; i++) {
        const shuffled = [...availablePool].sort(() => Math.random() - 0.5);
        let currentMatches = [];
        let currentTotalScore = 0;
        let possible = true;

        for (let m = 0; m < numMatches; m++) {
            const p = shuffled.slice(m * 4, m * 4 + 4);
            if (p.length < 4) { possible = false; break; }

            // [v64] 파트너 중복 사전 필터링: 점수 계산 전 유효한 조합만 추출
            const combinations = [
                { t1: [p[0], p[1]], t2: [p[2], p[3]] },
                { t1: [p[0], p[2]], t2: [p[1], p[3]] },
                { t1: [p[0], p[3]], t2: [p[1], p[2]] }
            ].filter(c => {
                // 파트너 중복이 하나라도 있으면 해당 조합은 폐기
                return !partners[c.t1[0].id].has(c.t1[1].id) && !partners[c.t2[0].id].has(c.t2[1].id);
            });

            if (combinations.length === 0) { possible = false; break; }

            let bestChoice = null;
            let bestMatchScore = -Infinity;

            combinations.forEach(c => {
                let score = 0;
                
                let oppRepeat = 0;
                let maxOppRepeat = 0;
                c.t1.forEach(p1 => c.t2.forEach(p2 => {
                    const times = opponents[p1.id].get(p2.id) || 0;
                    oppRepeat += times;
                    if (times > maxOppRepeat) maxOppRepeat = times;
                }));
                
                // 상대편 중복 방지 (v63: 3회 이상 만남 금지 정책 반영)
                if (matchMode === 'court') {
                    if (maxOppRepeat >= 2) score -= 20000000; // 3번째 만남은 강력 차단
                    else if (maxOppRepeat === 1) score -= 10000; // 2번째 만남은 가급적 지양
                } else {
                    if (maxOppRepeat >= 2) score -= 20000000;
                    else score -= oppRepeat * 1000;
                }

                // 실력 균형 (ELO 차이 최소화)
                const r1 = c.t1[0].rating || 1500;
                const r2 = c.t1[1].rating || 1500;
                const r3 = c.t2[0].rating || 1500;
                const r4 = c.t2[1].rating || 1500;
                const skillDiff = Math.abs((r1 + r2) - (r3 + r4));
                score -= (skillDiff * 2); 

                if (score > bestMatchScore) {
                    bestMatchScore = score;
                    bestChoice = { team1: c.t1, team2: c.t2 };
                }
            });

            if (!bestChoice) { possible = false; break; }

            currentMatches.push(bestChoice);
            currentTotalScore += bestMatchScore;

            // 게임 횟수 형평성 유지
            p.forEach(player => {
                const lateJoinPenalty = (player.lateJoin && matchMode === 'court') ? 25000 : 0;
                currentTotalScore -= ((gameCounts[player.id] || 0) * 50000 + lateJoinPenalty);
            });
        }

        if (possible && currentTotalScore > bestScore) {
            bestScore = currentTotalScore;
            bestMatches = currentMatches;
            noImprovementCount = 0; // 개선 시 카운터 리셋
        } else {
            noImprovementCount++;
        }

        // [v64] 조기 종료 조건: 200회 연속 개선 없을 시 중단
        if (noImprovementCount >= 200) break;
    }
    return bestMatches;
}

function generateCourtSchedule(context) {
    const { currentSessionState, applicants, courtConfigs, maxGamesPerPlayer, locationKey } = context;

    const sessionNum = currentSessionState.sessionNum;
    if (!sessionNum) return null;
    if (applicants.length < 4) return null;

    const info = currentSessionState.info || '';
    let courtConfig = null;

    // [v65] Firebase에서 로드된 동적 코트 설정 우선 적용
    let targetLocationKey = locationKey;
    if (!targetLocationKey) {
        targetLocationKey = courtConfigs ? Object.keys(courtConfigs).find(key => info.includes(key)) : null;
    }

    if (targetLocationKey && courtConfigs && courtConfigs[targetLocationKey]) {
        const cfg = courtConfigs[targetLocationKey];
        courtConfig = {};
        (cfg.courts || []).forEach(c => { courtConfig[c.name] = c.maxRounds; });
    }

    // 동적 설정이 없으면 하드코딩 폴백 (하위 호환성)
    if (!courtConfig) {
        if (info.includes('중앙공원')) {
            courtConfig = { '코트 1': 5, '코트 2': 5, '코트 3': 7 };
        } else if (info.includes('CS')) {
            courtConfig = { '코트 4': 7, '코트 3': 7, '코트 2': 5 };
        }
    }

    let numRounds, roundsToCourts = {};
    if (courtConfig) {
        numRounds = Math.max(...Object.values(courtConfig));
        for (let r = 1; r <= numRounds; r++) {
            roundsToCourts[r] = Object.keys(courtConfig).filter(btn => r <= courtConfig[btn]);
        }
    } else {
        numRounds = 6;
        const defaultCourts = Math.min(3, Math.floor(applicants.length / 4));
        for (let r = 1; r <= numRounds; r++) {
            roundsToCourts[r] = Array.from({ length: defaultCourts }, (_, i) => `코트 ${i + 1}`);
        }
    }

    // [v65] 인당 최대 게임 수: context에서 전달받거나 기본값 4
    const maxGamesDefault = maxGamesPerPlayer || 4;
    const players = [...applicants];
    const gameCounts = {};
    const maxGamesMap = {};
    const partners = {};
    const opponents = {};

    // [v63] 연속 휴식 방지 및 게임 참여 균형 로직 강화
    const lastPlayedRound = {};
    players.forEach(p => {
        gameCounts[p.id] = 0;
        maxGamesMap[p.id] = maxGamesDefault; // [v65] 지각자 포함 전원 동일한 최대 게임 수
        partners[p.id] = new Set();
        opponents[p.id] = new Map();
        lastPlayedRound[p.id] = 0;
    });

    const fullScheduleData = [];

    for (let r = 1; r <= numRounds; r++) {
        const activeCourtsInRound = roundsToCourts[r] || [];
        if (activeCourtsInRound.length === 0) continue;

        // [v63] 가용 인원 풀 구성 시 연속 휴식 방지 로직 적용
        const availablePool = [...players]
            .filter(p => {
                if (gameCounts[p.id] >= maxGamesMap[p.id]) return false;
                if (r === 1 && p.lateJoin) return false; 
                return true;
            })
            // [v65] 정렬 우선순위:
            // 1순위: 2회 연속 휴식 방지 (직전 라운드 휴식자를 최상단 배치)
            // 2순위: 적게 뛴 사람 우선 (게임 수 균형)
            // 3순위: 동일 게임 수일 때 지각자를 뒤로 → 시간 부족 시 자연스럽게 3게임 대상
            // 4순위: 랜덤
            .sort((a, b) => {
                const aRested = lastPlayedRound[a.id] < r - 1;
                const bRested = lastPlayedRound[b.id] < r - 1;
                if (aRested && !bRested) return -1;
                if (!aRested && bRested) return 1;

                // [v65] 게임 수 적은 사람 최우선 → 지각자와 비지각자 모두 공평하게 게임 기회 부여
                if (gameCounts[a.id] !== gameCounts[b.id]) return gameCounts[a.id] - gameCounts[b.id];
                
                // [v65] 게임 수가 같을 때만 지각자를 뒤로 배치
                // → 마지막 라운드에서 자리 부족 시 지각자가 3게임 대상이 됨
                if (a.lateJoin !== b.lateJoin) return a.lateJoin ? 1 : -1;
                
                return Math.random() - 0.5;
            });
        const numMatches = Math.min(activeCourtsInRound.length, Math.floor(availablePool.length / 4));
        if (numMatches === 0) continue;

        // [v63] 실질적으로 경기를 뛸 인원(numMatches * 4)만 정렬된 순서대로 추출
        // 정렬 기준(이미 위에서 수행): 2회 연속 휴식 방지 > 경기수 적은 사람 > 랜덤
        const finalPoolForRound = availablePool.slice(0, numMatches * 4);

        const roundMatches = optimizeCourtRoundLayout(finalPoolForRound, numMatches, partners, opponents, 'court', gameCounts);

        for (let i = 0; i < roundMatches.length; i++) {
            const match = roundMatches[i];
            const courtName = activeCourtsInRound[i];

            const allInMatch = [...match.team1, ...match.team2];
            allInMatch.forEach(p => {
                gameCounts[p.id]++;
                lastPlayedRound[p.id] = r; // 마지막 활동 라운드 갱신
            });

            partners[match.team1[0].id].add(match.team1[1].id);
            partners[match.team1[1].id].add(match.team1[0].id);
            partners[match.team2[0].id].add(match.team2[1].id);
            partners[match.team2[1].id].add(match.team2[0].id);

            match.team1.forEach(p1 => match.team2.forEach(p2 => {
                opponents[p1.id].set(p2.id, (opponents[p1.id].get(p2.id) || 0) + 1);
                opponents[p2.id].set(p1.id, (opponents[p2.id].get(p1.id) || 0) + 1);
            }));

            fullScheduleData.push({
                id: Math.random().toString(36).substr(2, 9),
                sessionNum: sessionNum,
                group: courtName,
                groupRound: r,
                t1: [{ ...match.team1[0] }, { ...match.team1[1] }],
                t2: [{ ...match.team2[0] }, { ...match.team2[1] }],
                s1: null, s2: null
            });
        }
    }

    return {
        tempSchedule: fullScheduleData,
        activeGroupTab: '1R',
        gameCounts
    };
}

export function generateSchedule(context) {
    const {
        isAdmin, currentSessionState, sessionNumInput, customSplitInput,
        applicants, previewGroups, rankMap, members,
        courtConfigs, maxGamesPerPlayer, locationKey
    } = context;

    if (!isAdmin) return null;

    if (currentSessionState.matchMode === 'court') {
        return generateCourtSchedule({ currentSessionState, applicants, courtConfigs, maxGamesPerPlayer, locationKey });
    }

    const sessionNum = currentSessionState.sessionNum || sessionNumInput;

    if (!sessionNum) { alert('회차 정보가 없습니다. 회차를 활성화하거나 입력해주세요.'); return null; }

    let split;
    if (customSplitInput) {
        split = customSplitInput.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        const sum = split.reduce((a, b) => a + b, 0);
        if (sum !== applicants.length) { alert('커스텀 인원 합계가 신청 인원과 일치하지 않습니다.'); return null; }
    } else {
        split = getSplits(applicants.length);
    }
    if (!split || split.length === 0) { alert('인원 분할에 실패했습니다. 조별 인원을 확인해 주세요.'); return null; }

    let groupsArr = [];
    if (previewGroups && previewGroups.length > 0) {
        const actualSizes = previewGroups.map(g => g.length).sort((a, b) => a - b);
        const expectedSizes = [...split].sort((a, b) => a - b);
        const isMatch = actualSizes.length === expectedSizes.length && actualSizes.every((v, i) => v === expectedSizes[i]);
        if (!isMatch) {
            const actualStr = previewGroups.map((g, i) => `${String.fromCharCode(65 + i)}조: ${g.length}명`).join(', ');
            const expectedStr = split.join(', ');
            alert(`조별 인원 배분이 기준과 맞지 않습니다.\n\n현재: ${actualStr}\n기준: ${expectedStr}분할\n\n선수를 드래그하여 조 편성을 조정해 주세요.`);
            return null;
        }

        const allNewInPreview = [];
        previewGroups.forEach(group => {
            group.forEach(p => {
                if (!rankMap.has(String(p.id))) {
                    allNewInPreview.push(p);
                }
            });
        });

        allNewInPreview.sort(() => Math.random() - 0.5);

        let startVRank = members.length + 1;
        allNewInPreview.forEach(p => {
            p.vRank = startVRank++;
        });

        previewGroups.forEach(group => {
            groupsArr.push([...group]);
        });
    } else {
        const sorted = [...applicants].sort((a, b) => {
            const rA = a.rating || 1500;
            const rB = b.rating || 1500;
            if (rB !== rA) return rB - rA;

            const mA = a.mmr || 1500;
            const mB = b.mmr || 1500;
            if (mB !== mA) return mB - mA;

            return String(a.name).localeCompare(String(b.name));
        });
        
        let startVRank = members.length + 1;
        sorted.forEach(p => {
            if (!rankMap.has(String(p.id))) {
                p.vRank = startVRank++;
            }
        });
        let cur = 0;
        split.forEach(s => {
            const groupMembers = sorted.slice(cur, cur + s);
            if (groupMembers.length >= 4) groupsArr.push(groupMembers);
            cur += s;
        });
    }

    // [v6.4.1] 지각자 조 분산 배치 세분화: 
    // 조 인원이 4명인데 지각자가 포함된 경우, 1라운드 매칭이 불가능하므로 뒤쪽(Wait 슬롯)으로 배치합니다.
    // 5인 이상의 조는 지각자가 있어도 나머지 4명이 1라운드를 뛸 수 있으므로 배정 순서를 조정하지 않습니다.
    groupsArr.sort((a, b) => {
        const aImpact = (a.length === 4 && a.some(p => p.lateJoin)) ? 1 : 0;
        const bImpact = (b.length === 4 && b.some(p => p.lateJoin)) ? 1 : 0;
        return aImpact - bImpact;
    });

    let tempSchedule = [];
    const gameCounts = {};
    applicants.forEach(a => gameCounts[a.id] = 0);

    const partners = {};
    const opponents = {};
    applicants.forEach(p => {
        partners[p.id] = new Set();
        opponents[p.id] = new Map();
    });

    for (let groupIdx = 0; groupIdx < groupsArr.length; groupIdx++) {
        const g = groupsArr[groupIdx];
        const gLabel = String.fromCharCode(65 + groupIdx);
        const groupSize = g.length;
        const defaultTarget = groupSize === 4 ? 3 : 4;
        
        const targetGamesPerPlayer = {};
        g.forEach(p => {
            targetGamesPerPlayer[p.id] = defaultTarget;
        });

        // [v7.0] 결정론적 전수 탐색을 이용한 조별리그 대진 생성
        let matchSchedule = generateGroupScheduleDeterministic(g, targetGamesPerPlayer);

        if (matchSchedule) {
            matchSchedule.forEach((m, matchIdx) => {
                const r = g.length === 8 ? Math.floor(matchIdx / 2) + 1 : matchIdx + 1;
                tempSchedule.push({
                    id: Math.random().toString(36).substr(2, 9),
                    sessionNum: currentSessionState.sessionNum || sessionNum,
                    group: gLabel,
                    groupRound: r,
                    t1: [{ ...m.t1[0] }, { ...m.t1[1] }],
                    t2: [{ ...m.t2[0] }, { ...m.t2[1] }],
                    s1: null,
                    s2: null
                });
                [...m.t1, ...m.t2].forEach(p => {
                    gameCounts[p.id] = (gameCounts[p.id] || 0) + 1;
                });
            });
        } else {
            // [v7.3] 생성 실패 시 상세 사유 안내 추가
            const is8 = g.length === 8;
            const msg = is8 
                ? `[${gLabel}조] 8인 대진표 생성에 실패했습니다. 내부 논리 오류일 수 있습니다.`
                : `[${gLabel}조] 대진표 생성에 실패했습니다.\n- 사유: 지각자 설정 등으로 인해 모든 선수가 만족하는 파트너 중복 방지 대진을 찾을 수 없습니다.`;
            alert(msg);
            return null;
        }
    }

    return {
        tempSchedule,
        activeGroupTab: 'A',
        gameCounts,
        previewGroups: null
    };
}

// ============================================================
// [v7.0] 결정론적 조별 대진표 생성 알고리즘
// 동일 입력(선수 구성 + ELO) → 항상 동일 출력 보장
// ============================================================
function generateGroupScheduleDeterministic(group, targetGamesPerPlayer) {
  // ── [v7.4] 8인 조 전용 특수 알고리즘: 상/하위 그룹 분할 + 최종 믹스 ──
  // 사용자 제안: 상위 4명/하위 4명 각각 리그 진행 후, 마지막 라운드에서 교차 매칭
  if (group.length === 8) {
    // 1. ELO 점수 기준 정렬
    const sorted = [...group].sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return String(a.id).localeCompare(String(b.id));
    });

    const top = sorted.slice(0, 4);
    const bot = sorted.slice(4, 8);

    // 2. 1~3 라운드: 상위 4명끼리, 하위 4명끼리 경기 (Round Robin)
    // 패턴: [0,1 vs 2,3], [0,2 vs 1,3], [0,3 vs 1,2]
    const rrPairs = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
    const schedule = [];

    const getBestPairing = (p4) => {
      // 4인 조 내에서 ELO 차이가 가장 적은 2v2 팀 구성을 반환
      const p = p4;
      const options = [
        { t1: [p[0], p[1]], t2: [p[2], p[3]], diff: Math.abs((p[0].rating+p[1].rating) - (p[2].rating+p[3].rating)) },
        { t1: [p[0], p[2]], t2: [p[1], p[3]], diff: Math.abs((p[0].rating+p[2].rating) - (p[1].rating+p[3].rating)) },
        { t1: [p[0], p[3]], t2: [p[1], p[2]], diff: Math.abs((p[0].rating+p[3].rating) - (p[1].rating+p[2].rating)) }
      ];
      return options.sort((a, b) => a.diff - b.diff)[0];
    };

    // 1~3 라운드 생성 (총 6경기)
    for (let r = 0; r < 3; r++) {
      const pIdx = rrPairs[r];
      const matchTopMembers = [top[pIdx[0]], top[pIdx[1]], top[pIdx[2]], top[pIdx[3]]];
      const matchBotMembers = [bot[pIdx[0]], bot[pIdx[1]], bot[pIdx[2]], bot[pIdx[3]]];
      
      const mTop = getBestPairing(matchTopMembers);
      const mBot = getBestPairing(matchBotMembers);
      
      schedule.push(mTop, mBot); // 라운드별로 상위/하위 경기 하나씩 추가
    }

    // 3. 4 라운드: 상/하위 믹스 매치 (파트너 중복 방지를 위해 새로운 조합)
    // 상위-하위 섞기 위한 결정론적 조합: [S1, S2, H1, H2] & [S3, S4, H3, H4]
    const mix1Members = [top[0], top[1], bot[0], bot[1]];
    const mix2Members = [top[2], top[3], bot[2], bot[3]];
    
    schedule.push(getBestPairing(mix1Members), getBestPairing(mix2Members));
    
    return schedule;
  }

  const TARGET = targetGamesPerPlayer[group[0].id];

  // ── STEP 1: 고유 경기 조합 생성 (팀 순서 중복 제거, 결정론적 정렬) ──
  function buildUniqCombos(pool) {
    const combos = [], seen = new Set();
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const t1 = [pool[i], pool[j]];
        const rest = pool.filter(p => p.id !== t1[0].id && p.id !== t1[1].id);
        for (let k = 0; k < rest.length; k++) {
          for (let l = k + 1; l < rest.length; l++) {
            const t2 = [rest[k], rest[l]];
            const key = [
              t1.map(p => p.id).sort((a, b) => a - b).join(','),
              t2.map(p => p.id).sort((a, b) => a - b).join(',')
            ].sort().join('|');
            if (!seen.has(key)) {
              seen.add(key);
              const s1 = t1[0].rating + t1[1].rating;
              const s2 = t2[0].rating + t2[1].rating;
              const [ft1, ft2] = s1 >= s2 ? [t1, t2] : [t2, t1];
              combos.push({
                t1: ft1, t2: ft2,
                s1: Math.max(s1, s2),
                s2: Math.min(s1, s2),
                eloDiff: Math.abs(s1 - s2),
                id: [
                  ft1.map(p => p.id).sort((a, b) => a - b).join(''),
                  ft2.map(p => p.id).sort((a, b) => a - b).join('')
                ].join('v')
              });
            }
          }
        }
      }
    }
    // 결정론적 정렬: eloDiff↑ → s1↓ → id (DFS 탐색 순서도 고정)
    return combos.sort((a, b) =>
      a.eloDiff !== b.eloDiff ? a.eloDiff - b.eloDiff :
      b.s1 !== a.s1 ? b.s1 - a.s1 :
      a.id.localeCompare(b.id)
    );
  }

  // ── STEP 2: 모든 제약을 만족하는 완전 세트 전수 탐색 ──
  function findAllSets(allCombos) {
    const sets = [];
    const numMatches = Math.floor(group.reduce((acc, p) => acc + TARGET, 0) / 4);
    const MAX_SETS = group.length >= 7 ? 500 : Infinity; // 7명 이상: 500세트 제한

    function dfs(idx, chosen, gc, pt, op) {
      if (sets.length >= MAX_SETS) return; // 조기 종료
      if (chosen.length === numMatches) {
        if (group.every(p => gc[p.id] === TARGET)) sets.push([...chosen]);
        return;
      }
      for (let i = idx; i < allCombos.length; i++) {
        if (sets.length >= MAX_SETS) return; // 조기 종료
        const c = allCombos[i];
        const four = [...c.t1, ...c.t2];

        if (four.some(p => gc[p.id] >= TARGET)) continue;
        if (pt[c.t1[0].id].has(c.t1[1].id)) continue;
        if (pt[c.t2[0].id].has(c.t2[1].id)) continue;

        let oppFail = false;
        c.t1.forEach(p1 => c.t2.forEach(p2 => {
          if ((op[p1.id].get(p2.id) || 0) >= 2) oppFail = true;
        }));
        if (oppFail) continue;

        // [v7.1] 8인 조 전용 전원 출전 제약 조건:
        // 한 라운드(2개 경기) 내에서 선수 중복이 없어야 함 (8명 전원 경기)
        if (group.length === 8 && chosen.length % 2 === 1) {
          const prevMatch = chosen[chosen.length - 1];
          const prevPlayers = new Set([...prevMatch.t1, ...prevMatch.t2].map(p => p.id));
          if (four.some(p => prevPlayers.has(p.id))) continue;
        }

        const ng = { ...gc };
        four.forEach(p => ng[p.id]++);

        const np = {};
        group.forEach(p => np[p.id] = new Set([...pt[p.id]]));
        np[c.t1[0].id].add(c.t1[1].id); np[c.t1[1].id].add(c.t1[0].id);
        np[c.t2[0].id].add(c.t2[1].id); np[c.t2[1].id].add(c.t2[0].id);

        const no = {};
        group.forEach(p => no[p.id] = new Map([...op[p.id]]));
        c.t1.forEach(p1 => c.t2.forEach(p2 => {
          no[p1.id].set(p2.id, (no[p1.id].get(p2.id) || 0) + 1);
          no[p2.id].set(p1.id, (no[p2.id].get(p1.id) || 0) + 1);
        }));

        dfs(i + 1, [...chosen, c], ng, np, no);
      }
    }

    const g0 = {}, p0 = {}, o0 = {};
    group.forEach(p => { g0[p.id] = 0; p0[p.id] = new Set(); o0[p.id] = new Map(); });
    dfs(0, [], g0, p0, o0);
    return sets;
  }

  // ── STEP 3: 세트 점수화 (결정론적 4단계 기준) ──
  function scoreSet(s) {
    const diffs = s.map(c => c.eloDiff).sort((a, b) => a - b);
    return {
      totalDiff: diffs.reduce((a, b) => a + b, 0), // 1순위: ELO차이 합산 최소
      maxDiff:   Math.max(...diffs),                // 2순위: 최대 단일경기 차이 최소
      diffSeq:   diffs.join(','),                   // 3순위: 차이 분포 사전순
      setKey:    s.map(c => c.id).sort().join('|')   // 4순위: 완전 동점 tie-break
    };
  }

  // ── STEP 4: 라운드 배정 (연속 휴식 방지 + 지각자 R1 제외, DFS 기반) ──
  function assignRounds(set) {
    // 4명 조(전원 출전, 휴식자 없음)는 단순 정렬로 충분
    if (group.length === 4) {
      return [...set].sort((a, b) => {
        const aLate = [...a.t1, ...a.t2].some(p => p.lateJoin);
        const bLate = [...b.t1, ...b.t2].some(p => p.lateJoin);
        if (aLate !== bLate) return aLate ? 1 : -1;
        if (a.eloDiff !== b.eloDiff) return a.eloDiff - b.eloDiff;
        return a.id.localeCompare(b.id);
      });
    }

    // 5명 이상: DFS 기반 라운드 배정 (연속 휴식 방지 하드 제약)
    const n = set.length;
    const used = new Array(n).fill(false);
    const result = new Array(n).fill(null);
    const lastPlayed = {};
    group.forEach(p => lastPlayed[p.id] = 0);

    function tryAssign(round) {
      if (round > n) return true;

      // 후보를 결정론적 순서로 정렬: 지각자 경기 R1 제외 → ELO차이 작은 순 → id
      const candidates = set
        .map((c, i) => ({ c, i }))
        .filter(({ i }) => !used[i])
        .sort((a, b) => {
          const aLate = [...a.c.t1, ...a.c.t2].some(p => p.lateJoin);
          const bLate = [...b.c.t1, ...b.c.t2].some(p => p.lateJoin);
          if (round === 1 && aLate !== bLate) return aLate ? 1 : -1;
          if (a.c.eloDiff !== b.c.eloDiff) return a.c.eloDiff - b.c.eloDiff;
          if (a.c.s1 !== b.c.s1) return b.c.s1 - a.c.s1;
          return a.c.id.localeCompare(b.c.id);
        });

      for (const { c, i } of candidates) {
        // 연속 휴식 체크 (5~6명 조에서만 적용: 1~2명만 쉬므로 연속 방지 가능)
        // 7명 이상은 매 라운드 3명+ 가 쉬므로 연속 휴식이 구조적으로 불가피
        if (group.length <= 6) {
          const playing = new Set([...c.t1, ...c.t2].map(p => p.id));
          let restFail = false;
          for (const p of group) {
            if (!playing.has(p.id) && round > 1 && lastPlayed[p.id] < round - 1) {
              restFail = true; break;
            }
          }
          if (restFail) continue;
        }

        // 이 매치를 round에 배정
        used[i] = true;
        result[round - 1] = c;
        const prev = {};
        [...c.t1, ...c.t2].forEach(p => { prev[p.id] = lastPlayed[p.id]; lastPlayed[p.id] = round; });

        if (tryAssign(round + 1)) return true;

        // 백트래킹
        used[i] = false;
        result[round - 1] = null;
        [...c.t1, ...c.t2].forEach(p => { lastPlayed[p.id] = prev[p.id]; });
      }
      return false;
    }

    if (tryAssign(1)) {
      return result;
    }
    // 라운드 배정 실패 시 폴백: 단순 정렬 (연속 휴식 가능하지만 대진 자체는 유효)
    return [...set].sort((a, b) => {
      if (a.eloDiff !== b.eloDiff) return a.eloDiff - b.eloDiff;
      return a.id.localeCompare(b.id);
    });
  }

  // ── 실행 ──
  const allCombos = buildUniqCombos(group);
  const allSets   = findAllSets(allCombos);

  if (allSets.length === 0) return null;

  const best = allSets
    .map(s => ({ set: s, score: scoreSet(s) }))
    .sort((a, b) => {
      const sa = a.score, sb = b.score;
      if (sa.totalDiff !== sb.totalDiff) return sa.totalDiff - sb.totalDiff;
      if (sa.maxDiff   !== sb.maxDiff)   return sa.maxDiff   - sb.maxDiff;
      if (sa.diffSeq   !== sb.diffSeq)   return sa.diffSeq.localeCompare(sb.diffSeq);
      return sa.setKey.localeCompare(sb.setKey);
    })[0];

  const ordered = assignRounds(best.set);
  if (!ordered) return null;

  // 현행 generateGroupScheduleDFS와 동일한 반환 형식 유지
  return ordered.map(c => ({
    t1: c.t1,
    t2: c.t2,
    prevLastPlayed: {}
  }));
}
