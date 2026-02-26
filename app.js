// ACE 랭킹 시스템 - 실시간 클라우드 엔진 v3.0 (JavaScript)

// --- 글로벌 에러 핸들링 (디버깅용) ---
window.onerror = function (msg, url, line, col, error) {
    console.error(`Error: ${msg}\nLine: ${line}\nSource: ${url}`);
    if (msg.includes("Firebase")) {
        alert("Firebase 오류가 발생했습니다. 네트워크 또는 권한 설정을 확인하세요.");
    }
    return false;
};

// --- 상태 관리 ---
let isAdmin = false;
let systemSettings = { admin_pw: "ace_admin" };
let currentDbName = ''; // firebase-api.js에서 콜백으로 갱신됨

// --- 핵심 도메인 데이터 ---
let members = [];
let matchHistory = [];
let applicants = [];
let currentSchedule = [];
let activeGroupTab = 'A';
let editingMatchId = null;
let sessionNum = 1;
let currentSessionState = { status: 'idle', sessionNum: 0, matchMode: 'court' };
let eloChart = null;
let trendChart = null;
let rankMap = new Map(); // 현재 랭킹 순위 저장용
let tempSchedule = null; // 대진표 생성 미리보기용 임시 저장
let sessionRankSnapshots = {}; // 회차별(세션별) 시작 시점의 랭킹 스냅샷
let historyViewMode = 'match'; // 'match' or 'player'
let sessionStartRatings = {}; // 회차별 시작 시점의 레이팅 스냅샷
let previewGroups = null; // v7.0: 조 편성 미리보기 상태 (null이면 자동)

import { ELO_INITIAL, K_FACTOR, GAME_COUNTS, MATCH_PATTERNS, getSplits, recalculateAll as engineRecalculateAll, generateSchedule as engineGenerateSchedule } from './engine.js';
import {
    updateAdminUI as uiUpdateAdminUI,
    renderSessionStatus as uiRenderSessionStatus,
    updateApplyButtonState as uiUpdateApplyButtonState,
    renderApplicants as uiRenderApplicants,
    validateCustomSplit as uiValidateCustomSplit,
    updateOptimizationInfo as uiUpdateOptimizationInfo,
    updateSplitInputFromPreview as uiUpdateSplitInputFromPreview,
    renderSchedulePreview as uiRenderSchedulePreview,
    renderCurrentMatches as uiRenderCurrentMatches,
    renderHistory as uiRenderHistory,
    toggleHistoryContent as uiToggleHistoryContent,
    renderRanking as uiRenderRanking,
    switchTab as uiSwitchTab,
    updateStatistics as uiUpdateStatistics,
    renderStatsDashboard as uiRenderStatsDashboard,
    renderEloChart as uiRenderEloChart,
    updatePlayerSelect as uiUpdatePlayerSelect,
    renderPlayerTrend as uiRenderPlayerTrend
} from './ui.js';
import {
    initFirebase as fbInitFirebase,
    saveToCloud as fbSaveToCloud,
    saveSessionState as fbSaveSessionState,
    fetchDbList as fbFetchDbList,
    switchDatabase as fbSwitchDatabase,
    handleMigration as fbHandleMigration,
    getCurrentDbName as fbGetCurrentDbName,
    getCurrentClubId as fbGetCurrentClubId,
    getSystemSettings as fbGetSystemSettings,
    getDb as fbGetDb,
    initNewClusterSession as fbInitNewClusterSession
} from './firebase-api.js';
// --- 설정 및 상수 ---
// engine.js 로 분리됨

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
    fbInitFirebase({
        onDataLoaded: (data) => {
            members = data.members || [];
            matchHistory = data.matchHistory || [];
            currentSchedule = data.currentSchedule || [];
            sessionNum = data.sessionNum || 1;
            applicants = data.applicants || [];
            recalculateAll();
            updateUI();
        },
        onEmptyDefault: async () => {
            await fbHandleMigration();
        },
        onEmptyCluster: async () => {
            members = []; matchHistory = []; currentSchedule = []; applicants = [];
            await window.saveToCloud();
        },
        onSessionUpdate: (state) => {
            currentSessionState = state;
            updateUI();
        },
        onNewClusterSession: async (sessionStatusDocPath) => {
            const nextSeq = (matchHistory.length > 0 ? Math.max(...matchHistory.map(h => parseInt(h.sessionNum) || 0)) : 0) + 1;
            currentSessionState = { status: 'idle', sessionNum: nextSeq, matchMode: 'court' };
            await fbInitNewClusterSession(sessionStatusDocPath, currentSessionState);
        },
        onSettingsUpdate: (settings) => {
            systemSettings = settings;
        },
        onDbNameChange: (dbName) => {
            currentDbName = dbName;
            updateDbDisplay();
        },
        afterMigration: () => {
            recalculateAll();
            updateUI();
        },
        closeDbModal: () => closeDbModal()
    });
}

