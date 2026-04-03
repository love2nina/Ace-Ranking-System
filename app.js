/**
 * ACE 랭킹 시스템 - 메인 애플리케이션 (app.js)
 * 시스템의 전체 상태를 관리하고 UI와 엔진, Firebase 레이어를 조율합니다.
 */

import {
    initFirebase,
    subscribeToCluster,
    saveToCloud as fbSaveToCloud,
    saveSessionState as fbSaveSessionState,
    subscribeToVideos,
    addVideo as fbAddVideo,
    deleteVideo as fbDeleteVideo,
    switchDatabase as fbSwitchDatabase,
    loadDatabase as fbLoadDatabase,
    fetchDbList,
    saveReport as fbSaveReport,
    saveMatchScoreWithTransaction as fbSaveMatchScoreWithTransaction,
    addHistoryItem as fbAddHistoryItem,
    deleteHistoryItem as fbDeleteHistoryItem,
    updateHistoryItem as fbUpdateHistoryItem,
    saveCourtConfig as fbSaveCourtConfig
} from './firebase-api.js';

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
    renderRanking as uiRenderRanking,
    switchTab as uiSwitchTab,
    updateStatistics as uiUpdateStatistics,
    renderAnalystReport as uiRenderAnalystReport,
    renderVideoGallery as uiRenderVideoGallery,
    toggleHistoryContent as uiToggleHistoryContent,
    renderEloChart as uiRenderEloChart,
    updatePlayerSelect as uiUpdatePlayerSelect,
    renderPlayerTrend as uiRenderPlayerTrend,
    renderHistoryEditModal as uiRenderHistoryEditModal,
    renderCurrentMatchEditModal as uiRenderCurrentMatchEditModal
} from './ui.js';

import {
    ELO_INITIAL,
    GAME_COUNTS,
    getSplits,
    recalculateAll as engineRecalculateAll,
    generateSchedule as engineGenerateSchedule
} from './engine.js';

// --- 전역 애플리케이션 상태 (State) ---
let members = [];
let matchHistory = [];
let applicants = [];
let currentSchedule = [];
let reports = {};
let videos = [];
let currentSessionState = { status: 'idle', sessionNum: 0, info: '', matchMode: 'court' };
let systemSettings = { admin_pw: 'ace_dot' };

let isAdmin = false;
let rankMap = new Map();
let sessionRankSnapshots = {};
let sessionStartRatings = {};
let sessionEndRatings = {};
let previewGroups = null; // 조편성 미리보기용 임시 데이터
let activeGroupTab = ''; // 현재 활성 대진표 탭
let tempSchedule = null; // 확정 전 임시 대진표
let historyViewMode = 'match'; // 'match' or 'player'
let editingMatchId = null;
let modalMode = ''; // 'history' or 'current'

// --- 초기화 (Initialization) ---
async function init() {
    console.log("[App] System starting...");

    // [v60] 로딩 타임아웃 안전장치: 15초 후에도 데이터 미수신 시 에러 UI 표시
    const loadingTimeout = setTimeout(() => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay && overlay.style.display !== 'none') {
            const loadingText = document.getElementById('loadingText');
            const retryBtn = document.getElementById('retryBtn');
            if (loadingText) loadingText.innerText = '서버 연결에 실패했습니다. 네트워크를 확인해 주세요.';
            if (retryBtn) retryBtn.style.display = 'block';
        }
    }, 15000);

    // [v62-hotfix] SDK 비동기 다운로드 대기 (네트워크 지연 대비 최대 5초)
    if (!window.FB_SDK) {
        console.warn("[App] FB_SDK not ready, waiting for 'firebase-sdk-ready' event...");
        await new Promise(resolve => {
            const onReady = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => {
                window.removeEventListener('firebase-sdk-ready', onReady);
                resolve();
            }, 5000);
            window.addEventListener('firebase-sdk-ready', onReady, { once: true });
        });
    }

    if (!window.FB_SDK) {
        console.error("[App] Firebase SDK not available even after waiting.");
        const loadingText = document.getElementById('loadingText');
        const retryBtn = document.getElementById('retryBtn');
        if (loadingText) loadingText.innerText = 'Firebase SDK 로드 지연. 네트워크 연결을 확인해 주세요.';
        if (retryBtn) retryBtn.style.display = 'block';
        clearTimeout(loadingTimeout);
        return;
    }

    const callbacks = {
        onDataLoaded: (data) => {
            clearTimeout(loadingTimeout); // 타임아웃 해제
            members = data.members || [];
            currentSchedule = data.currentSchedule || [];
            applicants = data.applicants || [];
            // [v44] recalculateAll은 onHistoryLoaded에서만 호출 (중복 제거, 로딩 최적화)
            updateUI();

            // 데이터 로딩 완료 시 오버레이 숨김
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        },
        onHistoryLoaded: (historyList) => {
            matchHistory = historyList;
            recalculateAll();
            updateUI();
        },
        onReportsLoaded: (reportsData) => {
            reports = reportsData;
            if (document.querySelector('.tab-content#tab-caster.active')) {
                window.renderAnalystReport();
            }
        },
        onSessionUpdate: (state) => {
            currentSessionState = state;
            updateUI();
        },
        onSettingsUpdate: (settings) => {
            systemSettings = settings;
        },
        onDbNameChange: (dbName) => {
            const badge = document.getElementById('currentDbName');
            if (badge) badge.innerText = `DB: ${dbName}`;
        },
        onEmptyDefault: async () => {
            // 레거시 마이그레이션 모듈은 firebase-api에서 수행
        },
        onEmptyClusterSafe: () => {
            clearTimeout(loadingTimeout);
            members = [];
            matchHistory = [];
            applicants = [];
            currentSchedule = [];
            recalculateAll();
            updateUI();
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        },
        getMembers: () => members
    };

    // 비동기 초기화를 기다려서 SDK가 로드된 이후에만 subscribeToVideos가 정상 동작하게 함
    await initFirebase(callbacks);

    subscribeToVideos((videoList) => {
        videos = videoList;
        if (document.querySelector('.tab-content#tab-caster.active')) {
            window.renderVideoGallery();
        }
    });

    setupEventListeners();
    // [v63] 보안 강화: 자동 로그인 기능을 위해 저장된 민감 정보를 초기화합니다.
    localStorage.removeItem('ace_admin_pw');
    await checkAdminLogin();
}

// [v60] 재시도 기능
window.retryFirebaseInit = () => {
    window.location.reload();
};

