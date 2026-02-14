// ACE 랭킹 시스템 - 실시간 클라우드 엔진 v3.0 (JavaScript)

// --- Firebase 초기화 및 상태 관리 ---
let db;
let isAdmin = false;
let systemSettings = { admin_pw: "ace_admin" };
let currentDbName = 'Default';
let clusterUnsubscribe = null;
let statusUnsubscribe = null;

// --- 멀티 클럽 감지 ---
const urlParams = new URLSearchParams(window.location.search);
const currentClubId = urlParams.get('club') || 'Default';

// --- 핵심 도메인 데이터 ---
let members = [];
let matchHistory = [];
let applicants = [];
let currentSchedule = [];
let activeGroupTab = 'A';
let editingMatchId = null;
let sessionNum = 1;
let currentSessionState = { status: 'idle', sessionNum: 0 };
let eloChart = null;
let trendChart = null;
let rankMap = new Map(); // 현재 랭킹 순위 저장용
let sessionRankSnapshots = {}; // 회차별(세션별) 시작 시점의 랭킹 스냅샷
let historyViewMode = 'match'; // 'match' or 'player'
let sessionStartRatings = {}; // 회차별 시작 시점의 레이팅 스냅샷

// --- 설정 및 상수 ---
const ELO_INITIAL = 1500;
const K_FACTOR = 32;
const GAME_COUNTS = { 4: 3, 5: 5, 6: 6, 7: 7, 8: 8 };
const MATCH_PATTERNS = {
    8: [[[0, 4], [1, 5]], [[2, 6], [3, 7]], [[0, 5], [3, 6]], [[1, 4], [2, 7]], [[2, 4], [0, 6]], [[3, 5], [1, 7]], [[0, 7], [3, 4]], [[2, 5], [1, 6]]],
    7: [[[0, 3], [2, 6]], [[1, 4], [2, 5]], [[0, 4], [1, 3]], [[4, 5], [3, 6]], [[1, 6], [2, 3]], [[0, 5], [2, 4]], [[0, 6], [1, 5]]],
    6: [[[0, 2], [1, 4]], [[1, 3], [4, 5]], [[0, 5], [2, 4]], [[0, 3], [1, 2]], [[0, 4], [3, 5]], [[1, 5], [2, 3]]],
    5: [[[0, 2], [1, 4]], [[0, 4], [1, 3]], [[1, 2], [3, 4]], [[0, 3], [2, 4]], [[0, 1], [2, 3]]],
    4: [[[0, 1], [2, 3]], [[0, 3], [1, 2]], [[0, 2], [1, 3]]]
};

// --- 앱 초기화 로직 ---
window.addEventListener('DOMContentLoaded', async () => {
    initFirebase();
    initUIEvents();
    checkAdminLogin();
    if (document.getElementById('tab-stats').classList.contains('active')) {
        renderStatsDashboard();
    }
    // DB 이름 표시 업데이트
    updateDbDisplay();
});

function initFirebase() {
    const { initializeApp, getFirestore, onSnapshot, doc, setDoc } = window.FB_SDK;

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

    // 글로벌 설정 리스너 (기본 ACE 클레스터 또는 개별 클럽 경로)
    const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
    const settingsRef = doc(db, settingsPath);

    onSnapshot(settingsRef, (snapshot) => {
        if (snapshot.exists()) {
            systemSettings = snapshot.data();
            const globalActiveDb = systemSettings.active_cluster || 'Default';

            // 전역 활성 DB가 변경되었을 경우에만 리스너 재구독
            if (globalActiveDb !== currentDbName || !clusterUnsubscribe) {
                console.log(`[Global Sync] Switching to Active DB: ${globalActiveDb}`);
                subscribeToCluster(globalActiveDb);
            }
        } else {
            // 초기 설정 (클럽별 독립 설정)
            setDoc(settingsRef, { admin_pw: "ace_admin", active_cluster: "Default" });
        }
    });
}

function subscribeToCluster(dbName) {
    const { doc, onSnapshot, setDoc } = window.FB_SDK;

    // 기존 리스너 해제
    if (clusterUnsubscribe) clusterUnsubscribe();
    if (statusUnsubscribe) statusUnsubscribe();

    currentDbName = dbName;
    updateDbDisplay();

    // 1. 데이터 클러스터 리스너
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    const docRef = doc(db, clusterPath, currentDbName);
    clusterUnsubscribe = onSnapshot(docRef, async (snapshot) => {
        console.log(`[Firebase] Snapshot received for DB: ${currentDbName}`);
        let data = snapshot.exists() ? snapshot.data() : null;
        let isEmpty = !data || (Array.isArray(data.members) && data.members.length === 0);

        if (isEmpty && currentDbName.toLowerCase() === 'default') {
            await handleMigration();
        } else if (snapshot.exists()) {
            members = data.members || [];
            matchHistory = data.matchHistory || [];
            currentSchedule = data.currentSchedule || [];
            sessionNum = data.sessionNum || 1;
            applicants = data.applicants || [];
            recalculateAll();
            updateUI();
        } else {
            members = []; matchHistory = []; currentSchedule = []; applicants = [];
            await window.saveToCloud();
        }
    });

    // 2. 세션 상태 리스너 (경로 보정: 홀수 세그먼트 방지)
    const sessionStatusDocPath = currentClubId === 'Default'
        ? `system/sessionStatus_${currentDbName}`
        : `clubs/${currentClubId}/status/sessionStatus_${currentDbName}`;

    statusUnsubscribe = onSnapshot(doc(db, sessionStatusDocPath), (snap) => {
        if (snap.exists()) {
            currentSessionState = snap.data();
            updateUI();
        } else if (currentDbName.toLowerCase() !== 'default') {
            const nextSeq = (matchHistory.length > 0 ? Math.max(...matchHistory.map(h => parseInt(h.sessionNum) || 0)) : 0) + 1;
            currentSessionState = { status: 'idle', sessionNum: nextSeq };
            setDoc(doc(db, sessionStatusDocPath), currentSessionState);
        }
    });
}

async function handleMigration() {
    const { doc, getDoc, setDoc } = window.FB_SDK;
    console.log("[Migration] Default DB is empty. Checking for legacy data...");
    try {
        const legacyRef = doc(db, "system", "database");
        const legacySnap = await getDoc(legacyRef);

        if (legacySnap.exists()) {
            const legacyData = legacySnap.data();
            members = legacyData.members || [];
            matchHistory = legacyData.matchHistory || [];
            currentSchedule = legacyData.currentSchedule || [];
            sessionNum = legacyData.sessionNum || 1;
            applicants = legacyData.applicants || [];

            await window.saveToCloud();

            const legacySessionRef = doc(db, "system", "sessionStatus");
            const legacySessionSnap = await getDoc(legacySessionRef);
            if (legacySessionSnap.exists()) {
                await setDoc(doc(db, "system", "sessionStatus_Default"), legacySessionSnap.data());
            }
            recalculateAll();
            updateUI();
        } else {
            members = []; matchHistory = []; currentSchedule = []; applicants = [];
            await window.saveToCloud();
        }
    } catch (e) {
        console.error("[Migration] Error:", e);
    }
}

