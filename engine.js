// ACE ??‚¹ ?œìŠ¤??- ?µì‹¬ ?ë‡Œ ëª¨ë“ˆ (?”ì§„ ë¡œì§)
// ???Œì¼?€ ELO ?ˆì´???¬ê³„?? ì½”íŠ¸ ë°°ì • ë°??˜ë™ ?€ì§„í‘œ ?Œê³ ë¦¬ì¦˜ê³?ê°™ì?
// ?¨ì–´ ë¹„ì¦ˆ?ˆìŠ¤ ë¡œì§(Pure Business Logic)ë§Œì„ ?¬í•¨?©ë‹ˆ??

export const ELO_INITIAL = 1500;
export const K_FACTOR = 32;
export const GAME_COUNTS = { 4: 3, 5: 5, 6: 6, 7: 7, 8: 8 };

export const MATCH_PATTERNS = {
    8: [[[0, 4], [1, 5]], [[2, 6], [3, 7]], [[0, 5], [3, 6]], [[1, 4], [2, 7]], [[2, 4], [0, 6]], [[3, 5], [1, 7]], [[0, 7], [3, 4]], [[2, 5], [1, 6]]],
    7: [[[2, 5], [3, 6]], [[0, 4], [1, 5]], [[2, 6], [3, 4]], [[0, 1], [3, 5]], [[1, 2], [4, 6]], [[0, 5], [2, 3]], [[0, 6], [1, 4]]],
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
    const { 
        members, matchHistory, rankMap, sessionRankSnapshots, 
        sessionStartRatings, sessionStartMmrs, achievements = [] 
    } = context;

    console.log(`[Engine] Recalculate Start. History count: ${matchHistory?.length}`);

    const memberMap = new Map(members.map(m => [String(m.id), m]));

    try {
        // 1. ?Œì› ëª©ë¡ ì´ˆê¸°??ë°??ˆìŠ¤? ë¦¬ ê¸°ë°˜ ? ê·œ ë©¤ë²„ ?ë™ ?±ì¬
        const memberIdSet = new Set(members.map(m => String(m.id)));
        matchHistory.forEach(h => {
            const ids = [...(h.t1_ids || []), ...(h.t2_ids || [])];
            const names = [...(h.t1_names || []), ...(h.t2_names || [])];
            ids.forEach((id, idx) => {
                const sId = String(id);
                if (id && !memberIdSet.has(sId)) {
                    members.push({
                        id: sId, name: names[idx] || "Unknown", rating: ELO_INITIAL, mmr: ELO_INITIAL,
                        matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: [], prevRating: ELO_INITIAL
                    });
                    memberIdSet.add(sId);
                }
            });
        });

        // ëª¨ë“  ë©¤ë²„ ?íƒœ ë¦¬ì…‹
        // [v91] rating(?´ë²ˆ ?œì¦Œ ?œìœ„ ì§€???€ 1500?¼ë¡œ ì´ˆê¸°??
        //       mmr(??? ?„ì  ?¤ë ¥ ì§€???€ ?´ì „ ?œì¦Œ ?´ê?ê°?baseMmr) ? ì? - ?†ìœ¼ë©?1500
        //       peakMmr(??? ìµœê³ ???€ ?´ì „ ?œì¦Œ ìµœê³ ?ê³¼ ?´ê? MMR ì¤??’ì? ê°?ê¸°ì??¼ë¡œ ?œì‘
        rankMap.clear();
        members.forEach(m => {
            m.rating = ELO_INITIAL;
            m.mmr = (m.baseMmr !== undefined) ? m.baseMmr : ELO_INITIAL;
            const prevPeak = m.cumulativeStats?.peakMmr || 0;
            const baseMmr = m.baseMmr || ELO_INITIAL;
            m.peakMmr = Math.max(prevPeak, baseMmr);
            m.peakMmrDate = m.peakMmr === prevPeak ? (m.cumulativeStats?.peakMmrDate || null) : null;
            m.matchCount = 0; m.wins = 0; m.losses = 0; m.draws = 0; m.scoreDiff = 0;
            m.participationArr = []; m.prevRating = ELO_INITIAL;
            delete m.vRank;
        });

        // 2. ?µí•© ?€?„ë¼???ì„± (ê²½ê¸° + ?…ìƒ ë³´ë„ˆ??
        const events = [
            ...matchHistory.map(h => { h.eventType = 'match'; return h; }),
            ...achievements.map(a => { a.eventType = 'achievement'; return a; })
        ].sort((a, b) => {
            const parseSession = (s) => {
                if (s === undefined || s === null || s === '') return 999999;
                const match = String(s).match(/\d+/);
                return match ? parseInt(match[0]) : 999999;
            };
            const sA = parseSession(a.sessionNum);
            const sB = parseSession(b.sessionNum);
            if (sA !== sB) return sA - sB;

            // [v89] ?™ì¼ ?Œì°¨ ?´ì—?œëŠ” ?…ìƒ ë³´ë„ˆ??achievement)ë¥?ê²½ê¸°(match)ë³´ë‹¤ ë¨¼ì? ì²˜ë¦¬?˜ì—¬
            // ?´ë‹¹ ?Œì°¨ ê²½ê¸°?¤ì˜ ê¸°ë??¹ë¥  ê³„ì‚° ??ë³´ë„ˆ???ìˆ˜ê°€ ?´ë? ?©ì‚°???íƒœê°€ ?˜ë„ë¡???
            const priorityA = a.eventType === 'achievement' ? 0 : 1;
            const priorityB = b.eventType === 'achievement' ? 0 : 1;
            if (priorityA !== priorityB) return priorityA - priorityB;

            const tA = a.timestamp || 0;
            const tB = b.timestamp || 0;
            return tA - tB;
        });

        console.log(`[Engine] Timeline created: ${events.length} events sorted by session/time.`);

        // 3. ?€?„ë¼???œì°¨ ?°ì‚°
        // [v91] ë§??¬ê³„?????¸ì…˜ë³?ìºì‹œë¥??„ì „ ì´ˆê¸°??(stale ê°?ë°©ì?)
        if (!context.sessionEndRatings) context.sessionEndRatings = {};
        else Object.keys(context.sessionEndRatings).forEach(k => delete context.sessionEndRatings[k]);
        if (!context.sessionStartMmrs) context.sessionStartMmrs = {};
        else Object.keys(context.sessionStartMmrs).forEach(k => delete context.sessionStartMmrs[k]);

        let currentSessionId = null;
        let previousRankingIds = [];
        let processedSessions = [];

        events.forEach((event, idx) => {
            try {
                let sId = (event.sessionNum !== undefined && event.sessionNum !== null) ? event.sessionNum.toString() : "999";
                if (sId !== currentSessionId) {
                    if (currentSessionId !== null) {
                        console.log(`[Engine] Finalizing Snapshot for Session ${currentSessionId}`);
                        processedSessions.push(currentSessionId);
                        finalizeSession(currentSessionId, members, sessionRankSnapshots, context.sessionEndRatings, processedSessions, context.enableAttendanceBonus);
                        // [v88] ì§ì „ ?¤ëƒ…??ê¸°ì??¼ë¡œ previousRankingIds ì¶”ì¶œ (ë¹„í™œ??ë©¤ë²„ ?œì™¸??ê²°ê³¼ ê·¸ë?ë¡??¬ìš©)
                        const prevSnapshot = sessionRankSnapshots[currentSessionId] || {};
                        previousRankingIds = Object.entries(prevSnapshot)
                            .sort(([, rankA], [, rankB]) => rankA - rankB)
                            .map(([id]) => id);
                    }
                    currentSessionId = sId;
                    // [v89] ?Œì°¨ ë³€ê²???ì¦‰ì‹œ ìº¡ì²˜?˜ì? ?Šê³ , ì²?ê²½ê¸°ë¥?ë§Œë‚  ?Œê¹Œì§€ ?€ê¸°í•©?ˆë‹¤.
                }

                // ?…ìƒ ë³´ë„ˆ???ë³„
                if (event.mmrBonus !== undefined || event.eventType === 'achievement') {
                    // [¹ö±×¼öÁ¤] ÇöÀç Àç»ı¼º ÁßÀÎ DB(½ÃÁğ)ÀÇ ÀÔ»ó ±â·Ï¸¸ MMR¿¡ ÇÕ»ê (ÀÌÀü ½ÃÁğ µ¥ÀÌÅÍ ÀÌÁß ÇÕ»ê ¹æÁö)
                    if (event.dbName && context.currentDbName && event.dbName !== context.currentDbName) {
                        return;
                    }
                    
                    const member = members.find(m => m.name.trim() === (event.playerName || "").trim());
                    if (member) {
                        member.mmr += (Number(event.mmrBonus) || 0);
                        if (member.mmr > (member.peakMmr || 0)) {
                            member.peakMmr = member.mmr;
                            member.peakMmrDate = event.date || new Date().toISOString().split('T')[0];
                        }
                    }
                    return;
                } 

                // ê²½ê¸° ?°ì´???ë³„
                if (!(event.t1_ids || event.t1_names || event.t1 || event.eventType === 'match')) {
                    return;
                }

                // ?ìˆ˜ ?Œì‹± ê°•í™”
                const val1 = (event.score1 !== undefined && event.score1 !== null) ? event.score1 : 
                             (event.s1 !== undefined && event.s1 !== null) ? event.s1 : null;
                const val2 = (event.score2 !== undefined && event.score2 !== null) ? event.score2 : 
                             (event.s2 !== undefined && event.s2 !== null) ? event.s2 : null;
                
                if (val1 === null || val2 === null) {
                    console.warn(`[Engine] Skipping match in Session ${sId} - Missing scores.`, event);
                    return;
                }

                // [v89] ?¸ì…˜??ì²?ê²½ê¸°ë¥?ë§Œë‚¬???? ì§ì „ê¹Œì? ì²˜ë¦¬??ëª¨ë“  ë³´ë„ˆ?¤ê? ë°˜ì˜???œì ??MMR??'?œì‘ MMR'ë¡?ìº¡ì²˜
                if (context.sessionStartMmrs && !context.sessionStartMmrs[sId]) {
                    context.sessionStartMmrs[sId] = members.reduce((acc, m) => { acc[m.id] = m.mmr; return acc; }, {});
                }
                
                const s1 = parseInt(val1);
                const s2 = parseInt(val2);
                if (isNaN(s1) || isNaN(s2)) {
                    console.warn(`[Engine] Skipping match in Session ${sId} - Invalid scores: ${val1}, ${val2}`);
                    return;
                }

                // [v72] ? ìˆ˜ ë§¤ì¹­ ë¡œì§ ê·¹ë???(ID ë°°ì—´ ?ëŠ” ?´ë¦„ ë°°ì—´ ?´ë””?ì„œ??ì¶”ì¶œ)
                const getMember = (id, name) => {
                    let m = id ? memberMap.get(String(id)) : null;
                    if (!m && name) {
                        const cleanName = name.trim();
                        m = members.find(x => x.name.trim() === cleanName);
                    }
                    return m;
                };

                // ?¤ì–‘???•íƒœ??? ìˆ˜ ëª©ë¡ ?„ë“œ ?˜ìš© (t1_ids, t1_names, t1(ê°ì²´ë°°ì—´) ??
                let t1Base = event.t1_ids || [];
                if (t1Base.length === 0 && event.t1_names) t1Base = event.t1_names;
                if (t1Base.length === 0 && event.t1) t1Base = event.t1.map(p => p.id || p.name);

                let t2Base = event.t2_ids || [];
                if (t2Base.length === 0 && event.t2_names) t2Base = event.t2_names;
                if (t2Base.length === 0 && event.t2) t2Base = event.t2.map(p => p.id || p.name);

                const team1 = t1Base.map((item, i) => {
                    const id = event.t1_ids ? event.t1_ids[i] : null;
                    const name = event.t1_names ? event.t1_names[i] : (typeof item === 'string' ? item : null);
                    let m = getMember(id, name);
                    if (!m && name) {
                        console.warn(`[Engine] Auto-creating missing member: ${name} (Session ${sId})`);
                        m = { id: id || `tmp_${Date.now()}_${i}`, name: name, rating: ELO_INITIAL, mmr: ELO_INITIAL, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: [] };
                        members.push(m);
                        memberMap.set(String(m.id), m);
                    }
                    return m;
                }).filter(Boolean);

                const team2 = t2Base.map((item, i) => {
                    const id = event.t2_ids ? event.t2_ids[i] : null;
                    const name = event.t2_names ? event.t2_names[i] : (typeof item === 'string' ? item : null);
                    let m = getMember(id, name);
                    if (!m && name) {
                        console.warn(`[Engine] Auto-creating missing member: ${name} (Session ${sId})`);
                        m = { id: id || `tmp_${Date.now()}_${i}`, name: name, rating: ELO_INITIAL, mmr: ELO_INITIAL, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: [] };
                        members.push(m);
                        memberMap.set(String(m.id), m);
                    }
                    return m;
                }).filter(Boolean);
                
                if (team1.length === 0 || team2.length === 0) {
                    console.error(`[Engine] Skipping match in Session ${sId} - Team empty: T1=${team1.length}, T2=${team2.length}`);
                    return;
                }

                // [v78] ê¸°ë??¹ë¥  ê³„ì‚° ê¸°ì?: ?¤ì‹œê°?ë³€??MMR???„ë‹Œ, ?´ë‹¹ ?¸ì…˜ ?œì‘ ?œì ???¤ëƒ…??MMR???¬ìš©?©ë‹ˆ??
                // ?´ë¡œ???™ì¼ ?Œì°¨ ??ëª¨ë“  ê²½ê¸°ê°€ ?™ì¼???œì‘ ?ìˆ˜ë¥?ê¸°ì??¼ë¡œ ?¹ë¥ ??ê³„ì‚°?©ë‹ˆ??
                const startMmrs = context.sessionStartMmrs[sId] || {};
                const getStartMmr = (m) => (startMmrs[m.id] !== undefined ? startMmrs[m.id] : m.mmr);

                const mmr1 = team1.reduce((sum, m) => sum + getStartMmr(m), 0) / team1.length;
                const mmr2 = team2.reduce((sum, m) => sum + getStartMmr(m), 0) / team2.length;
                const expected = 1 / (1 + Math.pow(10, (mmr2 - mmr1) / 400));
                const actual = s1 > s2 ? 1 : (s1 < s2 ? 0 : 0.5);
                
                let change = K_FACTOR * (actual - expected);
                if (Math.abs(s1 - s2) >= 6) change *= 1.5;
                change = Math.round(change);

                // [v90] ì¶œì„ ë³´ë„ˆ?? rating?ë§Œ ë¶€??(?œìˆ˜ ?¤ë ¥ ì§€?œì¸ mmr?ëŠ” ë¯¸ë°˜??
                const attendanceBonus = Math.round(K_FACTOR / 2);

                event.elo_at_match = {
                    expected: expected,
                    change1: change,
                    change2: -change,
                    attendanceBonus: attendanceBonus, // ì¶”ê?
                    mmr1_before: mmr1,
                    mmr2_before: mmr2
                };

                [...team1, ...team2].forEach(m => {
                    m.matchCount++;
                    if (!m.participationArr.includes(sId)) {
                        m.participationArr.push(sId);
                    }
                });

                const updatePeakMmr = (m) => {
                    if (m.mmr > (m.peakMmr || 0)) {
                        m.peakMmr = m.mmr;
                        m.peakMmrDate = event.date || new Date().toISOString().split('T')[0];
                    }
                };

                if (s1 > s2) {
                    team1.forEach(m => { m.wins++; m.rating += change; m.mmr += change; m.scoreDiff += (s1 - s2); updatePeakMmr(m); });
                    team2.forEach(m => { m.losses++; m.rating -= change; m.mmr -= change; m.scoreDiff += (s2 - s1); });
                } else if (actual === 0) {
                    team1.forEach(m => { m.losses++; m.rating += change; m.mmr += change; m.scoreDiff += (s1 - s2); updatePeakMmr(m); });
                    team2.forEach(m => { m.wins++; m.rating -= change; m.mmr -= change; m.scoreDiff += (s2 - s1); });
                } else {
                    [...team1, ...team2].forEach(m => { m.draws++; updatePeakMmr(m); });
                }
            } catch (err) {
                console.error(`[Engine] Error in loop idx ${idx} (Session ${event.sessionNum}):`, err, event);
            }
        });

        // ë§ˆì?ë§??¸ì…˜ ì¢…ë£Œ ì²˜ë¦¬
        if (currentSessionId !== null) {
            processedSessions.push(currentSessionId);
            finalizeSession(currentSessionId, members, sessionRankSnapshots, context.sessionEndRatings, processedSessions, context.enableAttendanceBonus);
        }

        // 4. ìµœì¢… ?œìœ„(rankMap) ?…ë°?´íŠ¸
        updateRankMap(members, rankMap, previousRankingIds, context);

    } catch (e) {
        console.error("Recalculate Error:", e);
    }
}