window.saveToCloud = async () => {
    await fbSaveToCloud({ members, matchHistory, currentSchedule, sessionNum, applicants });
};

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
    bindClick('generateScheduleBtn', () => generateSchedule());
    bindClick('cancelScheduleBtn', cancelSchedule);
    bindClick('updateEloBtn', commitSession);
    bindClick('saveEditBtn', saveEdit);
    bindClick('openRoundBtn', openRegistration);
    bindClick('switchDbBtn', switchDatabase);
    bindClick('dbSettingsBtn', openDbModal);
    bindClick('regenerateBtn', () => generateSchedule());
    bindClick('finalizeScheduleBtn', finalizeSchedule);
    bindClick('loadDbBtn', async () => {
        const sel = document.getElementById('dbListSelect');
        if (sel && sel.value) {
            if (confirm(`전체 사용자에게 '${sel.value}' 데이터베이스를 활성 DB로 설정하시겠습니까?`)) {
                try {
                    const { doc, updateDoc } = window.FB_SDK;
                    const clubId = fbGetCurrentClubId();
                    const fbDb = fbGetDb();
                    const settingsPath = clubId === 'Default' ? "system/settings" : `clubs/${clubId}/config/settings`;
                    await updateDoc(doc(fbDb, settingsPath), { active_cluster: sel.value });
                    alert(`'${sel.value}' DB가 전역 활성 DB로 설정되었습니다.`);
                    closeDbModal();
                } catch (e) { alert('설정 변경 실패: ' + e.message); }
            }
        } else {
            alert('전환할 데이터베이스를 선택해주세요.');
        }
    });
    bindClick('exportCsvBtn', exportHistoryToCsv);
    bindClick('savePreviewBtn', async () => {
        await window.saveToCloud();
        alert('조편성 구성이 저장되었습니다. 모든 사용자에게 실시간 반영됩니다.');
        renderApplicants();
    });

    const splitInput = document.getElementById('customSplitInput');
    if (splitInput) splitInput.oninput = validateCustomSplit;

    const matchModeRadios = document.querySelectorAll('input[name="matchMode"]');
    matchModeRadios.forEach(radio => {
        radio.onchange = async () => {
            if (!isAdmin) return;
            const newMode = radio.value;
            console.log(`[Admin] Switching match mode to: ${newMode}`);
            await window.saveSessionState(currentSessionState.status, currentSessionState.sessionNum, currentSessionState.info, newMode);
            // 전체 UI 즉시 갱신 (명단 렌더링 방식 변경 반영)
            renderApplicants();
        };
    });

    const sessionInfoSelect = document.getElementById('sessionInfoSelect');
    if (sessionInfoSelect) {
        sessionInfoSelect.onchange = async () => {
            const manualInput = document.getElementById('manualSessionInfo');
            if (manualInput) {
                manualInput.style.display = sessionInfoSelect.value === 'manual' ? 'block' : 'none';
            }
            // 접수 중일 때 장소 변경 시 즉시 반영
            if (isAdmin && currentSessionState.status === 'recruiting') {
                const newInfo = sessionInfoSelect.value === 'manual' ? (manualInput ? manualInput.value : '') : sessionInfoSelect.value;
                await window.saveSessionState(currentSessionState.status, currentSessionState.sessionNum, newInfo, currentSessionState.matchMode);
            }
        };
    }

    const manualSessionInfoInput = document.getElementById('manualSessionInfo');
    if (manualSessionInfoInput) {
        manualSessionInfoInput.oninput = async () => {
            if (isAdmin && currentSessionState.status === 'recruiting' && sessionInfoSelect?.value === 'manual') {
                // 디바운스 필요할 수 있지만 일단 즉시 반영
                await window.saveSessionState(currentSessionState.status, currentSessionState.sessionNum, manualSessionInfoInput.value, currentSessionState.matchMode);
            }
        };
    }

    const restoreCsvBtn = document.getElementById('restoreCsvBtn');
    if (restoreCsvBtn) {
        restoreCsvBtn.onclick = handleRestoreCsv;
    }
}