window.saveToCloud = async () => {
    const { doc, setDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
    try {
        await setDoc(doc(db, clusterPath, currentDbName), {
            members,
            matchHistory,
            currentSchedule,
            sessionNum,
            applicants
        });
    } catch (e) {
        console.error("Cloud Error:", e);
    }
};

async function tryMigrateLocalToCloud() {
    const localMembers = JSON.parse(localStorage.getItem('ace_v3_members'));
    const localHistory = JSON.parse(localStorage.getItem('ace_v3_history'));
    if (localMembers && localMembers.length > 0) {
        if (confirm('클라우드에 데이터가 없습니다. 노트북의 기존 데이터를 업로드할까요?')) {
            await window.saveToCloud({
                members: localMembers,
                matchHistory: localHistory || [],
                applicants: [],
                currentSchedule: []
            });
            alert('클라우드로 마이그레이션 완료!');
        }
    }
}

// --- 관리자 인증 로직 ---
function initUIEvents() {
    const bindClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    bindClick('adminLoginBtn', openAdminModal);
    bindClick('helpBtn', openHelpModal);
    bindClick('confirmAdminBtn', tryAdminLogin);
    bindClick('addPlayerBtn', addPlayer);
    bindClick('generateScheduleBtn', generateSchedule);
    bindClick('updateEloBtn', commitSession);
    bindClick('saveEditBtn', saveEdit);
    bindClick('openRoundBtn', openRegistration);
    bindClick('switchDbBtn', switchDatabase);
    bindClick('dbSettingsBtn', openDbModal);
    bindClick('loadDbBtn', async () => {
        const sel = document.getElementById('dbListSelect');
        if (sel && sel.value) {
            if (confirm(`전체 사용자에게 '${sel.value}' 데이터베이스를 활성 DB로 설정하시겠습니까?`)) {
                try {
                    const { doc, updateDoc } = window.FB_SDK;
                    const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
                    await updateDoc(doc(db, settingsPath), { active_cluster: sel.value });
                    alert(`'${sel.value}' DB가 전역 활성 DB로 설정되었습니다.`);
                    closeDbModal();
                } catch (e) { alert('설정 변경 실패: ' + e.message); }
            }
        } else {
            alert('전환할 데이터베이스를 선택해주세요.');
        }
    });
    bindClick('exportCsvBtn', exportHistoryToCsv);

    const splitInput = document.getElementById('customSplitInput');
    if (splitInput) splitInput.oninput = validateCustomSplit;
}

function updateDbDisplay() {
    const el = document.getElementById('currentDbName');
    if (el) {
        const clubText = currentClubId !== 'Default' ? `[${currentClubId}] ` : '';
        el.innerText = `${clubText}DB: ${currentDbName}`;
    }
}

async function fetchDbList() {
    if (!isAdmin) return;
    try {
        const { collection, getDocs } = window.FB_SDK;
        const clusterPath = currentClubId === 'Default' ? "clusters" : `clubs/${currentClubId}/clusters`;
        const querySnapshot = await getDocs(collection(db, clusterPath));
        const select = document.getElementById('dbListSelect');
        if (!select) return;

        // 초기화 (첫 번째 옵션 제외)
        while (select.options.length > 1) select.remove(1);

        querySnapshot.forEach((doc) => {
            const opt = document.createElement('option');
            opt.value = doc.id;
            opt.text = doc.id;
            if (doc.id === currentDbName) opt.selected = true;
            select.add(opt);
        });
    } catch (e) {
        console.error("Fetch DB List Error:", e);
    }
}

async function switchDatabase() {
    const newName = document.getElementById('newDbInput').value.trim();
    if (!newName) { alert('DB 이름을 입력해주세요.'); return; }
    if (confirm(`'${newName}' 데이터베이스를 생성하고 모든 사용자의 기본 DB로 설정하시겠습니까?`)) {
        try {
            const { doc, updateDoc } = window.FB_SDK;
            const settingsPath = currentClubId === 'Default' ? "system/settings" : `clubs/${currentClubId}/config/settings`;
            await updateDoc(doc(db, settingsPath), { active_cluster: newName });
            document.getElementById('newDbInput').value = '';
            alert(`신규 DB '${newName}'이 생성 및 전역 활성 DB로 설정되었습니다.`);
            closeDbModal();
        } catch (e) { alert('생성 실패: ' + e.message); }
    }
}

// --- 세션 관리 로직 (New) ---
async function openRegistration() {
    if (!isAdmin) return;
    const input = document.getElementById('nextSessionNum');
    const num = parseInt(input.value);

    if (!num || num < 1) {
        alert('유효한 회차 번호를 입력하세요.');
        return;
    }

    if (confirm(`제 ${num}회차 참가 접수를 시작하시겠습니까?`)) {
        await window.saveSessionState('recruiting', num);
        // 기존 참가자 명단 초기화 여부는 선택사항이나, 새 회차 시작 시 보통 초기화함
        if (applicants.length > 0 && confirm('이전 대기 명단을 초기화하시겠습니까?')) {
            applicants = [];
            await window.saveToCloud();
        }
    }
}

window.saveSessionState = async (status, sessionNum) => {
    try {
        const { doc, setDoc } = window.FB_SDK;
        const sessionStatusDocPath = currentClubId === 'Default'
            ? `system/sessionStatus_${currentDbName}`
            : `clubs/${currentClubId}/status/sessionStatus_${currentDbName}`;
        await setDoc(doc(db, sessionStatusDocPath), { status, sessionNum });
    } catch (e) { console.error("Session State Error:", e); }
};

function renderSessionStatus() {
    const banner = document.getElementById('roundStatusBanner');
    const form = document.getElementById('applicationForm');
    const adminPanel = document.getElementById('nextSessionNum')?.parentElement?.parentElement;

    // 상태별 텍스트 및 스타일
    let statusText = "";
    let statusColor = "";

    if (currentSessionState.status === 'recruiting') {
        statusText = `📢 제 ${currentSessionState.sessionNum}회차 랭킹전 참가 접수 중`;
        statusColor = "rgba(56, 189, 248, 0.2)"; // Blue tint
        if (form) form.style.display = 'block';
    } else if (currentSessionState.status === 'playing') {
        statusText = `🔥 제 ${currentSessionState.sessionNum}회차 랭킹전 진행 중`;
        statusColor = "rgba(255, 99, 132, 0.1)"; // Red tint
        if (form) form.style.display = 'none';
    } else {
        statusText = "💤 현재 진행 중인 랭킹전 일정이 없습니다.";
        statusColor = "rgba(255, 255, 255, 0.05)"; // Gray
        if (form) form.style.display = 'none';

        // Idle 상태일 때 관리자에게 다음 회차 자동 추천
        if (isAdmin) {
            const nextSeq = (matchHistory.length > 0 ? Math.max(...matchHistory.map(h => parseInt(h.sessionNum) || 0)) : 0) + 1;
            const input = document.getElementById('nextSessionNum');
            if (input && !input.value) input.value = nextSeq;
        }
    }

    if (banner) {
        banner.innerHTML = `<h3 style="margin:0">${statusText}</h3>`;
        banner.style.background = statusColor;
    }

    // 관리자 패널 표시 제어 (경기 중일 때는 숨김 request)
    if (adminPanel && isAdmin) {
        if (currentSessionState.status === 'playing') {
            adminPanel.style.display = 'none';
        } else {
            adminPanel.style.display = 'block';
        }
    }

    // 관리자 UI 제어 (모집 중일 때는 오픈 버튼 비활성화 등)
    const openBtn = document.getElementById('openRoundBtn');
    if (openBtn) {
        openBtn.disabled = (currentSessionState.status === 'recruiting');
        openBtn.innerText = currentSessionState.status === 'recruiting' ? "접수 진행 중" : "참가 접수 시작";
    }
}

// --- 수동 조 편성 엔진 (v3.2: 복구 및 정밀화) ---
function validateCustomSplit() {
    const input = document.getElementById('customSplitInput').value.trim();
    const status = document.getElementById('splitStatus');
    const btn = document.getElementById('generateScheduleBtn');

    if (!input) {
        if (status) status.innerText = "";
        btn.disabled = false;
        updateOptimizationInfo();
        return true;
    }

    const nums = input.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const sum = nums.reduce((a, b) => a + b, 0);
    const isValidSize = nums.every(n => n >= 4 && n <= 8);
    const totalGames = nums.reduce((a, b) => a + (GAME_COUNTS[b] || 0), 0);

    if (sum !== applicants.length) {
        if (status) {
            status.innerText = `인원 불일치 (입력:${sum}/참가:${applicants.length})`;
            status.className = "status-error";
        }
        btn.disabled = true;
        return false;
    } else if (!isValidSize) {
        if (status) {
            status.innerText = "각 조는 4~8명만 가능합니다.";
            status.className = "status-error";
        }
        btn.disabled = true;
        return false;
    } else {
        if (status) {
            status.innerText = `구성 가능 ✅ (총 ${totalGames}게임)`;
            status.className = "status-success";
        }
        btn.disabled = false;

        const info = document.getElementById('optimizationInfo');
        if (info) info.innerHTML = `<div>현재 참여: ${applicants.length}명 | 커스텀: <strong>${nums.join(', ')}분할</strong></div><div style="margin-top:5px">총 경기: <span class="session-info" style="background:${totalGames <= 18 ? 'var(--success)' : 'var(--danger)'}; color:white">${totalGames}게임</span></div>`;
        return true;
    }
}

function openAdminModal() {
    if (isAdmin) {
        if (confirm('관리자 로그아웃 하시겠습니까?')) {
            isAdmin = false;
            localStorage.removeItem('ace_admin');
            updateAdminUI();
        }
        return;
    }
    document.getElementById('adminModal').classList.remove('hidden');
}
window.closeAdminModal = () => document.getElementById('adminModal').classList.add('hidden');

function openHelpModal() {
    document.getElementById('helpModal').classList.remove('hidden');
}
window.closeHelpModal = () => document.getElementById('helpModal').classList.add('hidden');

function openDbModal() {
    document.getElementById('dbModal').classList.remove('hidden');
    fetchDbList();
}
window.closeDbModal = () => document.getElementById('dbModal').classList.add('hidden');

function tryAdminLogin() {
    const pw = document.getElementById('adminPassword').value;
    // 디버깅: 비밀번호 로드 상태 확인
    if (!systemSettings || !systemSettings.admin_pw) {
        console.warn("System settings not loaded yet. Using default.");
    }
    const correctPw = systemSettings?.admin_pw || "ace_admin"; // 로드 실패 시 기본값

    if (pw === correctPw) {
        isAdmin = true;
        localStorage.setItem('ace_admin', 'true');
        closeAdminModal();
        updateAdminUI();
        alert('관리자 모드가 활성화되었습니다.');
    } else {
        alert(`비밀번호가 틀렸습니다. (입력: ${pw})`);
    }
    document.getElementById('adminPassword').value = '';
}

async function checkAdminLogin() {
    const saved = localStorage.getItem('ace_admin');
    if (saved === 'true') {
        isAdmin = true;
        updateAdminUI();
    }
}

function updateAdminUI() {
    const status = document.getElementById('adminLoginBtn');
    const adminAreas = document.querySelectorAll('.admin-only');
    const guestAreas = document.querySelectorAll('.guest-only');

    if (isAdmin) {
        status.innerText = "로그아웃 (Admin)";
        status.classList.remove('secondary');
        status.classList.add('success');
        adminAreas.forEach(el => el.style.display = 'block');
        guestAreas.forEach(el => el.style.display = 'none');
        fetchDbList(); // DB 관리 리스트 갱신
    } else {
        status.innerText = "관리자 로그인";
        status.classList.add('secondary');
        status.classList.remove('success');
        adminAreas.forEach(el => el.style.display = 'none');
        guestAreas.forEach(el => el.style.display = 'block');
    }
    renderApplicants(); // 관리자 상태 변경 시 명단(X버튼 등) 즉시 갱신
    renderHistory();    // 관리자 상태 변경 시 히스토리 버튼 즉시 갱신
    renderSessionStatus(); // 관리자 상태 변경 시 세션 UI 즉시 갱신 (New)
}

// --- 데이터 동기화 로직 통합 (v3.1) ---
// (기존 중복 saveToCloud 함수 제거됨)

// --- 개선된 신청 로직 (비회원도 가능, 멤버 등록은 경기 후) ---
async function addPlayer() {
    if (currentSessionState.status !== 'recruiting') {
        alert('현재 참가 접수 기간이 아닙니다.');
        return;
    }
    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim(); if (!name) return;

    // 이미 멤버에 있는지 확인
    let existingMember = members.find(x => x.name === name);
    let applicantData;

    if (existingMember) {
        // 이미 멤버라면 기존 데이터 활용
        applicantData = existingMember;
    } else {
        // 신규라면 임시 객체 생성 (members에는 아직 안 넣음)
        applicantData = { id: Date.now() + Math.random(), name, rating: ELO_INITIAL, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0, participationArr: [] };
    }

    // 신청 명단에 없으면 추가
    if (!applicants.find(a => a.name === name)) {
        applicants.push(applicantData);
    }

    nameInput.value = '';
    await window.saveToCloud();
}

// 신청 버튼 상태 업데이트 (대진 진행 중일 때 비활성화)
function updateApplyButtonState() {
    const btn = document.getElementById('addPlayerBtn');
    const input = document.getElementById('playerName');
    if (!btn || !input) return;

    if (currentSchedule.length > 0) {
        btn.disabled = true;
        btn.innerText = "대진 진행 중...";
        btn.classList.add('secondary');
        input.disabled = true;
        input.placeholder = "대진 종료 후 신청 가능";
    } else {
        btn.disabled = false;
        btn.innerText = "신청하기";
        btn.classList.remove('secondary');
        input.disabled = false;
        input.placeholder = "선수 이름 입력";
    }
}

// --- 기존 핵심 엔진 로직 (클라우드 환경 대응) ---

function recalculateAll() {
    try {
        rankMap.clear();
        members.forEach(m => {
            m.rating = ELO_INITIAL; m.matchCount = 0; m.wins = 0; m.losses = 0; m.draws = 0; m.scoreDiff = 0;
            m.participationArr = [];
            m.prevRating = ELO_INITIAL; // 이전 세션 레이팅 (변동 표시용)
        });

        const memberMap = new Map();
        members.forEach(m => memberMap.set(String(m.id), m));

        const sessionIds = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));

        // 이전 세션까지의 랭킹 계산 (순위 변동용)
        let previousRanking = [];

        sessionIds.forEach((sId, idx) => {
            const isLastSession = idx === sessionIds.length - 1;
            if (isLastSession) {
                // 현재 세션 시작 전의 레이팅 저장
                members.forEach(m => m.prevRating = m.rating);
                previousRanking = [...members].sort((a, b) => b.rating - a.rating).map(m => m.id);
            }

            const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);
            const ratingSnapshot = {};
            members.forEach(m => { ratingSnapshot[m.id] = m.rating; });

            // 회차별 시작 시점의 랭킹 스냅샷 저장
            // v6.3: 신규 멤버(matchCount===0)는 하위 랭킹으로 배치
            const existingMembers = members.filter(m => m.matchCount > 0);
            const newMembers = members.filter(m => m.matchCount === 0);
            existingMembers.sort((a, b) => b.rating - a.rating);
            newMembers.sort(() => Math.random() - 0.5); // 신규끼리는 랜덤
            const finalSorted = [...existingMembers, ...newMembers];
            sessionRankSnapshots[sId] = {};
            finalSorted.forEach((m, idx) => {
                sessionRankSnapshots[sId][m.id] = idx + 1;
            });

            // 회차별 시작 시점의 레이팅 저장 (인원별 정렬용)
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

                // --- Modified ELO System (v6) ---
                // 초기: 1500점
                // 공식: Change = K * (Actual - Expected)
                // 완승(6:0) 보너스: Change * 1.5 (승자 +50%, 패자 -50%)

                const exp1 = 1 / (1 + Math.pow(10, (avg2 - avg1) / 400));
                const exp2 = 1 / (1 + Math.pow(10, (avg1 - avg2) / 400));

                // Actual Score (1=Win, 0=Loss, 0.5=Draw)
                let act1 = 0.5;
                let act2 = 0.5;
                if (actual === 1) { act1 = 1; act2 = 0; }
                else if (actual === 0) { act1 = 0; act2 = 1; }

                let changeT1 = K_FACTOR * (act1 - exp1);
                let changeT2 = K_FACTOR * (act2 - exp2);

                // Shutout Bonus (1.5x)
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
            // 세션 참가 점수 제거됨
        });

        // 현재 랭킹 순위 저장
        const currentRanking = [...members].sort((a, b) => {
            if (b.rating !== a.rating) return b.rating - a.rating;
            // 동점자(특히 신규 0점) 처리: 랜덤 배정 (요청사항)
            // 주의: 리렌더링 시마다 순위가 바뀔 수 있음. 고정하려면 별도 seed 필요하나, 현재는 요청대로 단순 랜덤 적용.
            return Math.random() - 0.5;
        });
        currentRanking.forEach((m, idx) => {
            const prevIdx = previousRanking.indexOf(m.id);
            let change = 0;
            if (prevIdx !== -1) change = prevIdx - idx; // 이전 순위 - 현재 순위 (양수면 상승)
            rankMap.set(String(m.id), { rank: idx + 1, change });
        });

    } catch (e) { console.error("Recalculate Error:", e); }
}