function finalizeSession(sId, members, snapshots, ratings, processedSessions = [], enableAttendanceBonus = true) {
    // [v90] ?Œì°¨ ì¢…ë£Œ ???´ë‹¹ ?Œì°¨ ì°¸ì„???„ì›?ê²Œ ì¶œì„ ë³´ë„ˆ??ë¶€??
    // enableAttendanceBonus ?Œë˜ê·¸ë¡œ DBë³?ì¶œì„ ë³´ë„ˆ??ON/OFF ?œì–´
    if (enableAttendanceBonus) {
        const attendanceBonus = Math.round(K_FACTOR / 2);
        members.forEach(m => {
            if (m.participationArr.includes(sId)) {
                m.rating += attendanceBonus;
            }
        });
    }

    const activeRanked = members.filter(m => m.matchCount > 0);
    const sorted = [...activeRanked].sort((a, b) => (b.rating - a.rating) || (b.wins - a.wins) || String(a.name).localeCompare(String(b.name)));
    
    snapshots[sId] = {};
    sorted.forEach((m, idx) => { 
        snapshots[sId][String(m.id)] = idx + 1; // ID ?€?…ì„ ë¬¸ì?´ë¡œ ê°•ì œ
    });
    ratings[sId] = members.reduce((acc, m) => { acc[String(m.id)] = m.rating; return acc; }, {});
}

