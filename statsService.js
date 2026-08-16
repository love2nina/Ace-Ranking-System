/**
 * ACE 랭킹 시스템 - 고도화 통계 서비스 (Utility)
 * 모든 함수는 Immutable 원칙을 준수하며 원본 데이터를 수정하지 않습니다.
 */

const WIN_STREAK_THRESHOLD = 3;
const PARTNER_MIN_GAMES = 3;

/**
 * 1. 뱃지 현황 계산
 */
export const calculateBadges = (members, matchHistory, mode = 'season') => {
    if (!members || !matchHistory) return {
        bagelMasters: {names: [], count: 0}, hotStreaks: [], swampGuards: {names: [], count: 0},
        ironMen: [], topAcorns: [], nationalPartners: {names: [], count: 0},
        nemesisMakers: {names: [], count: 0}, kingSlayers: {names: [], count: 0},
        attendanceKings: {names: [], count: 0}
    };

    // --- 1. 베이글 장인 ---
    const bagelCounts = members.map(m => {
        let count = 0;
        if (mode === 'cumulative' && m.cumulativeStats) count += (m.cumulativeStats.totalBagels || 0);
        else {
            count = matchHistory.filter(match => {
                const isParticipating = [...match.t1_ids, ...match.t2_ids].some(id => String(id) === String(m.id));
                if (!isParticipating) return false;
                const isT1 = match.t1_ids.some(id => String(id) === String(m.id));
                const myScore = isT1 ? match.score1 : match.score2;
                const opScore = isT1 ? match.score2 : match.score1;
                return (myScore === 6 && opScore === 0);
            }).length;
        }
        return { name: m.name, count };
    });
    const maxBagels = Math.max(...bagelCounts.map(m => m.count), 0);
    const bagelMasters = maxBagels > 0 
        ? { names: bagelCounts.filter(m => m.count === maxBagels).map(m => m.name), count: maxBagels }
        : { names: [], count: 0 };

    // --- 2. 불타는 연승 --- (항상 현재 진행형이므로 mode 상관없이 현재 시즌 기록 최우선, 또는 누적이면 이전 기록 무시하고 현재 연승만 측정)
    const hotStreaks = members.filter(member => {
        const myMatches = matchHistory
            .filter(m => [...m.t1_ids, ...m.t2_ids].some(id => String(id) === String(member.id)))
            .sort((a, b) => b.sessionNum - a.sessionNum || b.id - a.id);
        let streak = 0;
        for (const match of myMatches) {
            const isT1 = match.t1_ids.some(id => String(id) === String(member.id));
            const isWin = isT1 ? match.score1 > match.score2 : match.score2 > match.score1;
            const isDraw = match.score1 === match.score2;
            if (isWin) streak++;
            else if (isDraw) continue;
            else break;
        }
        return streak >= WIN_STREAK_THRESHOLD;
    }).map(m => m.name);

    // --- 3. 늪지대 방어군 ---
    const drawCounts = members.map(m => {
        const count = matchHistory.filter(match => {
            const isParticipating = [...match.t1_ids, ...match.t2_ids].some(id => String(id) === String(m.id));
            return isParticipating && match.score1 === 5 && match.score2 === 5;
        }).length;
        // 누적의 경우 cumulativeStats에 5:5 횟수만 따로 없으므로 현재 시즌만 계산(근사)
        return { id: m.id, name: m.name, count };
    });
    const maxDraws = Math.max(...drawCounts.map(d => d.count), 0);
    const swampGuards = maxDraws > 0 ? { names: drawCounts.filter(d => d.count === maxDraws).map(m => m.name), count: maxDraws } : { names: [], count: 0 };

    // --- 4. 코트의 철인 ---
    const matchCounts = members.map(m => {
        let count = m.matchCount || 0;
        if (mode === 'cumulative' && m.cumulativeStats) count += (m.cumulativeStats.totalMatches || 0);
        return { name: m.name, count };
    });
    const maxMatches = Math.max(...matchCounts.map(m => m.count), 0);
    const ironMen = maxMatches > 0 ? matchCounts.filter(m => m.count === maxMatches).map(m => m.name) : [];

    // --- 5. 최고의 도토리 ---
    const activeForAcorn = members.filter(m => mode === 'cumulative' 
        ? (m.matchCount > 0 || (m.cumulativeStats && m.cumulativeStats.totalMatches > 0) || (m.prevSeasonStats && Object.keys(m.prevSeasonStats).length > 0))
        : m.matchCount > 0
    );
    const getScore = m => mode === 'cumulative' ? (m.mmr || 0) : (m.rating || 0);
    const maxScore = Math.max(...activeForAcorn.map(getScore), 0);
    const topAcorns = maxScore > 0 ? activeForAcorn.filter(m => getScore(m) === maxScore).map(m => m.name) : [];

    // --- 6. 국민파트너 --- (함께 뛴 파트너 수 최다)
    const partnerCounts = members.map(m => {
        let count = 0;
        if (mode === 'cumulative' && m.cumulativeStats) {
            count = m.cumulativeStats.uniquePartners || 0;
        } else {
            const partners = new Set();
            matchHistory.forEach(match => {
                const isT1 = match.t1_ids.some(id => String(id) === String(m.id));
                const isT2 = match.t2_ids.some(id => String(id) === String(m.id));
                if (isT1) match.t1_ids.forEach(id => { if (String(id) !== String(m.id)) partners.add(String(id)); });
                if (isT2) match.t2_ids.forEach(id => { if (String(id) !== String(m.id)) partners.add(String(id)); });
            });
            count = partners.size;
        }
        return { name: m.name, count };
    });
    const maxPartners = Math.max(...partnerCounts.map(m => m.count), 0);
    const nationalPartners = maxPartners > 0 ? { names: partnerCounts.filter(m => m.count === maxPartners).map(m => m.name), count: maxPartners } : { names: [], count: 0 };

    // --- 7. 천적 제조기 ---
    const nemesisMakerCounts = members.map(m => {
        let makerCount = 0;
        const oppStats = {};
        if (mode === 'cumulative' && m.prevSeasonStats) {
            Object.entries(m.prevSeasonStats).forEach(([oppId, stats]) => {
                if (!oppStats[oppId]) oppStats[oppId] = { wins: 0, games: 0 };
                oppStats[oppId].wins += stats.wins || 0;
                oppStats[oppId].games += (stats.wins || 0) + (stats.losses || 0) + (stats.draws || 0);
            });
        }
        matchHistory.forEach(match => {
            const isT1 = match.t1_ids.some(id => String(id) === String(m.id));
            const isT2 = match.t2_ids.some(id => String(id) === String(m.id));
            if (!isT1 && !isT2) return;
            const won = (isT1 && match.score1 > match.score2) || (isT2 && match.score2 > match.score1);
            const opps = isT1 ? match.t2_ids : match.t1_ids;
            opps.forEach(oppId => {
                const idStr = String(oppId);
                if (!oppStats[idStr]) oppStats[idStr] = { wins: 0, games: 0 };
                if (won) oppStats[idStr].wins++;
                oppStats[idStr].games++;
            });
        });
        
        Object.values(oppStats).forEach(st => {
            if (st.games >= 3 && (st.wins / st.games) >= 0.8) makerCount++; // 80% 이상 승률을 기준으로 완화
        });
        return { name: m.name, count: makerCount };
    });
    const maxNemesisMakers = Math.max(...nemesisMakerCounts.map(m => m.count), 0);
    const nemesisMakers = maxNemesisMakers > 0 ? { names: nemesisMakerCounts.filter(m => m.count === maxNemesisMakers).map(m => m.name), count: maxNemesisMakers } : { names: [], count: 0 };

    // --- 8. 킹슬레이어 ---
    const slayerCounts = members.map(m => {
        let count = 0;
        if (mode === 'cumulative' && m.cumulativeStats) count += (m.cumulativeStats.kingsSlayerCount || 0);
        else {
            matchHistory.forEach(match => {
                const isT1 = match.t1_ids.some(id => String(id) === String(m.id));
                const isT2 = match.t2_ids.some(id => String(id) === String(m.id));
                if (!isT1 && !isT2) return;
                const won = (isT1 && match.score1 > match.score2) || (isT2 && match.score2 > match.score1);
                if (won && match.elo_at_match) {
                    const myMmr = isT1 ? match.elo_at_match.mmr1_before : match.elo_at_match.mmr2_before;
                    const oppMmr = isT1 ? match.elo_at_match.mmr2_before : match.elo_at_match.mmr1_before;
                    if (oppMmr > myMmr) count++;
                }
            });
        }
        return { name: m.name, count };
    });
    const maxSlayers = Math.max(...slayerCounts.map(m => m.count), 0);
    const kingSlayers = maxSlayers > 0 ? { names: slayerCounts.filter(m => m.count === maxSlayers).map(m => m.name), count: maxSlayers } : { names: [], count: 0 };

    // --- 9. 출석왕 ---
    const attCounts = members.map(m => {
        let count = 0;
        if (mode === 'cumulative' && m.cumulativeStats) {
            count = Math.max(m.cumulativeStats.maxConsecutiveAttendance || 0, m.participationArr ? m.participationArr.length : 0);
        } else {
            count = m.participationArr ? m.participationArr.length : 0; // 이번 시즌 출석 횟수
        }
        return { name: m.name, count };
    });
    const maxAtt = Math.max(...attCounts.map(m => m.count), 0);
    const attendanceKings = maxAtt > 0 ? { names: attCounts.filter(m => m.count === maxAtt).map(m => m.name), count: maxAtt } : { names: [], count: 0 };

    return {
        bagelMasters,
        hotStreaks,
        swampGuards,
        ironMen,
        topAcorns,
        nationalPartners,
        nemesisMakers,
        kingSlayers,
        attendanceKings
    };
};