function updateUI() {
    const unique = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean);
    const badge = document.getElementById('sessionBadge');
    if (badge) badge.innerText = `진행된 대회: ${unique.length}회차`;
    renderApplicants();
    updateOptimizationInfo();
    renderRanking();
    renderCurrentMatches();
    renderHistory();
    updateApplyButtonState(); // 신청 버튼 상태 갱신 추가
    updateStatistics(); // 통계 업데이트 추가
    renderStatsDashboard(); // 대시보드 렌더링 엔진 가동
    renderSessionStatus(); // 세션 상태 렌더링 추가
}

function renderApplicants() {
    const list = document.getElementById('playerList'); if (!list) return;
    list.innerHTML = '';

    // 조별 인원 정렬 (랭킹순, 신규는 아래)
    const sortedApplicants = [...applicants].sort((a, b) => {
        const rA = rankMap.get(String(a.id))?.rank || 9999;
        const rB = rankMap.get(String(b.id))?.rank || 9999;
        return rA - rB;
    });

    sortedApplicants.forEach(a => {
        const div = document.createElement('div'); div.className = 'player-tag';
        const info = rankMap.get(String(a.id));
        // 신규 참가자는 (New) 표시
        const rankLabel = info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
        div.innerHTML = `${a.name}${rankLabel}${isAdmin ? ` <span class="remove-btn" onclick="removeApplicant('${a.id}')">×</span>` : ''}`;
        list.appendChild(div);
    });
}
window.removeApplicant = async (id) => {
    if (!isAdmin) return;
    // id가 숫자인 경우와 문자열인 경우 모두 대응하도록 String으로 변환하여 비교
    applicants = applicants.filter(a => String(a.id) !== String(id));
    await window.saveToCloud();
};