// --- 윈도우 익스포트 (UI 제어용) ---
window.switchTab = (id) => {
    const ctx = {
        members, matchHistory, reports, currentSessionState, isAdmin, videos,
        applicants, currentSchedule, sessionEndRatings, sessionRankSnapshots,
        ELO_INITIAL, rankMap,
        actions: {
            renderEloChart: (c) => uiRenderEloChart(c),
            updatePlayerSelect: (c) => uiUpdatePlayerSelect(c),
            renderPlayerTrend: (c) => uiRenderPlayerTrend(c),
            renderAnalystReport: (c) => uiRenderAnalystReport(c),
            renderVideoGallery: (c) => uiRenderVideoGallery(c),
            updateUI: () => updateUI()
        }
    };
    uiSwitchTab(id, ctx);

    // [v62-Performance] 메인 탭도 선택 시 화면 중앙으로 자동 슬라이딩 (모바일 UX)
    const activeTabBtn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    if (activeTabBtn) {
        activeTabBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
};

// 모달 및 서브탭 제어
window.openAdminModal = () => openAdminModal();
window.tryAdminLogin = () => tryAdminLogin();
window.closeAdminModal = () => {
    const modal = document.getElementById('adminModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.openDbModal = async () => {
    document.getElementById('dbModal').classList.remove('hidden');
    document.getElementById('dbModal').style.display = 'flex';
    await fetchDbList();
};
window.closeDbModal = () => {
    const modal = document.getElementById('dbModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.openHelpModal = () => {
    const modal = document.getElementById('helpModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
};
window.closeHelpModal = () => {
    const modal = document.getElementById('helpModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.openVideoModal = () => {
    const modal = document.getElementById('videoModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
};
window.closeVideoModal = () => {
    const modal = document.getElementById('videoModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.closeModal = () => {
    const modal = document.getElementById('editModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.switchCasterSubTab = (id) => {
    const tabs = ['badge', 'insight', 'report', 'video'];
    tabs.forEach(t => {
        const el = document.getElementById(`subtab-${t}`);
        const btn = document.getElementById(`subtab-${t}-btn`);
        if (el) el.style.display = (t === id) ? 'block' : 'none';
        if (btn) {
            btn.classList.toggle('active', t === id);
        }
    });

    if (id === 'badge') {
        uiRenderEloChart({ members, rankMap });
    }
    if (id === 'insight') {
        uiRenderPlayerTrend({ members, matchHistory, rankMap, ELO_INITIAL });
    }

    // [v62-Performance] 선택한 탭이 화면 좌측으로 부드럽게 이동 (모바일 UX 개선)
    const activeBtn = document.getElementById(`subtab-${id}-btn`);
    if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
};

// 히스토리 제어
window.setHistoryViewMode = (mode) => {
    historyViewMode = mode;
    const matchBtn = document.getElementById('viewMatchesBtn');
    const playerBtn = document.getElementById('viewPlayersBtn');
    if (matchBtn) matchBtn.classList.toggle('active', mode === 'match');
    if (playerBtn) playerBtn.classList.toggle('active', mode === 'player');
    updateUI();
};
window.toggleHistoryContent = (headerEl) => uiToggleHistoryContent(headerEl);

// 데이터 렌더링 명시적 노출
window.renderAnalystReport = () => uiRenderAnalystReport({ reports, currentSessionState, matchHistory, isAdmin });

// CSV 내보내기 (경기 기록 엑셀 다운)
window.exportHistoryToCSV = () => {
    if (!matchHistory || matchHistory.length === 0) {
        alert("다운로드할 경기 기록이 없습니다.");
        return;
    }
    const header = ["회차", "날짜", "팀1_선수1", "팀1_선수2", "팀2_선수1", "팀2_선수2", "팀1_점수", "팀2_점수", "승리팀"];
    const rows = matchHistory.map(m => {
        const team1 = Array.isArray(m.t1) ? m.t1 : [];
        const team2 = Array.isArray(m.t2) ? m.t2 : [];
        const t1p1 = team1[0]?.name || "";
        const t1p2 = team1[1]?.name || "";
        const t2p1 = team2[0]?.name || "";
        const t2p2 = team2[1]?.name || "";
        const s1 = m.s1 !== undefined ? m.s1 : "";
        const s2 = m.s2 !== undefined ? m.s2 : "";
        let win = "무승부";
        if (s1 > s2) win = "팀1";
        else if (s2 > s1) win = "팀2";
        
        return [
            m.sessionNum,
            m.timestamp ? new Date(m.timestamp).toLocaleDateString() : "",
            t1p1, t1p2, t2p1, t2p2,
            s1, s2, win
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",");
    });
    
    const csvContent = "\uFEFF" + header.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ACE_매치기록_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
};
window.renderVideoGallery = () => uiRenderVideoGallery({ videos, isAdmin });
window.toggleLateJoin = (id) => {
    const player = applicants.find(p => String(p.id) === String(id));
    if (player) {
        player.lateJoin = !player.lateJoin;
        fbSaveToCloud({ applicants }, 'toggleLateJoin');
        updateUI();
    }
};

// --- 이벤트 리스너 설정 ---
function setupEventListeners() {
    // 관리자/설정 버튼들 (ID 기반 바인딩)
    const adminBtn = document.getElementById('adminLoginBtn');
    if (adminBtn) adminBtn.onclick = () => window.openAdminModal();

    const confirmAdminBtn = document.getElementById('confirmAdminBtn');
    if (confirmAdminBtn) confirmAdminBtn.onclick = () => window.tryAdminLogin();

    const dbSettingsBtn = document.getElementById('dbSettingsBtn');
    if (dbSettingsBtn) dbSettingsBtn.onclick = () => window.openDbModal();

    const switchDbBtn = document.getElementById('switchDbBtn');
    if (switchDbBtn) switchDbBtn.onclick = () => fbSwitchDatabase();

    const loadDbBtn = document.getElementById('loadDbBtn');
    if (loadDbBtn) loadDbBtn.onclick = () => fbLoadDatabase();

    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) helpBtn.onclick = () => window.openHelpModal();

    // 참가신청 탭 버튼들
    const openRoundBtn = document.getElementById('openRoundBtn');
    if (openRoundBtn) openRoundBtn.onclick = () => openRegistration();

    const addPlayerBtn = document.getElementById('addPlayerBtn');
    if (addPlayerBtn) addPlayerBtn.onclick = () => addPlayer();

    const playerNameInput = document.getElementById('playerName');
    if (playerNameInput) {
        playerNameInput.onkeypress = (e) => { if (e.key === 'Enter') addPlayer(); };
    }

    // 대진표 탭 버튼들
    const generateScheduleBtn = document.getElementById('generateScheduleBtn');
    if (generateScheduleBtn) generateScheduleBtn.onclick = () => generateSchedule();

    const finalizeScheduleBtn = document.getElementById('finalizeScheduleBtn');
    if (finalizeScheduleBtn) {
        finalizeScheduleBtn.onclick = () => finalizeSchedule();
    }

    const saveEditBtn = document.getElementById('saveEditBtn');
    if (saveEditBtn) saveEditBtn.onclick = () => saveEdit();

    const closeModalBtn = document.querySelector('#editModal .secondary');
    if (closeModalBtn) closeModalBtn.onclick = () => closeEditModal();

    const cancelScheduleBtn = document.getElementById('cancelScheduleBtn');
    if (cancelScheduleBtn) cancelScheduleBtn.onclick = () => cancelSchedule();

    const updateEloBtn = document.getElementById('updateEloBtn');
    if (updateEloBtn) updateEloBtn.onclick = () => commitSession();

    // 전력분석실 버튼들
    const copyAIBtn = document.getElementById('copyAIBtn');
    if (copyAIBtn) copyAIBtn.onclick = () => handleCopyAIData();

    const saveReportBtn = document.getElementById('saveReportBtn');
    if (saveReportBtn) saveReportBtn.onclick = () => handleSaveReport();

    const openVideoModalBtn = document.getElementById('openVideoModalBtn');
    if (openVideoModalBtn) openVideoModalBtn.onclick = () => window.openVideoModal();

    const submitVideoBtn = document.getElementById('submitVideoBtn');
    if (submitVideoBtn) submitVideoBtn.onclick = () => handleAddVideo();

    const closeVideoModalBtn = document.getElementById('closeVideoModalBtn');
    if (closeVideoModalBtn) closeVideoModalBtn.onclick = () => window.closeVideoModal();

    const restoreCsvBtn = document.getElementById('restoreCsvBtn');
    if (restoreCsvBtn) restoreCsvBtn.onclick = () => handleRestoreCsv();

    // [v44] 조편성 저장 버튼 클릭 시 즉시 반영
    const savePreviewBtn = document.getElementById('savePreviewBtn');
    if (savePreviewBtn) savePreviewBtn.onclick = () => {
        previewGroups = null; // 기존 미리보기 초기화 → 새 커스텀 입력값 기준으로 재생성
        updateUI();
    };

    // [v45] 실시간 커스텀 인원 입력 검증
    const customSplitInput = document.getElementById('customSplitInput');
    if (customSplitInput) {
        customSplitInput.oninput = () => {
            // updateUI 전체를 호출하면 포커스가 잃어버리므로, 정보 업데이트만 부분 호출
            const context = {
                currentSessionState, applicants, previewGroups, GAME_COUNTS, 
                getSplits,
                actions: { selfRender: () => {}, setPreviewGroups: (val) => { previewGroups = val; }, updateUI: () => updateUI() }
            };
            uiUpdateOptimizationInfo(context);
        };
    }

    // 실시간 세션 정보 입력 동기화
    const sessionInfoSelect = document.getElementById('sessionInfoSelect');
    if (sessionInfoSelect) {
        sessionInfoSelect.onchange = async () => {
            const manualInput = document.getElementById('manualSessionInfo');
            if (sessionInfoSelect.value === 'manual') {
                if (manualInput) manualInput.style.display = 'inline-block';
            } else {
                if (manualInput) manualInput.style.display = 'none';
                if (isAdmin && currentSessionState.status === 'recruiting') {
                    await fbSaveSessionState(currentSessionState.status, currentSessionState.sessionNum, sessionInfoSelect.value, currentSessionState.matchMode);
                }
            }
            // [v65] 코트 설정 패널 표시/갱신
            renderCourtConfigPanel();
        };
    }

    // [v65] 코트 설정 이벤트 바인딩
    const addCourtBtn = document.getElementById('addCourtBtn');
    if (addCourtBtn) addCourtBtn.onclick = () => addCourtRow();
    
    const saveCourtConfigBtn = document.getElementById('saveCourtConfigBtn');
    if (saveCourtConfigBtn) saveCourtConfigBtn.onclick = () => saveCourtConfigFromUI();

    const manualSessionInfoInput = document.getElementById('manualSessionInfo');
    if (manualSessionInfoInput) {
        manualSessionInfoInput.oninput = async () => {
            if (isAdmin && currentSessionState.status === 'recruiting' && sessionInfoSelect?.value === 'manual') {
                await fbSaveSessionState(currentSessionState.status, currentSessionState.sessionNum, manualSessionInfoInput.value, currentSessionState.matchMode);
            }
        };
    }

    // 대진 방식(matchMode) 변경 이벤트 리스너 추가
    const matchModeRadios = document.querySelectorAll('input[name="matchMode"]');
    matchModeRadios.forEach(radio => {
        radio.onchange = async () => {
            if (isAdmin) {
                await fbSaveSessionState(
                    currentSessionState.status,
                    currentSessionState.sessionNum,
                    currentSessionState.info,
                    radio.value
                );
            }
        };
    });
}

// --- 코어 UI 동기화 ---
function updateUI() {
    const context = {
        members, matchHistory, applicants, currentSchedule, reports, videos,
        currentSessionState, isAdmin, rankMap, sessionRankSnapshots, sessionStartRatings,
        sessionEndRatings, previewGroups, activeGroupTab, tempSchedule, historyViewMode,
        ELO_INITIAL, GAME_COUNTS,
        getSplits,
        actions: {
            setPreviewGroups: (val) => { previewGroups = val; },
            updateSplitInputFromPreview: () => uiUpdateSplitInputFromPreview(context),
            renderApplicants: () => uiRenderApplicants(context),
            updateOptimizationInfo: () => uiUpdateOptimizationInfo(context),
            setActiveGroupTab: (val) => { activeGroupTab = val; updateUI(); },
            renderCurrentMatches: () => uiRenderCurrentMatches(context),
            openCurrentMatchEditModal: (id) => openCurrentMatchEditModal(id),
            renderEloChart: (ctx) => uiRenderEloChart(ctx),
            updatePlayerSelect: (ctx) => uiUpdatePlayerSelect(ctx),
            renderPlayerTrend: (ctx) => uiRenderPlayerTrend(ctx),
            openEditModal: (id) => openHistoryEditModal(id),
            deleteHistory: (id) => deleteHistory(id),
            updateUI: () => updateUI()
        }
    };

    uiUpdateAdminUI(context);
    uiRenderSessionStatus(context);
    uiUpdateApplyButtonState(context);
    uiRenderApplicants(context);
    uiRenderCurrentMatches(context);
    uiRenderHistory(context);
    uiRenderRanking(context);
    uiUpdateStatistics(context);
    uiRenderAnalystReport(context);
    uiRenderVideoGallery(context);

    // [v62] 현재 활성화된 탭의 렌더링 함수를 트리거 (수정된 탭 구조 대응)
    const activeTabObj = document.querySelector('.tab-content.active');
    if (activeTabObj) {
        const activeTabId = activeTabObj.id.replace('tab-', '');
        uiSwitchTab(activeTabId, context);
    }
}

function recalculateAll() {
    engineRecalculateAll({ 
        members, 
        matchHistory, 
        rankMap, 
        sessionRankSnapshots, 
        sessionStartRatings, 
        sessionEndRatings,
        applicants,
        currentSchedule
    });
}
window.removeApplicant = (id) => {
    applicants = applicants.filter(p => String(p.id) !== String(id));
    fbSaveToCloud({ applicants }, 'removeApplicant');
    
    // [v45] 인원 변동 시 커스텀 분할 고정 해제 및 미리보기 리셋
    const customInput = document.getElementById('customSplitInput');
    if (customInput) customInput.value = '';
    previewGroups = null;
    
    updateUI();
};
window.updateLiveScore = (id, team, val) => {
    const score = parseInt(val);
    const m = currentSchedule.find(x => x.id === id);
    if (!m) return;
    if (team === 1) m.s1 = isNaN(score) ? null : score;
    else m.s2 = isNaN(score) ? null : score;

    // 점수가 둘 다 입력되면 저장 버튼 노출 (CSS 클래스 제어)
    const card = document.querySelector(`.match-card[data-match-id="${id}"]`);
    if (card) {
        const btn = card.querySelector('.save-score-btn');
        if (m.s1 !== null && m.s2 !== null) btn.style.display = 'block';
        else btn.style.display = 'none';
    }
};
window.saveMatchScore = async (id) => {
    const m = currentSchedule.find(x => x.id === id);
    if (!m || m.s1 === null || m.s2 === null) return;
    await fbSaveMatchScoreWithTransaction(id, m.s1, m.s2);
    // UI 업데이트는 Snapshot Listener에 의해 자동 수행됨
};

// --- 대진표 생성 및 관리 ---
function generateSchedule() {
    if (!isAdmin) return;
    const sessionNumInput = document.getElementById('nextSessionNum')?.value;
    const customSplitInput = document.getElementById('customSplitInput')?.value;

    const locationKey = getLocationKeyFromInfo(document.getElementById('sessionInfoSelect')?.value || "");

    const context = {
        isAdmin, currentSessionState, sessionNumInput, customSplitInput,
        applicants, previewGroups, rankMap, members,
        courtConfigs: systemSettings.courtConfigs || null,
        locationKey: locationKey,
        maxGamesPerPlayer: parseInt(document.getElementById('maxGamesPerPlayerInput')?.value) || 4
    };

    const result = engineGenerateSchedule(context);
    if (result) {
        tempSchedule = result.tempSchedule;
        activeGroupTab = result.activeGroupTab;
        
        // [v50] 대진표가 생성되지 않은 경우 (인원 부족 등) 알림 추가
        if (!tempSchedule || tempSchedule.length === 0) {
            alert("대진표를 생성할 수 없습니다. 인원 배분이나 참가자 수를 확인해 주세요.");
            const finalizeBtn = document.getElementById('finalizeScheduleBtn');
            if (finalizeBtn) finalizeBtn.style.display = 'none';
            return;
        }

        uiRenderSchedulePreview({ gameCounts: result.gameCounts, applicants, rankMap });

        const finalizeBtn = document.getElementById('finalizeScheduleBtn');
        if (finalizeBtn) finalizeBtn.style.display = 'block';
    }
}

async function finalizeSchedule() {
    if (!tempSchedule || tempSchedule.length === 0) {
        window.alert("확정할 대진표 데이터가 없습니다. 먼저 대진표를 생성해 주세요.");
        return;
    }
    
    // 관리자 권한 최종 확인
    const savedPw = localStorage.getItem('ace_admin_pw');
    const effectiveIsAdmin = isAdmin || (savedPw === systemSettings.admin_pw);
    if (!effectiveIsAdmin) {
        window.alert("관리자 권한이 없습니다. 다시 로그인해 주세요.");
        return;
    }
    
    if (!window.confirm("대진표를 확정하고 랭킹전을 시작하시겠습니까?")) return;

    try {
        const sessionNum = tempSchedule[0].sessionNum;
        const infoSelect = document.getElementById('sessionInfoSelect')?.value || "";
        const manualInput = document.getElementById('manualSessionInfo')?.value || "";
        const info = (infoSelect === 'manual' ? manualInput : infoSelect) || currentSessionState.info || "";
        const matchMode = currentSessionState.matchMode || 'court';

        await fbSaveToCloud({ currentSchedule: tempSchedule }, 'finalizeSchedule');
        await fbSaveSessionState('playing', sessionNum, info, matchMode);

        // 상탯값 초기화
        tempSchedule = null;
        previewGroups = null;
        
        const area = document.getElementById('schedulePreviewArea');
        if (area) area.style.display = 'none';
        
        // 확정 성공 시 대진표 탭으로 자동 이동 및 알림
        if (window.switchTab) window.switchTab('match');
        window.alert("대진표가 성공적으로 확정되었습니다!");
        
    } catch (e) {
        console.error("Finalize Schedule Error:", e);
        window.alert("대진표 확정 중 오류가 발생했습니다: " + e.message);
    }
}

async function cancelSchedule() {
    if (!isAdmin) return;
    if (!confirm("현재 진행 중인 대진표를 초기화하시겠습니까? (입력된 점수가 모두 사라집니다)")) return;

    await fbSaveToCloud({ currentSchedule: [] }, 'cancelSchedule');
    await fbSaveSessionState('recruiting', currentSessionState.sessionNum, currentSessionState.info, currentSessionState.matchMode);
}

// --- 회원 관리 ---
function addPlayer() {
    const input = document.getElementById('playerName');
    const name = input.value.trim();
    if (!name) return;

    // 이미 신청했는지 확인
    if (applicants.some(a => a.name === name)) {
        alert("이미 신청된 선수입니다.");
        return;
    }

    // 회원 리스트에서 찾기
    const member = members.find(m => m.name === name);
    const newPlayer = member ? { ...member } : { id: Date.now().toString(), name: name, rating: ELO_INITIAL };

    applicants.push(newPlayer);
    
    // [v45] 인원 변동 시 커스텀 분할 고정 해제 및 미리보기 리셋
    const customInput = document.getElementById('customSplitInput');
    if (customInput) customInput.value = '';
    previewGroups = null; // 인원 변경 시 프리뷰 초기화

    fbSaveToCloud({ applicants }, 'addPlayer');
    input.value = '';
    input.focus();
}

// --- 세션 종료 (Commit) ---
async function commitSession() {
    if (!isAdmin) return;
    if (!confirm("모든 경기가 완료되었습니다. 결과를 확정하고 랭킹에 반영하시겠습니까?")) return;

    // 현재 스케줄의 모든 경기를 히스토리에 추가
    for (const m of currentSchedule) {
        const historyItem = {
            id: Date.now() + Math.random(),
            sessionNum: m.sessionNum,
            date: new Date().toLocaleDateString(),
            t1_ids: m.t1.map(p => p.id),
            t1_names: m.t1.map(p => p.name),
            t2_ids: m.t2.map(p => p.id),
            t2_names: m.t2.map(p => p.name),
            score1: m.s1,
            score2: m.s2,
            group: m.group, // [v26] 조별 정렬을 위해 그룹 정보 명시적 저장
            groupRound: m.groupRound || 0 // [v30] 라운드 정보 명시적 저장
        };
        await fbAddHistoryItem(historyItem);
    }

    // [v41] 신규 회원 자동 등재: members에 없는 참가자를 자동 저장
    const currentMemberIds = new Set(members.map(m => String(m.id)));
    let addedAny = false;
    currentSchedule.forEach(m => {
        [...m.t1, ...m.t2].forEach(p => {
            if (p.id && !currentMemberIds.has(String(p.id))) {
                members.push({ ...p, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0 });
                currentMemberIds.add(String(p.id));
                addedAny = true;
            }
        });
    });
    if (addedAny) {
        await fbSaveToCloud({ members }, 'commitSession:autoMember');
    }

    // 상태 초기화
    await fbSaveToCloud({ currentSchedule: [], applicants: [] }, 'commitSession');
    await fbSaveSessionState('idle', currentSessionState.sessionNum, "", currentSessionState.matchMode);
    alert("결과가 성공적으로 반영되었습니다.");
}

async function openRegistration() {
    if (!isAdmin) return;
    const sessionNum = document.getElementById('nextSessionNum')?.value;
    if (!sessionNum) { alert("회차를 입력해주세요."); return; }

    // [v44] 회차 오픈 시 현재 선택된 장소/시간 정보를 즉시 반영
    const sessionInfoSelect = document.getElementById('sessionInfoSelect');
    const manualInput = document.getElementById('manualSessionInfo');
    let info = '';
    if (sessionInfoSelect?.value === 'manual') {
        info = manualInput?.value || '';
    } else {
        info = sessionInfoSelect?.value || '';
    }
    await fbSaveSessionState('recruiting', sessionNum, info, currentSessionState.matchMode || 'court');
}

// --- AI 리포트 생성 (v23 핵심: 서사 및 템플릿 고착화) ---
// --- AI 리포트 생성 (v24 및 Advanced Analytics 대응) ---
async function handleCopyAIData() {
    const sessionNum = document.getElementById('reportPostSessionNum')?.value || currentSessionState.sessionNum;
    if (!sessionNum) return;

    const sessionMatches = matchHistory.filter(h => String(h.sessionNum) === String(sessionNum));
    if (sessionMatches.length === 0) {
        alert("해당 회차의 경기 기록이 없습니다.");
        return;
    }

    // --- 1. 해당 회차 성적 및 경기 리스트 집계 ---
    const todayPerformance = {};
    const matchesJson = sessionMatches.map(m => {
        const scoreA = m.score1;
        const scoreB = m.score2;
        let result = "draw";
        if (scoreA > scoreB) result = "A";
        else if (scoreB > scoreA) result = "B";

        return {
            match_id: m.id,
            team_a: m.t1_names,
            team_b: m.t2_names,
            score_a: scoreA,
            score_b: scoreB,
            result: result
        };
    });

    sessionMatches.forEach(m => {
        const pids = [...m.t1_ids, ...m.t2_ids];
        pids.forEach((id, idx) => {
            if (!todayPerformance[id]) {
                const name = idx < 2 ? m.t1_names[idx] : m.t2_names[idx - 2];
                todayPerformance[id] = {
                    name,
                    wins: 0, draws: 0, losses: 0,
                    ratingChange: 0,
                    trend: [],
                    participationStatus: 'New',
                    scoreDiffSum: 0
                };
            }
            const isT1 = m.t1_ids.includes(id);
            const win = isT1 ? (m.score1 > m.score2) : (m.score2 > m.score1);
            const draw = (m.score1 === m.score2);
            if (win) todayPerformance[id].wins++;
            else if (draw) todayPerformance[id].draws++;
            else todayPerformance[id].losses++;
            
            todayPerformance[id].ratingChange += isT1 ? (m.elo_at_match?.change1 || 0) : (m.elo_at_match?.change2 || 0);
            todayPerformance[id].scoreDiffSum += isT1 ? (m.score1 - m.score2) : (m.score2 - m.score1);
        });
    });

    // --- 2. 시즌 누적 데이터 및 출석 분석 ---
    const allSessions = [...new Set(matchHistory.map(h => String(h.sessionNum)))].sort((a, b) => parseInt(a) - parseInt(b));
    const totalSessionsCount = allSessions.length;
    const playerStatsMap = {};

    // 시간 순으로 전체 히스토리 정렬 (연승 계산용)
    const sortedHistory = [...matchHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    sortedHistory.forEach(m => {
        const pids = [...m.t1_ids, ...m.t2_ids];
        pids.forEach((id) => {
            const sid = String(id);
            if (!playerStatsMap[sid]) {
                playerStatsMap[sid] = {
                    total_wins: 0, total_draws: 0, total_losses: 0,
                    max_rating: -Infinity, min_rating: Infinity,
                    sessions: new Set(),
                    consecutive_wins: 0, consecutive_losses: 0
                };
            }
            const stats = playerStatsMap[sid];
            const isT1 = m.t1_ids.map(String).includes(sid);
            const win = isT1 ? (m.score1 > m.score2) : (m.score2 > m.score1);
            const draw = (m.score1 === m.score2);
            const loss = !win && !draw;

            if (win) stats.total_wins++;
            else if (draw) stats.total_draws++;
            else stats.total_losses++;

            stats.sessions.add(String(m.sessionNum));

            if (m.elo_at_match) {
                const rBefore = isT1 ? m.elo_at_match.t1_before : m.elo_at_match.t2_before;
                const rAfter = rBefore + (isT1 ? m.elo_at_match.change1 : m.elo_at_match.change2);
                stats.max_rating = Math.max(stats.max_rating, rBefore, rAfter);
                stats.min_rating = Math.min(stats.min_rating, rBefore, rAfter);
            }

            if (win) { stats.consecutive_wins++; stats.consecutive_losses = 0; }
            else if (loss) { stats.consecutive_losses++; stats.consecutive_wins = 0; }
            else { stats.consecutive_wins = 0; stats.consecutive_losses = 0; }
        });
    });

    // --- 3. 데이터 결합 및 최종 구성 ---
    const targetIdx = allSessions.indexOf(String(sessionNum));
    const recentSessions = allSessions.slice(Math.max(0, targetIdx - 4), targetIdx + 1);
    const prevSessionId = targetIdx > 0 ? allSessions[targetIdx - 1] : null;

    Object.keys(todayPerformance).forEach(pid => {
        const s = playerStatsMap[pid];
        const totalPlayed = s.total_wins + s.total_draws + s.total_losses;
        
        todayPerformance[pid].season_stats = {
            total_wins: s.total_wins,
            total_draws: s.total_draws,
            total_losses: s.total_losses,
            win_rate: totalPlayed > 0 ? parseFloat((s.total_wins / totalPlayed).toFixed(2)) : 0,
            max_rating: s.max_rating === -Infinity ? 1500 : Math.round(s.max_rating),
            min_rating: s.min_rating === Infinity ? 1500 : Math.round(s.min_rating),
            rating_volatility: (s.max_rating !== -Infinity && s.min_rating !== Infinity) ? Math.round(s.max_rating - s.min_rating) : 0,
            consecutive_wins: s.consecutive_wins,
            consecutive_losses: s.consecutive_losses,
            attendance_rate: parseFloat((s.sessions.size / totalSessionsCount).toFixed(2))
        };

        // 추세 분석 (최근 5회차)
        let participatedBeforeInWindow = false;
        let participatedInPrev = false;

        recentSessions.forEach(sId => {
            const endRating = (sessionEndRatings[sId] && sessionEndRatings[sId][pid]) || null;
            const hasMatchRecord = matchHistory.some(h =>
                String(h.sessionNum) === String(sId) &&
                (h.t1_ids.map(String).includes(String(pid)) || h.t2_ids.map(String).includes(String(pid)))
            );

            if (endRating !== null || hasMatchRecord) {
                todayPerformance[pid].trend.push({
                    session: sId,
                    rating: endRating !== null ? Math.round(endRating) : 1500,
                    played: hasMatchRecord
                });

                if (sId !== String(sessionNum) && hasMatchRecord) participatedBeforeInWindow = true;
                if (sId === String(prevSessionId) && hasMatchRecord) participatedInPrev = true;
            }
        });

        // 출석 상태 판별 개선: 최근 5회차 뿐만 아니라 전체 히스토리 참조
        const totalSessionsParticipated = s.sessions.size;
        if (totalSessionsParticipated === 1) {
            todayPerformance[pid].participationStatus = 'New (데뷔)';
        } else if (!participatedInPrev) {
            todayPerformance[pid].participationStatus = 'Returning (복귀)';
        } else {
            todayPerformance[pid].participationStatus = 'Steady (터줏대감)';
        }
    });

    const upsets = [];
    const groupStats = {};
    sessionMatches.forEach(m => {
        if (m.elo_at_match) {
            const { expected } = m.elo_at_match;
            const t1_won = m.score1 > m.score2;
            const t2_won = m.score2 > m.score1;
            if ((t1_won && expected < 0.45) || (t2_won && expected > 0.55)) {
                upsets.push({
                    matchId: m.id, group: m.group,
                    winner: t1_won ? m.t1_names : m.t2_names,
                    loser: t1_won ? m.t2_names : m.t1_names,
                    score: `${m.score1}:${m.score2}`,
                    expectedWinRate: t1_won ? Math.round(expected * 100) : Math.round((1 - expected) * 100)
                });
            }
        }
        const gLabel = m.group || 'Unknown';
        if (!groupStats[gLabel]) groupStats[gLabel] = { totalMatches: 0, totalScores: 0 };
        groupStats[gLabel].totalMatches++;
        groupStats[gLabel].totalScores += (m.score1 + m.score2);
    });

    const reportData = {
        sessionNum: sessionNum,
        totalMatches: sessionMatches.length,
        matches: matchesJson,
        performance: Object.values(todayPerformance).map(p => {
            const playedCount = p.trend.filter(t => t.played).length;
            return {
                ...p,
                avgScoreDiff: playedCount > 0 ? parseFloat((p.scoreDiffSum / playedCount).toFixed(1)) : 0
            };
        }),
        upsets: upsets,
        groupStats: groupStats,
        topRankers: members.sort((a, b) => b.rating - a.rating).slice(0, 5).map(m => ({ name: m.name, rating: Math.round(m.rating) }))
    };

    try {
        await navigator.clipboard.writeText(JSON.stringify(reportData, null, 2));
        alert("분석용 통합 데이터(JSON)가 클립보드에 복사되었습니다!\n상세 대진 정보와 시즌 누적 통계가 포함되었습니다.");
    } catch (err) {
        console.error("Clipboard Error:", err);
        alert("클립보드 복사에 실패했습니다.");
    }
}

async function handleSaveReport() {
    const sessionNum = document.getElementById('reportPostSessionNum')?.value;
    const content = document.getElementById('reportPostContent')?.value;
    if (!sessionNum || !content) {
        alert("회차와 내용을 모두 입력해주세요.");
        return;
    }
    await fbSaveReport(sessionNum, content);
    document.getElementById('reportPostContent').value = '';
    alert("리포트가 저장되었습니다.");
}

// --- 관리자/모달 로직 (생략된 기타 함수들) ---
async function checkAdminLogin() {
    // [v63] 기기 기반 자동 로그인 기능을 제거합니다.
    isAdmin = false;
    localStorage.removeItem('ace_admin_pw');
    updateUI();
}

function openAdminModal() {
    if (isAdmin) {
        if (confirm("로그아웃 하시겠습니까?")) {
            isAdmin = false;
            localStorage.removeItem('ace_admin_pw');
            updateUI();
        }
    } else {
        const modal = document.getElementById('adminModal');
        const status = document.getElementById('adminLoginStatus');
        const pwInput = document.getElementById('adminPassword');
        if (status) status.innerText = '';
        if (pwInput) pwInput.value = '';
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        if (pwInput) setTimeout(() => pwInput.focus(), 100);
    }
}

function tryAdminLogin() {
    const pwInput = document.getElementById('adminPassword');
    const status = document.getElementById('adminLoginStatus');
    const pw = pwInput ? pwInput.value.trim() : '';

    if (pw === systemSettings.admin_pw) {
        isAdmin = true;
        // [v63] 보안을 위해 브라우저 저장소의 비밀번호를 영구 보관하지 않습니다.
        localStorage.removeItem('ace_admin_pw'); 
        const modal = document.getElementById('adminModal');
        modal.classList.add('hidden');
        modal.style.display = 'none';
        if (pwInput) pwInput.value = '';
        if (status) status.innerText = '';
        updateUI();
    } else {
        if (status) {
            status.innerText = "비밀번호가 올바르지 않습니다.";
            status.style.color = "#ef4444";
        }
        if (pwInput) {
            pwInput.select(); // 틀렸을 때 바로 수정할 수 있게 선택 상태로 만듦
        }
    }
}

// --- 영상 및 기타 핸들러 ---
async function handleAddVideo() {
    const url = document.getElementById('videoUrlInput')?.value;
    const title = document.getElementById('videoTitleInput')?.value;
    const summary = document.getElementById('videoSummaryInput')?.value;

    if (!url || !title) { alert("URL과 제목을 입력해주세요."); return; }

    await fbAddVideo({ url, title, summary, timestamp: Date.now() });
    const modal = document.getElementById('videoModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
    // 입력 필드 초기화
    document.getElementById('videoUrlInput').value = '';
    document.getElementById('videoTitleInput').value = '';
    document.getElementById('videoSummaryInput').value = '';
}

async function handleRestoreCsv() {
    const fileInput = document.getElementById('restoreCsvFile');
    const file = fileInput?.files[0];
    if (!file) { alert("파일을 선택해주세요."); return; }

    if (!confirm("데이터를 복구하시겠습니까? 기존 데이터가 덮어씌워질 수 있습니다.")) return;

    // csv 복구 로직은 firebase-api 또는 별도 유틸 필요 (보통 예시만 작성)
    alert("CSV 복구 기능은 현재 지원 준비 중입니다.");
}

// 모달/수정 관련
// 히스토리(경기별 기록) 수정 모달 열기
window.openHistoryEditModal = (id) => {
    editingMatchId = id;
    modalMode = 'history';

    if (!matchHistory || matchHistory.length === 0) {
        alert("경기 기록 데이터를 불러올 수 없습니다.");
        return;
    }

    const match = matchHistory.find(m => String(m.id) === String(id));
    if (!match) {
        alert("해당 경기 정보를 찾을 수 없습니다.");
        return;
    }

    uiRenderHistoryEditModal(match);
};

window.deleteHistoryItem = async (id) => {
    if (!confirm("정말 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다)")) return;
    await fbDeleteHistoryItem(id);
};

window.deleteVideo = async (id) => {
    if (!confirm("영상을 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다)")) return;
    await fbDeleteVideo(id);
};

function openCurrentMatchEditModal(id) {
    editingMatchId = id;
    modalMode = 'current';
    const match = currentSchedule.find(m => String(m.id) === String(id));
    if (!match) {
        alert("현재 경기 정보를 찾을 수 없습니다.");
        return;
    }

    uiRenderCurrentMatchEditModal(match);
}

async function saveEdit() {
    console.log("[App] saveEdit called. Mode:", modalMode, "ID:", editingMatchId);
    if (!editingMatchId) return;

    // 이름 변경에 따른 ID 해결 유틸리티
    const resolvePlayer = (newName, oldId) => {
        const name = newName.trim();
        if (!name) return { id: oldId, name: "Unknown" };

        const existing = members.find(m => m.name === name);
        if (existing) return { id: existing.id, name: existing.name };

        const member = members.find(m => String(m.id) === String(oldId));
        if (member) {
            member.name = name;
            return { id: member.id, name: name };
        }

        const newId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const newM = { id: newId, name: name, rating: ELO_INITIAL, matchCount: 0, wins: 0, losses: 0, draws: 0, scoreDiff: 0 };
        members.push(newM);
        return { id: newId, name: name };
    };

    try {
        let membersUpdated = false;

        if (modalMode === 'history') {
            const hMatch = matchHistory.find(m => String(m.id) === String(editingMatchId));
            if (!hMatch) throw new Error("History Match not found");

            const n1 = document.getElementById('editHistName1').value.trim();
            const n2 = document.getElementById('editHistName2').value.trim();
            const n3 = document.getElementById('editHistName3').value.trim();
            const n4 = document.getElementById('editHistName4').value.trim();
            const s1 = parseInt(document.getElementById('editHistScore1').value);
            const s2 = parseInt(document.getElementById('editHistScore2').value);

            // 선수별 이름-ID 동기화
            const p1 = resolvePlayer(n1, hMatch.t1_ids[0]);
            const p2 = resolvePlayer(n2, hMatch.t1_ids[1]);
            const p3 = resolvePlayer(n3, hMatch.t2_ids[0]);
            const p4 = resolvePlayer(n4, hMatch.t2_ids[1]);

            console.log(`[App] Saving History Edit with ID Sync:`, { p1, p2, p3, p4, s1, s2 });
            
            await fbUpdateHistoryItem(editingMatchId, { 
                t1_ids: [p1.id, p2.id],
                t1_names: [p1.name, p2.name],
                t2_ids: [p3.id, p4.id],
                t2_names: [p3.name, p4.name],
                score1: s1, 
                score2: s2 
            });
            membersUpdated = true;
            alert("히스토리 기록이 수정되었습니다. 선수 명단 및 랭킹이 재계산됩니다.");

        } else if (modalMode === 'current') {
            const match = currentSchedule.find(m => String(m.id) === String(editingMatchId));
            if (!match) throw new Error("Current Match not found");

            const n1 = document.getElementById('editName1').value.trim();
            const n2 = document.getElementById('editName2').value.trim();
            const n3 = document.getElementById('editName3').value.trim();
            const n4 = document.getElementById('editName4').value.trim();

            const p1 = resolvePlayer(n1, match.t1[0].id);
            const p2 = resolvePlayer(n2, match.t1[1].id);
            const p3 = resolvePlayer(n3, match.t2[0].id);
            const p4 = resolvePlayer(n4, match.t2[1].id);

            match.t1[0] = p1;
            match.t1[1] = p2;
            match.t2[0] = p3;
            match.t2[1] = p4;

            await fbSaveToCloud({ currentSchedule: currentSchedule }, 'updateMatchNamesExtended');
            membersUpdated = true;
            alert("현재 대진표의 선수 및 명칭이 수정되었습니다.");
        }

        // 회원 정보가 변경(이름 수정 또는 신규 추가)되었다면 클라우드에 전체 저장
        if (membersUpdated) {
            await fbSaveToCloud({ members }, 'syncMembersAfterEdit');
        }

        closeEditModal();
        recalculateAll(); // 로컬 캐시 즉시 갱신
        updateUI();
    } catch (e) {
        console.error("Save Edit Error:", e);
        alert("수정 중 오류가 발생했습니다: " + e.message);
    }
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
    editingMatchId = null;
    modalMode = '';
}

// --- [v65] 코트 설정 관리 ---

/** 장소 키를 세션 정보 문자열에서 추출 ('중앙공원' 또는 'CS') */
function getLocationKeyFromInfo(info) {
    if (!info) return null;
    if (info.includes('중앙공원')) return '중앙공원';
    if (info.includes('CS')) return 'CS';
    if (info === 'manual') return 'manual';
    return null;
}

/** 기본 코트 설정 (Firebase에 아직 저장된 설정이 없을 때 사용) */
const DEFAULT_COURT_CONFIGS = {
    '중앙공원': {
        courts: [
            { name: '코트 1', maxRounds: 5 },
            { name: '코트 2', maxRounds: 5 },
            { name: '코트 3', maxRounds: 7 }
        ],
        maxGamesPerPlayer: 4
    },
    'CS': {
        courts: [
            { name: '코트 4', maxRounds: 7 },
            { name: '코트 3', maxRounds: 7 },
            { name: '코트 2', maxRounds: 5 }
        ],
        maxGamesPerPlayer: 4
    },
    'manual': {
        courts: [
            { name: '코트 1', maxRounds: 5 },
            { name: '코트 2', maxRounds: 5 },
            { name: '코트 3', maxRounds: 5 }
        ],
        maxGamesPerPlayer: 4
    }
};

/** 코트 설정 패널 렌더링 */
function renderCourtConfigPanel() {
    const panel = document.getElementById('courtConfigPanel');
    const infoSelect = document.getElementById('sessionInfoSelect');
    if (!panel || !infoSelect) return;

    const info = infoSelect.value;
    const locationKey = getLocationKeyFromInfo(info);

    if (!locationKey || !isAdmin) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';

    // Firebase에 저장된 설정 우선, 없으면 기본값
    const configs = systemSettings.courtConfigs || DEFAULT_COURT_CONFIGS;
    const config = configs[locationKey] || DEFAULT_COURT_CONFIGS[locationKey] || { courts: [], maxGamesPerPlayer: 4 };

    // 인당 최대 게임 수 설정
    const maxGamesInput = document.getElementById('maxGamesPerPlayerInput');
    if (maxGamesInput) maxGamesInput.value = config.maxGamesPerPlayer || 4;

    // 코트 목록 렌더링
    const list = document.getElementById('courtConfigList');
    if (!list) return;
    list.innerHTML = '';

    config.courts.forEach((court, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
        row.innerHTML = `
            <input type="text" class="court-name-input" value="${court.name}" 
                style="flex: 2; font-size: 0.85rem; padding: 6px;" placeholder="코트 이름">
            <input type="number" class="court-rounds-input" value="${court.maxRounds}" min="1" max="10"
                style="width: 55px; text-align: center; font-size: 0.85rem; padding: 6px;" placeholder="R">
            <span style="font-size: 0.75rem; color: var(--text-secondary);">라운드</span>
            <button class="secondary remove-court-btn" data-idx="${idx}" 
                style="padding: 4px 8px; font-size: 0.75rem; color: var(--danger); border-color: var(--danger);">✕</button>
        `;
        list.appendChild(row);
    });

    // 삭제 버튼 이벤트
    list.querySelectorAll('.remove-court-btn').forEach(btn => {
        btn.onclick = () => {
            btn.closest('div').remove();
        };
    });
}

/** 코트 행 추가 */
function addCourtRow() {
    const list = document.getElementById('courtConfigList');
    if (!list) return;

    const idx = list.children.length;
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    row.innerHTML = `
        <input type="text" class="court-name-input" value="코트 ${idx + 1}" 
            style="flex: 2; font-size: 0.85rem; padding: 6px;" placeholder="코트 이름">
        <input type="number" class="court-rounds-input" value="5" min="1" max="10"
            style="width: 55px; text-align: center; font-size: 0.85rem; padding: 6px;" placeholder="R">
        <span style="font-size: 0.75rem; color: var(--text-secondary);">라운드</span>
        <button class="secondary remove-court-btn" 
            style="padding: 4px 8px; font-size: 0.75rem; color: var(--danger); border-color: var(--danger);">✕</button>
    `;
    list.appendChild(row);

    row.querySelector('.remove-court-btn').onclick = () => row.remove();
}

/** 코트 설정을 UI에서 읽어 Firebase에 저장 */
async function saveCourtConfigFromUI() {
    const infoSelect = document.getElementById('sessionInfoSelect');
    if (!infoSelect) return;

    const locationKey = getLocationKeyFromInfo(infoSelect.value);
    if (!locationKey) {
        alert('장소를 먼저 선택해 주세요.');
        return;
    }

    const list = document.getElementById('courtConfigList');
    const nameInputs = list.querySelectorAll('.court-name-input');
    const roundsInputs = list.querySelectorAll('.court-rounds-input');
    const maxGames = parseInt(document.getElementById('maxGamesPerPlayerInput')?.value) || 4;

    const courts = [];
    nameInputs.forEach((input, i) => {
        const name = input.value.trim();
        const maxRounds = parseInt(roundsInputs[i]?.value) || 5;
        if (name) courts.push({ name, maxRounds });
    });

    if (courts.length === 0) {
        alert('최소 1개 이상의 코트를 설정해 주세요.');
        return;
    }

    // 기존 설정에 현재 장소 설정만 업데이트
    const configs = { ...(systemSettings.courtConfigs || DEFAULT_COURT_CONFIGS) };
    configs[locationKey] = { courts, maxGamesPerPlayer: maxGames };

    try {
        await fbSaveCourtConfig(configs);
        alert(`'${locationKey}' 코트 설정이 저장되었습니다.`);
    } catch (e) {
        alert('코트 설정 저장 중 오류: ' + e.message);
    }
}

// 앱 시작
init();
