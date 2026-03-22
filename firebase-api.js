// firebase-api.js — Firebase 통신 및 데이터 영속성 계층
// app.js에서 분리된 Firebase 관련 로직을 관리합니다.

// --- 모듈 내부 상태 ---
let db = null;
let currentDbName = '';
let currentClubId = 'Default';
let clusterUnsubscribe = null;
let statusUnsubscribe = null;
let videosUnsubscribe = null;
let historyUnsubscribe = null;
let reportsUnsubscribe = null;
let systemSettings = { admin_pw: "ace_dot" };

// 콜백 저장소 (app.js에서 주입)
let _callbacks = {};
// 데이터 로드 여부 추적 (세션 자동 생성 방어용)
let _dataLoadedForDb = '';

/**
 * 모듈 내 currentDbName 게터
 */
export function getCurrentDbName() {
    return currentDbName;
}

/**
 * 모듈 내 systemSettings 게터
 */
export function getSystemSettings() {
    return systemSettings;
}

/**
 * 모듈 내 currentClubId 게터
 */
export function getCurrentClubId() {
    return currentClubId;
}

/**
 * 모듈 내 db 게터
 */
export function getDb() {
    return db;
}


/**
 * Firebase 초기화 및 설정 리스너 등록
 * @param {Object} callbacks - app.js에서 주입하는 콜백 모음
 *   - onDataLoaded(data): 데이터 스냅샷 수신 시
 *   - onEmptyDefault(): Default DB가 비어있을 때 (마이그레이션 트리거)
 *   - onEmptyCluster(): 비어있는 클러스터 생성 시
 *   - onSessionUpdate(state): 세션 상태 변경 시
 *   - onSettingsUpdate(settings): 시스템 설정 변경 시
 *   - onDbNameChange(dbName): DB 이름 변경 시
 *   - saveToCloud(): 클라우드 저장 트리거
 */
export async function initFirebase(callbacks) {
    _callbacks = callbacks;
    console.log("[Firebase] Initializing...");
    if (!window.FB_SDK) {
        console.error("Firebase SDK not loaded. If you are opening index.html directly from a file, please use a local server (e.g., python -m http.server).");
        alert("DB 연결 실패: Firebase SDK를 불러오지 못했습니다. 로컬 서버(http://)를 통해 접속 중인지 확인해 주세요.");
        return;
    }
    const { initializeApp, getFirestore, onSnapshot, doc, setDoc, getDoc } = window.FB_SDK;

    // 멀티 클럽 감지
    const urlParams = new URLSearchParams(window.location.search);
    currentClubId = urlParams.get('club') || 'Default';

    const firebaseConfig = {
        apiKey: "AIzaSyBjGjM6KpHG1lgQ9Dr48AawB8gvkkC8pCs",
        authDomain: "ace-ranking-system.firebaseapp.com",
        projectId: "ace-ranking-system",
        storageBucket: "ace-ranking-system.firebasestorage.app",
        messagingSenderId: "179912247763",
        appId: "1:179912247763:web:37f2d14933a198ffba0726",
        measurementId: "G-XZVQLB23RV"
    };

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    // [v60] 오프라인 캐시 활성화 (재방문 시 캐시 데이터로 즉시 렌더링)
    if (window.FB_SDK.enableIndexedDbPersistence) {
        try {
            await window.FB_SDK.enableIndexedDbPersistence(db);
            console.log("[Firebase] Offline cache enabled.");
        } catch (err) {
            if (err.code === 'failed-precondition') {
                console.warn("[Firebase] Offline cache: multiple tabs open, skipping.");
            } else if (err.code === 'unimplemented') {
                console.warn("[Firebase] Offline cache: not supported in this browser.");
            } else {
                console.warn("[Firebase] Offline cache error:", err);
            }
        }
    }

    // 글로벌 설정 리스너 (기본 ACE 클러스터 또는 개별 클럽 경로)
    const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
    const settingsRef = doc(db, settingsPath);

    // 1. 먼저 localStorage를 읽어서 활성 DB를 확인 (빠른 사용자 경험용)
    const cachedDb = localStorage.getItem(`ace_active_db_${currentClubId}`);
    if (cachedDb) {
        currentDbName = cachedDb;
        if (_callbacks.onDbNameChange) _callbacks.onDbNameChange(currentDbName);
        subscribeToCluster(currentDbName); // 최초 구독 시도
    }

    // 2. 서버 설정 실시간 리스너 (설정 변경 시 DB 전환 대응)
    onSnapshot(settingsRef, (snapshot) => {
        if (snapshot.exists()) {
            systemSettings = snapshot.data();
            if (_callbacks.onSettingsUpdate) _callbacks.onSettingsUpdate(systemSettings);
            const globalActiveDb = systemSettings.active_cluster || 'Default';

            // 구독 중인 DB와 다르거나 아직 리스너가 없는 경우에만 재구독
            if (globalActiveDb !== currentDbName || !clusterUnsubscribe) {
                console.log(`[Global Sync] Database context: ${globalActiveDb}`);
                currentDbName = globalActiveDb;
                localStorage.setItem(`ace_active_db_${currentClubId}`, globalActiveDb);
                if (_callbacks.onDbNameChange) _callbacks.onDbNameChange(currentDbName);
                subscribeToCluster(globalActiveDb);
            }
        } else {
            // 설정 문서가 없는 경우 기본값 복구 또는 생성
            if (currentDbName && currentDbName !== 'Default') {
                console.warn(`[Settings] Restoring missing settings for '${currentDbName}'`);
                setDoc(settingsRef, { admin_pw: systemSettings.admin_pw || "ace_dot", active_cluster: currentDbName });
            } else if (!currentDbName) {
                console.log("[Settings] Initializing Default cluster settings");
                setDoc(settingsRef, { admin_pw: "ace_dot", active_cluster: "Default" });
            }
        }
    }, (error) => {
        console.error("[Settings] Listener Error:", error);
    });
}