function updateOptimizationInfo() {
    const dash = document.getElementById('dashboard'); if (!dash) return;
    if (applicants.length < 4) { dash.style.display = 'none'; return; }
    dash.style.display = 'block';

    const sessIn = document.getElementById('manualSessionNum');
    if (sessIn && !sessIn.value) sessIn.value = (matchHistory.length > 0 ? Math.max(...matchHistory.map(h => parseInt(h.sessionNum) || 0)) : 0) + 1;

    const customInputVal = document.getElementById('customSplitInput').value.trim();
    if (!customInputVal) {
        const split = getSplits(applicants.length);
        const games = split.reduce((a, b) => a + (GAME_COUNTS[b] || 0), 0);
        const info = document.getElementById('optimizationInfo');
        if (info) info.innerHTML = `<div>참가: ${applicants.length}명 | 추천: <strong>${split.join(', ')}분할</strong></div><div style="margin-top:5px">총 경기: <span class="session-info" style="background:${games <= 18 ? 'var(--success)' : 'var(--danger)'}; color:white">${games}게임</span></div>`;
    } else {
        validateCustomSplit();
    }
}

// --- 대진표 생성 (Admin Only: 수동 조 편성 로직 최우선 반영) ---
async function generateSchedule() {
    if (!isAdmin) return;

    // 활성화된 회차 번호 우선 사용
    const sessionNum = currentSessionState.sessionNum || document.getElementById('manualSessionNum')?.value;

    if (!sessionNum) { alert('회차 정보가 없습니다. 회차를 활성화하거나 입력해주세요.'); return; }

    let split;
    const customValue = document.getElementById('customSplitInput').value.trim();
    if (customValue) {
        split = customValue.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        const sum = split.reduce((a, b) => a + b, 0);
        if (sum !== applicants.length) { alert('커스텀 인원 합계가 신청 인원과 일치하지 않습니다.'); return; }
    } else {
        split = getSplits(applicants.length);
    }
    if (!split || split.length === 0) { alert('인원 분할에 실패했습니다. 조별 인원을 확인해 주세요.'); return; }

    // 대진 배정 로직: 랭킹 사용자(정렬) + 신규 사용자(랜덤)
    // 대진 배정 로직: 랭킹 사용자(정렬) + 신규 사용자(랜덤)
    const rankedArr = applicants.filter(a => rankMap.has(String(a.id))).sort((a, b) => b.rating - a.rating);
    const newArr = applicants.filter(a => !rankMap.has(String(a.id)));

    // 신규 사용자 랜덤 셔플 및 가상 랭킹(vRank) 부여
    // 가상 랭킹 시작: 전체 멤버 수 + 1
    // 랜덤성을 위해 먼저 섞음
    newArr.sort(() => Math.random() - 0.5);

    let startVRank = members.length + 1;
    newArr.forEach(p => {
        p.vRank = startVRank++; // 대진표 생성을 위한 임시 속성
    });

    const sorted = [...rankedArr, ...newArr];

    let groupsArr = [], cur = 0;
    split.forEach(s => {
        const groupMembers = sorted.slice(cur, cur + s);
        if (groupMembers.length >= 4) groupsArr.push(groupMembers);
        cur += s;
    });

    currentSchedule = [];
    groupsArr.forEach((g, groupIdx) => {
        const pattern = MATCH_PATTERNS[g.length]; if (!pattern) return;
        const gLabel = String.fromCharCode(65 + groupIdx);
        pattern.forEach((m, matchIdx) => {
            let roundNum = Math.floor(matchIdx / (g.length === 8 ? 2 : 1)) + 1;
            currentSchedule.push({
                id: Math.random().toString(36).substr(2, 9),
                sessionNum: currentSessionState.sessionNum || sessionNum, // 활성화된 회차 번호 사용
                group: gLabel, groupRound: roundNum,
                // 플레이어 객체에 vRank가 있다면 이를 보존해야 함.
                // applicants의 객체를 그대로 참조하면 되지만, 안전을 위해 복사하되 vRank는 포함.
                t1: [{ ...g[m[0][0]] }, { ...g[m[0][1]] }],
                t2: [{ ...g[m[1][0]] }, { ...g[m[1][1]] }],
                s1: null, s2: null
            });
        });
    });

    activeGroupTab = 'A';

    // 대진 생성 시 상태를 'playing'으로 변경하여 접수 마감
    await window.saveSessionState('playing', currentSessionState.sessionNum);

    // 대진 생성 시 신청자 명단 초기화 (운영 로직 강화)
    applicants = [];
    await window.saveToCloud();
    switchTab('match');
}

