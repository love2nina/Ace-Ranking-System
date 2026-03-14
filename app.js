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
let systemSettings = { admin_pw: "ace_dot" };
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
let reports = {}; // 회차별 리포트 데이터
let videos = []; // 신규: 테니스 영상 자료실 리스트
let eloChart = null;
let trendChart = null;
let rankMap = new Map(); // 현재 랭킹 순위 저장용
let tempSchedule = null; // 대진표 생성 미리보기용 임시 저장
let sessionRankSnapshots = {}; // 회차별(세션별) 종료 시점의 랭킹 스냅샷
let historyViewMode = 'match'; // 'match' or 'player'
let sessionStartRatings = {}; // 회차별 시작 시점의 레이팅 스냅샷
let sessionEndRatings = {};   // 회차별 종료 시점의 레이팅 스냅샷
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
    renderPlayerTrend as uiRenderPlayerTrend,
    renderAnalystReport,
    renderVideoGallery as uiRenderVideoGallery
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
    initNewClusterSession as fbInitNewClusterSession,
    saveReport as fbSaveReport,
    getServerData as fbGetServerData,
    subscribeToVideos as fbSubscribeToVideos,
    addVideo as fbAddVideo,
    deleteVideo as fbDeleteVideo
} from './firebase-api.js';
// --- 설정 및 상수 ---
// engine.js 로 분리됨

// --- 로딩 UI 제어 ---
let _dataReceived = false;
let _loadingTimeoutId = null;

function showLoading(text) {
    const overlay = document.getElementById('loadingOverlay');
    const textEl = document.getElementById('loadingText');
    const retryBtn = document.getElementById('retryBtn');
    if (overlay) {
        overlay.classList.remove('fade-out');
        overlay.style.display = 'flex';
    }
    if (textEl) textEl.textContent = text || '데이터를 불러오는 중입니다...';
    if (retryBtn) retryBtn.style.display = 'none';
}

function hideLoading() {
    _dataReceived = true;
    if (_loadingTimeoutId) clearTimeout(_loadingTimeoutId);
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }
}

function showRetry() {
    const textEl = document.getElementById('loadingText');
    const retryBtn = document.getElementById('retryBtn');
    const spinner = document.querySelector('.loading-spinner');
    if (textEl) textEl.textContent = '연결에 시간이 걸리고 있습니다. 네트워크를 확인해주세요.';
    if (retryBtn) retryBtn.style.display = 'inline-block';
    if (spinner) spinner.style.display = 'none';
}

window.retryFirebaseInit = () => {
    const spinner = document.querySelector('.loading-spinner');
    if (spinner) spinner.style.display = 'block';
    showLoading('재연결 중입니다...');
    startFirebaseInit();
};

// --- 앱 초기화 로직 ---
window.addEventListener('DOMContentLoaded', () => {
    initUIEvents();
    checkAdminLogin();
    updateDbDisplay();

    // Firebase SDK가 준비된 후에만 DB 연결 시작
    if (window.FB_SDK) {
        startFirebaseInit();
    } else {
        showLoading('Firebase SDK를 로드하는 중...');
        window.addEventListener('firebase-sdk-ready', () => startFirebaseInit(), { once: true });
        // SDK 자체가 10초 안에 로드되지 않으면 안내
        setTimeout(() => {
            if (!window.FB_SDK) showRetry();
        }, 10000);
    }
});

function startFirebaseInit() {
    showLoading('데이터를 불러오는 중입니다...');
    _dataReceived = false;
    initFirebase();

    // 비디오 구독 (setTimeout 제거, SDK 준비 상태에서 즉시)
    fbSubscribeToVideos((data) => {
        videos = data;
        uiRenderVideoGallery({ videos, isAdmin, deleteVideo: window.deleteVideo });
    });

    // 타임아웃 안전장치: 15초 이내 데이터 미수신 시 "다시 시도" 표시
    _loadingTimeoutId = setTimeout(() => {
        if (!_dataReceived) {
            console.warn('[App] ⚠️ 15초 타임아웃: 데이터 수신 없음');
            showRetry();
        }
    }, 15000);
}

