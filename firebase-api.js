// firebase-api.js — Firebase 통신 및 데이터 영속성 계층
// app.js에서 분리된 Firebase 관련 로직을 관리합니다.

// --- 모듈 내부 상태 ---
let db = null;
let currentDbName = '';
let currentClubId = 'Default';
let clusterUnsubscribe = null;
let statusUnsubscribe = null;
let systemSettings = { admin_pw: "ace_admin" };

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
export function initFirebase(callbacks) {
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

    // 글로벌 설정 리스너 (기본 ACE 클러스터 또는 개별 클럽 경로)
    const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
    const settingsRef = doc(db, settingsPath);

    // 먼저 localStorage를 읽어서 활성 DB를 확인
    const cachedDb = localStorage.getItem(`ace_active_db_${currentClubId}`);
    if (cachedDb) {
        currentDbName = cachedDb;
        if (_callbacks.onDbNameChange) _callbacks.onDbNameChange(currentDbName);
        subscribeToCluster(currentDbName);
    }

    getDoc(settingsRef).then(snap => {
        if (snap.exists()) {
            const activeDb = snap.data().active_cluster || 'Default';
            if (activeDb !== currentDbName) {
                currentDbName = activeDb;
                localStorage.setItem(`ace_active_db_${currentClubId}`, activeDb);
                if (_callbacks.onDbNameChange) _callbacks.onDbNameChange(currentDbName);
                subscribeToCluster(activeDb);
            }
        }
    }).catch(() => { }).finally(() => {
        // settings 리스너 등록 (이후 실시간 변경 감지)
        onSnapshot(settingsRef, (snapshot) => {
            if (snapshot.exists()) {
                systemSettings = snapshot.data();
                if (_callbacks.onSettingsUpdate) _callbacks.onSettingsUpdate(systemSettings);
                const globalActiveDb = systemSettings.active_cluster || 'Default';

                // 전역 활성 DB가 변경되었을 경우에만 리스너 재구독 및 로컬 저장
                if (globalActiveDb !== currentDbName || !clusterUnsubscribe) {
                    console.log(`[Global Sync] Switching to Active DB: ${globalActiveDb}`);
                    currentDbName = globalActiveDb;
                    localStorage.setItem(`ace_active_db_${currentClubId}`, globalActiveDb);
                    if (_callbacks.onDbNameChange) _callbacks.onDbNameChange(currentDbName);
                    subscribeToCluster(globalActiveDb);
                }
            } else {
                // ⚠️ 설정 문서가 존재하지 않음
                // 이미 활성 DB가 있는 경우: 네트워크 일시 단절로 인한 false-negative일 수 있음
                // → 기존 DB를 유지하면서 설정 문서를 복원
                if (currentDbName && currentDbName !== 'Default') {
                    console.warn(`[Settings] ⚠️ Settings document not found but active DB is '${currentDbName}'. Restoring settings instead of resetting to Default.`);
                    setDoc(settingsRef, { admin_pw: systemSettings.admin_pw || "ace_admin", active_cluster: currentDbName });
                } else {
                    // 최초 초기화인 경우에만 Default로 생성
                    console.log("[Settings] Creating initial settings document with Default.");
                    setDoc(settingsRef, { admin_pw: "ace_admin", active_cluster: "Default" });
                }
            }
        });
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

/**
 * 전체 상태를 Firestore에 저장
 * @param {Object} appState - { members, matchHistory, currentSchedule, sessionNum, applicants }
 * @param {string} caller - 호출 경로 식별용 문자열
 */
export async function saveToCloud(appState, caller = 'unknown') {
    // --- 안전장치: 빈 데이터 덮어쓰기 방지 ---
    const memberCount = (appState.members || []).length;
    const historyCount = (appState.matchHistory || []).length;

    if (memberCount === 0 && historyCount === 0) {
        console.warn(`[SaveToCloud] ⚠️ BLOCKED: 빈 데이터 저장 시도 차단됨 (caller: ${caller}, DB: ${currentDbName})`);
        console.warn(`[SaveToCloud] members: ${memberCount}, matchHistory: ${historyCount}`);
        console.trace('[SaveToCloud] 호출 스택:');
        return; // 빈 데이터를 저장하지 않음
    }

    console.log(`[SaveToCloud] 저장 실행 (caller: ${caller}, DB: ${currentDbName}, members: ${memberCount}, history: ${historyCount})`);

    const { doc, setDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    try {
        await setDoc(doc(db, clusterPath, currentDbName), {
            members: appState.members,
            matchHistory: appState.matchHistory,
            currentSchedule: appState.currentSchedule,
            sessionNum: appState.sessionNum,
            applicants: appState.applicants
        });
    } catch (e) {
        console.error("Cloud Error:", e);
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
    try {
        const { collection, getDocs } = window.FB_SDK;
        const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
        const querySnapshot = await getDocs(collection(db, clusterPath));
        const select = document.getElementById('dbListSelect');
        if (!select) return;

        // 초기화 (첫 번째 옵션 제외)
        while (select.options.length > 1) select.remove(1);

        querySnapshot.forEach((docSnap) => {
            const opt = document.createElement('option');
            opt.value = docSnap.id;
            opt.text = docSnap.id;
            if (docSnap.id === currentDbName) opt.selected = true;
            select.add(opt);
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
    if (confirm(`'${newName}' 데이터베이스를 생성하고 모든 사용자의 기본 DB로 설정하시겠습니까?`)) {
        try {
            const { doc, updateDoc } = window.FB_SDK;
            const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
            await updateDoc(doc(db, settingsPath), { active_cluster: newName });
            document.getElementById('newDbInput').value = '';
            alert(`신규 DB '${newName}'이 생성 및 전역 활성 DB로 설정되었습니다.`);
            if (_callbacks.closeDbModal) _callbacks.closeDbModal();
        } catch (e) { alert('생성 실패: ' + e.message); }
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