function updateDbDisplay() {
    const el = document.getElementById('currentDbName');
    if (el) {
        const clubId = fbGetCurrentClubId();
        const clubText = clubId !== 'Default' ? `[${clubId}] ` : '';
        el.innerText = `${clubText}DB: ${currentDbName}`;
    }
}

async function fetchDbList() {
    if (!isAdmin) return;
    await fbFetchDbList();
}

async function switchDatabase() {
    await fbSwitchDatabase();
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
        let info = document.getElementById('sessionInfoSelect').value;
        if (info === 'manual') info = document.getElementById('manualSessionInfo').value.trim();

        const matchMode = currentSessionState.matchMode || 'court';

        await window.saveSessionState('recruiting', num, info, matchMode);
        // 기존 참가자 명단 초기화 여부는 선택사항이나, 새 회차 시작 시 보통 초기화함
        applicants = [];
        await window.saveToCloud();
    }

    // 미리보기 영역 숨김 (초기화)
    const area = document.getElementById('schedulePreviewArea');
    if (area) area.style.display = 'none';
    tempSchedule = null;
}

window.saveSessionState = async (status, sessionNum, info = '', matchMode = 'court') => {
    await fbSaveSessionState(status, sessionNum, info, matchMode);
};

function renderSessionStatus() {
    uiRenderSessionStatus({ currentSessionState, isAdmin, matchHistory });
}

// --- 수동 조 편성 엔진 (v3.2: 복구 및 정밀화) ---
function validateCustomSplit() {
    uiValidateCustomSplit({ applicants, previewGroups, GAME_COUNTS, actions: { selfRender: renderApplicants, setPreviewGroups: (val) => previewGroups = val } });
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
    uiUpdateAdminUI({ isAdmin });
    if (isAdmin) fetchDbList(); // DB 관리 리스트 갱신
    renderApplicants(); // 관리자 상태 변경 시 명단 즉시 갱신
    renderHistory();    // 히스토리 화면 즉시 갱신
    renderSessionStatus(); // 세션 UI 즉시 갱신
    renderCurrentMatches(); // 대진표 화면 갱신
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
        previewGroups = null; // v10.1: 인원 변동 시 미리보기 리셋하여 정합성 유지
    }

    nameInput.value = '';
    await window.saveToCloud();
    renderApplicants(); // 로컬 즉시 반영
}

function updateApplyButtonState() {
    uiUpdateApplyButtonState({ currentSessionState });
}

// --- 기존 핵심 엔진 로직 (클라우드 환경 대응) ---

function recalculateAll() {
    engineRecalculateAll({ members, matchHistory, rankMap, sessionRankSnapshots, sessionStartRatings });
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
    uiRenderApplicants({
        currentSessionState, applicants, rankMap, isAdmin, getSplits, GAME_COUNTS, previewGroups,
        actions: { setPreviewGroups: (val) => previewGroups = val, updateSplitInputFromPreview, renderApplicants: () => renderApplicants(), updateOptimizationInfo: () => updateOptimizationInfo() }
    });
}
window.removeApplicant = async (id) => {
    if (!isAdmin) return;
    console.log(`[Admin] Removing applicant ID: ${id}`);
    applicants = applicants.filter(a => String(a.id) !== String(id));
    previewGroups = null; // 인원 변경 시 미리보기 초기화
    await window.saveToCloud();
    // 로컬 즉시 반영 (선택 사항이나 체감 속도 향상 위해)
    renderApplicants();
};