// 방안 A: matchHistory 변경 감지용 경량 해시
function _matchHistoryHash(history) {
    if (!history || history.length === 0) return '0';
    return history.length + ':' + history.map(h => `${h.id}_${h.score1}_${h.score2}`).join(',');
}

function initFirebase() {
    fbInitFirebase({
        getMembers: () => members,
        onDataLoaded: (data) => {
            members = data.members || [];
            matchHistory = data.matchHistory || [];
            currentSchedule = data.currentSchedule || [];
            sessionNum = data.sessionNum || 1;
            applicants = data.applicants || [];
            reports = data.reports || {};

            // 방안 A: matchHistory가 변경된 경우에만 재계산
            const newHash = _matchHistoryHash(matchHistory);
            if (newHash !== _lastMatchHistoryHash) {
                recalculateAll();
                _lastMatchHistoryHash = newHash;
                console.log('[Perf] matchHistory changed → recalculateAll executed');
            } else {
                console.log('[Perf] matchHistory unchanged → recalculateAll skipped');
            }
            updateUI();
            hideLoading();
        },
        onEmptyDefault: async () => {
            await fbHandleMigration();
        },
        onEmptyClusterSafe: () => {
            // Firebase에 저장하지 않고 UI만 빈 상태로 초기화
            console.log('[App] Empty cluster detected - UI only reset (no save)');
            members = []; matchHistory = []; currentSchedule = []; applicants = [];
            recalculateAll();
            updateUI();
            hideLoading(); // 빈 클러스터여도 로딩 완료 처리
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

window.saveToCloud = async (caller = 'unknown') => {
    await fbSaveToCloud({ members, matchHistory, currentSchedule, sessionNum, applicants, reports }, caller);
};

// --- 관리자 인증 로직 ---
function initUIEvents() {
    const bindClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    // --- 비디오 자료실 미니탭 전환 ---
    window.switchCasterSubTab = (tabName) => {
        const reportBtn = document.getElementById('subtab-report-btn');
        const videoBtn = document.getElementById('subtab-video-btn');
        const reportContent = document.getElementById('subtab-report');
        const videoContent = document.getElementById('subtab-video');

        if (tabName === 'report') {
            reportBtn.classList.add('active');
            reportBtn.style.color = 'var(--accent-color)';
            reportBtn.style.fontWeight = 'bold';

            videoBtn.classList.remove('active');
            videoBtn.style.color = 'var(--text-secondary)';
            videoBtn.style.fontWeight = 'normal';

            reportContent.style.display = 'block';
            videoContent.style.display = 'none';
        } else {
            videoBtn.classList.add('active');
            videoBtn.style.color = 'var(--accent-color)';
            videoBtn.style.fontWeight = 'bold';

            reportBtn.classList.remove('active');
            reportBtn.style.color = 'var(--text-secondary)';
            reportBtn.style.fontWeight = 'normal';

            reportContent.style.display = 'none';
            videoContent.style.display = 'block';

            uiRenderVideoGallery({ videos, isAdmin, deleteVideo: window.deleteVideo });
        }
    };

    // --- 비디오 자료실 모달 및 업로드 제어 ---
    bindClick('openVideoModalBtn', () => {
        document.getElementById('videoUrlInput').value = '';
        document.getElementById('videoTitleInput').value = '';
        document.getElementById('videoSummaryInput').value = '';
        document.getElementById('videoModal').classList.remove('hidden');
    });

    bindClick('closeVideoModalBtn', () => {
        document.getElementById('videoModal').classList.add('hidden');
    });

    // 유튜브 URL에서 제목 자동 파싱 (blur 이벤트)
    const videoUrlInput = document.getElementById('videoUrlInput');
    if (videoUrlInput) {
        videoUrlInput.addEventListener('blur', async () => {
            const url = videoUrlInput.value.trim();
            const titleInput = document.getElementById('videoTitleInput');
            if (url && (url.includes('youtu.be') || url.includes('youtube.com')) && !titleInput.value.trim()) {
                try {
                    titleInput.placeholder = '제목을 불러오는 중...';
                    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
                    const data = await res.json();
                    if (data && data.title) {
                        titleInput.value = data.title;
                    }
                } catch (e) {
                    console.error('유튜브 제목 가져오기 실패', e);
                } finally {
                    titleInput.placeholder = '영상 제목을 입력하세요';
                }
            }
        });
    }

    bindClick('submitVideoBtn', async () => {
        const url = document.getElementById('videoUrlInput').value.trim();
        const title = document.getElementById('videoTitleInput').value.trim();
        const summary = document.getElementById('videoSummaryInput').value.trim();

        if (!url || !url.includes('youtu')) {
            alert('올바른 유튜브 링크를 입력해주세요.');
            return;
        }
        if (!title) {
            alert('영상 제목을 입력해주세요.');
            return;
        }

        try {
            document.getElementById('submitVideoBtn').disabled = true;
            document.getElementById('submitVideoBtn').innerText = '등록 중...';

            await fbAddVideo({ url, title, summary });

            document.getElementById('videoModal').classList.add('hidden');
            alert('영상이 성공적으로 등록되었습니다!');
        } catch (e) {
            alert('영상 등록 중 오류가 발생했습니다: ' + e.message);
        } finally {
            document.getElementById('submitVideoBtn').disabled = false;
            document.getElementById('submitVideoBtn').innerText = '영상 등록';
        }
    });

    window.deleteVideo = async (videoId) => {
        if (!isAdmin) return;
        if (confirm('이 영상을 삭제하시겠습니까?')) {
            try {
                await fbDeleteVideo(videoId);
            } catch (e) {
                alert('삭제 중 오류 발생: ' + e.message);
            }
        }
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
        await window.saveToCloud('savePreviewBtn');
        alert('조편성 구성이 저장되었습니다. 모든 사용자에게 실시간 반영됩니다.');
        renderApplicants();
    });
    bindClick('saveReportBtn', handleSaveReport);
    bindClick('copyAIBtn', handleCopyAIData);

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

    // --- 시즌 고도화: 생성 옵션 UI 토글 ---
    const seasonRadios = document.querySelectorAll('input[name="seasonOption"]');
    seasonRadios.forEach(radio => {
        radio.onchange = () => {
            const container = document.getElementById('prevDbSelectContainer');
            if (container) container.style.display = radio.value === 'carryover' ? 'block' : 'none';
        };
    });
}

function updateDbDisplay() {
    const el = document.getElementById('currentDbName');
    if (el) {
        const clubId = fbGetCurrentClubId();
        const clubText = clubId !== 'Default' ? `[${clubId}] ` : '';
        el.innerText = `${clubText}DB: ${currentDbName}`;
    }
}

async function openDbModal() {
    if (!isAdmin) return;
    const modal = document.getElementById('dbModal');
    if (modal) modal.classList.remove('hidden');
    
    // 모달 열 때 DB 목록 갱신
    await fbFetchDbList();
}

window.closeDbModal = () => {
    const modal = document.getElementById('dbModal');
    if (modal) modal.classList.add('hidden');
};

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
        await window.saveToCloud('openRegistration');
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
            localStorage.removeItem('ace_admin');
            alert('로그아웃 되었습니다.');
            location.reload(); // 확실한 상태 초기화를 위해 새로고침
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

// openDbModal/closeDbModal은 위에서 통합 선언됨

function tryAdminLogin() {
    const pw = document.getElementById('adminPassword').value;
    // 디버깅: 비밀번호 로드 상태 확인
    if (!systemSettings || !systemSettings.admin_pw) {
        console.warn("System settings not loaded yet. Using default.");
    }
    const correctPw = systemSettings?.admin_pw || "ace_dot"; // 로드 실패 시 기본값

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
    await window.saveToCloud('addPlayer');
    renderApplicants(); // 로컬 즉시 반영
}

function updateApplyButtonState() {
    uiUpdateApplyButtonState({ currentSessionState });
}

// --- 기존 핵심 엔진 로직 (클라우드 환경 대응) ---

function recalculateAll() {
    engineRecalculateAll({ members, matchHistory, rankMap, sessionRankSnapshots, sessionStartRatings, sessionEndRatings });
}

function updateUI() {
    const unique = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean);
    const badge = document.getElementById('sessionBadge');
    if (badge) badge.innerText = `진행된 대회: ${unique.length}회차`;

    // 방안 D: 항상 렌더링해야 하는 핵심 UI
    renderApplicants();
    updateOptimizationInfo();
    renderRanking();
    renderCurrentMatches();
    updateApplyButtonState();
    renderSessionStatus();

    // 방안 D: 현재 활성 탭에 해당하는 것만 렌더링 (지연 로딩)
    const activeTab = document.querySelector('.tab-content.active');
    const activeId = activeTab ? activeTab.id.replace('tab-', '') : '';
    if (activeId === 'history') {
        renderHistory();
    } else if (activeId === 'stats') {
        updateStatistics();
        renderStatsDashboard();
    } else if (activeId === 'cast') {
        window.renderAnalystReport();
    }
}
async function handleSaveReport() {
    if (!isAdmin) return;
    const sessNum = document.getElementById('reportPostSessionNum').value;
    const content = document.getElementById('reportPostContent').value.trim();

    if (!sessNum || !content) {
        alert('회차 번호와 리포트 내용을 입력해주세요.');
        return;
    }

    if (confirm(`제 ${sessNum}회차 리포트를 게시하시겠습니까?`)) {
        try {
            await fbSaveReport(sessNum, content);
            alert('리포트가 게시되었습니다!');
            document.getElementById('reportPostContent').value = '';
        } catch (e) {
            alert('게시 실패: ' + e.message);
        }
    }
}

async function handleCopyAIData() {
    const select = document.getElementById('reportSessionSelect');
    const targetSession = select ? select.value : currentSessionState.sessionNum;

    if (!targetSession) {
        alert('분석할 회차를 선택해주세요.');
        return;
    }

    // 해당 회차의 경기 필터링
    const sessionMatches = matchHistory.filter(m => String(m.sessionNum) === String(targetSession));

    if (sessionMatches.length === 0) {
        alert('해당 회차의 경기 결과가 없습니다.');
        return;
    }

    // AI에게 전달할 데이터 구조화 (더 상세한 회차별 분석을 위해)
    // [전략 변경] 과거 시점 복구 대신, 현재의 최신 누적 성적과 랭킹을 기반으로 데이터 추출
    // 사용자 요청: "최신의 누적결과를 바탕으로 가장 최근의 회차를 분석"

    const startRatings = sessionStartRatings[targetSession] || {};
    const endRatings = sessionEndRatings[targetSession] || members.reduce((acc, m) => { acc[m.id] = m.rating; return acc; }, {});

    // 전체 멤버를 현재 랭킹 순서대로 정렬하여 추출
    const snapshotMembers = members
        .filter(m => m.matchCount > 0)
        .map(m => {
            return {
                ...m,
                snapshotRating: Math.round(m.rating),
                snapshotWins: m.wins,
                snapshotDraws: m.draws,
                snapshotLosses: m.losses,
                snapshotScoreDiff: m.scoreDiff,
                snapshotRank: rankMap.get(String(m.id)) || 999
            };
        })
        .sort((a, b) => a.snapshotRank - b.snapshotRank);

    // 1. 해당 회차에서의 선수별 요약 성적 계산
    const todayPerformance = snapshotMembers.map(m => {
        const sMatches = sessionMatches.filter(match => match.t1_ids.concat(match.t2_ids).includes(m.id));
        if (sMatches.length === 0) return null;

        const wins = sMatches.filter(match => {
            const isT1 = match.t1_ids.includes(m.id);
            return isT1 ? match.score1 > match.score2 : match.score2 > match.score1;
        }).length;
        const draws = sMatches.filter(match => match.score1 === match.score2).length;
        const losses = sMatches.length - wins - draws;

        const startR = startRatings[m.id] || ELO_INITIAL;
        const endR = endRatings[m.id] || ELO_INITIAL;
        const ratingDiff = endR - startR;

        // [정교화] 해당 분석 회차가 선수의 첫 출전인지 판별
        const isNewInThisSession = m.participationArr && m.participationArr.length > 0 &&
            Math.min(...m.participationArr.map(s => parseInt(s))) === parseInt(targetSession);
        const displayName = m.name + (isNewInThisSession ? " (NEW)" : "");

        return {
            name: displayName,
            record: `${wins}승 ${draws}무 ${losses}패`,
            ratingChange: (ratingDiff > 0 ? '+' : '') + Math.round(ratingDiff),
            scoreDiff: sMatches.reduce((acc, match) => {
                const isT1 = match.t1_ids.includes(m.id);
                return acc + (isT1 ? match.score1 - match.score2 : match.score2 - match.score1);
            }, 0)
        };
    }).filter(Boolean).sort((a, b) => parseFloat(b.ratingChange) - parseFloat(a.ratingChange));

    const reportData = {
        title: `ACE 테니스 클럽 제 ${targetSession}회차 랭킹전 결과`,
        sessionNumber: targetSession,
        sessionDate: new Date().toLocaleDateString('ko-KR'),
        // 오늘의 경기 결과 (상세)
        matchResults: sessionMatches.map(m => ({
            round: m.groupRound ? `${m.groupRound}회전` : '기타',
            team1: m.t1_names.join(', '),
            team2: m.t2_names.join(', '),
            score: `${m.score1}:${m.score2}`,
            winner: m.score1 > m.score2 ? 'Team 1' : (m.score2 > m.score1 ? 'Team 2' : 'Draw')
        })),
        // 오늘 하루만의 성적 (레이팅 변동순 정렬)
        todayPerformance: todayPerformance,
        // [타임머신] 해당 회차 종료 시점의 누적 랭킹 보드
        cumulativeRankingAtSnapshot: snapshotMembers.map(m => {
            const isNewInThisSession = m.participationArr && m.participationArr.length > 0 &&
                Math.min(...m.participationArr.map(s => parseInt(s))) === parseInt(targetSession);
            return {
                rank: m.snapshotRank,
                name: m.name + (isNewInThisSession ? " (NEW)" : ""),
                elo: Math.round(m.snapshotRating),
                overallRecord: `${m.snapshotWins}승 ${m.snapshotDraws}무 ${m.snapshotLosses}패`
            };
        })
    };

    const prompt = `
# 역할: 평촌ACE 수석 데이터 분석관 (Senior Data Analyst)
# 목표: [경기 데이터]를 바탕으로 모든 참가자의 활약상을 담은 '입체적' 분석 리포트를 작성하라.

## 분석 및 작성 지침
1. **광범위한 인물 분석**: 'todayPerformance'에 포함된 모든 선수를 최소 한 번씩 언급할 것. 상위권뿐만 아니라 중위권의 분전, 하위권의 '아쉬운 데이터'도 위트 있게 다뤄라.
2. **데이터 기반 스토리텔링**: 
    - 승률, 레이팅 변화, 득실차(scoreDiff)를 조합하여 선수의 오늘 '컨디션'을 정의하라.
    - 예: 득실차는 높으나 승률이 낮은 경우 "효율의 끝판왕", 무승부가 많은 경우 "평화주의자" 등.
3. **리포트 구성**:
    - **세션 총평**: 오늘 세션의 전체적인 온도와 랭킹 판도의 큰 변화.
    - **전력 분석 (In-Depth)**: 
        - [승리의 주역] 압도적 지표를 보인 상위권 분석.
        - [존재감 발산] 신규 회원, 순위 급등자, 혹은 득실차에서 두각을 나타낸 이들 분석.
        - [반전 필요] 레이팅이 하락했으나 경기 내용상 희망이 보이는 이들을 향한 위트 있는 격려.
    - **향후 전망**: 다음 회차에서 주목해야 할 '다크호스' 선정 및 랭킹 변화 예측.
4. **톤앤매너**: 분석 전문가의 냉철한 시각 90% + 회원들의 사기를 북돋우는 유머 한 스푼 10%. (모바일 최적화 형식 유지)

## [경기 데이터]
\`\`\`json
${JSON.stringify(reportData, null, 2)}
\`\`\`

---
작성된 전문 분석 리포트 본문만을 즉시 출력하십시오.
`;

    try {
        await navigator.clipboard.writeText(prompt.trim());
        alert('AI 분석용 데이터와 프롬프트가 클립보드에 복사되었습니다!\nGemini나 ChatGPT에 붙여넣어 리포트를 생성하세요.');
    } catch (err) {
        console.error('클립보드 복사 실패:', err);
        alert('복사 중 오류가 발생했습니다.');
    }
}

window.renderAnalystReport = () => {
    // ui.js에서 임포트된 renderAnalystReport를 명시적으로 호출 (무한 루프 방지)
    renderAnalystReport({ reports, matchHistory, isAdmin });
};

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
    await window.saveToCloud('removeApplicant');
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
    await window.saveToCloud('finalizeSchedule');

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
    await window.saveToCloud('cancelSchedule');

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

// --- 미저장 경기 추적 ---
const dirtyMatches = new Set();

window.updateLiveScore = (id, team, val) => {
    let score = val === '' ? null : (parseInt(val) || 0); // 빈칸이면 null
    if (score !== null) {
        if (score < 0) score = 0; if (score > 6) score = 6;
    }
    const m = currentSchedule.find(x => x.id === id);
    if (m) {
        if (team === 1) m.s1 = score; else m.s2 = score;
        dirtyMatches.add(id); // 미저장 표시
        // UI에 미저장 상태 반영 (저장 버튼 활성화)
        const card = document.querySelector(`[data-match-id="${id}"]`);
        if (card) {
            card.classList.add('unsaved');
            const btn = card.querySelector('.save-score-btn');
            if (btn) btn.style.display = 'inline-flex';
        }
    }
};

window.saveMatchScore = async (id) => {
    if (!dirtyMatches.has(id)) return;
    const m = currentSchedule.find(x => x.id === id);
    if (!m) return;

    const btn = document.querySelector(`[data-match-id="${id}"] .save-score-btn`);
    if (btn) {
        btn.disabled = true;
        btn.innerText = '저장 중...';
    }

    try {
        // 서버의 최신 데이터를 읽어서 현재 경기 점수만 병합
        const serverData = await fbGetServerData();
        if (serverData && serverData.currentSchedule) {
            // 서버의 최신 스케줄에 이 경기의 점수만 덮어쓰기
            const serverSchedule = serverData.currentSchedule;
            const serverMatch = serverSchedule.find(x => x.id === id);
            if (serverMatch) {
                serverMatch.s1 = m.s1;
                serverMatch.s2 = m.s2;
            }
            // 서버 스케줄의 나머지 경기 점수도 로컬에 동기화 (다른 사람이 입력한 점수 반영)
            serverSchedule.forEach(sm => {
                if (sm.id !== id) {
                    const localM = currentSchedule.find(x => x.id === sm.id);
                    if (localM && !dirtyMatches.has(sm.id)) {
                        localM.s1 = sm.s1;
                        localM.s2 = sm.s2;
                    }
                }
            });
            // 병합된 서버 스케줄로 교체 후 저장
            currentSchedule = serverSchedule;
            // 이 경기의 점수를 다시 확실히 반영
            const finalMatch = currentSchedule.find(x => x.id === id);
            if (finalMatch) {
                finalMatch.s1 = m.s1;
                finalMatch.s2 = m.s2;
            }
        }
        await window.saveToCloud('saveMatchScore');
        dirtyMatches.delete(id);
        // 성공 시 UI 업데이트
        const card = document.querySelector(`[data-match-id="${id}"]`);
        if (card) {
            card.classList.remove('unsaved');
            card.classList.add('saved-flash');
            const saveBtn = card.querySelector('.save-score-btn');
            if (saveBtn) {
                saveBtn.innerText = '✅ 저장 완료';
                saveBtn.disabled = true;
                setTimeout(() => {
                    saveBtn.style.display = 'none';
                    saveBtn.innerText = '💾 점수 저장';
                    saveBtn.disabled = false;
                    card.classList.remove('saved-flash');
                }, 1500);
            }
        }
        console.log(`[SaveMatch] ✅ 경기 ${id} 점수 저장 완료 (병합 방식)`);
    } catch (e) {
        console.error('[SaveMatch] 저장 실패:', e);
        alert('점수 저장 중 오류가 발생했습니다. 다시 시도해주세요.');
        if (btn) {
            btn.disabled = false;
            btn.innerText = '💾 점수 저장';
        }
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
        await window.saveToCloud('commitSession');

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
    await window.saveToCloud('deleteHistory');
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
        await window.saveToCloud('saveScheduleEdit');
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
        await window.saveToCloud('saveEdit');
    }
}

function renderRanking() {
    uiRenderRanking({ members, matchHistory, rankMap, currentSessionState, applicants, currentSchedule });
}

window.switchTab = (id) => {
    uiSwitchTab(id, { actions: { renderStatsDashboard } });
    // 방안 D: 탭 전환 시 해당 탭 데이터 렌더링
    if (id === 'history') renderHistory();
    else if (id === 'stats') { updateStatistics(); renderStatsDashboard(); }
    else if (id === 'cast') window.renderAnalystReport();
};

function updateStatistics() {
    uiUpdateStatistics({ members, matchHistory });
}

function renderStatsDashboard() {
    uiRenderStatsDashboard({
        members,
        matchHistory,
        ELO_INITIAL,
        actions: { renderEloChart, updatePlayerSelect, renderPlayerTrend: window.renderPlayerTrend }
    });
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
    
    // 데이터 로딩 확인
    if (!matchHistory || !members) {
        alert('데이터를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        return;
    }
    if (matchHistory.length === 0 && members.length === 0) {
        alert('내보낼 데이터가 없습니다.');
        return;
    }

    try {
        let csv = "\uFEFF회차,날짜,팀1,팀2,점수1,점수2,기대승률(%),ELO변동\n";
        matchHistory.slice().sort((a, b) => (b.sessionNum || 0) - (a.sessionNum || 0)).forEach(h => {
            const expected = h.elo_at_match?.expected ? (h.elo_at_match.expected * 100).toFixed(0) : 50;
            const eloChange = h.elo_at_match?.change1?.toFixed(1) || 0;
            const t1 = (h.t1_names || []).join(',');
            const t2 = (h.t2_names || []).join(',');
            csv += `${h.sessionNum || 0},${h.date || ''},"${t1}","${t2}",${h.score1 || 0},${h.score2 || 0},${expected}%,${eloChange}\n`;
        });

        // v5: 통합 백업을 위한 멤버 데이터 섹션 추가
        csv += "\n---MEMBER_DATA---\n";
        csv += "id,name,rating,mmr,prevSeasonStats\n";
        members.forEach(m => {
            let statsStr = "{}";
            try {
                if (m.prevSeasonStats) statsStr = JSON.stringify(m.prevSeasonStats).replace(/"/g, '""');
            } catch (e) {
                console.error("Stats Serialize Error for", m.name, e);
            }
            // id와 name에 쉼표가 들어있을 경우를 대비해 따옴표 처리
            csv += `"${m.id}","${m.name}",${m.rating || 1500},${m.mmr || 1500},"${statsStr}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const filename = `ACE_Integrated_Backup_${new Date().toISOString().slice(0, 10)}.csv`;

        const link = document.createElement("a");
        link.href = url;
        link.setAttribute('download', filename);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        
        // 지연 후 정리 (브라우저가 다운로드를 감지할 시간 확보)
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);
        
        console.log("[Export] CSV Exported successfully.");
    } catch (err) {
        console.error("Export Error:", err);
        alert('CSV 내보내기 중 오류가 발생했습니다: ' + err.message);
    }
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

        // v7.6: UTF-8 디코딩 시 깨짐 현상()이 있거나 한글이 감지되지 않으면 EUC-KR로 재시도
        if (text.includes('\ufffd') || !/[가-힣]/.test(text)) {
            console.log("[Restore] Potential encoding issue detected. Retrying with EUC-KR...");
            text = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsText(file, 'euc-kr');
            });
        }
        // v5: 통합 백업 포맷 대응 분할
        const sections = text.split("---MEMBER_DATA---");
        const matchDataText = sections[0].trim();
        const memberDataText = sections.length > 1 ? sections[1].trim() : null;

        const lines = matchDataText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) {
            alert('파일 내용이 너무 적거나 형식이 맞지 않습니다.');
            return;
        }

        const dataRows = lines.slice(1);
        const newHistory = [];
        const nameSet = new Set();
        
        // CSV 파싱 유틸리티 (따옴표 대응)
        const parseCsvLine = (line) => {
            const parts = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    if (inQuotes && line[i+1] === '"') { // Double quote inside
                        current += '"'; i++;
                    } else inQuotes = !inQuotes;
                }
                else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = '';
                } else current += char;
            }
            parts.push(current.trim());
            return parts;
        };

        dataRows.forEach((line, idx) => {
            const parts = parseCsvLine(line);
            if (parts.length < 6) return;

            const sessionNum = parseInt(parts[0]) || 0;
            const date = parts[1].replace(/"/g, '').trim();
            const t1_names = parts[2].replace(/"/g, '').split(',').map(n => n.trim());
            const t2_names = parts[3].replace(/"/g, '').split(',').map(n => n.trim());
            const score1 = parseInt(parts[4]) || 0;
            const score2 = parseInt(parts[5]) || 0;

            t1_names.forEach(n => nameSet.add(n));
            t2_names.forEach(n => nameSet.add(n));

            newHistory.push({
                id: Date.now() + Math.random() + idx,
                sessionNum, date, t1_names, t2_names, t1_ids: t1_names, t2_ids: t2_names, score1, score2
            });
        });

        // 맴버 명단 구성
        let newMembers = [];
        if (memberDataText) {
            const mLines = memberDataText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const mRows = mLines.slice(1); // skip header (id,name,rating,mmr,prevSeasonStats)
            newMembers = mRows.map(line => {
                const p = parseCsvLine(line);
                let stats = {};
                try { stats = JSON.parse(p[4] || "{}"); } catch(e) { console.warn("Failed to parse stats for", p[1]); }
                return {
                    id: p[0],
                    name: p[1],
                    rating: parseFloat(p[2]) || 1500,
                    mmr: parseFloat(p[3]) || 1500,
                    prevSeasonStats: stats,
                    matchCount: 0, wins: 0, losses: 0, draws: 0
                };
            });
        } else {
            // 구버전 CSV 대응: 이름 기반 생성
            newMembers = Array.from(nameSet).map(name => ({
                id: name, name, rating: 1500, mmr: 1500, matchCount: 0, wins: 0, losses: 0, draws: 0
            }));
        }

        // 전역 상태 업데이트
        matchHistory = newHistory;
        members = newMembers;
        currentSchedule = [];
        applicants = [];
        sessionNum = Math.max(...newHistory.map(h => h.sessionNum)) + 1;

        // 재계산 및 저장
        recalculateAll();
        await window.saveToCloud('handleRestoreCsv');
        await window.saveSessionState('idle', sessionNum);

        alert(`데이터 복구가 완료되었습니다!\n총 ${newHistory.length}개의 경기와 ${newMembers.length}명의 선수가 복구되었습니다.`);
        location.reload(); // 상태 반영을 위해 새로고침

    } catch (e) {
        console.error("Restore Error:", e);
        alert('복구 중 오류 발생: ' + e.message);
    }
}
