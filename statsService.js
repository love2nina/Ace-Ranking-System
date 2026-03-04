/**
 * ACE 랭킹 시스템 - 고도화 통계 서비스 (Utility)
 * 모든 함수는 Immutable 원칙을 준수하며 원본 데이터를 수정하지 않습니다.
 */

const WIN_STREAK_THRESHOLD = 3;
const PARTNER_MIN_GAMES = 3;

/**
 * 1. 뱃지 현황 계산
 */
export const calculateBadges = (members, matchHistory) => {
    if (!members || !matchHistory) return [];

    // [🥇 베이글 장인]: 6:0 또는 0:6 경기가 있는 선수
    const bagelMasters = members.filter(member => {
        return matchHistory.some(match => {
            const isParticipating = [...match.t1_ids, ...match.t2_ids].includes(member.id);
            if (!isParticipating) return false;

            const isT1 = match.t1_ids.includes(member.id);
            const myScore = isT1 ? match.score1 : match.score2;
            const opScore = isT1 ? match.score2 : match.score1;

            return (myScore === 6 && opScore === 0);
        });
    });

    // [🔥 불타는 연승]: 현재 3연승 이상 진행 중인 선수
    const hotStreaks = members.filter(member => {
        // 해당 멤버의 경기를 최신순으로 정렬
        const myMatches = matchHistory
            .filter(m => [...m.t1_ids, ...m.t2_ids].includes(member.id))
            .sort((a, b) => b.sessionNum - a.sessionNum || b.id - a.id);

        let streak = 0;
        for (const match of myMatches) {
            const isT1 = match.t1_ids.includes(member.id);
            const isWin = isT1 ? match.score1 > match.score2 : match.score2 > match.score1;
            const isDraw = match.score1 === match.score2;

            if (isWin) streak++;
            else if (isDraw) continue; // 무승부는 연승 유지에 영향 미치지 않거나 중단 (여기선 중단으로 가정 가능하나 보통 유지)
            else break; // 패배 시 중단
        }
        return streak >= WIN_STREAK_THRESHOLD;
    });

    // [🛡️ 늪지대 방어군]: 5:5 무승부 기록이 가장 많은 선수
    const drawCounts = members.map(m => {
        const count = matchHistory.filter(match => {
            const isParticipating = [...match.t1_ids, ...match.t2_ids].includes(m.id);
            return isParticipating && match.score1 === 5 && match.score2 === 5;
        }).length;
        return { id: m.id, name: m.name, count };
    });
    const maxDraws = Math.max(...drawCounts.map(d => d.count));
    const swampGuards = maxDraws > 0 ? drawCounts.filter(d => d.count === maxDraws) : [];

    // [🏋️‍♂️ 코트의 철인]: 최다 경기 소화
    const maxMatches = Math.max(...members.map(m => m.matchCount || 0));
    const ironMen = maxMatches > 0 ? members.filter(m => m.matchCount === maxMatches) : [];

    return {
        bagelMasters: bagelMasters.map(m => m.name),
        hotStreaks: hotStreaks.map(m => m.name),
        swampGuards: swampGuards.map(m => m.name),
        ironMen: ironMen.map(m => m.name)
    };
};

/**
 * 2. 개인별 인맥 통계 계산
 */
export const getPlayerInsights = (targetId, members, matchHistory) => {
    if (!targetId || !members || !matchHistory) return null;

    const myMatches = matchHistory.filter(m => [...m.t1_ids, ...m.t2_ids].includes(targetId));

    // 파트너 및 상대 분석용 맵
    const partnerStats = new Map(); // key: partnerId, value: { wins, losses, eloGain }
    const antagonistStats = new Map(); // key: opponentId, value: { eloLost }

    myMatches.forEach(match => {
        const isT1 = match.t1_ids.includes(targetId);
        const myTeamIds = isT1 ? match.t1_ids : match.t2_ids;
        const opTeamIds = isT1 ? match.t2_ids : match.t1_ids;

        const isWin = isT1 ? match.score1 > match.score2 : match.score2 > match.score1;
        const isLoss = isT1 ? match.score1 < match.score2 : match.score2 < match.score1;

        // ELO 기준 (matchHistory에 elo_at_match 정보가 있다고 가정)
        // change1은 팀1의 변동폭, change2는 팀2의 변동폭
        const eloChange = match.elo_at_match ? (isT1 ? match.elo_at_match.change1 : match.elo_at_match.change2) : 0;

        // 파트너 분석
        myTeamIds.forEach(id => {
            if (id === targetId) return;
            const stats = partnerStats.get(id) || { wins: 0, losses: 0, eloGain: 0, games: 0 };
            if (isWin) stats.wins++;
            if (isLoss) stats.losses++;
            stats.eloGain += eloChange;
            stats.games++;
            partnerStats.set(id, stats);
        });

        // 상대 분석 (천적)
        if (isLoss) {
            opTeamIds.forEach(id => {
                const stats = antagonistStats.get(id) || { eloLost: 0 };
                // 내가 잃은 만큼 상대가 가져간 것으로 간주 (절대값 합산)
                stats.eloLost += Math.abs(eloChange);
                antagonistStats.set(id, stats);
            });
        }
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

    // 1. 🏹 나의 천적: 나를 상대로 ELO를 가장 많이 가져간 사람 (상대팀)
    const antagonists = Array.from(antagonistStats.entries()).map(([id, stats]) => {
        const member = members.find(m => m.id === id);
        return { id, name: member ? member.name : '알 수 없음', ...stats };
    });
    const nemesis = antagonists.sort((a, b) => b.eloLost - a.eloLost)[0];
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