function updateOptimizationInfo() {
    uiUpdateOptimizationInfo({ currentSessionState, applicants, previewGroups, GAME_COUNTS, getSplits });
}

function updateSplitInputFromPreview() {
    uiUpdateSplitInputFromPreview({ previewGroups, applicants, GAME_COUNTS });
}

// --- 대진표 생성 (Admin Only: 수동 조 편성 로직 최우선 반영) ---
async function generateSchedule() {
    if (!isAdmin) return;
    const context = {
        isAdmin, currentSessionState,
        sessionNumInput: document.getElementById('manualSessionNum')?.value,
        customSplitInput: document.getElementById('customSplitInput')?.value?.trim(),
        applicants, previewGroups, rankMap, members
    };
    const result = engineGenerateSchedule(context);
    if (!result) return;

    tempSchedule = result.tempSchedule;
    activeGroupTab = result.activeGroupTab;
    if (result.previewGroups === null) previewGroups = null;

    renderSchedulePreview(result.gameCounts);
}

/**
 * [Mode 2] 코트별 랜덤 최적 배정 알고리즘 (사용자 제공 코드 기반)
 * 6라운드, 최대 3코트 (인원에 따라 조정), 인당 최대 4경기 기준
 */


function renderSchedulePreview(gameCounts) {
    uiRenderSchedulePreview({ gameCounts, applicants });
}

async function finalizeSchedule() {
    if (!tempSchedule) return;
    if (!confirm('현재 대진표로 확정하시겠습니까?')) return;

    currentSchedule = tempSchedule;
    tempSchedule = null;

    const sessionNum = currentSchedule[0].sessionNum;
    const mode = currentSessionState.matchMode || 'group';

    // 활성 탭 초기화
    if (mode === 'court') {
        activeGroupTab = '1R';
    } else {
        activeGroupTab = 'A';
    }

    await window.saveSessionState('playing', sessionNum, currentSessionState.info, mode);
    await window.saveToCloud();

    // 미리보기 영역 숨김
    const area = document.getElementById('schedulePreviewArea');
    if (area) area.style.display = 'none';

    switchTab('match');
    alert('대진표가 확정되었습니다!');
}



async function cancelSchedule() {
    if (!isAdmin) return;
    if (!confirm('현재 대진표를 삭제하고 참가 접수 단계로 돌아가시겠습니까?\n(입력된 경기 결과가 모두 사라집니다.)')) return;

    currentSchedule = [];
    previewGroups = null;

    // v7.4: 참가 신청 명단 내 임시 데이터(vRank 등) 초기화
    applicants.forEach(a => { delete a.vRank; });

    // 상태를 다시 'recruiting'으로 변경 (기존 장소 및 방식 유지)
    await window.saveSessionState('recruiting', currentSessionState.sessionNum, currentSessionState.info, currentSessionState.matchMode);
    await window.saveToCloud();

    alert('대진표가 초기화되었습니다. 참가신청 탭에서 명단을 수정할 수 있습니다.');

    // 미리보기 영역 숨김
    const area = document.getElementById('schedulePreviewArea');
    if (area) area.style.display = 'none';
    tempSchedule = null;

    renderApplicants(); // UI 즉시 갱신
    switchTab('apply');
}

function renderCurrentMatches() {
    uiRenderCurrentMatches({
        currentSchedule, currentSessionState, isAdmin, activeGroupTab, rankMap, ELO_INITIAL,
        actions: { setActiveGroupTab: (val) => activeGroupTab = val, renderCurrentMatches: () => renderCurrentMatches(), openCurrentMatchEditModal }
    });
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
                const existingMember = members.find(existing => String(existing.id) === String(p.id));
                if (!existingMember) {
                    members.push(p);
                    newMemberCount++;
                }
                // v7.2: Renaming logic removed to prevent accidental overwrites
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

        currentSchedule = [];
        applicants = []; // 랭킹전 최종 종료 시에만 명단 초기화
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
    uiRenderHistory({ matchHistory, historyViewMode, sessionRankSnapshots, isAdmin, actions: { openEditModal: window.openEditModal, deleteHistory: window.deleteHistory } });
}

