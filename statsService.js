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
            const isParticipating = [...match.t1_ids, ...match.t2_ids].map(id => id.toString()).includes(member.id.toString());
            if (!isParticipating) return false;

            const isT1 = match.t1_ids.map(id => id.toString()).includes(member.id.toString());
            const myScore = isT1 ? match.score1 : match.score2;
            const opScore = isT1 ? match.score2 : match.score1;

            return (myScore === 6 && opScore === 0);
        });
    });

    // [🔥 불타는 연승]: 현재 3연승 이상 진행 중인 선수
    const hotStreaks = members.filter(member => {
        const myMatches = matchHistory
            .filter(m => [...m.t1_ids, ...m.t2_ids].map(id => id.toString()).includes(member.id.toString()))
            .sort((a, b) => b.sessionNum - a.sessionNum || b.id - a.id);

        let streak = 0;
        for (const match of myMatches) {
            const isT1 = match.t1_ids.map(id => id.toString()).includes(member.id.toString());
            const isWin = isT1 ? match.score1 > match.score2 : match.score2 > match.score1;
            const isDraw = match.score1 === match.score2;

            if (isWin) streak++;
            else if (isDraw) continue;
            else break;
        }
        return streak >= WIN_STREAK_THRESHOLD;
    });

    // [🛡️ 늪지대 방어군]: 5:5 무승부 기록이 가장 많은 선수
    const drawCounts = members.map(m => {
        const count = matchHistory.filter(match => {
            const isParticipating = [...match.t1_ids, ...match.t2_ids].map(id => id.toString()).includes(m.id.toString());
            return isParticipating && match.score1 === 5 && match.score2 === 5;
        }).length;
        return { id: m.id, name: m.name, count };
    });
    const maxDraws = Math.max(...drawCounts.map(d => d.count));
    const swampGuards = maxDraws > 0 ? drawCounts.filter(d => d.count === maxDraws) : [];

    // [🏋️‍♂️ 코트의 철인]: 최다 경기 소화
    const maxMatches = Math.max(...members.map(m => m.matchCount || 0));
    const ironMen = maxMatches > 0 ? members.filter(m => m.matchCount === maxMatches) : [];

    // [💎 최고의 도토리]: 현재 전체 1위 (ELO 최고점)
    const activeMembers = members.filter(m => m.matchCount > 0);
    const maxRating = Math.max(...activeMembers.map(m => m.rating || 0));
    const topAcorns = maxRating > 0 ? activeMembers.filter(m => m.rating === maxRating) : [];

    return {
        bagelMasters: bagelMasters.map(m => m.name),
        hotStreaks: hotStreaks.map(m => m.name),
        swampGuards: swampGuards.map(m => m.name),
        ironMen: ironMen.map(m => m.name),
        topAcorns: topAcorns.map(m => m.name)
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
        const antag = antagonistStats.get(oppId) || { eloLost: 0 };
        // 이전 시즌에서 잃은 ELO 합산 (eloGain이 음수이면 내가 잃은 것)
        if (stats.eloGain < 0) {
            antag.eloLost += Math.abs(stats.eloGain);
            antagonistStats.set(oppId, antag);
        }

        // 파트너 데이터는 현재 요약 구조상 포함되어 있지 않으므로 (상대팀 기준), 
        // 추후 확장이 필요할 수 있으나 현재는 천적(상대) 데이터 위주로 병합
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
        if (isLoss) {
            opTeamIds.forEach(id => {
                const stats = antagonistStats.get(id.toString()) || { eloLost: 0 };
                stats.eloLost += Math.abs(eloChange);
                antagonistStats.set(id.toString(), stats);
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
