// ACE 랭킹 시스템 - 실시간 클라우드 엔진 v3.0 (JavaScript)

// --- Firebase 초기화 및 상태 관리 ---
let db;
let isAdmin = false;
let systemSettings = { admin_pw: "ace_admin" }; // 기본값 (로딩 전 대비)

// --- 핵심 도메인 데이터 ---
let members = [];
let matchHistory = [];
let applicants = [];
let currentSchedule = [];
let activeGroupTab = 'A';
let editingMatchId = null;
let sessionNum = 1;
let eloChart = null;
let trendChart = null;

// --- 설정 및 상수 ---
const ELO_INITIAL = 1500;
const K_FACTOR = 32;
const GAME_COUNTS = { 4: 3, 5: 5, 6: 6, 7: 7, 8: 8 };
const MATCH_PATTERNS = {
    8: [[[0, 4], [1, 5]], [[2, 6], [3, 7]], [[0, 5], [3, 6]], [[1, 4], [7, 2]], [[2, 4], [0, 6]], [[3, 5], [1, 7]], [[0, 7], [3, 4]], [[2, 5], [1, 6]]],
    7: [[[0, 3], [2, 6]], [[1, 4], [2, 5]], [[0, 4], [1, 3]], [[4, 5], [3, 6]], [[1, 6], [2, 3]], [[0, 5], [2, 4]], [[0, 6], [1, 5]]],
    6: [[[0, 2], [1, 4]], [[1, 3], [4, 5]], [[0, 5], [2, 4]], [[0, 3], [1, 2]], [[0, 4], [3, 5]], [[1, 5], [2, 3]]],
    5: [[[0, 2], [1, 4]], [[0, 4], [1, 3]], [[1, 2], [3, 4]], [[0, 3], [2, 4]], [[0, 1], [2, 3]]],
    4: [[[0, 1], [2, 3]], [[0, 3], [1, 2]], [[0, 2], [1, 3]]]
};

// --- 앱 초기화 로직 ---
window.addEventListener('DOMContentLoaded', async () => {
    initFirebase();
    initUIEvents();
    checkAdminLogin(); // 세션 유지 확인
    // 초기 탭이 stats(대시보드)인 경우 차트 렌더링 보장
    if (document.getElementById('tab-stats').classList.contains('active')) {
        renderStatsDashboard();
    }
});