/**
 * 특정 데이터 클러스터에 실시간 구독
 */
export function subscribeToCluster(dbName) {
    const { doc, onSnapshot, setDoc } = window.FB_SDK;

    // 기존 리스너 해제
    if (clusterUnsubscribe) clusterUnsubscribe();
    if (statusUnsubscribe) statusUnsubscribe();
    if (videosUnsubscribe) videosUnsubscribe();
    if (historyUnsubscribe) historyUnsubscribe();
    if (reportsUnsubscribe) reportsUnsubscribe();

    currentDbName = dbName;
    if (_callbacks.onDbNameChange) _callbacks.onDbNameChange(currentDbName);
    console.log(`[Firebase] Subscribing to Cluster: ${dbName}`);

    // 1. 데이터 클러스터 리스너
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName);
    clusterUnsubscribe = onSnapshot(docRef, async (snapshot) => {
        console.log(`[Firebase] Snapshot received for DB: ${currentDbName}, exists: ${snapshot.exists()}`);
        let data = snapshot.exists() ? snapshot.data() : null;
        let isEmpty = !data || (Array.isArray(data.members) && data.members.length === 0);

        if (isEmpty && currentDbName.toLowerCase() === 'default') {
            if (_callbacks.onEmptyDefault) await _callbacks.onEmptyDefault();
        } else if (snapshot.exists()) {
            _dataLoadedForDb = currentDbName; // 데이터 로드 성공 기록
            if (_callbacks.onDataLoaded) _callbacks.onDataLoaded(data);

            // 1.1 하위 히스토리 컬렉션 추가 구독 (순차적 로딩)
            const { collection, query, orderBy } = window.FB_SDK;
            const historyRef = collection(db, clusterPath, currentDbName, "history");
            const historyQuery = query(historyRef, orderBy("timestamp", "desc")); // 최신순

            if (historyUnsubscribe) historyUnsubscribe();
            historyUnsubscribe = onSnapshot(historyQuery, (hSnapshot) => {
                const historyList = hSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                console.log(`[Firebase] History loaded: ${historyList.length} items`);
                if (_callbacks.onHistoryLoaded) _callbacks.onHistoryLoaded(historyList);
            }, (hError) => {
                console.warn("[Firebase] History migration check or loading issue:", hError);
            });

            // 1.2 분석 리포트 서브컬렉션 구독 (지연/순차 로드)
            const reportsRef = collection(db, clusterPath, currentDbName, "reports");
            if (reportsUnsubscribe) reportsUnsubscribe();
            reportsUnsubscribe = onSnapshot(reportsRef, (rSnapshot) => {
                const reportsData = {};
                rSnapshot.docs.forEach(doc => {
                    reportsData[doc.id] = doc.data().content;
                });
                console.log(`[Firebase] Reports loaded: ${Object.keys(reportsData).length} sessions`);
                if (_callbacks.onReportsLoaded) _callbacks.onReportsLoaded(reportsData);
            }, (rError) => {
                console.warn("[Firebase] Reports loading issue:", rError);
            });
        } else {
            // ⚠️ 문서가 존재하지 않는 경우: 빈 데이터를 자동 저장하지 않음 (데이터 소실 방지)
            console.warn(`[Firebase] Document does not exist for DB: ${currentDbName}. Skipping auto-save to prevent data loss.`);
            // 빈 상태로 UI만 초기화 (Firebase에는 저장하지 않음)
            if (_callbacks.onEmptyClusterSafe) _callbacks.onEmptyClusterSafe();
        }
    });

    // 2. 세션 상태 리스너
    const sessionStatusDocPath = currentClubId === 'Default'
        ? `system/sessionStatus_${currentDbName}`
        : `clubs/${currentClubId}/status/sessionStatus_${currentDbName}`;

    statusUnsubscribe = onSnapshot(doc(db, sessionStatusDocPath), (snap) => {
        if (snap.exists()) {
            if (_callbacks.onSessionUpdate) _callbacks.onSessionUpdate(snap.data());
        } else if (currentDbName.toLowerCase() !== 'default') {
            // ⚠️ 세션 문서가 없을 때: 데이터가 로드된 DB에서만 자동 생성
            // 데이터가 아직 로드되지 않았으면 네트워크 지연/일시 오류일 수 있으므로 건너뜀
            if (_dataLoadedForDb === currentDbName) {
                console.log(`[Session] Creating initial session state for DB: ${currentDbName}`);
                if (_callbacks.onNewClusterSession) _callbacks.onNewClusterSession(sessionStatusDocPath);
            } else {
                console.warn(`[Session] ⚠️ Session status not found for DB: ${currentDbName}, but data not yet loaded. Skipping auto-create.`);
            }
        }
    });
}