function updateRankMap(members, rankMap, previousRankingIds, context) {
    const sessionIds = [...new Set(context.matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));
    const currentRanking = members.filter(m => {
        if (m.matchCount > 0) return true;
        
        // ?„ì§ ê²½ê¸°ë¥????°ì—ˆ?”ë¼???„ì¬ ? ì²­?ê±°???€ì§„í‘œ???¬í•¨??ê²½ìš° ?œì‹œ
        const isCurrentParticipant = (context.applicants || []).some(a => String(a.id) === String(m.id)) ||
            (context.currentSchedule || []).some(match => [...(match.t1_ids || []), ...(match.t2_ids || [])].some(id => String(id) === String(m.id)));
        return isCurrentParticipant;
    }).sort((a, b) => (b.rating - a.rating) || (b.wins - a.wins) || String(a.name).localeCompare(String(b.name)));

    currentRanking.forEach((m, idx) => {
        const prevIdx = previousRankingIds.indexOf(String(m.id));
        rankMap.set(String(m.id), { rank: idx + 1, change: prevIdx !== -1 ? prevIdx - idx : 0 });
    });
}

export function optimizeCourtRoundLayout(availablePool, numMatches, partners, opponents, matchMode = 'court', gameCounts) {
    let bestMatches = [];
    let bestScore = -Infinity;
    let noImprovementCount = 0; // [v64] ì¡°ê¸° ì¢…ë£Œë¥??„í•œ ì¹´ìš´??

    for (let i = 0; i < 2000; i++) {
        const shuffled = [...availablePool].sort(() => Math.random() - 0.5);
        let currentMatches = [];
        let currentTotalScore = 0;
        let possible = true;

        for (let m = 0; m < numMatches; m++) {
            const p = shuffled.slice(m * 4, m * 4 + 4);
            if (p.length < 4) { possible = false; break; }

            // [v64] ?ŒíŠ¸??ì¤‘ë³µ ?¬ì „ ?„í„°ë§? ?ìˆ˜ ê³„ì‚° ??? íš¨??ì¡°í•©ë§?ì¶”ì¶œ
            const combinations = [
                { t1: [p[0], p[1]], t2: [p[2], p[3]] },
                { t1: [p[0], p[2]], t2: [p[1], p[3]] },
                { t1: [p[0], p[3]], t2: [p[1], p[2]] }
            ].filter(c => {
                // ?ŒíŠ¸??ì¤‘ë³µ???˜ë‚˜?¼ë„ ?ˆìœ¼ë©??´ë‹¹ ì¡°í•©?€ ?ê¸°
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
                
                // ?ë???ì¤‘ë³µ ë°©ì? (v63: 3???´ìƒ ë§Œë‚¨ ê¸ˆì? ?•ì±… ë°˜ì˜)
                if (matchMode === 'court') {
                    if (maxOppRepeat >= 2) score -= 20000000; // 3ë²ˆì§¸ ë§Œë‚¨?€ ê°•ë ¥ ì°¨ë‹¨
                    else if (maxOppRepeat === 1) score -= 10000; // 2ë²ˆì§¸ ë§Œë‚¨?€ ê°€ê¸‰ì  ì§€??
                } else {
                    if (maxOppRepeat >= 2) score -= 20000000;
                    else score -= oppRepeat * 1000;
                }

                // ?¤ë ¥ ê· í˜• (ELO ì°¨ì´ ìµœì†Œ??
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

            // ê²Œì„ ?Ÿìˆ˜ ?•í‰??? ì?
            p.forEach(player => {
                const lateJoinPenalty = (player.lateJoin && matchMode === 'court') ? 25000 : 0;
                currentTotalScore -= ((gameCounts[player.id] || 0) * 50000 + lateJoinPenalty);
            });
        }

        if (possible && currentTotalScore > bestScore) {
            bestScore = currentTotalScore;
            bestMatches = currentMatches;
            noImprovementCount = 0; // ê°œì„  ??ì¹´ìš´??ë¦¬ì…‹
        } else {
            noImprovementCount++;
        }

        // [v64] ì¡°ê¸° ì¢…ë£Œ ì¡°ê±´: 200???°ì† ê°œì„  ?†ì„ ??ì¤‘ë‹¨
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

    // [v65] Firebase?ì„œ ë¡œë“œ???™ì  ì½”íŠ¸ ?¤ì • ?°ì„  ?ìš©
    let targetLocationKey = locationKey;
    if (!targetLocationKey) {
        targetLocationKey = courtConfigs ? Object.keys(courtConfigs).find(key => info.includes(key)) : null;
    }

    if (targetLocationKey && courtConfigs && courtConfigs[targetLocationKey]) {
        const cfg = courtConfigs[targetLocationKey];
        courtConfig = {};
        (cfg.courts || []).forEach(c => { courtConfig[c.name] = c.maxRounds; });
    }

    // ?™ì  ?¤ì •???†ìœ¼ë©??˜ë“œì½”ë”© ?´ë°± (?˜ìœ„ ?¸í™˜??
    if (!courtConfig) {
        if (info.includes('ì¤‘ì•™ê³µì›')) {
            courtConfig = { 'ì½”íŠ¸ 1': 5, 'ì½”íŠ¸ 2': 5, 'ì½”íŠ¸ 3': 7 };
        } else if (info.includes('CS')) {
            courtConfig = { 'ì½”íŠ¸ 4': 7, 'ì½”íŠ¸ 3': 7, 'ì½”íŠ¸ 2': 5 };
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
            roundsToCourts[r] = Array.from({ length: defaultCourts }, (_, i) => `ì½”íŠ¸ ${i + 1}`);
        }
    }

    // [v65] ?¸ë‹¹ ìµœë? ê²Œì„ ?? context?ì„œ ?„ë‹¬ë°›ê±°??ê¸°ë³¸ê°?4
    const maxGamesDefault = maxGamesPerPlayer || 4;
    const players = [...applicants];
    const gameCounts = {};
    const maxGamesMap = {};
    const partners = {};
    const opponents = {};

    // [v63] ?°ì† ?´ì‹ ë°©ì? ë°?ê²Œì„ ì°¸ì—¬ ê· í˜• ë¡œì§ ê°•í™”
    const lastPlayedRound = {};
    players.forEach(p => {
        gameCounts[p.id] = 0;
        maxGamesMap[p.id] = maxGamesDefault; // [v65] ì§€ê°ì ?¬í•¨ ?„ì› ?™ì¼??ìµœë? ê²Œì„ ??
        partners[p.id] = new Set();
        opponents[p.id] = new Map();
        lastPlayedRound[p.id] = 0;
    });

    const fullScheduleData = [];

    for (let r = 1; r <= numRounds; r++) {
        const activeCourtsInRound = roundsToCourts[r] || [];
        if (activeCourtsInRound.length === 0) continue;

        // [v63] ê°€???¸ì› ?€ êµ¬ì„± ???°ì† ?´ì‹ ë°©ì? ë¡œì§ ?ìš©
        const availablePool = [...players]
            .filter(p => {
                if (gameCounts[p.id] >= maxGamesMap[p.id]) return false;
                if (r === 1 && p.lateJoin) return false; 
                return true;
            })
            // [v65] ?•ë ¬ ?°ì„ ?œìœ„:
            // 1?œìœ„: 2???°ì† ?´ì‹ ë°©ì? (ì§ì „ ?¼ìš´???´ì‹?ë? ìµœìƒ??ë°°ì¹˜)
            // 2?œìœ„: ?ê²Œ ???¬ëŒ ?°ì„  (ê²Œì„ ??ê· í˜•)
            // 3?œìœ„: ?™ì¼ ê²Œì„ ?˜ì¼ ??ì§€ê°ìë¥??¤ë¡œ ???œê°„ ë¶€ì¡????ì—°?¤ëŸ½ê²?3ê²Œì„ ?€??
            // 4?œìœ„: ?œë¤
            .sort((a, b) => {
                const aRested = lastPlayedRound[a.id] < r - 1;
                const bRested = lastPlayedRound[b.id] < r - 1;
                if (aRested && !bRested) return -1;
                if (!aRested && bRested) return 1;

                // [v65] ê²Œì„ ???ì? ?¬ëŒ ìµœìš°????ì§€ê°ì?€ ë¹„ì?ê°ì ëª¨ë‘ ê³µí‰?˜ê²Œ ê²Œì„ ê¸°íšŒ ë¶€??
                if (gameCounts[a.id] !== gameCounts[b.id]) return gameCounts[a.id] - gameCounts[b.id];
                
                // [v65] ê²Œì„ ?˜ê? ê°™ì„ ?Œë§Œ ì§€ê°ìë¥??¤ë¡œ ë°°ì¹˜
                // ??ë§ˆì?ë§??¼ìš´?œì—???ë¦¬ ë¶€ì¡???ì§€ê°ìê°€ 3ê²Œì„ ?€?ì´ ??
                if (a.lateJoin !== b.lateJoin) return a.lateJoin ? 1 : -1;
                
                return Math.random() - 0.5;
            });
        const numMatches = Math.min(activeCourtsInRound.length, Math.floor(availablePool.length / 4));
        if (numMatches === 0) continue;

        // [v63] ?¤ì§ˆ?ìœ¼ë¡?ê²½ê¸°ë¥????¸ì›(numMatches * 4)ë§??•ë ¬???œì„œ?€ë¡?ì¶”ì¶œ
        // ?•ë ¬ ê¸°ì?(?´ë? ?„ì—???˜í–‰): 2???°ì† ?´ì‹ ë°©ì? > ê²½ê¸°???ì? ?¬ëŒ > ?œë¤
        const finalPoolForRound = availablePool.slice(0, numMatches * 4);

        const roundMatches = optimizeCourtRoundLayout(finalPoolForRound, numMatches, partners, opponents, 'court', gameCounts);

        for (let i = 0; i < roundMatches.length; i++) {
            const match = roundMatches[i];
            const courtName = activeCourtsInRound[i];

            const allInMatch = [...match.team1, ...match.team2];
            allInMatch.forEach(p => {
                gameCounts[p.id]++;
                lastPlayedRound[p.id] = r; // ë§ˆì?ë§??œë™ ?¼ìš´??ê°±ì‹ 
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

    if (!sessionNum) { alert('?Œì°¨ ?•ë³´ê°€ ?†ìŠµ?ˆë‹¤. ?Œì°¨ë¥??œì„±?”í•˜ê±°ë‚˜ ?…ë ¥?´ì£¼?¸ìš”.'); return null; }

    let split;
    if (customSplitInput) {
        split = customSplitInput.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        const sum = split.reduce((a, b) => a + b, 0);
        if (sum !== applicants.length) { alert('ì»¤ìŠ¤?€ ?¸ì› ?©ê³„ê°€ ? ì²­ ?¸ì›ê³??¼ì¹˜?˜ì? ?ŠìŠµ?ˆë‹¤.'); return null; }
    } else {
        split = getSplits(applicants.length);
    }
    if (!split || split.length === 0) { alert('?¸ì› ë¶„í• ???¤íŒ¨?ˆìŠµ?ˆë‹¤. ì¡°ë³„ ?¸ì›???•ì¸??ì£¼ì„¸??'); return null; }

    let groupsArr = [];
    if (previewGroups && previewGroups.length > 0) {
        const actualSizes = previewGroups.map(g => g.length).sort((a, b) => a - b);
        const expectedSizes = [...split].sort((a, b) => a - b);
        const isMatch = actualSizes.length === expectedSizes.length && actualSizes.every((v, i) => v === expectedSizes[i]);
        if (!isMatch) {
            const actualStr = previewGroups.map((g, i) => `${String.fromCharCode(65 + i)}ì¡? ${g.length}ëª?).join(', ');
            const expectedStr = split.join(', ');
            alert(`ì¡°ë³„ ?¸ì› ë°°ë¶„??ê¸°ì?ê³?ë§ì? ?ŠìŠµ?ˆë‹¤.\n\n?„ì¬: ${actualStr}\nê¸°ì?: ${expectedStr}ë¶„í• \n\n? ìˆ˜ë¥??œë˜ê·¸í•˜??ì¡??¸ì„±??ì¡°ì •??ì£¼ì„¸??`);
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

    // [v6.4.1] ì§€ê°ì ì¡?ë¶„ì‚° ë°°ì¹˜ ?¸ë¶„?? 
    // ì¡??¸ì›??4ëª…ì¸??ì§€ê°ìê°€ ?¬í•¨??ê²½ìš°, 1?¼ìš´??ë§¤ì¹­??ë¶ˆê??¥í•˜ë¯€ë¡??¤ìª½(Wait ?¬ë¡¯)?¼ë¡œ ë°°ì¹˜?©ë‹ˆ??
    // 5???´ìƒ??ì¡°ëŠ” ì§€ê°ìê°€ ?ˆì–´???˜ë¨¸ì§€ 4ëª…ì´ 1?¼ìš´?œë? ?????ˆìœ¼ë¯€ë¡?ë°°ì • ?œì„œë¥?ì¡°ì •?˜ì? ?ŠìŠµ?ˆë‹¤.
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

        // [v7.0] ê²°ì •ë¡ ì  ?„ìˆ˜ ?ìƒ‰???´ìš©??ì¡°ë³„ë¦¬ê·¸ ?€ì§??ì„±
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
            // [v7.3] ?ì„± ?¤íŒ¨ ???ì„¸ ?¬ìœ  ?ˆë‚´ ì¶”ê?
            const is8 = g.length === 8;
            const msg = is8 
                ? `[${gLabel}ì¡? 8???€ì§„í‘œ ?ì„±???¤íŒ¨?ˆìŠµ?ˆë‹¤. ?´ë? ?¼ë¦¬ ?¤ë¥˜?????ˆìŠµ?ˆë‹¤.`
                : `[${gLabel}ì¡? ?€ì§„í‘œ ?ì„±???¤íŒ¨?ˆìŠµ?ˆë‹¤.\n- ?¬ìœ : ì§€ê°ì ?¤ì • ?±ìœ¼ë¡??¸í•´ ëª¨ë“  ? ìˆ˜ê°€ ë§Œì¡±?˜ëŠ” ?ŒíŠ¸??ì¤‘ë³µ ë°©ì? ?€ì§„ì„ ì°¾ì„ ???†ìŠµ?ˆë‹¤.`;
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
// [v7.0] ê²°ì •ë¡ ì  ì¡°ë³„ ?€ì§„í‘œ ?ì„± ?Œê³ ë¦¬ì¦˜
// ?™ì¼ ?…ë ¥(? ìˆ˜ êµ¬ì„± + ELO) ????ƒ ?™ì¼ ì¶œë ¥ ë³´ì¥
// ============================================================
function generateGroupScheduleDeterministic(group, targetGamesPerPlayer) {
  // ?€?€ [v7.4] 8??ì¡??„ìš© ?¹ìˆ˜ ?Œê³ ë¦¬ì¦˜: ???˜ìœ„ ê·¸ë£¹ ë¶„í•  + ìµœì¢… ë¯¹ìŠ¤ ?€?€
  // ?¬ìš©???œì•ˆ: ?ìœ„ 4ëª??˜ìœ„ 4ëª?ê°ê° ë¦¬ê·¸ ì§„í–‰ ?? ë§ˆì?ë§??¼ìš´?œì—??êµì°¨ ë§¤ì¹­
  if (group.length === 8) {
    // 1. ELO ?ìˆ˜ ê¸°ì? ?•ë ¬
    const sorted = [...group].sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return String(a.id).localeCompare(String(b.id));
    });

    const top = sorted.slice(0, 4);
    const bot = sorted.slice(4, 8);

    // 2. 1~3 ?¼ìš´?? ?ìœ„ 4ëª…ë¼ë¦? ?˜ìœ„ 4ëª…ë¼ë¦?ê²½ê¸° (Round Robin)
    // ?¨í„´: [0,1 vs 2,3], [0,2 vs 1,3], [0,3 vs 1,2]
    const rrPairs = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
    const schedule = [];

    const getBestPairing = (p4) => {
      // 4??ì¡??´ì—??ELO ì°¨ì´ê°€ ê°€???ì? 2v2 ?€ êµ¬ì„±??ë°˜í™˜
      const p = p4;
      const options = [
        { t1: [p[0], p[1]], t2: [p[2], p[3]], diff: Math.abs((p[0].rating+p[1].rating) - (p[2].rating+p[3].rating)) },
        { t1: [p[0], p[2]], t2: [p[1], p[3]], diff: Math.abs((p[0].rating+p[2].rating) - (p[1].rating+p[3].rating)) },
        { t1: [p[0], p[3]], t2: [p[1], p[2]], diff: Math.abs((p[0].rating+p[3].rating) - (p[1].rating+p[2].rating)) }
      ];
      return options.sort((a, b) => a.diff - b.diff)[0];
    };

    // 1~3 ?¼ìš´???ì„± (ì´?6ê²½ê¸°)
    for (let r = 0; r < 3; r++) {
      const pIdx = rrPairs[r];
      const matchTopMembers = [top[pIdx[0]], top[pIdx[1]], top[pIdx[2]], top[pIdx[3]]];
      const matchBotMembers = [bot[pIdx[0]], bot[pIdx[1]], bot[pIdx[2]], bot[pIdx[3]]];
      
      const mTop = getBestPairing(matchTopMembers);
      const mBot = getBestPairing(matchBotMembers);
      
      schedule.push(mTop, mBot); // ?¼ìš´?œë³„ë¡??ìœ„/?˜ìœ„ ê²½ê¸° ?˜ë‚˜??ì¶”ê?
    }

    // 3. 4 ?¼ìš´?? ???˜ìœ„ ë¯¹ìŠ¤ ë§¤ì¹˜ (?ŒíŠ¸??ì¤‘ë³µ ë°©ì?ë¥??„í•´ ?ˆë¡œ??ì¡°í•©)
    // ?ìœ„-?˜ìœ„ ?ê¸° ?„í•œ ê²°ì •ë¡ ì  ì¡°í•©: [S1, S2, H1, H2] & [S3, S4, H3, H4]
    const mix1Members = [top[0], top[1], bot[0], bot[1]];
    const mix2Members = [top[2], top[3], bot[2], bot[3]];
    
    schedule.push(getBestPairing(mix1Members), getBestPairing(mix2Members));
    
    return schedule;
  }

  const TARGET = targetGamesPerPlayer[group[0].id];

  // ?€?€ STEP 1: ê³ ìœ  ê²½ê¸° ì¡°í•© ?ì„± (?€ ?œì„œ ì¤‘ë³µ ?œê±°, ê²°ì •ë¡ ì  ?•ë ¬) ?€?€
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
    // ê²°ì •ë¡ ì  ?•ë ¬: eloDiff????s1????id (DFS ?ìƒ‰ ?œì„œ??ê³ ì •)
    return combos.sort((a, b) =>
      a.eloDiff !== b.eloDiff ? a.eloDiff - b.eloDiff :
      b.s1 !== a.s1 ? b.s1 - a.s1 :
      a.id.localeCompare(b.id)
    );
  }

  // ?€?€ STEP 2: ëª¨ë“  ?œì•½??ë§Œì¡±?˜ëŠ” ?„ì „ ?¸íŠ¸ ?„ìˆ˜ ?ìƒ‰ ?€?€
  function findAllSets(allCombos) {
    const sets = [];
    const numMatches = Math.floor(group.reduce((acc, p) => acc + TARGET, 0) / 4);
    const MAX_SETS = group.length >= 7 ? 500 : Infinity; // 7ëª??´ìƒ: 500?¸íŠ¸ ?œí•œ

    function dfs(idx, chosen, gc, pt, op) {
      if (sets.length >= MAX_SETS) return; // ì¡°ê¸° ì¢…ë£Œ
      if (chosen.length === numMatches) {
        if (group.every(p => gc[p.id] === TARGET)) sets.push([...chosen]);
        return;
      }
      for (let i = idx; i < allCombos.length; i++) {
        if (sets.length >= MAX_SETS) return; // ì¡°ê¸° ì¢…ë£Œ
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

        // [v7.1] 8??ì¡??„ìš© ?„ì› ì¶œì „ ?œì•½ ì¡°ê±´:
        // ???¼ìš´??2ê°?ê²½ê¸°) ?´ì—??? ìˆ˜ ì¤‘ë³µ???†ì–´????(8ëª??„ì› ê²½ê¸°)
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

  // ?€?€ STEP 3: ?¸íŠ¸ ?ìˆ˜??(ê²°ì •ë¡ ì  4?¨ê³„ ê¸°ì?) ?€?€
  function scoreSet(s) {
    const diffs = s.map(c => c.eloDiff).sort((a, b) => a - b);
    return {
      totalDiff: diffs.reduce((a, b) => a + b, 0), // 1?œìœ„: ELOì°¨ì´ ?©ì‚° ìµœì†Œ
      maxDiff:   Math.max(...diffs),                // 2?œìœ„: ìµœë? ?¨ì¼ê²½ê¸° ì°¨ì´ ìµœì†Œ
      diffSeq:   diffs.join(','),                   // 3?œìœ„: ì°¨ì´ ë¶„í¬ ?¬ì „??
      setKey:    s.map(c => c.id).sort().join('|')   // 4?œìœ„: ?„ì „ ?™ì  tie-break
    };
  }

  // ?€?€ STEP 4: ?¼ìš´??ë°°ì • (?°ì† ?´ì‹ ë°©ì? + ì§€ê°ì R1 ?œì™¸, DFS ê¸°ë°˜) ?€?€
  function assignRounds(set) {
    // 4ëª?ì¡??„ì› ì¶œì „, ?´ì‹???†ìŒ)???¨ìˆœ ?•ë ¬ë¡?ì¶©ë¶„
    if (group.length === 4) {
      return [...set].sort((a, b) => {
        const aLate = [...a.t1, ...a.t2].some(p => p.lateJoin);
        const bLate = [...b.t1, ...b.t2].some(p => p.lateJoin);
        if (aLate !== bLate) return aLate ? 1 : -1;
        if (a.eloDiff !== b.eloDiff) return a.eloDiff - b.eloDiff;
        return a.id.localeCompare(b.id);
      });
    }

    // 5ëª??´ìƒ: DFS ê¸°ë°˜ ?¼ìš´??ë°°ì • (?°ì† ?´ì‹ ë°©ì? ?˜ë“œ ?œì•½)
    const n = set.length;
    const used = new Array(n).fill(false);
    const result = new Array(n).fill(null);
    const lastPlayed = {};
    group.forEach(p => lastPlayed[p.id] = 0);

    function tryAssign(round) {
      if (round > n) return true;

      // ?„ë³´ë¥?ê²°ì •ë¡ ì  ?œì„œë¡??•ë ¬: ì§€ê°ì ê²½ê¸° R1 ?œì™¸ ??ELOì°¨ì´ ?‘ì? ????id
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
        // [v7.5] ?°ì† ?´ì‹ ì²´í¬ (5~7ëª?ì¡°ì— ?ìš©)
        // 7ëª?ì¡°ë„ ?¼ìš´??ë°°ì¹˜ë¥?ìµœì ?”í•˜ë©??°ì† ?´ì‹ ë°©ì? ê°€??
        if (group.length <= 7) {
          const playing = new Set([...c.t1, ...c.t2].map(p => p.id));
          let restFail = false;
          for (const p of group) {
            if (!playing.has(p.id) && round > 1 && lastPlayed[p.id] < round - 1) {
              restFail = true; break;
            }
          }
          if (restFail) continue;
        }

        // ??ë§¤ì¹˜ë¥?round??ë°°ì •
        used[i] = true;
        result[round - 1] = c;
        const prev = {};
        [...c.t1, ...c.t2].forEach(p => { prev[p.id] = lastPlayed[p.id]; lastPlayed[p.id] = round; });

        if (tryAssign(round + 1)) return true;

        // ë°±íŠ¸?˜í‚¹
        used[i] = false;
        result[round - 1] = null;
        [...c.t1, ...c.t2].forEach(p => { lastPlayed[p.id] = prev[p.id]; });
      }
      return false;
    }

    if (tryAssign(1)) {
      return result;
    }
    // [v7.5] 7ëª?ì¡? DFS ?¤íŒ¨ ??null ë°˜í™˜ ???¤ë¥¸ ?¸íŠ¸ ?œë„ ?ëŠ” MATCH_PATTERNS ?´ë°± ? ë„
    if (group.length >= 7) {
      return null;
    }
    // 5~6ëª?ì¡??´ë°±: ?¨ìˆœ ?•ë ¬ (?°ì† ?´ì‹ ê°€?¥í•˜ì§€ë§??€ì§??ì²´??? íš¨)
    return [...set].sort((a, b) => {
      if (a.eloDiff !== b.eloDiff) return a.eloDiff - b.eloDiff;
      return a.id.localeCompare(b.id);
    });
  }

  // ?€?€ ?¤í–‰ ?€?€
  const allCombos = buildUniqCombos(group);
  const allSets   = findAllSets(allCombos);

  if (allSets.length > 0) {
    // [v7.5] ëª¨ë“  ?¸íŠ¸ë¥??ìˆ˜?œìœ¼ë¡??•ë ¬???? ?¼ìš´??ë°°ì •(?°ì† ?´ì‹ ë°©ì?)???±ê³µ?˜ëŠ” ì²?ë²ˆì§¸ ?¸íŠ¸ë¥?ì±„íƒ
    const sortedSets = allSets
      .map(s => ({ set: s, score: scoreSet(s) }))
      .sort((a, b) => {
        const sa = a.score, sb = b.score;
        if (sa.totalDiff !== sb.totalDiff) return sa.totalDiff - sb.totalDiff;
        if (sa.maxDiff   !== sb.maxDiff)   return sa.maxDiff   - sb.maxDiff;
        if (sa.diffSeq   !== sb.diffSeq)   return sa.diffSeq.localeCompare(sb.diffSeq);
        return sa.setKey.localeCompare(sb.setKey);
      });

    for (const { set } of sortedSets) {
      const ordered = assignRounds(set);
      if (ordered) {
        return ordered.map(c => ({
          t1: c.t1,
          t2: c.t2,
          prevLastPlayed: {}
        }));
      }
    }
  }

  // [v7.5] DFS ?¼ìš´??ë°°ì • ?¤íŒ¨ ??ê¸°ì¡´ ì¶”ì²œ ?¨í„´(MATCH_PATTERNS) ?´ë°±
const pattern = MATCH_PATTERNS[group.length];
if (pattern) {
  console.log(`[Engine] DFS ?¼ìš´??ë°°ì • ?¤íŒ¨ ??MATCH_PATTERNS[${group.length}] ?´ë°± ?¬ìš©`);
  const sorted = [...group].sort((a, b) => {
    if ((b.rating || 1500) !== (a.rating || 1500)) return (b.rating || 1500) - (a.rating || 1500);
    return String(a.id).localeCompare(String(b.id));
  });
  const matches = pattern.map(([t1Idx, t2Idx]) => ({
    t1: [sorted[t1Idx[0]], sorted[t1Idx[1]]],
    t2: [sorted[t2Idx[0]], sorted[t2Idx[1]]],
    prevLastPlayed: {}
  }));
  // If there are lateJoin members, move matches containing them to round 2
  if (group.some(p => p.lateJoin)) {
    const hasLate = m => [...m.t1, ...m.t2].some(p => p.lateJoin);
    const lateMatches = matches.filter(hasLate);
    const otherMatches = matches.filter(m => !hasLate(m));
    if (otherMatches.length > 0) {
      // place first non-late match, then all late matches, then remaining others
      return [otherMatches[0], ...lateMatches, ...otherMatches.slice(1)];
    }
    return lateMatches;
  }
  return matches;
}


  return null;
}

export function applyNewMatches(context) {
    const { members, newMatches, rankMap, sessionRankSnapshots, enableAttendanceBonus, applicants, currentSchedule } = context;
    const memberMap = new Map(members.map(m => [String(m.id), m]));
    
    const sId = (newMatches.length > 0 && newMatches[0].sessionNum !== undefined && newMatches[0].sessionNum !== null) 
                ? newMatches[0].sessionNum.toString() : "999";

    const startMmrs = members.reduce((acc, m) => { acc[m.id] = m.mmr; return acc; }, {});

    newMatches.forEach((event, i) => {
        let t1Base = event.t1_ids || [];
        if (t1Base.length === 0 && event.t1_names) t1Base = event.t1_names;
        if (t1Base.length === 0 && event.t1) t1Base = event.t1.map(p => p.id || p.name);

        let t2Base = event.t2_ids || [];
        if (t2Base.length === 0 && event.t2_names) t2Base = event.t2_names;
        if (t2Base.length === 0 && event.t2) t2Base = event.t2.map(p => p.id || p.name);

        const getMember = (id, name) => {
            let m = id ? memberMap.get(String(id)) : null;
            if (!m && name) {
                const cleanName = name.trim();
                m = members.find(x => x.name.trim() === cleanName);
            }
            return m;
        };

        const team1 = t1Base.map((item, idx) => {
            const id = event.t1_ids ? event.t1_ids[idx] : null;
            const name = event.t1_names ? event.t1_names[idx] : (typeof item === 'string' ? item : null);
            let m = getMember(id, name);
            if (!m && name) {
                m = { id: id || `tmp_${Date.now()}_${idx}`, name: name, rating: ELO_INITIAL, mmr: ELO_INITIAL, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: [] };
                members.push(m);
                memberMap.set(String(m.id), m);
            }
            return m;
        }).filter(Boolean);

        const team2 = t2Base.map((item, idx) => {
            const id = event.t2_ids ? event.t2_ids[idx] : null;
            const name = event.t2_names ? event.t2_names[idx] : (typeof item === 'string' ? item : null);
            let m = getMember(id, name);
            if (!m && name) {
                m = { id: id || `tmp_${Date.now()}_${idx}`, name: name, rating: ELO_INITIAL, mmr: ELO_INITIAL, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: [] };
                members.push(m);
                memberMap.set(String(m.id), m);
            }
            return m;
        }).filter(Boolean);

        if (team1.length === 0 || team2.length === 0) return;

        const getStartMmr = (m) => (startMmrs[m.id] !== undefined ? startMmrs[m.id] : m.mmr);
        const mmr1 = team1.reduce((sum, m) => sum + getStartMmr(m), 0) / team1.length;
        const mmr2 = team2.reduce((sum, m) => sum + getStartMmr(m), 0) / team2.length;
        const expected = 1 / (1 + Math.pow(10, (mmr2 - mmr1) / 400));
        
        const val1 = (event.score1 !== undefined && event.score1 !== null) ? event.score1 : event.s1;
        const val2 = (event.score2 !== undefined && event.score2 !== null) ? event.score2 : event.s2;
        const s1 = parseInt(val1);
        const s2 = parseInt(val2);
        const actual = s1 > s2 ? 1 : (s1 < s2 ? 0 : 0.5);
        
        let change = K_FACTOR * (actual - expected);
        if (Math.abs(s1 - s2) >= 6) change *= 1.5;
        change = Math.round(change);

        const attendanceBonus = Math.round(K_FACTOR / 2);
        
        event.elo_at_match = {
            expected: expected,
            change1: change,
            change2: -change,
            attendanceBonus: attendanceBonus,
            mmr1_before: mmr1,
            mmr2_before: mmr2
        };

        [...team1, ...team2].forEach(m => {
            m.matchCount = (m.matchCount || 0) + 1;
            if (!m.participationArr) m.participationArr = [];
            if (!m.participationArr.includes(sId)) {
                m.participationArr.push(sId);
            }
        });

        const updatePeakMmr = (m) => {
            if (m.mmr > (m.peakMmr || 0)) {
                m.peakMmr = m.mmr;
                m.peakMmrDate = event.date || new Date().toISOString().split('T')[0];
            }
        };

        if (s1 > s2) {
            team1.forEach(m => { m.wins++; m.rating += change; m.mmr += change; m.scoreDiff += (s1 - s2); updatePeakMmr(m); });
            team2.forEach(m => { m.losses++; m.rating -= change; m.mmr -= change; m.scoreDiff += (s2 - s1); });
        } else if (actual === 0) {
            team1.forEach(m => { m.losses++; m.rating += change; m.mmr += change; m.scoreDiff += (s1 - s2); updatePeakMmr(m); });
            team2.forEach(m => { m.wins++; m.rating -= change; m.mmr -= change; m.scoreDiff += (s2 - s1); });
        } else {
            [...team1, ...team2].forEach(m => { m.draws++; updatePeakMmr(m); });
        }
    });

    if (newMatches.length > 0) {
        const prevSnapshot = sessionRankSnapshots[sId] || {}; 
        const previousRankingIds = Object.entries(prevSnapshot)
            .sort(([, rankA], [, rankB]) => rankA - rankB)
            .map(([id]) => id);

        finalizeSession(sId, members, sessionRankSnapshots, {}, [], enableAttendanceBonus);
        updateRankMap(members, rankMap, previousRankingIds, { matchHistory: newMatches, applicants, currentSchedule });
    }
}

