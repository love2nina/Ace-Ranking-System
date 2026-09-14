// ACE ??궧 ?쒖뒪??- ?듭떖 ?먮뇤 紐⑤뱢 (?붿쭊 濡쒖쭅)
// ???뚯씪? ELO ?덉씠???ш퀎?? 肄뷀듃 諛곗젙 諛??섎룞 ?吏꾪몴 ?뚭퀬由ъ쬁怨?媛숈?
// ?⑥뼱 鍮꾩쫰?덉뒪 濡쒖쭅(Pure Business Logic)留뚯쓣 ?ы븿?⑸땲??

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
        // 1. ?뚯썝 紐⑸줉 珥덇린??諛??덉뒪?좊━ 湲곕컲 ?좉퇋 硫ㅻ쾭 ?먮룞 ?깆옱
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

        // 紐⑤뱺 硫ㅻ쾭 ?곹깭 由ъ뀑
        // [v91] rating(?대쾲 ?쒖쫵 ?쒖쐞 吏??? 1500?쇰줈 珥덇린??        //       mmr(??? ?꾩쟻 ?ㅻ젰 吏??? ?댁쟾 ?쒖쫵 ?닿?媛?baseMmr) ?좎? - ?놁쑝硫?1500
        //       peakMmr(??? 理쒓퀬??? ?댁쟾 ?쒖쫵 理쒓퀬?먭낵 ?닿? MMR 以??믪? 媛?湲곗??쇰줈 ?쒖옉
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

        // 2. ?듯빀 ??꾨씪???앹꽦 (寃쎄린 + ?낆긽 蹂대꼫??
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

            // [v89] ?숈씪 ?뚯감 ?댁뿉?쒕뒗 ?낆긽 蹂대꼫??achievement)瑜?寃쎄린(match)蹂대떎 癒쇱? 泥섎━?섏뿬
            // ?대떦 ?뚯감 寃쎄린?ㅼ쓽 湲곕??밸쪧 怨꾩궛 ??蹂대꼫???먯닔媛 ?대? ?⑹궛???곹깭媛 ?섎룄濡???            const priorityA = a.eventType === 'achievement' ? 0 : 1;
            const priorityB = b.eventType === 'achievement' ? 0 : 1;
            if (priorityA !== priorityB) return priorityA - priorityB;

            const tA = a.timestamp || 0;
            const tB = b.timestamp || 0;
            return tA - tB;
        });

        console.log(`[Engine] Timeline created: ${events.length} events sorted by session/time.`);

        // 3. ??꾨씪???쒖감 ?곗궛
        // [v91] 留??ш퀎?????몄뀡蹂?罹먯떆瑜??꾩쟾 珥덇린??(stale 媛?諛⑹?)
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
                        // [v88] 吏곸쟾 ?ㅻ깄??湲곗??쇰줈 previousRankingIds 異붿텧 (鍮꾪솢??硫ㅻ쾭 ?쒖쇅??寃곌낵 洹몃?濡??ъ슜)
                        const prevSnapshot = sessionRankSnapshots[currentSessionId] || {};
                        previousRankingIds = Object.entries(prevSnapshot)
                            .sort(([, rankA], [, rankB]) => rankA - rankB)
                            .map(([id]) => id);
                    }
                    currentSessionId = sId;
                    // [v89] ?뚯감 蹂寃???利됱떆 罹≪쿂?섏? ?딄퀬, 泥?寃쎄린瑜?留뚮궇 ?뚭퉴吏 ?湲고빀?덈떎.
                }

                // ?낆긽 蹂대꼫???먮퀎
                if (event.mmrBonus !== undefined || event.eventType === 'achievement') {
                    // [버그수정] 현재 재생성 중인 DB(시즌)의 입상 기록만 MMR에 합산 (이전 시즌 이중 합산 방지)
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

                // 寃쎄린 ?곗씠???먮퀎
                if (!(event.t1_ids || event.t1_names || event.t1 || event.eventType === 'match')) {
                    return;
                }

                // ?먯닔 ?뚯떛 媛뺥솕
                const val1 = (event.score1 !== undefined && event.score1 !== null) ? event.score1 : 
                             (event.s1 !== undefined && event.s1 !== null) ? event.s1 : null;
                const val2 = (event.score2 !== undefined && event.score2 !== null) ? event.score2 : 
                             (event.s2 !== undefined && event.s2 !== null) ? event.s2 : null;
                
                if (val1 === null || val2 === null) {
                    console.warn(`[Engine] Skipping match in Session ${sId} - Missing scores.`, event);
                    return;
                }

                // [v89] ?몄뀡??泥?寃쎄린瑜?留뚮궗???? 吏곸쟾源뚯? 泥섎━??紐⑤뱺 蹂대꼫?ㅺ? 諛섏쁺???쒖젏??MMR??'?쒖옉 MMR'濡?罹≪쿂
                if (context.sessionStartMmrs && !context.sessionStartMmrs[sId]) {
                    context.sessionStartMmrs[sId] = members.reduce((acc, m) => { acc[m.id] = m.mmr; return acc; }, {});
                }
                
                const s1 = parseInt(val1);
                const s2 = parseInt(val2);
                if (isNaN(s1) || isNaN(s2)) {
                    console.warn(`[Engine] Skipping match in Session ${sId} - Invalid scores: ${val1}, ${val2}`);
                    return;
                }

                // [v72] ?좎닔 留ㅼ묶 濡쒖쭅 洹밸???(ID 諛곗뿴 ?먮뒗 ?대쫫 諛곗뿴 ?대뵒?먯꽌??異붿텧)
                const getMember = (id, name) => {
                    let m = id ? memberMap.get(String(id)) : null;
                    if (!m && name) {
                        const cleanName = name.trim();
                        m = members.find(x => x.name.trim() === cleanName);
                    }
                    return m;
                };

                // ?ㅼ뼇???뺥깭???좎닔 紐⑸줉 ?꾨뱶 ?섏슜 (t1_ids, t1_names, t1(媛앹껜諛곗뿴) ??
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

                // [v78] 湲곕??밸쪧 怨꾩궛 湲곗?: ?ㅼ떆媛?蹂??MMR???꾨땶, ?대떦 ?몄뀡 ?쒖옉 ?쒖젏???ㅻ깄??MMR???ъ슜?⑸땲??
                // ?대줈???숈씪 ?뚯감 ??紐⑤뱺 寃쎄린媛 ?숈씪???쒖옉 ?먯닔瑜?湲곗??쇰줈 ?밸쪧??怨꾩궛?⑸땲??
                const startMmrs = context.sessionStartMmrs[sId] || {};
                const getStartMmr = (m) => (startMmrs[m.id] !== undefined ? startMmrs[m.id] : m.mmr);

                const mmr1 = team1.reduce((sum, m) => sum + getStartMmr(m), 0) / team1.length;
                const mmr2 = team2.reduce((sum, m) => sum + getStartMmr(m), 0) / team2.length;
                const expected = 1 / (1 + Math.pow(10, (mmr2 - mmr1) / 400));
                const actual = s1 > s2 ? 1 : (s1 < s2 ? 0 : 0.5);
                
                let change = K_FACTOR * (actual - expected);
                if (Math.abs(s1 - s2) >= 6) change *= 1.5;
                change = Math.round(change);

                // [v90] 異쒖꽍 蹂대꼫?? rating?먮쭔 遺??(?쒖닔 ?ㅻ젰 吏?쒖씤 mmr?먮뒗 誘몃컲??
                const attendanceBonus = Math.round(K_FACTOR / 2);

                event.elo_at_match = {
                    expected: expected,
                    change1: change,
                    change2: -change,
                    attendanceBonus: attendanceBonus, // 異붽?
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

        // 留덉?留??몄뀡 醫낅즺 泥섎━
        if (currentSessionId !== null) {
            processedSessions.push(currentSessionId);
            finalizeSession(currentSessionId, members, sessionRankSnapshots, context.sessionEndRatings, processedSessions, context.enableAttendanceBonus);
        }

        // 4. 理쒖쥌 ?쒖쐞(rankMap) ?낅뜲?댄듃
        updateRankMap(members, rankMap, previousRankingIds, context);

    } catch (e) {
        console.error("Recalculate Error:", e);
    }
}