/**
 * 레거시 데이터 마이그레이션
 */
export async function handleMigration() {
    const { doc, getDoc, setDoc } = window.FB_SDK;
    console.log("[Migration] Default DB is empty. Checking for legacy data...");
    try {
        const legacyRef = doc(db, "system", "database");
        const legacySnap = await getDoc(legacyRef);

        if (legacySnap.exists()) {
            const legacyData = legacySnap.data();
            const data = {
                members: legacyData.members || [],
                matchHistory: legacyData.matchHistory || [],
                currentSchedule: legacyData.currentSchedule || [],
                sessionNum: legacyData.sessionNum || 1,
                applicants: legacyData.applicants || []
            };

            // app.js에 데이터 전달 후 저장
            if (_callbacks.onDataLoaded) _callbacks.onDataLoaded(data);

            const legacySessionRef = doc(db, "system", "sessionStatus");
            const legacySessionSnap = await getDoc(legacySessionRef);
            if (legacySessionSnap.exists()) {
                await setDoc(doc(db, "system", "sessionStatus_Default"), legacySessionSnap.data());
            }

            if (_callbacks.afterMigration) _callbacks.afterMigration();
        } else {
            if (_callbacks.onEmptyCluster) await _callbacks.onEmptyCluster();
        }
    } catch (e) {
        console.error("[Migration] Error:", e);
    }
}