function renderCurrentMatches() {
    const container = document.getElementById('matchContainer'), footer = document.getElementById('matchFooter'), tabs = document.getElementById('groupTabsContainer');
    if (!container) return;
    container.innerHTML = '';
    if (currentSchedule.length === 0) { if (footer) footer.style.display = 'none'; if (tabs) tabs.style.display = 'none'; return; }
    if (footer) footer.style.display = 'block'; if (tabs) tabs.style.display = 'block';

    const groups = [...new Set(currentSchedule.map(m => m.group))].sort();
    if (tabs) {
        tabs.innerHTML = '';
        groups.forEach(g => {
            const btn = document.createElement('button');
            btn.className = `sub-tab-btn ${activeGroupTab === g ? 'active' : ''}`;
            btn.innerText = `${g}조`;
            btn.onclick = () => { activeGroupTab = g; renderCurrentMatches(); };
            tabs.appendChild(btn);
        });
    }

    const sessionNum = currentSchedule[0].sessionNum;
    container.innerHTML = `<h3 style="text-align:center; margin-bottom:20px">제 ${sessionNum}회차 (${activeGroupTab}조 대진표)</h3>`;

    const filtered = currentSchedule.filter(m => m.group === activeGroupTab);
    const rounds = [...new Set(filtered.map(m => m.groupRound))].sort((a, b) => a - b);
    rounds.forEach(rNum => {
        const h = document.createElement('h4'); h.style.margin = '20px 0 10px 0'; h.style.color = 'var(--accent-color)'; h.innerText = `${rNum}회전`;
        container.appendChild(h);
        filtered.filter(m => m.groupRound === rNum).forEach(m => {
            // 랭킹 정보 조회 (v5.3: vRank 지원, v6.1: 스냅샷 지원은 History 전용이므로 여기는 vRank/CurrentRank)
            // 대진표(Current Schedule)는 '지금' 생성된 것이므로 vRank 또는 현재 랭킹 사용
            const getRank = (p) => {
                if (p.vRank) return `<span style="font-size:0.8em; color:var(--text-secondary)">(${p.vRank})</span>`;
                const info = rankMap.get(String(p.id));
                return info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : '';
            };

            const div = document.createElement('div'); div.className = 'match-card';
            div.innerHTML = `
                <div style="flex:1; display:flex; flex-direction:column; justify-content:center; gap:2px;">
                    <div><strong>${m.t1[0].name}${getRank(m.t1[0])}</strong></div>
                    <div><strong>${m.t1[1].name}${getRank(m.t1[1])}</strong></div>
                    ${isAdmin ? `<div style="margin-top:5px"><button class="edit-btn" style="padding:2px 6px; font-size:0.7rem; color:var(--text-secondary)" onclick="openCurrentMatchEditModal('${m.id}')">이름 수정</button></div>` : ''}
                </div>
                <div class="vs">
                    <input type="number" class="score-input" value="${m.s1 !== null ? m.s1 : ''}" placeholder="-" min="0" max="6" onchange="updateLiveScore('${m.id}',1,this.value)"> 
                    : 
                    <input type="number" class="score-input" value="${m.s2 !== null ? m.s2 : ''}" placeholder="-" min="0" max="6" onchange="updateLiveScore('${m.id}',2,this.value)">
                </div>
                <div style="flex:1; text-align:right; display:flex; flex-direction:column; justify-content:center; gap:2px;">
                    <div><strong>${m.t2[0].name}${getRank(m.t2[0])}</strong></div>
                    <div><strong>${m.t2[1].name}${getRank(m.t2[1])}</strong></div>
                </div>
            `;
            container.appendChild(div);
        });
    });

    // 모든 경기 점수가 입력되었는지 확인 및 종료 버튼 표시 (null이 아니어야 함)
    const finishedCount = currentSchedule.filter(m =>
        m.s1 !== null && m.s1 !== undefined && typeof m.s1 === 'number' &&
        m.s2 !== null && m.s2 !== undefined && typeof m.s2 === 'number'
    ).length;

    console.log(`Match Status: ${finishedCount}/${currentSchedule.length}`, currentSchedule);

    const eloBtn = document.getElementById('updateEloBtn');
    const footerMsg = footer ? footer.querySelector('p') : null;

    if (eloBtn) {
        if (finishedCount === currentSchedule.length && currentSchedule.length > 0) {
            eloBtn.style.display = 'block';
            eloBtn.disabled = false;
            eloBtn.innerText = "🏆 랭킹전 종료 및 결과 확정";
            if (footerMsg) footerMsg.innerText = "* 모든 경기가 종료되었습니다. 결과를 확정하세요.";
        } else {
            // 진행 중일 때는 안내 문구 표시 및 버튼 비활성화 (혹은 숨김)
            eloBtn.style.display = 'block';
            eloBtn.disabled = true;
            eloBtn.innerText = `경기 진행 중 (${finishedCount}/${currentSchedule.length})`;
            if (footerMsg) footerMsg.innerText = "⚠️ 모든 경기의 점수를 입력하면 [종료] 버튼이 활성화됩니다.";
        }
    }
}

window.updateLiveScore = async (id, team, val) => {
    let score = val === '' ? null : (parseInt(val) || 0); // 빈칸이면 null
    if (score !== null) {
        if (score < 0) score = 0; if (score > 6) score = 6;
    }
    const m = currentSchedule.find(x => x.id === id);
    if (m) {
        if (team === 1) m.s1 = score; else m.s2 = score;
        await window.saveToCloud();
    }
};

