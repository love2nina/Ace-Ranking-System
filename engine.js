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
        12: [4, 4, 4], 13: [5, 4, 4], 14: [5, 5, 4], 15: [5, 5, 5],
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
        rankMap.clear();
        members.forEach(m => {
            m.rating = ELO_INITIAL; m.matchCount = 0; m.wins = 0; m.losses = 0; m.draws = 0; m.scoreDiff = 0;
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
                previousRanking = [...members].sort((a, b) => {
                    if (b.rating !== a.rating) return b.rating - a.rating;
                    return String(a.id).localeCompare(String(b.id));
                }).map(m => m.id);
            }

            const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);
            const ratingSnapshot = {};
            members.forEach(m => { ratingSnapshot[m.id] = m.rating; });

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

                const avg1 = ((ratingSnapshot[team1[0].id] || ELO_INITIAL) + (ratingSnapshot[team1[1].id] || ELO_INITIAL)) / 2;
                const avg2 = ((ratingSnapshot[team2[0].id] || ELO_INITIAL) + (ratingSnapshot[team2[1].id] || ELO_INITIAL)) / 2;
                const expected = 1 / (1 + Math.pow(10, (avg2 - avg1) / 400));
                let actual = h.score1 > h.score2 ? 1 : (h.score1 < h.score2 ? 0 : 0.5);
                const diff = Math.abs(h.score1 - h.score2);

                const exp1 = 1 / (1 + Math.pow(10, (avg2 - avg1) / 400));
                const exp2 = 1 / (1 + Math.pow(10, (avg1 - avg2) / 400));

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

                h.elo_at_match = { t1_before: avg1, t2_before: avg2, expected, change1: changeT1, change2: changeT2 };

                [...team1, ...team2].forEach(p => {
                    p.matchCount++;
                    if (!p.participationArr.includes(sId)) p.participationArr.push(sId);
                });

                team1.forEach(p => {
                    p.rating += changeT1;
                    p.scoreDiff += (h.score1 - h.score2);
                    if (actual === 1) { p.wins++; }
                    else if (actual === 0) { p.losses++; }
                    else { p.draws++; }
                });
                team2.forEach(p => {
                    p.rating += changeT2;
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

        const currentRanking = [...members].sort((a, b) => {
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

export function optimizeCourtRoundLayout(players, partners, opponents) {
    let bestMatches = [];
    let bestScore = -Infinity;
    const numMatches = players.length / 4;

    for (let i = 0; i < 500; i++) {
        const shuffled = [...players].sort(() => Math.random() - 0.5);
        let currentMatches = [];
        let currentTotalScore = 0;

        for (let m = 0; m < numMatches; m++) {
            const p = shuffled.slice(m * 4, m * 4 + 4);
            const combinations = [
                { t1: [p[0], p[1]], t2: [p[2], p[3]] },
                { t1: [p[0], p[2]], t2: [p[1], p[3]] },
                { t1: [p[0], p[3]], t2: [p[1], p[2]] }
            ];

            let bestChoice = null;
            let bestMatchScore = -Infinity;

            combinations.forEach(c => {
                let score = 0;
                if (partners[c.t1[0].id].has(c.t1[1].id)) score -= 100000;
                if (partners[c.t2[0].id].has(c.t2[1].id)) score -= 100000;

                let oppRepeat = 0;
                c.t1.forEach(p1 => c.t2.forEach(p2 => {
                    oppRepeat += (opponents[p1.id].get(p2.id) || 0);
                }));
                score -= oppRepeat * 500;

                const r1 = c.t1[0].rating || 1500;
                const r2 = c.t1[1].rating || 1500;
                const r3 = c.t2[0].rating || 1500;
                const r4 = c.t2[1].rating || 1500;
                const skillDiff = Math.abs((r1 + r2) - (r3 + r4));
                score -= skillDiff;

                if (score > bestMatchScore) {
                    bestMatchScore = score;
                    bestChoice = { team1: c.t1, team2: c.t2 };
                }
            });

            currentMatches.push(bestChoice);
            currentTotalScore += bestMatchScore;
        }

        if (currentTotalScore > bestScore) {
            bestScore = currentTotalScore;
            bestMatches = currentMatches;
        }
    }
    return bestMatches;
}

function generateCourtSchedule(context) {
    const { currentSessionState, applicants } = context;

    const sessionNum = currentSessionState.sessionNum;
    if (!sessionNum) { alert('회차 정보가 없습니다.'); return null; }
    if (applicants.length < 4) { alert('최소 4명 이상의 선수가 필요합니다.'); return null; }

    const info = currentSessionState.info || '';
    let courtConfig = null;

    if (info.includes('중앙공원')) {
        courtConfig = { '코트 1': 5, '코트 2': 5, '코트 3': 7 };
    } else if (info.includes('CS')) {
        courtConfig = { '코트 4': 7, '코트 3': 7, '코트 2': 5 };
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

    const maxGamesPerPlayer = 4;
    const players = [...applicants];
    const gameCounts = {};
    const partners = {};
    const opponents = {};

    players.forEach(p => {
        gameCounts[p.id] = 0;
        partners[p.id] = new Set();
        opponents[p.id] = new Map();
    });

    const fullScheduleData = [];

    for (let r = 1; r <= numRounds; r++) {
        const activeCourtsInRound = roundsToCourts[r] || [];
        if (activeCourtsInRound.length === 0) continue;

        const availablePool = [...players]
            .filter(p => gameCounts[p.id] < maxGamesPerPlayer)
            .sort((a, b) => {
                if (gameCounts[a.id] !== gameCounts[b.id]) return gameCounts[a.id] - gameCounts[b.id];

                const noiseA = (Math.random() - 0.5) * 100;
                const noiseB = (Math.random() - 0.5) * 100;
                const scoreA = (a.rating || 1500) + noiseA;
                const scoreB = (b.rating || 1500) + noiseB;

                return scoreB - scoreA;
            });

        const numMatches = Math.min(activeCourtsInRound.length, Math.floor(availablePool.length / 4));
        const roundPlayers = availablePool.slice(0, numMatches * 4);

        if (numMatches === 0) continue;

        const roundMatches = optimizeCourtRoundLayout(roundPlayers, partners, opponents);

        for (let i = 0; i < roundMatches.length; i++) {
            const match = roundMatches[i];
            const courtName = activeCourtsInRound[i];

            const allInMatch = [...match.team1, ...match.team2];
            allInMatch.forEach(p => gameCounts[p.id]++);

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
        applicants, previewGroups, rankMap, members
    } = context;

    if (!isAdmin) return null;

    if (currentSessionState.matchMode === 'court') {
        return generateCourtSchedule({ currentSessionState, applicants });
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
        const rankedArr = applicants.filter(a => rankMap.has(String(a.id))).sort((a, b) => b.rating - a.rating);
        const newArr = applicants.filter(a => !rankMap.has(String(a.id)));
        newArr.sort(() => Math.random() - 0.5);
        let startVRank = members.length + 1;
        newArr.forEach(p => { p.vRank = startVRank++; });
        const sorted = [...rankedArr, ...newArr];
        let cur = 0;
        split.forEach(s => {
            const groupMembers = sorted.slice(cur, cur + s);
            if (groupMembers.length >= 4) groupsArr.push(groupMembers);
            cur += s;
        });
    }

    let tempSchedule = [];
    const gameCounts = {};
    applicants.forEach(a => gameCounts[a.id] = 0);

    groupsArr.forEach((g, groupIdx) => {
        const pattern = MATCH_PATTERNS[g.length]; if (!pattern) return;

        const optimizedGroup = g;
        const gLabel = String.fromCharCode(65 + groupIdx);

        pattern.forEach((m, matchIdx) => {
            let roundNum = Math.floor(matchIdx / (g.length === 8 ? 2 : 1)) + 1;
            const matchData = {
                id: Math.random().toString(36).substr(2, 9),
                sessionNum: currentSessionState.sessionNum || sessionNum,
                group: gLabel, groupRound: roundNum,
                t1: [{ ...optimizedGroup[m[0][0]] }, { ...optimizedGroup[m[0][1]] }],
                t2: [{ ...optimizedGroup[m[1][0]] }, { ...optimizedGroup[m[1][1]] }],
                s1: null, s2: null
            };
            tempSchedule.push(matchData);

            [...matchData.t1, ...matchData.t2].forEach(p => {
                gameCounts[p.id] = (gameCounts[p.id] || 0) + 1;
            });
        });
    });

    return {
        tempSchedule,
        activeGroupTab: 'A',
        gameCounts,
        previewGroups: null
    };
}