// --- 비디오(영상 자료실) 데이터 통신 ---
export async function subscribeToVideos(callback) {
    if (!window.FB_SDK) return;
    const { collection, onSnapshot } = window.FB_SDK;
    const videoPath = currentClubId === 'Default' ? "videos" : `clubs/${currentClubId}/videos`;

    videosUnsubscribe = onSnapshot(collection(db, videoPath), (snapshot) => {
        const videos = [];
        snapshot.forEach(doc => {
            videos.push({ id: doc.id, ...doc.data() });
        });
        videos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        callback(videos);
    }, (error) => {
        console.error("Error subscribing to videos:", error);
    });
}

export async function addVideo(videoData) {
    if (!window.FB_SDK) return;
    const { doc, setDoc } = window.FB_SDK;
    const videoPath = currentClubId === 'Default' ? "videos" : `clubs/${currentClubId}/videos`;

    const videoId = String(Date.now());
    videoData.timestamp = Date.now();

    const docRef = doc(db, videoPath, videoId);
    await setDoc(docRef, videoData);
}

export async function deleteVideo(videoId) {
    if (!window.FB_SDK) return;
    const { doc, deleteDoc } = window.FB_SDK;
    const videoPath = currentClubId === 'Default' ? "videos" : `clubs/${currentClubId}/videos`;

    const docRef = doc(db, videoPath, videoId);
    await deleteDoc(docRef);
}

/**
 * 전체 상태를 Firestore에 저장
 * @param {Object} appState - { members, matchHistory, currentSchedule, sessionNum, applicants }
 * @param {string} caller - 호출 경로 식별용 문자열
 */