async function commitSession() {
    if (!isAdmin) return;

    // 안전장치: 모든 경기가 완료되었는지 재확인
    const unfinished = currentSchedule.filter(m =>
        m.s1 === null || m.s1 === undefined || typeof m.s1 !== 'number' ||
        m.s2 === null || m.s2 === undefined || typeof m.s2 !== 'number'
    );

    if (unfinished.length > 0) {
        alert(`아직 진행 중인 경기가 ${unfinished.length}건 있습니다.\n모든 점수를 입력해야 종료할 수 있습니다.`);
        return;
    }

    if (!confirm('결과를 기록하고 랭킹을 누적하시겠습니까?')) return;
    try {
        const sessionNum = currentSchedule[0].sessionNum, date = new Date().toLocaleDateString();
        let newMemberCount = 0;

        // 랭킹전 종료 시 신규 멤버 등록
        currentSchedule.forEach(m => {
            // 선수 객체 검증
            const allPlayers = [...m.t1, ...m.t2];
            allPlayers.forEach(p => {
                if (!p || !p.id) {
                    console.error("Invalid player object in schedule:", p);
                    return;
                }
                // ID 타입 안전 비교
                if (!members.find(existing => String(existing.id) === String(p.id))) {
                    members.push(p);
                    newMemberCount++;
                }
            });

            matchHistory.push({
                id: Date.now() + Math.random(),
                date,
                sessionNum,
                t1_ids: m.t1.map(p => p.id),
                t2_ids: m.t2.map(p => p.id),
                t1_names: m.t1.map(p => p.name),
                t2_names: m.t2.map(p => p.name),
                score1: parseInt(m.s1) || 0,
                score2: parseInt(m.s2) || 0
            });
        });

        currentSchedule = []; applicants = [];
        await window.saveToCloud();

        // 랭킹전 종료 후 상태를 IDLE로 변경하고 다음 회차 번호 준비
        await window.saveSessionState('idle', parseInt(sessionNum) + 1);

        switchTab('rank');
        alert(`랭킹전이 확정되었습니다!\n(신규 멤버 ${newMemberCount}명 등록됨)`);
    } catch (e) {
        console.error("Commit Session Error:", e);
        alert("오류가 발생했습니다. 콘솔을 확인해주세요.");
    }
}

window.setHistoryViewMode = (mode) => {
    historyViewMode = mode;

    // 버튼 상태 업데이트
    const matchBtn = document.getElementById('viewMatchesBtn');
    const playerBtn = document.getElementById('viewPlayersBtn');

    if (mode === 'match') {
        matchBtn?.classList.add('active');
        playerBtn?.classList.remove('active');
    } else {
        matchBtn?.classList.remove('active');
        playerBtn?.classList.add('active');
    }

    renderHistory();
};

function renderHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = matchHistory.length ? '' : '<p style="text-align:center; padding:20px">기록이 없습니다.</p>';

    // 회차별 그룹화
    const groups = {};
    matchHistory.forEach(h => {
        if (!groups[h.sessionNum]) groups[h.sessionNum] = [];
        groups[h.sessionNum].push(h);
    });

    // 회차 내림차순 정렬
    const sortedSessions = Object.keys(groups).sort((a, b) => parseInt(b) - parseInt(a));

    sortedSessions.forEach(sNum => {
        const sessionMatches = groups[sNum];
        const date = sessionMatches[0].date;

        const card = document.createElement('div');
        card.className = 'history-session-card';

        let contentHtml = '';
        if (historyViewMode === 'match') {
            contentHtml = sessionMatches.map(h => {
                // --- 히스토리 출력 개선 (v4.1) ---
                // 1. 승자가 왼쪽으로 오도록 정렬
                // 2. 무승부일 경우 기대승률이 낮은 사람(언더독)이 왼쪽으로 오도록 정렬
                let isSwap = false;
                if (h.score1 < h.score2) {
                    isSwap = true;
                } else if (h.score1 === h.score2) {
                    if ((h.elo_at_match?.expected || 0.5) > 0.5) {
                        isSwap = true;
                    }
                }

                const t1_disp = isSwap ? h.t2_names : h.t1_names;
                const t2_disp = isSwap ? h.t1_names : h.t2_names;
                const s1_disp = isSwap ? h.score2 : h.score1;
                const s2_disp = isSwap ? h.score1 : h.score2;

                // Growth Point Fix: use change1/change2 based on isSwap
                // If isSwap is true, left side is Team 2. So we show change2.
                // But wait, the UI shows a single "+XX" tag on the right side.
                // Usually this was for the winner.
                // In Growth Point, both gain points.
                // Let's show the points gained by the *winner* (or the left side player if draw?).
                // Or maybe show "+W / +L" style?
                // Given the space, let's just show the points of the *Left Side* team (which is usually the winner).

                let left_change = 0;
                if (isSwap) {
                    left_change = h.elo_at_match?.change2 || 0;
                } else {
                    left_change = h.elo_at_match?.change1 || 0;
                }

                // If draw, both get same points usually.
                // If win, winner gets more.
                // Let's just show the points of the winner (who is on the left).
                // "elo_change" variable used below. Let's rename or reuse.
                let elo_change = left_change;

                // 랭킹 정보 조회 (과거 회차 당시 기준)
                const getRankStrArr = (ids, names, sessNum) => {
                    return names.map((n, i) => {
                        const pid = ids[i];
                        let rankVal = '-';
                        if (sessionRankSnapshots[sessNum] && sessionRankSnapshots[sessNum][pid]) {
                            rankVal = sessionRankSnapshots[sessNum][pid];
                        }
                        // 신규 참가자(기록 없음)인 경우 (New)
                        const r = (rankVal !== '-')
                            ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${rankVal})</span>`
                            : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
                        return `${n}${r}`;
                    });
                };

                const t1_arr = getRankStrArr(isSwap ? h.t2_ids : h.t1_ids, t1_disp, h.sessionNum);
                const t2_arr = getRankStrArr(isSwap ? h.t1_ids : h.t2_ids, t2_disp, h.sessionNum);

                // Growth Point에서는 elo_at_match.change가 큰 의미가 없을 수 있으나, 승리팀 획득 점수 등을 표시할 수도 있음.
                // 여기서는 점수 변동폭이 승/패에 따라 다르므로 개별 표시가 이상적이나, UI상 승리팀 획득 점수만 표시하거나 숨김.
                // 기존 형식을 유지하되 값은 새로 계산된 로직을 따름.

                return `
                    <div class="history-match-item">
                        <div style="flex:2; display:flex; flex-direction:column; gap:2px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="display:flex; flex-direction:column;">
                                    <span><strong>${t1_arr[0]}</strong></span>
                                    <span><strong>${t1_arr[1]}</strong></span>
                                </div>
                                <span style="font-size:0.8rem; color:var(--text-secondary); margin:0 5px;">vs</span>
                                <div style="display:flex; flex-direction:column; text-align:right;">
                                    <span><strong>${t2_arr[0]}</strong></span>
                                    <span><strong>${t2_arr[1]}</strong></span>
                                </div>
                            </div>
                        </div>
                        <div style="flex:1; text-align:center; color:var(--accent-color); font-weight:bold; font-size:1.1rem">${s1_disp} : ${s2_disp}</div>
                        <div style="flex:1; text-align:right">
                            <span class="history-elo-tag" style="color:${elo_change >= 0 ? 'var(--success)' : 'var(--danger)'}">
                                ${elo_change >= 0 ? '+' : ''}${elo_change.toFixed(1)}
                            </span>
                            ${isAdmin ? `<div style="margin-top:5px"><button class="edit-btn" onclick="openEditModal(${h.id})">수정</button><button class="delete-btn" onclick="deleteHistory(${h.id})">삭제</button></div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            // 인원별 보기 로직
            const playerStats = {};
            sessionMatches.forEach(h => {
                const teams = [
                    { ids: h.t1_ids, names: h.t1_names, score: h.score1, oppScore: h.score2, change: h.elo_at_match?.change1 || 0 },
                    { ids: h.t2_ids, names: h.t2_names, score: h.score2, oppScore: h.score1, change: h.elo_at_match?.change2 || 0 }
                ];
                teams.forEach(t => {
                    t.ids.forEach((id, idx) => {
                        if (!playerStats[id]) playerStats[id] = { id: id, name: t.names[idx], wins: 0, draws: 0, losses: 0, eloSum: 0 };
                        if (t.score > t.oppScore) playerStats[id].wins++;
                        else if (t.score < t.oppScore) playerStats[id].losses++;
                        else playerStats[id].draws++;
                        playerStats[id].eloSum += t.change;
                    });
                });
            });

            // v6.2: 선수별 보기 정렬 (당시 랭킹 순)
            // sessionRankSnapshots[sNum]에 당시 순위(1, 2, 3...)가 저장되어 있음.
            const sortedPlayers = Object.values(playerStats).sort((a, b) => {
                const rankA = (sessionRankSnapshots[sNum] && sessionRankSnapshots[sNum][a.id]) || 9999;
                const rankB = (sessionRankSnapshots[sNum] && sessionRankSnapshots[sNum][b.id]) || 9999;
                return rankA - rankB; // 오름차순 (1위가 먼저)
            });
            contentHtml = sortedPlayers.map(p => {
                // v6.2: 당시 랭킹(Snapshot Rank) 표시
                let rankVal = (sessionRankSnapshots[sNum] && sessionRankSnapshots[sNum][p.id]) || '-';
                const rankLabel = (rankVal !== '-')
                    ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${rankVal})</span>`
                    : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
                return `
                <div class="player-history-item">
                    <div>
                        <div class="player-history-info">${p.name}${rankLabel}</div>
                        <div class="player-history-stats">${p.wins}승 ${p.draws}무 ${p.losses}패</div>
                    </div>
                    <div style="text-align:right">
                        <span class="history-elo-tag" style="color:${p.eloSum >= 0 ? 'var(--success)' : 'var(--danger)'}">
                           ${p.eloSum >= 0 ? '+' : ''}${p.eloSum.toFixed(1)}
                        </span>
                    </div>
                </div>`;  // Fixed missing </div> and made color always success because points only go up
            }).join('');
        }

        card.innerHTML = `
            <div class="history-session-header" onclick="toggleHistoryContent(this)">
                <div>
                    <span class="session-info" style="margin-right:10px">제 ${sNum}회차</span>
                    <span style="font-size:0.85rem; color:var(--text-secondary)">${date} (${sessionMatches.length}경기)</span>
                </div>
                <span class="toggle-icon">▼</span>
            </div>
            <div class="history-session-content">
                ${contentHtml}
            </div>
        `;
        list.appendChild(card);
    });
}

window.toggleHistoryContent = (header) => {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.toggle-icon');
    const isActive = content.classList.contains('active');

    // 다른 아코디언 닫기 (선택 사항 - 여기선 유지)
    // document.querySelectorAll('.history-session-content').forEach(el => el.classList.remove('active'));

    if (isActive) {
        content.classList.remove('active');
        icon.innerText = '▼';
    } else {
        content.classList.add('active');
        icon.innerText = '▲';
    }
};

window.deleteHistory = async (id) => { if (isAdmin && confirm('영구 삭제?')) { matchHistory = matchHistory.filter(x => x.id !== id); await window.saveToCloud(); } };
window.openEditModal = (id) => {
    if (!isAdmin) return;
    editingMatchId = id; const h = matchHistory.find(x => x.id === id);
    const fields = document.getElementById('editFields');
    if (fields) fields.innerHTML = `<div class="input-group"><input type="text" id="edit_t1_1" value="${h.t1_names[0]}"><input type="text" id="edit_t1_2" value="${h.t1_names[1]}"></div><div class="input-group"><input type="text" id="edit_t2_1" value="${h.t2_names[0]}"><input type="text" id="edit_t2_2" value="${h.t2_names[1]}"></div><div class="input-group" style="justify-content:center"><input type="number" id="edit_s1" value="${h.score1}" style="max-width:80px">:<input type="number" id="edit_s2" value="${h.score2}" style="max-width:80px"></div>`;

    // 저장 버튼 핸들러 복원 (히스토리 수정용)
    document.getElementById('saveEditBtn').onclick = saveEdit;
    document.getElementById('editModal').classList.remove('hidden');
};
window.closeModal = () => document.getElementById('editModal').classList.add('hidden');

// --- 대진표 선수 이름 수정 로직 (New) ---
window.openCurrentMatchEditModal = (id) => {
    if (!isAdmin) return;
    editingMatchId = id;
    const m = currentSchedule.find(x => x.id === id);
    if (!m) return;

    const fields = document.getElementById('editFields');
    if (fields) {
        fields.innerHTML = `
            <div class="input-group"><input type="text" id="edit_t1_1" value="${m.t1[0].name}"><input type="text" id="edit_t1_2" value="${m.t1[1].name}"></div>
            <div class="input-group"><input type="text" id="edit_t2_1" value="${m.t2[0].name}"><input type="text" id="edit_t2_2" value="${m.t2[1].name}"></div>
            <p style="font-size:0.8rem; color:var(--text-secondary); text-align:center">경기 진행 중인 대진표의 이름을 수정합니다.</p>
        `;
    }

    // 저장 버튼 핸들러 변경 (현재 대진 수정용)
    document.getElementById('saveEditBtn').onclick = saveScheduleEdit;
    document.getElementById('editModal').classList.remove('hidden');
};

async function saveScheduleEdit() {
    if (!isAdmin) return;
    const m = currentSchedule.find(x => x.id === editingMatchId);
    if (m) {
        m.t1[0].name = document.getElementById('edit_t1_1').value;
        m.t1[1].name = document.getElementById('edit_t1_2').value;
        m.t2[0].name = document.getElementById('edit_t2_1').value;
        m.t2[1].name = document.getElementById('edit_t2_2').value;

        closeModal();
        await window.saveToCloud();
    }
}

async function saveEdit() {
    if (!isAdmin) return;
    const h = matchHistory.find(x => x.id === editingMatchId);
    if (h) {
        h.t1_names = [document.getElementById('edit_t1_1').value, document.getElementById('edit_t1_2').value];
        h.t2_names = [document.getElementById('edit_t2_1').value, document.getElementById('edit_t2_2').value];
        h.score1 = parseInt(document.getElementById('edit_s1').value) || 0; h.score2 = parseInt(document.getElementById('edit_s2').value) || 0;
        closeModal(); await window.saveToCloud();
    }
}

function renderRanking() {
    const tbody = document.querySelector('#rankingTable tbody'); if (!tbody) return;
    tbody.innerHTML = '';
    const uSess = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean);
    const sorted = [...members].sort((a, b) => b.rating - a.rating);

    sorted.forEach((p, i) => {
        const att = ((p.participationArr?.length || 0) / (uSess.length || 1) * 100).toFixed(0);
        const tr = document.createElement('tr');
        const rInfo = rankMap.get(String(p.id));

        let rankChangeIcon = '';
        if (rInfo && rInfo.change > 0) rankChangeIcon = `<span class="rank-up">▲${rInfo.change}</span>`;
        else if (rInfo && rInfo.change < 0) rankChangeIcon = `<span class="rank-down">▼${Math.abs(rInfo.change)}</span>`;
        else if (!rInfo || p.participationArr.length === 1) rankChangeIcon = `<span class="rank-new">NEW</span>`;

        const winRate = p.matchCount > 0 ? Math.round((p.wins / p.matchCount) * 100) : 0;

        tr.innerHTML = `
            <td><span class="rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</span>${rankChangeIcon}</td>
            <td><strong>${p.name}</strong></td>
            <td style="color:var(--accent-color); font-weight:bold">${Math.round(p.rating)}</td>
            <td>${p.wins}승 ${p.draws}무 ${p.losses}패</td>
            <td>${winRate}%</td>
            <td style="color:${p.scoreDiff >= 0 ? 'var(--success)' : 'var(--danger)'}">${p.scoreDiff > 0 ? '+' : ''}${p.scoreDiff}</td>
            <td><span class="attendance-badge">${att}%</span></td>
        `;
        tbody.appendChild(tr);
    });
}

window.switchTab = (id) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    // 콘텐츠 활성화
    const target = document.getElementById(`tab-${id}`);
    if (target) target.classList.add('active');

    // 버튼 하이라이트 (data-tab 활용)
    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    if (btn) btn.classList.add('active');

    // 탭 전환 시 차트 리사이징 대응
    if (id === 'stats') {
        renderStatsDashboard();
    }
};