window.toggleHistoryContent = (header) => {
    uiToggleHistoryContent(header);
};

window.deleteHistory = async (id) => {
    if (!isAdmin) return;
    if (!confirm('정말로 이 경기 기록을 삭제하시겠습니까?\n모든 랭킹 점수가 처음부터 재계산됩니다.')) return;
    matchHistory = matchHistory.filter(h => h.id !== id);
    recalculateAll();
    updateUI();
    await window.saveToCloud();
};
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
        const newNames = [
            document.getElementById('edit_t1_1').value.trim(),
            document.getElementById('edit_t1_2').value.trim(),
            document.getElementById('edit_t2_1').value.trim(),
            document.getElementById('edit_t2_2').value.trim()
        ];

        const teams = [m.t1, m.t2];
        let nameIdx = 0;

        teams.forEach(team => {
            team.forEach((p, pIdx) => {
                const newName = newNames[nameIdx++];
                if (p.name !== newName) {
                    // v7.2: 이름이 변경된 경우 '선수 교체'로 처리
                    // 1. 기존 멤버 중 해당 이름을 가진 사람이 있는지 확인
                    const existing = members.find(mem => mem.name === newName);
                    if (existing) {
                        // 기존 멤버가 있다면 해당 멤버의 정보를 매치에 할당
                        team[pIdx] = { ...existing };
                    } else {
                        // 2. 없다면 신규 게스트(또는 오타 수정)로 간주하여 새 ID 부여
                        // 기존 ID를 유지하면 기존 멤버 정보가 오염되므로 새 ID 생성
                        team[pIdx] = {
                            id: "guest_" + Math.random().toString(36).substr(2, 9),
                            name: newName,
                            rating: ELO_INITIAL,
                            vRank: members.length + 1 // 임시 랭킹은 마지막 순위 다음으로
                        };
                    }
                }
            });
        });

        closeModal();
        await window.saveToCloud();
    }
}

async function saveEdit() {
    if (!isAdmin) return;
    const h = matchHistory.find(x => x.id === editingMatchId);
    if (h) {
        const newT1Names = [
            document.getElementById('edit_t1_1').value.trim(),
            document.getElementById('edit_t1_2').value.trim()
        ];
        const newT2Names = [
            document.getElementById('edit_t2_1').value.trim(),
            document.getElementById('edit_t2_2').value.trim()
        ];

        // v7.3: 이름에 맞는 ID 동기화 로직 추가
        const syncIds = (names) => {
            return names.map(name => {
                const existing = members.find(m => m.name === name);
                if (existing) return existing.id;
                // 이름은 있지만 ID가 없는 경우(신규) 임시 ID 부여
                return "guest_" + Math.random().toString(36).substr(2, 9);
            });
        };

        h.t1_names = newT1Names;
        h.t2_names = newT2Names;
        h.t1_ids = syncIds(newT1Names);
        h.t2_ids = syncIds(newT2Names);
        h.score1 = parseInt(document.getElementById('edit_s1').value) || 0;
        h.score2 = parseInt(document.getElementById('edit_s2').value) || 0;

        closeModal();
        recalculateAll(); // 수정 즉시 데이터 재계산
        updateUI();       // UI 갱신
        await window.saveToCloud();
    }
}

function renderRanking() {
    uiRenderRanking({ members, matchHistory, rankMap, currentSessionState });
}

window.switchTab = (id) => {
    uiSwitchTab(id, { actions: { renderStatsDashboard } });
};

function updateStatistics() {
    uiUpdateStatistics({ members, matchHistory });
}

function renderStatsDashboard() {
    uiRenderStatsDashboard({ actions: { renderEloChart, updatePlayerSelect, renderPlayerTrend: window.renderPlayerTrend } });
}

function renderEloChart() {
    uiRenderEloChart({ members });
}

function updatePlayerSelect() {
    uiUpdatePlayerSelect({ members, actions: { renderPlayerTrend: window.renderPlayerTrend } });
}

window.renderPlayerTrend = () => {
    uiRenderPlayerTrend({ members, matchHistory, ELO_INITIAL });
};