function finalizeSession(sId, members, snapshots, ratings, processedSessions = [], enableAttendanceBonus = true) {
    // [v90] ?뚯감 醫낅즺 ???대떦 ?뚯감 李몄꽍???꾩썝?먭쾶 異쒖꽍 蹂대꼫??遺??    // enableAttendanceBonus ?뚮옒洹몃줈 DB蹂?異쒖꽍 蹂대꼫??ON/OFF ?쒖뼱
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
        snapshots[sId][String(m.id)] = idx + 1; // ID ??낆쓣 臾몄옄?대줈 媛뺤젣
    });
    ratings[sId] = members.reduce((acc, m) => { acc[String(m.id)] = m.rating; return acc; }, {});
}

function updateRankMap(members, rankMap, previousRankingIds, context) {
    const sessionIds = [...new Set(context.matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));
    const currentRanking = members.filter(m => {
        if (m.matchCount > 0) return true;
        
        // ?꾩쭅 寃쎄린瑜????곗뿀?붾씪???꾩옱 ?좎껌?먭굅???吏꾪몴???ы븿??寃쎌슦 ?쒖떆
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
    let noImprovementCount = 0; // [v64] 議곌린 醫낅즺瑜??꾪븳 移댁슫??
    for (let i = 0; i < 2000; i++) {
        const shuffled = [...availablePool].sort(() => Math.random() - 0.5);
        let currentMatches = [];
        let currentTotalScore = 0;
        let possible = true;

        for (let m = 0; m < numMatches; m++) {
            const p = shuffled.slice(m * 4, m * 4 + 4);
            if (p.length < 4) { possible = false; break; }

            // [v64] ?뚰듃??以묐났 ?ъ쟾 ?꾪꽣留? ?먯닔 怨꾩궛 ???좏슚??議고빀留?異붿텧
            const combinations = [
                { t1: [p[0], p[1]], t2: [p[2], p[3]] },
                { t1: [p[0], p[2]], t2: [p[1], p[3]] },
                { t1: [p[0], p[3]], t2: [p[1], p[2]] }
            ].filter(c => {
                // ?뚰듃??以묐났???섎굹?쇰룄 ?덉쑝硫??대떦 議고빀? ?먭린
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
                
                // ?곷???以묐났 諛⑹? (v63: 3???댁긽 留뚮궓 湲덉? ?뺤콉 諛섏쁺)
                if (matchMode === 'court') {
                    if (maxOppRepeat >= 2) score -= 20000000; // 3踰덉㎏ 留뚮궓? 媛뺣젰 李⑤떒
                    else if (maxOppRepeat === 1) score -= 10000; // 2踰덉㎏ 留뚮궓? 媛湲됱쟻 吏??                } else {
                    if (maxOppRepeat >= 2) score -= 20000000;
                    else score -= oppRepeat * 1000;
                }

                // ?ㅻ젰 洹좏삎 (ELO 李⑥씠 理쒖냼??
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

            // 寃뚯엫 ?잛닔 ?뺥룊???좎?
            p.forEach(player => {
                const lateJoinPenalty = (player.lateJoin && matchMode === 'court') ? 25000 : 0;
                currentTotalScore -= ((gameCounts[player.id] || 0) * 50000 + lateJoinPenalty);
            });
        }

        if (possible && currentTotalScore > bestScore) {
            bestScore = currentTotalScore;
            bestMatches = currentMatches;
            noImprovementCount = 0; // 媛쒖꽑 ??移댁슫??由ъ뀑
        } else {
            noImprovementCount++;
        }

        // [v64] 議곌린 醫낅즺 議곌굔: 200???곗냽 媛쒖꽑 ?놁쓣 ??以묐떒
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

    // [v65] Firebase?먯꽌 濡쒕뱶???숈쟻 肄뷀듃 ?ㅼ젙 ?곗꽑 ?곸슜
    let targetLocationKey = locationKey;
    if (!targetLocationKey) {
        targetLocationKey = courtConfigs ? Object.keys(courtConfigs).find(key => info.includes(key)) : null;
    }

    if (targetLocationKey && courtConfigs && courtConfigs[targetLocationKey]) {
        const cfg = courtConfigs[targetLocationKey];
        courtConfig = {};
        (cfg.courts || []).forEach(c => { courtConfig[c.name] = c.maxRounds; });
    }

    // ?숈쟻 ?ㅼ젙???놁쑝硫??섎뱶肄붾뵫 ?대갚 (?섏쐞 ?명솚??
    if (!courtConfig) {
        if (info.includes('以묒븰怨듭썝')) {
            courtConfig = { '肄뷀듃 1': 5, '肄뷀듃 2': 5, '肄뷀듃 3': 7 };
        } else if (info.includes('CS')) {
            courtConfig = { '肄뷀듃 4': 7, '肄뷀듃 3': 7, '肄뷀듃 2': 5 };
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
            roundsToCourts[r] = Array.from({ length: defaultCourts }, (_, i) => `肄뷀듃 ${i + 1}`);
        }
    }

    // [v65] ?몃떦 理쒕? 寃뚯엫 ?? context?먯꽌 ?꾨떖諛쏄굅??湲곕낯媛?4
    const maxGamesDefault = maxGamesPerPlayer || 4;
    const players = [...applicants];
    const gameCounts = {};
    const maxGamesMap = {};
    const partners = {};
    const opponents = {};

    // [v63] ?곗냽 ?댁떇 諛⑹? 諛?寃뚯엫 李몄뿬 洹좏삎 濡쒖쭅 媛뺥솕
    const lastPlayedRound = {};
    players.forEach(p => {
        gameCounts[p.id] = 0;
        maxGamesMap[p.id] = maxGamesDefault; // [v65] 吏媛곸옄 ?ы븿 ?꾩썝 ?숈씪??理쒕? 寃뚯엫 ??        partners[p.id] = new Set();
        opponents[p.id] = new Map();
        lastPlayedRound[p.id] = 0;
    });

    const fullScheduleData = [];

    for (let r = 1; r <= numRounds; r++) {
        const activeCourtsInRound = roundsToCourts[r] || [];
        if (activeCourtsInRound.length === 0) continue;

        // [v63] 媛???몄썝 ? 援ъ꽦 ???곗냽 ?댁떇 諛⑹? 濡쒖쭅 ?곸슜
        const availablePool = [...players]
            .filter(p => {
                if (gameCounts[p.id] >= maxGamesMap[p.id]) return false;
                if (r === 1 && p.lateJoin) return false; 
                return true;
            })
            // [v65] ?뺣젹 ?곗꽑?쒖쐞:
            // 1?쒖쐞: 2???곗냽 ?댁떇 諛⑹? (吏곸쟾 ?쇱슫???댁떇?먮? 理쒖긽??諛곗튂)
            // 2?쒖쐞: ?곴쾶 ???щ엺 ?곗꽑 (寃뚯엫 ??洹좏삎)
            // 3?쒖쐞: ?숈씪 寃뚯엫 ?섏씪 ??吏媛곸옄瑜??ㅻ줈 ???쒓컙 遺議????먯뿰?ㅻ읇寃?3寃뚯엫 ???            // 4?쒖쐞: ?쒕뜡
            .sort((a, b) => {
                const aRested = lastPlayedRound[a.id] < r - 1;
                const bRested = lastPlayedRound[b.id] < r - 1;
                if (aRested && !bRested) return -1;
                if (!aRested && bRested) return 1;

                // [v65] 寃뚯엫 ???곸? ?щ엺 理쒖슦????吏媛곸옄? 鍮꾩?媛곸옄 紐⑤몢 怨듯룊?섍쾶 寃뚯엫 湲고쉶 遺??                if (gameCounts[a.id] !== gameCounts[b.id]) return gameCounts[a.id] - gameCounts[b.id];
                
                // [v65] 寃뚯엫 ?섍? 媛숈쓣 ?뚮쭔 吏媛곸옄瑜??ㅻ줈 諛곗튂
                // ??留덉?留??쇱슫?쒖뿉???먮━ 遺議???吏媛곸옄媛 3寃뚯엫 ??곸씠 ??                if (a.lateJoin !== b.lateJoin) return a.lateJoin ? 1 : -1;
                
                return Math.random() - 0.5;
            });
        const numMatches = Math.min(activeCourtsInRound.length, Math.floor(availablePool.length / 4));
        if (numMatches === 0) continue;

        // [v63] ?ㅼ쭏?곸쑝濡?寃쎄린瑜????몄썝(numMatches * 4)留??뺣젹???쒖꽌?濡?異붿텧
        // ?뺣젹 湲곗?(?대? ?꾩뿉???섑뻾): 2???곗냽 ?댁떇 諛⑹? > 寃쎄린???곸? ?щ엺 > ?쒕뜡
        const finalPoolForRound = availablePool.slice(0, numMatches * 4);

        const roundMatches = optimizeCourtRoundLayout(finalPoolForRound, numMatches, partners, opponents, 'court', gameCounts);

        for (let i = 0; i < roundMatches.length; i++) {
            const match = roundMatches[i];
            const courtName = activeCourtsInRound[i];

            const allInMatch = [...match.team1, ...match.team2];
            allInMatch.forEach(p => {
                gameCounts[p.id]++;
                lastPlayedRound[p.id] = r; // 留덉?留??쒕룞 ?쇱슫??媛깆떊
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

    if (!sessionNum) { alert('?뚯감 ?뺣낫媛 ?놁뒿?덈떎. ?뚯감瑜??쒖꽦?뷀븯嫄곕굹 ?낅젰?댁＜?몄슂.'); return null; }

    let split;
    if (customSplitInput) {
        split = customSplitInput.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        const sum = split.reduce((a, b) => a + b, 0);
        if (sum !== applicants.length) { alert('而ㅼ뒪? ?몄썝 ?⑷퀎媛 ?좎껌 ?몄썝怨??쇱튂?섏? ?딆뒿?덈떎.'); return null; }
    } else {
        split = getSplits(applicants.length);
    }
    if (!split || split.length === 0) { alert('?몄썝 遺꾪븷???ㅽ뙣?덉뒿?덈떎. 議곕퀎 ?몄썝???뺤씤??二쇱꽭??'); return null; }

    let groupsArr = [];
    if (previewGroups && previewGroups.length > 0) {
        const actualSizes = previewGroups.map(g => g.length).sort((a, b) => a - b);
        const expectedSizes = [...split].sort((a, b) => a - b);
        const isMatch = actualSizes.length === expectedSizes.length && actualSizes.every((v, i) => v === expectedSizes[i]);
        if (!isMatch) {
            const actualStr = previewGroups.map((g, i) => `${String.fromCharCode(65 + i)}議? ${g.length}紐?).join(', ');
            const expectedStr = split.join(', ');
            alert(`議곕퀎 ?몄썝 諛곕텇??湲곗?怨?留욎? ?딆뒿?덈떎.\n\n?꾩옱: ${actualStr}\n湲곗?: ${expectedStr}遺꾪븷\n\n?좎닔瑜??쒕옒洹명븯??議??몄꽦??議곗젙??二쇱꽭??`);
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

    // [v6.4.1] 吏媛곸옄 議?遺꾩궛 諛곗튂 ?몃텇?? 
    // 議??몄썝??4紐낆씤??吏媛곸옄媛 ?ы븿??寃쎌슦, 1?쇱슫??留ㅼ묶??遺덇??ν븯誘濡??ㅼそ(Wait ?щ’)?쇰줈 諛곗튂?⑸땲??
    // 5???댁긽??議곕뒗 吏媛곸옄媛 ?덉뼱???섎㉧吏 4紐낆씠 1?쇱슫?쒕? ?????덉쑝誘濡?諛곗젙 ?쒖꽌瑜?議곗젙?섏? ?딆뒿?덈떎.
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

        // [v7.0] 寃곗젙濡좎쟻 ?꾩닔 ?먯깋???댁슜??議곕퀎由ш렇 ?吏??앹꽦
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
            // [v7.3] ?앹꽦 ?ㅽ뙣 ???곸꽭 ?ъ쑀 ?덈궡 異붽?
            const is8 = g.length === 8;
            const msg = is8 
                ? `[${gLabel}議? 8???吏꾪몴 ?앹꽦???ㅽ뙣?덉뒿?덈떎. ?대? ?쇰━ ?ㅻ쪟?????덉뒿?덈떎.`
                : `[${gLabel}議? ?吏꾪몴 ?앹꽦???ㅽ뙣?덉뒿?덈떎.\n- ?ъ쑀: 吏媛곸옄 ?ㅼ젙 ?깆쑝濡??명빐 紐⑤뱺 ?좎닔媛 留뚯”?섎뒗 ?뚰듃??以묐났 諛⑹? ?吏꾩쓣 李얠쓣 ???놁뒿?덈떎.`;
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
// [v7.0] 寃곗젙濡좎쟻 議곕퀎 ?吏꾪몴 ?앹꽦 ?뚭퀬由ъ쬁
// ?숈씪 ?낅젰(?좎닔 援ъ꽦 + ELO) ????긽 ?숈씪 異쒕젰 蹂댁옣
// ============================================================
function generateGroupScheduleDeterministic(group, targetGamesPerPlayer) {
  // ?? [v7.4] 8??議??꾩슜 ?뱀닔 ?뚭퀬由ъ쬁: ???섏쐞 洹몃９ 遺꾪븷 + 理쒖쥌 誘뱀뒪 ??
  // ?ъ슜???쒖븞: ?곸쐞 4紐??섏쐞 4紐?媛곴컖 由ш렇 吏꾪뻾 ?? 留덉?留??쇱슫?쒖뿉??援먯감 留ㅼ묶
  if (group.length === 8) {
    // 1. ELO ?먯닔 湲곗? ?뺣젹
    const sorted = [...group].sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return String(a.id).localeCompare(String(b.id));
    });

    const top = sorted.slice(0, 4);
    const bot = sorted.slice(4, 8);

    // 2. 1~3 ?쇱슫?? ?곸쐞 4紐낅겮由? ?섏쐞 4紐낅겮由?寃쎄린 (Round Robin)
    // ?⑦꽩: [0,1 vs 2,3], [0,2 vs 1,3], [0,3 vs 1,2]
    const rrPairs = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
    const schedule = [];

    const getBestPairing = (p4) => {
      // 4??議??댁뿉??ELO 李⑥씠媛 媛???곸? 2v2 ? 援ъ꽦??諛섑솚
      const p = p4;
      const options = [
        { t1: [p[0], p[1]], t2: [p[2], p[3]], diff: Math.abs((p[0].rating+p[1].rating) - (p[2].rating+p[3].rating)) },
        { t1: [p[0], p[2]], t2: [p[1], p[3]], diff: Math.abs((p[0].rating+p[2].rating) - (p[1].rating+p[3].rating)) },
        { t1: [p[0], p[3]], t2: [p[1], p[2]], diff: Math.abs((p[0].rating+p[3].rating) - (p[1].rating+p[2].rating)) }
      ];
      return options.sort((a, b) => a.diff - b.diff)[0];
    };

    // 1~3 ?쇱슫???앹꽦 (珥?6寃쎄린)
    for (let r = 0; r < 3; r++) {
      const pIdx = rrPairs[r];
      const matchTopMembers = [top[pIdx[0]], top[pIdx[1]], top[pIdx[2]], top[pIdx[3]]];
      const matchBotMembers = [bot[pIdx[0]], bot[pIdx[1]], bot[pIdx[2]], bot[pIdx[3]]];
      
      const mTop = getBestPairing(matchTopMembers);
      const mBot = getBestPairing(matchBotMembers);
      
      schedule.push(mTop, mBot); // ?쇱슫?쒕퀎濡??곸쐞/?섏쐞 寃쎄린 ?섎굹??異붽?
    }

    // 3. 4 ?쇱슫?? ???섏쐞 誘뱀뒪 留ㅼ튂 (?뚰듃??以묐났 諛⑹?瑜??꾪빐 ?덈줈??議고빀)
    // ?곸쐞-?섏쐞 ?욊린 ?꾪븳 寃곗젙濡좎쟻 議고빀: [S1, S2, H1, H2] & [S3, S4, H3, H4]
    const mix1Members = [top[0], top[1], bot[0], bot[1]];
    const mix2Members = [top[2], top[3], bot[2], bot[3]];
    
    schedule.push(getBestPairing(mix1Members), getBestPairing(mix2Members));
    
    return schedule;
  }

  const TARGET = targetGamesPerPlayer[group[0].id];

  // ?? STEP 1: 怨좎쑀 寃쎄린 議고빀 ?앹꽦 (? ?쒖꽌 以묐났 ?쒓굅, 寃곗젙濡좎쟻 ?뺣젹) ??
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
    // 寃곗젙濡좎쟻 ?뺣젹: eloDiff????s1????id (DFS ?먯깋 ?쒖꽌??怨좎젙)
    return combos.sort((a, b) =>
      a.eloDiff !== b.eloDiff ? a.eloDiff - b.eloDiff :
      b.s1 !== a.s1 ? b.s1 - a.s1 :
      a.id.localeCompare(b.id)
    );
  }

  // ?? STEP 2: 紐⑤뱺 ?쒖빟??留뚯”?섎뒗 ?꾩쟾 ?명듃 ?꾩닔 ?먯깋 ??
  function findAllSets(allCombos) {
    const sets = [];
    const numMatches = Math.floor(group.reduce((acc, p) => acc + TARGET, 0) / 4);
    const MAX_SETS = group.length >= 7 ? 500 : Infinity; // 7紐??댁긽: 500?명듃 ?쒗븳

    function dfs(idx, chosen, gc, pt, op) {
      if (sets.length >= MAX_SETS) return; // 議곌린 醫낅즺
      if (chosen.length === numMatches) {
        if (group.every(p => gc[p.id] === TARGET)) sets.push([...chosen]);
        return;
      }
      for (let i = idx; i < allCombos.length; i++) {
        if (sets.length >= MAX_SETS) return; // 議곌린 醫낅즺
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

        // [v7.1] 8??議??꾩슜 ?꾩썝 異쒖쟾 ?쒖빟 議곌굔:
        // ???쇱슫??2媛?寃쎄린) ?댁뿉???좎닔 以묐났???놁뼱????(8紐??꾩썝 寃쎄린)
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

  // ?? STEP 3: ?명듃 ?먯닔??(寃곗젙濡좎쟻 4?④퀎 湲곗?) ??
  function scoreSet(s) {
    const diffs = s.map(c => c.eloDiff).sort((a, b) => a - b);
    return {
      totalDiff: diffs.reduce((a, b) => a + b, 0), // 1?쒖쐞: ELO李⑥씠 ?⑹궛 理쒖냼
      maxDiff:   Math.max(...diffs),                // 2?쒖쐞: 理쒕? ?⑥씪寃쎄린 李⑥씠 理쒖냼
      diffSeq:   diffs.join(','),                   // 3?쒖쐞: 李⑥씠 遺꾪룷 ?ъ쟾??      setKey:    s.map(c => c.id).sort().join('|')   // 4?쒖쐞: ?꾩쟾 ?숈젏 tie-break
    };
  }

  // ?? STEP 4: ?쇱슫??諛곗젙 (?곗냽 ?댁떇 諛⑹? + 吏媛곸옄 R1 ?쒖쇅, DFS 湲곕컲) ??
  function assignRounds(set) {
    // 4紐?議??꾩썝 異쒖쟾, ?댁떇???놁쓬)???⑥닚 ?뺣젹濡?異⑸텇
    if (group.length === 4) {
      return [...set].sort((a, b) => {
        const aLate = [...a.t1, ...a.t2].some(p => p.lateJoin);
        const bLate = [...b.t1, ...b.t2].some(p => p.lateJoin);
        if (aLate !== bLate) return aLate ? 1 : -1;
        if (a.eloDiff !== b.eloDiff) return a.eloDiff - b.eloDiff;
        return a.id.localeCompare(b.id);
      });
    }

    // 5紐??댁긽: DFS 湲곕컲 ?쇱슫??諛곗젙 (?곗냽 ?댁떇 諛⑹? ?섎뱶 ?쒖빟)
    const n = set.length;
    const used = new Array(n).fill(false);
    const result = new Array(n).fill(null);
    const lastPlayed = {};
    group.forEach(p => lastPlayed[p.id] = 0);

    function tryAssign(round) {
      if (round > n) return true;

      // ?꾨낫瑜?寃곗젙濡좎쟻 ?쒖꽌濡??뺣젹: 吏媛곸옄 寃쎄린 R1 ?쒖쇅 ??ELO李⑥씠 ?묒? ????id
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
        // [v7.5] ?곗냽 ?댁떇 泥댄겕 (5~7紐?議곗뿉 ?곸슜)
        // 7紐?議곕룄 ?쇱슫??諛곗튂瑜?理쒖쟻?뷀븯硫??곗냽 ?댁떇 諛⑹? 媛??        if (group.length <= 7) {
          const playing = new Set([...c.t1, ...c.t2].map(p => p.id));
          let restFail = false;
          for (const p of group) {
            if (!playing.has(p.id) && round > 1 && lastPlayed[p.id] < round - 1) {
              restFail = true; break;
            }
          }
          if (restFail) continue;
        }

        // ??留ㅼ튂瑜?round??諛곗젙
        used[i] = true;
        result[round - 1] = c;
        const prev = {};
        [...c.t1, ...c.t2].forEach(p => { prev[p.id] = lastPlayed[p.id]; lastPlayed[p.id] = round; });

        if (tryAssign(round + 1)) return true;

        // 諛깊듃?섑궧
        used[i] = false;
        result[round - 1] = null;
        [...c.t1, ...c.t2].forEach(p => { lastPlayed[p.id] = prev[p.id]; });
      }
      return false;
    }

    if (tryAssign(1)) {
      return result;
    }
    // [v7.5] 7紐?議? DFS ?ㅽ뙣 ??null 諛섑솚 ???ㅻⅨ ?명듃 ?쒕룄 ?먮뒗 MATCH_PATTERNS ?대갚 ?좊룄
    if (group.length >= 7) {
      return null;
    }
    // 5~6紐?議??대갚: ?⑥닚 ?뺣젹 (?곗냽 ?댁떇 媛?ν븯吏留??吏??먯껜???좏슚)
    return [...set].sort((a, b) => {
      if (a.eloDiff !== b.eloDiff) return a.eloDiff - b.eloDiff;
      return a.id.localeCompare(b.id);
    });
  }

  // ?? ?ㅽ뻾 ??
  const allCombos = buildUniqCombos(group);
  const allSets   = findAllSets(allCombos);

  if (allSets.length > 0) {
    // [v7.5] 紐⑤뱺 ?명듃瑜??먯닔?쒖쑝濡??뺣젹???? ?쇱슫??諛곗젙(?곗냽 ?댁떇 諛⑹?)???깃났?섎뒗 泥?踰덉㎏ ?명듃瑜?梨꾪깮
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

  // [v7.5] DFS ?쇱슫??諛곗젙 ?ㅽ뙣 ??湲곗〈 異붿쿇 ?⑦꽩(MATCH_PATTERNS) ?대갚
const pattern = MATCH_PATTERNS[group.length];
if (pattern) {
  console.log(`[Engine] DFS ?쇱슫??諛곗젙 ?ㅽ뙣 ??MATCH_PATTERNS[${group.length}] ?대갚 ?ъ슜`);
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