function initFirebase() {
    // index.html에서 로드된 FB_SDK 사용
    const { initializeApp, getFirestore, onSnapshot, collection, doc, setDoc } = window.FB_SDK;

    // Firebase 설정값 (운영자님 프로젝트 설정으로 교체 필요)
    const firebaseConfig = {
        apiKey: "AIzaSyD0Kj87j4x58RHgTcnKT_T-VzxJ6refV0w",
        authDomain: "ace-ranking-system.firebaseapp.com",
        projectId: "ace-ranking-system",
        storageBucket: "ace-ranking-system.firebasestorage.app",
        messagingSenderId: "179912247763",
        appId: "1:179912247763:web:37f2d14933a198ffba0726",
        measurementId: "G-XZVQLB23RV"
    };

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    const docRef = doc(db, "system", "database");

    // [실시간 리스너] 클라우드 데이터 상시 감시
    onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            members = data.members || [];
            matchHistory = data.matchHistory || [];
            currentSchedule = data.currentSchedule || [];
            sessionNum = data.sessionNum || 1;
            applicants = data.applicants || [];

            // 데이터 변경 시 UI 전면 쇄신
            recalculateAll();
            updateUI();
        } else {
            // 데이터가 없는 경우 초기 마이그레이션 시도 (localStorage -> Cloud)
            tryMigrateLocalToCloud();
        }
    });

    // [시스템 설정 리스너] 비밀번호 등 관리
    const settingsRef = doc(db, "system", "settings");
    onSnapshot(settingsRef, (snapshot) => {
        if (snapshot.exists()) {
            systemSettings = snapshot.data();
            console.log("System Settings Loaded:", systemSettings);
        } else {
            // 초기 설정이 없으면 생성
            setDoc(settingsRef, { admin_pw: "ace_admin" });
        }
    });

    // 전역 문서 참조 업데이트 (저장 시 사용)
    window.saveToCloud = async () => {
        try {
            await setDoc(docRef, {
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

    console.log("Firebase Engine v3.0 Connected.");
}

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
    document.getElementById('adminLoginBtn').onclick = openAdminModal;
    document.getElementById('helpBtn').onclick = openHelpModal;
    document.getElementById('confirmAdminBtn').onclick = tryAdminLogin;
    document.getElementById('addPlayerBtn').onclick = addPlayer;
    document.getElementById('generateScheduleBtn').onclick = generateSchedule;
    document.getElementById('updateEloBtn').onclick = commitSession;
    document.getElementById('saveEditBtn').onclick = saveEdit;
    const splitInput = document.getElementById('customSplitInput');
    if (splitInput) splitInput.oninput = validateCustomSplit;
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

function checkAdminLogin() {
    if (localStorage.getItem('ace_admin') === 'true') {
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
    } else {
        status.innerText = "관리자 로그인";
        status.classList.add('secondary');
        status.classList.remove('success');
        adminAreas.forEach(el => el.style.display = 'none');
        guestAreas.forEach(el => el.style.display = 'block');
    }
    renderApplicants(); // 관리자 상태 변경 시 명단(X버튼 등) 즉시 갱신
    renderHistory();    // 관리자 상태 변경 시 히스토리 버튼 즉시 갱신
}

// --- 데이터 동기화 로직 통합 (v3.1) ---
// (기존 중복 saveToCloud 함수 제거됨)

// --- 개선된 신청 로직 (비회원도 가능, 멤버 등록은 경기 후) ---
async function addPlayer() {
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
        // 멤버 룩업 맵 생성 (성능 및 정확도 향상)
        const memberMap = new Map();
        members.forEach(m => {
            m.rating = ELO_INITIAL; m.matchCount = 0; m.wins = 0; m.losses = 0; m.draws = 0; m.scoreDiff = 0;
            m.participationArr = [];
            memberMap.set(String(m.id), m); // ID를 문자열로 통일하여 매칭
        });

        const sessionIds = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));
        sessionIds.forEach(sId => {
            const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);
            const ratingSnapshot = {};
            members.forEach(m => { ratingSnapshot[m.id] = m.rating; });

            sessionMatches.forEach(h => {
                const team1 = h.t1_ids.map(id => memberMap.get(String(id))).filter(Boolean);
                const team2 = h.t2_ids.map(id => memberMap.get(String(id))).filter(Boolean);
                if (team1.length < 2 || team2.length < 2) {
                    console.warn(`Match ${h.id} skipped: Missing players in members list.`);
                    return;
                }
                const avg1 = ((ratingSnapshot[team1[0].id] || ELO_INITIAL) + (ratingSnapshot[team1[1].id] || ELO_INITIAL)) / 2;
                const avg2 = ((ratingSnapshot[team2[0].id] || ELO_INITIAL) + (ratingSnapshot[team2[1].id] || ELO_INITIAL)) / 2;
                const expected = 1 / (1 + Math.pow(10, (avg2 - avg1) / 400));
                let actual = h.score1 > h.score2 ? 1 : (h.score1 < h.score2 ? 0 : 0.5);
                const diff = Math.abs(h.score1 - h.score2), multiplier = diff > 0 ? Math.log(diff + 1) : 1;
                const change = K_FACTOR * multiplier * (actual - expected);

                h.elo_at_match = { t1_before: avg1, t2_before: avg2, expected, change };

                [...team1, ...team2].forEach(p => {
                    p.matchCount++;
                    if (!p.participationArr.includes(sId)) p.participationArr.push(sId);
                });
                team1.forEach(p => { p.rating += change; p.scoreDiff += (h.score1 - h.score2); if (actual === 1) p.wins++; else if (actual === 0) p.losses++; else p.draws++; });
                team2.forEach(p => { p.rating -= change; p.scoreDiff += (h.score2 - h.score1); if (actual === 0) p.wins++; else if (actual === 1) p.losses++; else p.draws++; });
            });
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
}

function renderApplicants() {
    const list = document.getElementById('playerList'); if (!list) return;
    list.innerHTML = '';
    applicants.forEach(a => {
        const div = document.createElement('div'); div.className = 'player-tag';
        div.innerHTML = `${a.name}${isAdmin ? ` <span class="remove-btn" onclick="removeApplicant(${a.id})">×</span>` : ''}`;
        list.appendChild(div);
    });
}
window.removeApplicant = async (id) => {
    if (!isAdmin) return;
    applicants = applicants.filter(a => a.id !== id);
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
    const sessionNum = document.getElementById('manualSessionNum').value;
    if (!sessionNum) { alert('회차를 입력하세요.'); return; }

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

    const sorted = [...applicants].sort((a, b) => b.rating - a.rating);
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
                id: Math.random().toString(36).substr(2, 9), sessionNum, group: gLabel, groupRound: roundNum,
                t1: [g[m[0][0]], g[m[0][1]]], t2: [g[m[1][0]], g[m[1][1]]], s1: 0, s2: 0
            });
        });
    });

    activeGroupTab = 'A';
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
            const div = document.createElement('div'); div.className = 'match-card';
            div.innerHTML = `
                <div style="flex:1"><strong>${m.t1[0].name}, ${m.t1[1].name}</strong></div>
                <div class="vs">
                    <input type="number" class="score-input" value="${m.s1}" min="0" max="6" onchange="updateLiveScore('${m.id}',1,this.value)"> 
                    : 
                    <input type="number" class="score-input" value="${m.s2}" min="0" max="6" onchange="updateLiveScore('${m.id}',2,this.value)">
                </div>
                <div style="flex:1; text-align:right"><strong>${m.t2[0].name}, ${m.t2[1].name}</strong></div>
            `;
            container.appendChild(div);
        });
    });

    // 모든 경기 점수가 입력되었는지 확인 및 종료 버튼 표시
    const finishedCount = currentSchedule.filter(m => (parseInt(m.s1) + parseInt(m.s2)) > 0).length;

    if (finishedCount === currentSchedule.length && currentSchedule.length > 0) {
        const btnDiv = document.createElement('div');
        btnDiv.style.textAlign = 'center'; btnDiv.style.marginTop = '30px';
        btnDiv.innerHTML = `<button id="updateEloBtn" class="primary" onclick="commitSession()">🏆 랭킹전 종료 및 결과 확정</button>`;
        container.appendChild(btnDiv);
    } else if (currentSchedule.length > 0) {
        const infoDiv = document.createElement('div');
        infoDiv.style.textAlign = 'center'; infoDiv.style.marginTop = '30px'; infoDiv.style.color = 'var(--text-secondary)';
        infoDiv.innerHTML = `<p>⚠️ 모든 경기의 점수를 입력하면 [종료] 버튼이 나타납니다. (${finishedCount}/${currentSchedule.length} 완료)</p>`;
        container.appendChild(infoDiv);
    }
}