export async function saveToCloud(appState, caller = 'unknown') {
    const { doc, setDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;

    // --- 안전장치: 데이터 유실 방지 가드 강화 ---
    // 1. 전달된 필드 중 하나라도 데이터가 들어있는지 확인
    const hasPopulatedData = [
        appState.members,
        appState.matchHistory,
        appState.currentSchedule,
        appState.applicants
    ].some(arr => Array.isArray(arr) && arr.length > 0);

    // 2. 멤버와 히스토리가 모두 '명시적으로' 포함되어 있는데 둘 다 비어있는 경우(완전 초기화 시도)만 차단
    const isExplicitWipeAttempt = 
        (appState.hasOwnProperty('members') && Array.isArray(appState.members) && appState.members.length === 0) &&
        (appState.hasOwnProperty('matchHistory') && Array.isArray(appState.matchHistory) && appState.matchHistory.length === 0);

    if (isExplicitWipeAttempt && !hasPopulatedData) {
        console.warn(`[SaveToCloud] ⚠️ BLOCKED: 완전 초기화 시도 차단됨 (caller: ${caller}, DB: ${currentDbName})`);
        console.trace('[SaveToCloud] 호출 스택:');
        return;
    }

    console.log(`[SaveToCloud] 저장 실행 (caller: ${caller}, DB: ${currentDbName})`);

    try {
        // [v36] 전달된 필드만 업데이트하기 위해 merge: true 사용 및 유효한 데이터만 구성
        const dataToSave = { 
            updatedAt: window.FB_SDK.serverTimestamp() 
        };
        
        // appState에 존재하는 키만 dataToSave에 포함 (undefined 제외)
        const validKeys = ['members', 'matchHistory', 'currentSchedule', 'sessionNum', 'applicants', 'reports'];
        validKeys.forEach(key => {
            if (appState.hasOwnProperty(key) && appState[key] !== undefined) {
                dataToSave[key] = appState[key];
            }
        });

        await setDoc(doc(db, clusterPath, currentDbName), dataToSave, { merge: true });
    } catch (e) {
        console.error("Cloud Error:", e);
    }
}

/**
 * 서버의 최신 데이터를 읽어옵니다 (병합 저장 시 사용)
 * @returns {Object|null} 서버의 최신 데이터 또는 null
 */
export async function getServerData() {
    const { doc, getDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    try {
        const snapshot = await getDoc(doc(db, clusterPath, currentDbName));
        if (snapshot.exists()) {
            return snapshot.data();
        }
        return null;
    } catch (e) {
        console.error("[getServerData] 서버 데이터 읽기 실패:", e);
        return null;
    }
}


/**
 * localStorage → Cloud 마이그레이션
 */
export async function tryMigrateLocalToCloud() {
    const localMembers = JSON.parse(localStorage.getItem('ace_v3_members'));
    const localHistory = JSON.parse(localStorage.getItem('ace_v3_history'));
    if (localMembers && localMembers.length > 0) {
        if (confirm('클라우드에 데이터가 없습니다. 노트북의 기존 데이터를 업로드할까요?')) {
            await saveToCloud({
                members: localMembers,
                matchHistory: localHistory || [],
                applicants: [],
                currentSchedule: [],
                sessionNum: 1
            });
            alert('클라우드로 마이그레이션 완료!');
        }
    }
}

/**
 * 세션 상태 저장 (접수/진행/대기)
 */
export async function saveSessionState(status, sessionNum, info = '', matchMode = 'court') {
    try {
        const { doc, setDoc } = window.FB_SDK;
        const sessionStatusDocPath = currentClubId === 'Default'
            ? `system/sessionStatus_${currentDbName}`
            : `clubs/${currentClubId}/status/sessionStatus_${currentDbName}`;
        await setDoc(doc(db, sessionStatusDocPath), { status, sessionNum, info, matchMode });
    } catch (e) { console.error("Session State Error:", e); }
}

/**
 * DB 목록 가져오기 (관리자 전용)
 */
export async function fetchDbList() {
    if (!db) {
        console.warn("[Firebase] DB not initialized yet. Skipping fetchDbList.");
        return;
    }
    try {
        const { collection, getDocs } = window.FB_SDK;
        const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
        const querySnapshot = await getDocs(collection(db, clusterPath));
        const select = document.getElementById('dbListSelect');
        const prevSelect = document.getElementById('prevDbSelect'); // 신규: 이전 시즌 이관용 선택창
        if (!select) return;
        select.innerHTML = '<option value="">데이터베이스 선택...</option>';
        if (prevSelect) prevSelect.innerHTML = '<option value="">이관할 이전 DB(시즌) 선택...</option>';

        querySnapshot.forEach((docSnap) => {
            const opt = document.createElement('option');
            opt.value = docSnap.id;
            opt.textContent = docSnap.id;
            if (docSnap.id === currentDbName) opt.selected = true;
            select.add(opt);

            // 이전 DB 선택창에도 추가
            if (prevSelect) {
                const optPrev = document.createElement('option');
                optPrev.value = docSnap.id;
                optPrev.textContent = docSnap.id;
                prevSelect.add(optPrev);
            }
        });
    } catch (e) {
        console.error("Fetch DB List Error:", e);
    }
}

/**
 * 활성 DB 전환 (관리자 전용)
 */
export async function switchDatabase() {
    const newName = document.getElementById('newDbInput').value.trim();
    if (!newName) { alert('DB 이름을 입력해주세요.'); return; }

    const option = document.querySelector('input[name="seasonOption"]:checked')?.value || 'carryover';
    const prevDbName = document.getElementById('prevDbSelect')?.value;

    if (option === 'carryover' && !prevDbName) {
        alert('이관할 이전 시즌 DB를 선택해주세요. 새로 시작하려면 "완전히 새로 시작" 옵션을 선택하세요.');
        return;
    }

    const confirmMsg = option === 'carryover' 
        ? `'${prevDbName}'의 MMR과 전적 요약을 이관하여 신규 시즌 '${newName}'을 생성하시겠습니까?`
        : `'${newName}' 데이터베이스를 완전히 초기화된 상태로 새로 생성하시겠습니까? (MMR 포함 모든 데이터 초기화)`;

    if (confirm(confirmMsg)) {
        try {
            const { doc, getDoc, setDoc, updateDoc } = window.FB_SDK;
            const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
            const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;

            let newMembers = [];

            if (option === 'carryover') {
                // 1. 이전 시즌 데이터 로드 및 요약 생성
                const prevSnap = await getDoc(doc(db, clusterPath, prevDbName));
                if (prevSnap.exists()) {
                    const prevData = prevSnap.data();
                    const prevMembers = prevData.members || [];
                    const prevHistory = prevData.matchHistory || [];

                    // 2. MMR 이관 및 요약본 생성
                    newMembers = prevMembers.map(m => {
                        const stats = {};
                        const prevSummary = m.prevSeasonStats || {};
                        const playerMatches = prevHistory.filter(h => 
                            [...h.t1_ids, ...h.t2_ids].some(id => String(id) === String(m.id))
                        );

                        playerMatches.forEach(h => {
                            const isT1 = h.t1_ids.some(id => String(id) === String(m.id));
                            const opponents = isT1 ? h.t2_ids : h.t1_ids;
                            const won = (isT1 && h.score1 > h.score2) || (!isT1 && h.score2 > h.score1);
                            const lost = (isT1 && h.score1 < h.score2) || (!isT1 && h.score2 < h.score1);
                            const draw = h.score1 === h.score2;
                            const eloChange = isT1 ? (h.elo_at_match?.change1 || 0) : (h.elo_at_match?.change2 || 0);

                            opponents.forEach(oppId => {
                                const id = String(oppId);
                                if (!stats[id]) stats[id] = { wins: 0, losses: 0, draws: 0, eloGain: 0 };
                                if (won) stats[id].wins++;
                                if (lost) stats[id].losses++;
                                if (draw) stats[id].draws++;
                                stats[id].eloGain += eloChange;
                            });
                        });

                        // [추가] 이전 시즌들의 누적 요약(만약 있다면)을 현재 계산된 통계에 병합
                        Object.entries(prevSummary).forEach(([oppId, val]) => {
                            const id = String(oppId);
                            if (!stats[id]) stats[id] = { wins: 0, losses: 0, draws: 0, eloGain: 0 };
                            stats[id].wins += (val.wins || 0);
                            stats[id].losses += (val.losses || 0);
                            stats[id].draws += (val.draws || 0);
                            stats[id].eloGain += (val.eloGain || 0);
                        });

                        const carriedMmr = m.mmr || m.rating || 1500;
                        return {
                            ...m,
                            rating: 1500,
                            mmr: carriedMmr,
                            baseMmr: carriedMmr, // recalculateAll용 시즌 시작 기준값
                            prevSeasonStats: stats,
                            matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: []
                        };
                    });
                }
            } else {
                // 완전히 새로 시작: members 초기화 (기존 members가 있다면 구조만 유지하고 점수 리셋)
                newMembers = _callbacks.getMembers().map(m => ({
                    ...m,
                    rating: 1500,
                    mmr: 1500,
                    baseMmr: 1500, // recalculateAll용 시즌 시작 기준값
                    prevSeasonStats: {},
                    matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: []
                }));
            }

            // 3. 새 클러스터 문서 생성 및 활성화
            await setDoc(doc(db, clusterPath, newName), {
                members: newMembers,
                matchHistory: [],
                sessionStatus: { status: 'idle', sessionNum: 0, matchMode: 'court' },
                reports: {},
                createdAt: new Date().toISOString()
            });

            // 4. 전역 설정의 active_cluster 업데이트 (v49: robust global scope)
            const sdk = window.FB_SDK;
            await sdk.setDoc(sdk.doc(db, settingsPath), {
                active_cluster: newName,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            window.alert(`'${newName}'(으)로 전환 완료되었습니다. 페이지를 새로고침합니다.`);
            window.location.reload();
        } catch (e) {
            console.error("[Firebase] Switch DB Error:", e);
            window.alert("DB 생성/전환 중 오류가 발생했습니다: " + e.message);
        }
    }
}

/**
 * 기존 DB(시즌) 불러오기 (관리자 전용)
 */
export async function loadDatabase() {
    const dbSelect = document.getElementById('dbListSelect');
    if (!dbSelect) { console.error("[Firebase] dbListSelect not found"); return; }
    const selectedDb = dbSelect.value;
    
    console.log(`[Firebase] Attempting to load DB: ${selectedDb}`);
    
    if (!selectedDb) {
        window.alert('불러올 데이터베이스를 선택해주세요.');
        return;
    }
    
    if (window.confirm(`'${selectedDb}' 데이터베이스로 전환하시겠습니까?`)) {
        try {
            const sdk = window.FB_SDK;
            const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
            
            console.log(`[Firebase] Updating settingsPath: ${settingsPath} with cluster: ${selectedDb}`);
            
            // 4. 전역 설정의 active_cluster 업데이트 (v49: robust global scope)
            await sdk.setDoc(sdk.doc(db, settingsPath), {
                active_cluster: selectedDb,
                updatedAt: new Date().toISOString()
            }, { merge: true });

            window.alert(`'${selectedDb}'(으)로 전환되었습니다. 페이지를 새로고침합니다.`);
            window.location.reload();
        } catch(e) {
            console.error("[Firebase] DB Load Error:", e);
            window.alert("DB 불러오기 중 오류가 발생했습니다: " + e.message);
        }
    }
}

/**
 * 새 클러스터의 세션 상태 초기화
 */
export async function initNewClusterSession(sessionStatusDocPath, initialState) {
    try {
        const { doc, setDoc } = window.FB_SDK;
        await setDoc(doc(db, sessionStatusDocPath), initialState);
    } catch (e) {
        console.error("Init New Cluster Session Error:", e);
    }
}

/**
 * 중계석 리포트 저장
 * @param {number} sessionNum 
 * @param {string} content 
 */
export async function saveReport(sessionNum, content) {
    const { doc, setDoc, serverTimestamp } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    // [개선] 메인 문서 대신 reports 서브컬렉션에 세션번호를 문서 ID로 개별 저장
    const reportRef = doc(db, clusterPath, currentDbName, "reports", String(sessionNum));

    try {
        await setDoc(reportRef, {
            content: content,
            updatedAt: serverTimestamp()
        });
        console.log(`[Firebase] Report saved to subcollection for session ${sessionNum}`);
    } catch (e) {
        console.error("Save Report Error:", e);
        throw e;
    }
}

export { getServerData as fbGetServerData };

/**
 * 특정 경기의 점수를 트랜잭션으로 안전하게 저장합니다.
 * @param {string} matchId - 경기 ID
 * @param {number|null} s1 - 팀 1 점수
 * @param {number|null} s2 - 팀 2 점수
 */
export async function saveMatchScoreWithTransaction(matchId, s1, s2) {
    const { doc, runTransaction, serverTimestamp } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName);

    try {
        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(docRef);
            if (!sfDoc.exists()) {
                throw "Document does not exist!";
            }

            const data = sfDoc.data();
            const schedule = data.currentSchedule || [];
            const match = schedule.find(m => m.id === matchId);

            if (match) {
                match.s1 = s1;
                match.s2 = s2;
                transaction.update(docRef, { 
                    currentSchedule: schedule,
                    updatedAt: serverTimestamp()
                });
                console.log(`[Transaction] Success for match ${matchId}: ${s1}:${s2}`);
            } else {
                console.warn(`[Transaction] Match ${matchId} not found in schedule.`);
            }
        });
    } catch (e) {
        console.error("[Transaction] Failed:", e);
        throw e;
    }
}

/**
 * 개별 경기를 히스토리 서브컬렉션에 추가합니다.
 * @param {Object} item - 히스토리 경기 객체
 */
export async function addHistoryItem(item) {
    const { collection, setDoc, serverTimestamp, doc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const historyCol = collection(db, clusterPath, currentDbName, "history");

    try {
        // 기존 ID가 있으면 문서 ID로 사용, 없으면 자동 생성
        const docRef = item.id ? doc(historyCol, String(item.id)) : doc(historyCol);
        await setDoc(docRef, {
            ...item,
            timestamp: serverTimestamp() // 순차 로딩 및 정렬용
        });
        console.log(`[Firebase] History item saved to subcollection: ${docRef.id}`);
    } catch (e) {
        console.error("Add History Error:", e);
        throw e;
    }
}

export async function deleteHistoryItem(itemId) {
    const { doc, deleteDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName, "history", String(itemId));

    console.log(`[Firebase] Deleting history item. Path: ${docRef.path}, ID: ${itemId}`);

    try {
        await deleteDoc(docRef);
        console.log(`[Firebase] History item deleted: ${itemId}`);
    } catch (e) {
        console.error("Delete History Error:", e);
        if (e.code === 'permission-denied') {
            alert("삭제 권한이 없습니다. Firebase 보안 규칙을 확인해 주세요.");
        }
        throw e;
    }
}

/**
 * 특정 히스토리 항목을 서브컬렉션에서 수정합니다.
 * @param {string} itemId - 수정할 항목의 ID
 * @param {Object} updates - 수정할 내용
 */
export async function updateHistoryItem(itemId, updates) {
    const { doc, updateDoc, serverTimestamp } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName, "history", String(itemId));

    console.log(`[Firebase] Updating history item. Path: ${docRef.path}, ID: ${itemId}`, updates);

    try {
        await updateDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
        });
        console.log(`[Firebase] History item updated: ${itemId}`);
    } catch (e) {
        console.error("Update History Error:", e);
        if (e.code === 'permission-denied') {
            alert("수정 권한이 없습니다. Firebase 보안 규칙을 확인해 주세요.");
        }
        throw e;
    }
}