/**
 * 2. 개인별 인맥 통계 계산
 */
export const getPlayerInsights = (targetId, members, matchHistory) => {
    if (!targetId || !members || !matchHistory) return null;

    const targetMember = members.find(m => m.id.toString() === targetId.toString());
    const prevStats = (targetMember && targetMember.prevSeasonStats) ? targetMember.prevSeasonStats : {};

    const myMatches = matchHistory.filter(m =>
        m.t1_ids.some(id => id.toString() === targetId.toString()) ||
        m.t2_ids.some(id => id.toString() === targetId.toString())
    );

    // 파트너 및 상대 분석용 맵
    const partnerStats = new Map(); // key: partnerId, value: { wins, losses, eloGain, games }
    const antagonistStats = new Map(); // key: opponentId, value: { eloLost }

    // [시즌 고도화] 이전 시즌 요약 데이터(방안 C) 먼저 반영
    // 이전 시즌 요약에는 '상대팀'으로서의 전적만 압축되어 있음 (천적 위주)
    Object.entries(prevStats).forEach(([oppId, stats]) => {
        // 상대 분석 (천적) 초기화
        const antag = antagonistStats.get(oppId) || { wins: 0, losses: 0, draws: 0, games: 0, netEloChange: 0 };
        // 이전 시즌의 net ELO change 합산
        antag.netEloChange += stats.eloGain || 0;
        antagonistStats.set(oppId, antag);
    });

    myMatches.forEach(match => {
        const isT1 = match.t1_ids.map(id => id.toString()).includes(targetId.toString());
        const myTeamIds = isT1 ? match.t1_ids : match.t2_ids;
        const opTeamIds = isT1 ? match.t2_ids : match.t1_ids;

        const isWin = isT1 ? match.score1 > match.score2 : match.score2 > match.score1;
        const isLoss = isT1 ? match.score1 < match.score2 : match.score2 < match.score1;
        const isDraw = match.score1 === match.score2;

        // ELO 기준
        const eloChange = match.elo_at_match ? (isT1 ? match.elo_at_match.change1 : match.elo_at_match.change2) : 0;

        // 파트너 분석
        myTeamIds.forEach(id => {
            if (id.toString() === targetId.toString()) return;
            const stats = partnerStats.get(id.toString()) || { wins: 0, losses: 0, draws: 0, eloGain: 0, games: 0 };
            if (isWin) stats.wins++;
            if (isLoss) stats.losses++;
            if (isDraw) stats.draws++;
            stats.eloGain += eloChange;
            stats.games++;
            partnerStats.set(id.toString(), stats);
        });

        // 상대 분석 (천적)
        opTeamIds.forEach(id => {
            const stats = antagonistStats.get(id.toString()) || { wins: 0, losses: 0, draws: 0, games: 0, netEloChange: 0 };
            if (isWin) stats.wins++;
            if (isLoss) stats.losses++;
            if (isDraw) stats.draws++;
            stats.games++;
            stats.netEloChange += eloChange;
            antagonistStats.set(id.toString(), stats);
        });
    });

    // 결과 정렬 및 추출 (중복 제거 로직)
    const partners = Array.from(partnerStats.entries()).map(([id, stats]) => {
        const member = members.find(m => m.id === id);
        return {
            id,
            name: member ? member.name : '알 수 없음',
            winRate: stats.wins / (stats.games || 1),
            ...stats
        };
    });

    const usedIds = new Set();

    // 1. 🏹 나의 천적: 나를 상대로 NET ELO를 가장 많이 깎아간 사람 (합산 ELO 변화량이 가장 낮음)
    const antagonists = Array.from(antagonistStats.entries()).map(([id, stats]) => {
        const member = members.find(m => m.id === id);
        return { id, name: member ? member.name : '알 수 없음', ...stats };
    });
    const nemesis = antagonists
        .filter(a => a.netEloChange < 0)
        .sort((a, b) => a.netEloChange - b.netEloChange)[0];
    if (nemesis) usedIds.add(nemesis.id);

    // 2. 🤝 환상의 파트너: 최소 3경기, 승률 50% 이상, 중복 제외, 승률 우선
    const bestPartner = partners
        .filter(p => p.games >= PARTNER_MIN_GAMES && p.winRate >= 0.5 && !usedIds.has(p.id))
        .sort((a, b) => b.winRate - a.winRate || b.eloGain - a.eloGain)[0];
    if (bestPartner) usedIds.add(bestPartner.id);

    // 3. 🚫 환장하는 파트너: 최소 3경기, 승률 50% 미만, 중복 제외, 패배 횟수 우선
    const worstPartner = partners
        .filter(p => p.games >= PARTNER_MIN_GAMES && p.winRate < 0.5 && !usedIds.has(p.id))
        .sort((a, b) => b.losses - a.losses || a.eloGain - b.eloGain)[0];

    return {
        bestPartner,
        worstPartner,
        nemesis
    };
};