window.updateLiveScore = async (id, team, val) => {
    let score = parseInt(val) || 0;
    if (score < 0) score = 0; if (score > 6) score = 6;
    const m = currentSchedule.find(x => x.id === id);
    if (m) {
        if (team === 1) m.s1 = score; else m.s2 = score;
        await window.saveToCloud();
    }
};

async function commitSession() {
    if (!isAdmin || !confirm('결과를 기록하고 랭킹을 누적하시겠습니까?')) return;
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
        switchTab('rank');
        alert(`랭킹전이 확정되었습니다!\n(신규 멤버 ${newMemberCount}명 등록됨)`);
    } catch (e) {
        console.error("Commit Session Error:", e);
        alert("오류가 발생했습니다. 콘솔을 확인해주세요.");
    }
}

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

        card.innerHTML = `
            <div class="history-session-header" onclick="toggleHistoryContent(this)">
                <div>
                    <span class="session-info" style="margin-right:10px">제 ${sNum}회차</span>
                    <span style="font-size:0.85rem; color:var(--text-secondary)">${date} (${sessionMatches.length}경기)</span>
                </div>
                <span class="toggle-icon">▼</span>
            </div>
            <div class="history-session-content">
                ${sessionMatches.map(h => `
                    <div class="history-match-item">
                        <div style="flex:2">
                            <strong>${h.t1_names.join(',')}</strong> vs <strong>${h.t2_names.join(',')}</strong>
                            <div style="font-size:0.75rem; color:var(--text-secondary)">기대승률: ${((h.elo_at_match?.expected || 0.5) * 100).toFixed(1)}%</div>
                        </div>
                        <div style="flex:1; text-align:center; color:var(--accent-color); font-weight:bold; font-size:1.1rem">
                            ${h.score1} : ${h.score2}
                        </div>
                        <div style="flex:1; text-align:right">
                            <span class="history-elo-tag" style="color:${(h.elo_at_match?.change || 0) >= 0 ? 'var(--success)' : 'var(--danger)'}">
                                ${(h.elo_at_match?.change || 0) >= 0 ? '+' : ''}${(h.elo_at_match?.change || 0).toFixed(1)}P
                            </span>
                            ${isAdmin ? `
                                <div style="margin-top:5px">
                                    <button class="edit-btn" onclick="openEditModal(${h.id})">수정</button>
                                    <button class="delete-btn" onclick="deleteHistory(${h.id})">삭제</button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
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
    document.getElementById('editModal').classList.remove('hidden');
};
window.closeModal = () => document.getElementById('editModal').classList.add('hidden');
async function saveEdit() {
    if (!isAdmin) return;
    const h = matchHistory.find(x => x.id === editingMatchId);
    h.t1_names = [document.getElementById('edit_t1_1').value, document.getElementById('edit_t1_2').value];
    h.t2_names = [document.getElementById('edit_t2_1').value, document.getElementById('edit_t2_2').value];
    h.score1 = parseInt(document.getElementById('edit_s1').value) || 0; h.score2 = parseInt(document.getElementById('edit_s2').value) || 0;
    closeModal(); await window.saveToCloud();
}

function renderRanking() {
    const tbody = document.querySelector('#rankingTable tbody'); if (!tbody) return;
    tbody.innerHTML = '';
    const uSess = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean);
    [...members].sort((a, b) => b.rating - a.rating).forEach((p, i) => {
        const att = ((p.participationArr?.length || 0) / (uSess.length || 1) * 100).toFixed(0);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><span class="rank-badge ${i < 3 ? ['gold', 'silver', 'bronze'][i] : ''}">${i + 1}</span></td><td><strong>${p.name}</strong></td><td style="color:var(--accent-color); font-weight:bold">${Math.round(p.rating)}</td><td>${p.wins}승 ${p.draws}무 ${p.losses}패</td><td style="color:${p.scoreDiff >= 0 ? 'var(--success)' : 'var(--danger)'}">${p.scoreDiff > 0 ? '+' : ''}${p.scoreDiff}</td><td><span class="attendance-badge">${att}%</span></td>`;
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
    select.innerHTML = '<option value="" disabled selected>선수 선택 (랭킹 추이)</option>';

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

    // 회차별 점수 추적
    let currentRating = ELO_INITIAL;
    const labels = ['초기'];
    const data = [ELO_INITIAL];

    const sessionIds = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));

    sessionIds.forEach(sId => {
        const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);
        sessionMatches.forEach(h => {
            const team1 = h.t1_ids;
            const team2 = h.t2_ids;
            const isT1 = team1.includes(m.id);
            const isT2 = team2.includes(m.id);

            if (isT1 || isT2) {
                const change = h.elo_at_match?.change || 0;
                if (isT1) currentRating += change;
                else currentRating -= change;
            }
        });
        labels.push(`${sId}회`);
        data.push(Math.round(currentRating));
    });

    // 선수별 비교를 위해 전 선수 중 최소/최대 레이팅을 기준으로 Y축 고정
    const allRatings = members.map(m => m.rating);
    const minRating = Math.floor(Math.min(...allRatings, ELO_INITIAL) / 50) * 50 - 50;
    const maxRating = Math.ceil(Math.max(...allRatings, ELO_INITIAL) / 50) * 50 + 50;

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'ELO 변화',
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
                    borderColor: '#facc15', // 더 눈에 띄는 노란색
                    borderWidth: 2,          // 두께 강화
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
                    min: minRating,
                    max: maxRating,
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
};

function getSplits(n) {
    let best = null, bestG = -1, memo = {};
    function f(rem) {
        if (rem === 0) return [[]]; if (rem < 4) return null; if (memo[rem]) return memo[rem];
        let r = []; for (let s = 4; s <= 8; s++) { let sub = f(rem - s); if (sub) sub.forEach(x => r.push([...x, s].sort((a, b) => a - b))); }
        let u = []; let sSet = new Set(); r.forEach(x => { let k = x.join(','); if (!sSet.has(k)) { u.push(x); sSet.add(k); } });
        return memo[rem] = u;
    }
    const res = f(n);
    res.forEach(s => { let gs = s.reduce((a, b) => a + (GAME_COUNTS[b] || 0), 0); if (gs <= 18 && gs > bestG) { bestG = gs; best = s; } });
    return best || (res && res[0]) || [];
}