/**
 * 기존 메인 문서의 matchHistory를 서브컬렉션으로 일괄 이관합니다.
 * @param {Array} historyArray - 이관할 히스토리 배열
 */
export async function migrateHistory(historyArray) {
    if (!historyArray || historyArray.length === 0) return;
    
    const { doc, collection, setDoc, serverTimestamp } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName);
    const historyCol = collection(db, clusterPath, currentDbName, "history");

    console.log(`[Migration] Starting migration of ${historyArray.length} items...`);

    try {
        // 1. 각 항목을 서브컬렉션에 저장
        for (const item of historyArray) {
            const hDocRef = doc(historyCol, String(item.id));
            await setDoc(hDocRef, {
                ...item,
                timestamp: serverTimestamp()
            });
        }

        // 2. 메인 문서에서 히스토리 비우기
        await window.FB_SDK.updateDoc(docRef, { 
            matchHistory: [],
            updatedAt: serverTimestamp()
        });

        console.log(`[Migration] ✅ Successfully migrated ${historyArray.length} items to subcollection.`);
    } catch (e) {
        console.error("[Migration] ❌ Error during migration:", e);
        throw e;
    }
}

/**
 * 기존 메인 문서의 reports를 서브컬렉션으로 일괄 이관합니다.
 * @param {Object} reportsObj - 이관할 리포트 객체 (sessionNum: content)
 */
export async function migrateReports(reportsObj) {
    if (!reportsObj || Object.keys(reportsObj).length === 0) return;

    const { doc, setDoc, serverTimestamp, updateDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName);
    const reportsCol = doc(db, clusterPath, currentDbName).path + "/reports";

    console.log(`[Migration] Starting migration of ${Object.keys(reportsObj).length} reports...`);

    try {
        for (const [sessionNum, content] of Object.entries(reportsObj)) {
            const rDocRef = doc(db, clusterPath, currentDbName, "reports", String(sessionNum));
            await setDoc(rDocRef, {
                content: content,
                updatedAt: serverTimestamp()
            });
        }

        // 메인 문서에서 reports 비우기
        await updateDoc(docRef, { 
            reports: {},
            updatedAt: serverTimestamp()
        });

        console.log(`[Migration] ✅ Successfully migrated reports to subcollection.`);
    } catch (e) {
        console.error("[Migration] ❌ Error during report migration:", e);
        throw e;
    }
}