// --- 데이터 분석 대시보드 엔진 (New v4.0) ---
function updateStatistics() {
    const totalPlayers = members.length;
    const totalSessions = [...new Set(matchHistory.map(h => h.sessionNum.toString()))].length;
    const totalMatches = matchHistory.length;

    // 랭킹 1위 찾기
    const sortedMembers = [...members].sort((a, b) => b.rating - a.rating);
    const bestPlayer = sortedMembers.length > 0 ? sortedMembers[0].name : "---";

    const sp = document.getElementById('statTotalPlayers');
    const ss = document.getElementById('statTotalSessions');
    const sm = document.getElementById('statTotalMatches');
    const sb = document.getElementById('statBestPlayer');

    if (sp) sp.innerText = totalPlayers;
    if (ss) ss.innerText = totalSessions;
    if (sm) sm.innerText = totalMatches;
    if (sb) sb.innerText = bestPlayer;
}

function renderStatsDashboard() {
    if (document.getElementById('tab-stats').classList.contains('active')) {
        renderEloChart();
        updatePlayerSelect();
        renderPlayerTrend();
    }
}

function renderEloChart() {
    const ctx = document.getElementById('eloChart')?.getContext('2d');
    if (!ctx) return;

    const data = [...members].sort((a, b) => b.rating - a.rating).slice(0, 15);
    const labels = data.map(m => m.name);
    const ratings = data.map(m => Math.round(m.rating));
    if (ratings.length === 0) return;

    if (eloChart) eloChart.destroy();
    eloChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ELO 점수',
                data: ratings,
                backgroundColor: 'rgba(56, 189, 248, 0.6)',
                borderColor: '#38bdf8',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: false, min: Math.min(...ratings) - 50, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updatePlayerSelect() {
    const select = document.getElementById('playerSelect');
    if (!select) return;

    // 기존 옵션 유지 (첫번째 '선수 선택' 등) 하되, 목록 갱신
    // 여기서는 싹 비우고 다시 채움
    select.innerHTML = '<option value="" disabled selected>선수 선택</option>';

    // 랭킹 보드에 있는 멤버들만 표시 (이름순 정렬)
    [...members].sort((a, b) => a.name.localeCompare(b.name)).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = m.name;
        select.appendChild(opt);
    });
}

window.renderPlayerTrend = () => {
    const ctx = document.getElementById('trendChart')?.getContext('2d');
    const playerId = document.getElementById('playerSelect')?.value;
    if (!ctx) return;

    if (!playerId) {
        if (trendChart) trendChart.destroy();
        return;
    }

    const m = members.find(x => x.id.toString() === playerId.toString());
    if (!m) return;

    // 회차별 점수 추적 & 전체 평균 계산
    let currentRating = ELO_INITIAL;
    const labels = ['초기'];
    const data = [ELO_INITIAL];
    const averageData = [ELO_INITIAL]; // 평균 점수 추이

    const sessionIds = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));

    // 회차별 전체 멤버 점수 시뮬레이션
    let memberRatingsSim = {};
    members.forEach(mem => memberRatingsSim[mem.id] = ELO_INITIAL);

    sessionIds.forEach(sId => {
        const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);

        sessionMatches.forEach(h => {
            // 1. 선택된 선수의 점수 계산
            const isT1 = h.t1_ids.includes(m.id);
            const isT2 = h.t2_ids.includes(m.id);

            if (isT1) currentRating += (h.elo_at_match?.change1 || 0);
            if (isT2) currentRating += (h.elo_at_match?.change2 || 0);

            // 2. 전체 선수 점수 시뮬레이션 (평균 계산용)
            h.t1_ids.forEach(pid => {
                if (memberRatingsSim[pid] !== undefined) memberRatingsSim[pid] += (h.elo_at_match?.change1 || 0);
            });
            h.t2_ids.forEach(pid => {
                if (memberRatingsSim[pid] !== undefined) memberRatingsSim[pid] += (h.elo_at_match?.change2 || 0);
            });
        });

        labels.push(`${sId}회`);
        data.push(Math.round(currentRating));

        // 해당 회차 종료 시점의 전체 평균 계산
        const sum = Object.values(memberRatingsSim).reduce((a, b) => a + b, 0);
        const avg = sum / members.length;
        averageData.push(Math.round(avg));
    });

    // 선수별 비교를 위해 전 선수 중 최소/최대 레이팅을 기준으로 Y축 고정
    const allRatings = members.map(m => m.rating);
    const maxRating = Math.ceil(Math.max(...allRatings, ELO_INITIAL) / 50) * 50 + 50;

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '내 점수',
                    data: data,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    tension: 0.3,
                    fill: true,
                    zIndex: 2
                },
                {
                    label: '평균(1500)',
                    data: Array(labels.length).fill(1500),
                    borderColor: '#fbbf24', // Amber-400
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                    zIndex: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 1200,
                    // 1800점을 기본 Max로 하되, 실제 데이터가 넘으면 자동으로 늘어남
                    max: Math.max(maxRating, 1800),
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
};

function getSplits(n) {
    const table = {
        4: [4], 5: [5], 6: [6], 7: [7], 8: [8],
        9: [5, 4], 10: [5, 5], 11: [6, 5],
        12: [4, 4, 4], 13: [5, 4, 4], 14: [5, 5, 4], 15: [5, 5, 5],
        16: [5, 6, 5], 17: [6, 6, 5], 18: [6, 6, 6],
        19: [5, 5, 5, 4], 20: [4, 4, 4, 4, 4], 21: [4, 4, 5, 4, 4],
        22: [4, 4, 6, 4, 4], 23: [4, 4, 7, 4, 4], 24: [4, 4, 4, 4, 4, 4]
    };

    if (table[n]) return table[n];
    if (n < 4) return [];

    // 24명 초과 시 자동 최적화 로직 적용 (Fallback)
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

function exportHistoryToCsv() {
    if (!isAdmin) { alert('관리자 기능입니다.'); return; }
    if (matchHistory.length === 0) { alert('내보낼 기록이 없습니다.'); return; }

    let csv = "\uFEFF회차,날짜,팀1,팀2,점수1,점수2,ELO변동\n";
    matchHistory.slice().sort((a, b) => b.sessionNum - a.sessionNum).forEach(h => {
        csv += `${h.sessionNum},${h.date},"${h.t1_names.join(',')}","${h.t2_names.join(',')}",${h.score1},${h.score2},${h.elo_at_match?.change.toFixed(1) || 0}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ACE_Ranking_History_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