function exportHistoryToCsv() {
    if (!isAdmin) { alert('관리자 기능입니다.'); return; }
    if (matchHistory.length === 0) { alert('내보낼 기록이 없습니다.'); return; }

    let csv = "\uFEFF회차,날짜,팀1,팀2,점수1,점수2,기대승률(%),ELO변동\n";
    matchHistory.slice().sort((a, b) => b.sessionNum - a.sessionNum).forEach(h => {
        const expected = h.elo_at_match?.expected ? (h.elo_at_match.expected * 100).toFixed(0) : 50;
        const eloChange = h.elo_at_match?.change1?.toFixed(1) || 0;
        csv += `${h.sessionNum},${h.date},"${h.t1_names.join(',')}","${h.t2_names.join(',')}",${h.score1},${h.score2},${expected}%,${eloChange}\n`;
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

// --- 데이터 복구 엔진 (CSV 기반) ---
async function handleRestoreCsv() {
    if (!isAdmin) { alert('관리자만 가능한 기능입니다.'); return; }
    const fileInput = document.getElementById('restoreCsvFile');
    if (!fileInput || !fileInput.files[0]) {
        alert('복구할 .csv 파일을 선택해주세요.');
        return;
    }

    if (!confirm('현재 데이터베이스의 모든 정보를 삭제하고 선택한 CSV 데이터로 복구하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;

    try {
        const file = fileInput.files[0];
        // 한글 깨짐 방지를 위한 인코딩 처리 (UTF-8 시도 후 실패 시 EUC-KR 시도)
        let text = await file.text();
        if (text.includes('') || !/[가-힣]/.test(text)) {
            console.log("[Restore] UTF-8 decoding may have failed. Retrying with EUC-KR...");
            text = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsText(file, 'euc-kr');
            });
        }
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            alert('파일 내용이 너무 적거나 형식이 맞지 않습니다.');
            return;
        }

        // CSV 헤더 확인 (회차,날짜,팀1,팀2,점수1,점수2,...)
        const dataRows = lines.slice(1);

        const newHistory = [];
        const nameSet = new Set();

        dataRows.forEach((line, idx) => {
            // 따옴표 내 쉼표 처리 (예: "홍길동,김철수")
            const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!parts || parts.length < 6) return; // 필수 항목 부족

            const sessionNum = parseInt(parts[0]) || 0;
            const date = parts[1];
            const t1_names = parts[2].replace(/"/g, '').split(',').map(n => n.trim());
            const t2_names = parts[3].replace(/"/g, '').split(',').map(n => n.trim());
            const score1 = parseInt(parts[4]) || 0;
            const score2 = parseInt(parts[5]) || 0;

            t1_names.forEach(n => nameSet.add(n));
            t2_names.forEach(n => nameSet.add(n));

            newHistory.push({
                id: Date.now() + Math.random() + idx,
                sessionNum,
                date,
                t1_names,
                t2_names,
                t1_ids: t1_names, // 이름 기반 ID 매핑
                t2_ids: t2_names,
                score1,
                score2
            });
        });

        if (newHistory.length === 0) {
            alert('복구할 수 있는 유효한 대진 기록을 찾지 못했습니다.');
            return;
        }

        // 맴버 명단 재구성
        const newMembers = Array.from(nameSet).map(name => ({
            id: name,
            name: name,
            rating: 1500,
            matchCount: 0,
            wins: 0, losses: 0, draws: 0
        }));

        // 전역 상태 업데이트
        matchHistory = newHistory;
        members = newMembers;
        currentSchedule = [];
        applicants = [];
        sessionNum = Math.max(...newHistory.map(h => h.sessionNum)) + 1;

        // 재계산 및 저장
        recalculateAll();
        await window.saveToCloud();
        await window.saveSessionState('idle', sessionNum);

        alert(`데이터 복구가 완료되었습니다!\n총 ${newHistory.length}개의 경기와 ${newMembers.length}명의 선수가 복구되었습니다.`);
        location.reload(); // 상태 반영을 위해 새로고침

    } catch (e) {
        console.error("Restore Error:", e);
        alert('복구 중 오류 발생: ' + e.message);
    }
}
