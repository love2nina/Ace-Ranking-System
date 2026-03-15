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
    fetchDbList,
    saveReport as fbSaveReport,
    saveMatchScoreWithTransaction as fbSaveMatchScoreWithTransaction,
    addHistoryItem as fbAddHistoryItem,
    deleteHistoryItem as fbDeleteHistoryItem,
    updateHistoryItem as fbUpdateHistoryItem
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
    renderStatsDashboard as uiRenderStatsDashboard,
    renderAnalystReport as uiRenderAnalystReport,
    renderVideoGallery as uiRenderVideoGallery,
    toggleHistoryContent as uiToggleHistoryContent,
    renderEloChart as uiRenderEloChart,
    updatePlayerSelect as uiUpdatePlayerSelect,
    renderPlayerTrend as uiRenderPlayerTrend
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

// --- 초기화 (Initialization) ---
async function init() {
    console.log("[App] System starting...");

    const callbacks = {
        onDataLoaded: (data) => {
            members = data.members || [];
            currentSchedule = data.currentSchedule || [];
            applicants = data.applicants || [];
            recalculateAll();
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

    initFirebase(callbacks);
    subscribeToVideos((videoList) => {
        videos = videoList;
        if (document.querySelector('.tab-content#tab-caster.active')) {
            window.renderVideoGallery();
        }
    });

    setupEventListeners();
    await checkAdminLogin();
}

// --- 윈도우 익스포트 (UI 제어용) ---
window.switchTab = (id) => uiSwitchTab(id, { actions: { renderStatsDashboard: () => uiRenderStatsDashboard({ members, matchHistory, actions: { /* ... */ } }) } });

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
    document.getElementById('dbModal').style.display = 'block';
    const select = document.getElementById('dbListSelect');
    const prevSelect = document.getElementById('prevDbSelect');
    if (select) {
        const dbs = await fetchDbList();
        const options = dbs.map(db => `<option value="${db}">${db}</option>`).join('');
        select.innerHTML = '<option value="">데이터베이스 선택...</option>' + options;
        if (prevSelect) prevSelect.innerHTML = '<option value="">이관할 이전 DB(시즌) 선택...</option>' + options;
    }
};
window.closeDbModal = () => {
    const modal = document.getElementById('dbModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.openHelpModal = () => {
    const modal = document.getElementById('helpModal');
    modal.classList.remove('hidden');
    modal.style.display = 'block';
};
window.closeHelpModal = () => {
    const modal = document.getElementById('helpModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.openVideoModal = () => {
    const modal = document.getElementById('videoModal');
    modal.classList.remove('hidden');
    modal.style.display = 'block';
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
    const tabs = ['report', 'video'];
    tabs.forEach(t => {
        const el = document.getElementById(`subtab-${t}`);
        const btn = document.getElementById(`subtab-${t}-btn`);
        if (el) el.style.display = (t === id) ? 'block' : 'none';
        if (btn) {
            btn.classList.toggle('active', t === id);
            btn.style.color = (t === id) ? 'var(--accent-color)' : 'var(--text-secondary)';
            btn.style.fontWeight = (t === id) ? 'bold' : 'normal';
        }
    });
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
window.renderAnalystReport = () => uiRenderAnalystReport({ reports, currentSessionState });
window.renderVideoGallery = () => uiRenderVideoGallery({ videos, isAdmin });
window.toggleLateJoin = (id) => {
    const player = applicants.find(p => String(p.id) === String(id));
    if (player) {
        player.lateJoin = !player.lateJoin;
        fbSaveToCloud({ applicants });
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
    if (finalizeScheduleBtn) finalizeScheduleBtn.onclick = () => finalizeSchedule();

    const regenerateBtn = document.getElementById('regenerateBtn');
    if (regenerateBtn) regenerateBtn.onclick = () => generateSchedule();

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
        };
    }

    const manualSessionInfoInput = document.getElementById('manualSessionInfo');
    if (manualSessionInfoInput) {
        manualSessionInfoInput.oninput = async () => {
            if (isAdmin && currentSessionState.status === 'recruiting' && sessionInfoSelect?.value === 'manual') {
                await fbSaveSessionState(currentSessionState.status, currentSessionState.sessionNum, manualSessionInfoInput.value, currentSessionState.matchMode);
            }
        };
    }
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
            setActiveGroupTab: (val) => { activeGroupTab = val; },
            renderCurrentMatches: () => uiRenderCurrentMatches(context),
            openCurrentMatchEditModal: (id) => openCurrentMatchEditModal(id),
            renderStatsDashboard: () => uiRenderStatsDashboard(context),
            renderEloChart: (ctx) => uiRenderEloChart(ctx),
            updatePlayerSelect: (ctx) => uiUpdatePlayerSelect(ctx),
            renderPlayerTrend: (ctx) => uiRenderPlayerTrend(ctx),
            openEditModal: (id) => openHistoryEditModal(id),
            deleteHistory: (id) => deleteHistory(id)
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
    uiRenderStatsDashboard(context);
    uiRenderAnalystReport(context);
    uiRenderVideoGallery(context);
}

function recalculateAll() {
    engineRecalculateAll({ members, matchHistory, rankMap, sessionRankSnapshots, sessionStartRatings, sessionEndRatings });
}
window.removeApplicant = (id) => {
    applicants = applicants.filter(p => String(p.id) !== String(id));
    fbSaveToCloud({ applicants });
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

    const context = {
        isAdmin, currentSessionState, sessionNumInput, customSplitInput,
        applicants, previewGroups, rankMap, members
    };

    const result = engineGenerateSchedule(context);
    if (result) {
        tempSchedule = result.tempSchedule;
        activeGroupTab = result.activeGroupTab;
        uiRenderSchedulePreview({ gameCounts: result.gameCounts, applicants });

        const finalizeBtn = document.getElementById('finalizeScheduleBtn');
        if (finalizeBtn) finalizeBtn.style.display = 'block';
    }
}

async function finalizeSchedule() {
    if (!tempSchedule || !isAdmin) return;
    if (!confirm("대진표를 확정하고 랭킹전을 시작하시겠습니까?")) return;

    const sessionNum = tempSchedule[0].sessionNum;
    const info = document.getElementById('manualSessionInfo')?.value || document.getElementById('sessionInfoSelect')?.value || "";
    const matchMode = currentSessionState.matchMode || 'court';

    await fbSaveToCloud({ currentSchedule: tempSchedule });
    await fbSaveSessionState('playing', sessionNum, info, matchMode);

    tempSchedule = null;
    const area = document.getElementById('schedulePreviewArea');
    if (area) area.style.display = 'none';
}

async function cancelSchedule() {
    if (!isAdmin) return;
    if (!confirm("현재 진행 중인 대진표를 초기화하시겠습니까? (입력된 점수가 모두 사라집니다)")) return;

    await fbSaveToCloud({ currentSchedule: [] });
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
    previewGroups = null; // 인원 변경 시 프리뷰 초기화

    fbSaveToCloud({ applicants });
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
            score2: m.s2
        };
        await fbAddHistoryItem(historyItem);
    }

    // 상태 초기화
    await fbSaveToCloud({ currentSchedule: [], applicants: [] });
    await fbSaveSessionState('idle', currentSessionState.sessionNum, "", currentSessionState.matchMode);
    alert("결과가 성공적으로 반영되었습니다.");
}

async function openRegistration() {
    if (!isAdmin) return;
    const sessionNum = document.getElementById('nextSessionNum')?.value;
    if (!sessionNum) { alert("회차를 입력해주세요."); return; }

    await fbSaveSessionState('recruiting', sessionNum, "", currentSessionState.matchMode || 'court');
}

// --- AI 리포트 생성 (v23 핵심: 서사 및 템플릿 고착화) ---
async function handleCopyAIData() {
    const sessionNum = document.getElementById('reportPostSessionNum')?.value || currentSessionState.sessionNum;
    if (!sessionNum) return;

    const sessionMatches = matchHistory.filter(h => String(h.sessionNum) === String(sessionNum));
    if (sessionMatches.length === 0) {
        alert("해당 회차의 경기 기록이 없습니다.");
        return;
    }

    // 1. 해당 회차 성적 집계
    const todayPerformance = {};
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
                    participationStatus: 'New' // 기본값
                };
            }
            const isT1 = m.t1_ids.includes(id);
            const win = isT1 ? (m.score1 > m.score2) : (m.score2 > m.score1);
            const draw = (m.score1 === m.score2);
            if (win) todayPerformance[id].wins++;
            else if (draw) todayPerformance[id].draws++;
            else todayPerformance[id].losses++;
            todayPerformance[id].ratingChange += isT1 ? (m.elo_at_match?.change1 || 0) : (m.elo_at_match?.change2 || 0);
        });
    });

    // 2. [v24 개선] 최근 5회차 데이터 기반 참가 상태 및 트렌드 분석 (실제 참여 여부 포함)
    const allSessions = [...new Set(matchHistory.map(h => String(h.sessionNum)))].sort((a, b) => parseInt(a) - parseInt(b));
    const targetIdx = allSessions.indexOf(String(sessionNum));
    const recentSessions = allSessions.slice(Math.max(0, targetIdx - 4), targetIdx + 1);
    const prevSessionId = targetIdx > 0 ? allSessions[targetIdx - 1] : null;

    Object.keys(todayPerformance).forEach(pid => {
        let participatedBeforeInWindow = false;
        let participatedInPrev = false;

        recentSessions.forEach(sId => {
            const endRating = (sessionEndRatings[sId] && sessionEndRatings[sId][pid]) || null;

            // [v24] 해당 회차에 실제 경기 기록이 있는지 확인
            const hasMatchRecord = matchHistory.some(h =>
                String(h.sessionNum) === String(sId) &&
                (h.t1_ids.includes(pid) || h.t2_ids.includes(pid))
            );

            if (endRating !== null || hasMatchRecord) {
                const displayRating = endRating !== null ? Math.round(endRating) : 1500;
                todayPerformance[pid].trend.push({
                    session: sId,
                    rating: displayRating,
                    played: hasMatchRecord // [v24] 실제 참여 여부
                });

                // 현재 회차 제외, 이전 회차들 중 참여 이력 확인
                if (sId !== String(sessionNum) && hasMatchRecord) {
                    participatedBeforeInWindow = true;
                }
                // 직전 회차 참여 여부
                if (sId === String(prevSessionId) && hasMatchRecord) {
                    participatedInPrev = true;
                }
            }
        });

        // 상태 판별 (v24 정밀화: played 플래그 기준)
        if (!participatedBeforeInWindow) {
            todayPerformance[pid].participationStatus = 'New (이번이 첫 데뷔이거나 아주 오랜만의 등장)';
        } else if (!participatedInPrev) {
            todayPerformance[pid].participationStatus = 'Returning (지난 회차는 쉬고 돌아온 복귀파)';
        } else {
            todayPerformance[pid].participationStatus = 'Steady (꾸준히 자리를 지키는 터줏대감)';
        }
    });

    // 3. AI 프롬프트 구성 (v24: 실제 참여 여부 기반 서사 보강)
    const reportData = {
        sessionNum: sessionNum,
        totalMatches: sessionMatches.length,
        performance: Object.values(todayPerformance),
        topRankers: members.sort((a, b) => b.rating - a.rating).slice(0, 5).map(m => ({ name: m.name, rating: Math.round(m.rating) }))
    };

    const prompt = `
당신은 '평촌ACE 전력분석실'의 수석 데이터 분석가입니다. 
제 ${sessionNum}회차 랭킹전 결과를 바탕으로 전문적이면서도 위트 있는 분석 리포트를 작성해 주세요.

[🚨 리포트 작성 핵심 지침]
1. **고정 템플릿 준수**: 아래 제공된 Markdown 템플릿 구조를 절대 변경하지 마세요.
2. **참가자 구분 및 서사 (Important)**: 
   - 데이터의 \`trend\` 내 \`played: false\`는 해당 회차에 이름은 있었으나 경기를 뛰지 않았음을 의미합니다 (단순 1500점 유지와 다름).
   - **데뷔 (New)**: 최근 데이터상 처음으로 경기를 뛴 선수에게는 "화려한 데뷔", "뉴페이스의 등장" 서사를 부여하세요.
   - **복귀 (Returning)**: 이전에 뛰었다가 최근 쉬고 돌아온 선수에게는 "환영받는 귀환" 서사를 부여하세요.
   - **꾸준함 (Steady)**: 연속으로 경기에 참여하며 기량을 갈고닦는 선수들을 부각하세요.
3. **그룹 서사 중심**: 3~4개의 그룹으로 묶어 그룹 전체의 분위기를 먼저 설명한 뒤, 그 안에서 핵심 인물의 서사를 디테일하게 분석하세요. (모든 참가자 이름 언급 필수)
4. **모바일 최적화**: 표(Table) 형식을 절대 사용하지 말고, 리스트와 강조(Bold)를 활용하세요.
5. **톤앤매너**: 데이터 기반의 예리한 분석 70% + 위트와 유머 30% (한글 사용 우선)

---
[분석 리포트 고정 템플릿]

# 📊 제 ${sessionNum}회차 전력분석 리포트

## 🎾 세션 총평
(이 회차의 전반적인 분위기와 주요 특징 요약)

## 👥 그룹별 상세 분석
### [그룹 명칭 1]
- **해당 멤버**: (전원 이름 나열)
- **주요 결과**: (성과가 돋보이는 인물 위주로 트렌드와 실제 경기 참여 여부를 반영하여 심층 분석)

### [그룹 명칭 2]
- **해당 멤버**: (전원 이름 나열)
- **주요 결과**: (분석 내용 작성)

...(필요에 따라 그룹 추가)

## 🔭 향후 전망
(데이터 기반의 다음 회차 예측 및 관전 포인트)
    `;

    try {
        await navigator.clipboard.writeText(JSON.stringify(reportData, null, 2) + "\n\n--- AI PROMPT ---\n" + prompt);
        alert("AI 분석용 데이터와 프롬프트가 클립보드에 복사되었습니다!\nChatGPT 등에 붙여넣어 리포트를 생성하세요.");
    } catch (err) {
        console.error("Clipboard Error:", err);
        alert("클립보드 복사에 실패했습니다. 콘솔을 확인하세요.");
        console.log("DATA:", reportData);
        console.log("PROMPT:", prompt);
    }
}

async function handleSaveReport() {
    const sessionNum = document.getElementById('reportPostSessionNum')?.value;
    const content = document.getElementById('reportContent')?.value;
    if (!sessionNum || !content) {
        alert("회차와 내용을 모두 입력해주세요.");
        return;
    }
    await fbSaveReport(sessionNum, content);
    document.getElementById('reportContent').value = '';
    alert("리포트가 저장되었습니다.");
}

// --- 관리자/모달 로직 (생략된 기타 함수들) ---
async function checkAdminLogin() {
    const savedPw = localStorage.getItem('ace_admin_pw');
    if (savedPw === systemSettings.admin_pw) {
        isAdmin = true;
        updateUI();
    }
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
        modal.classList.remove('hidden');
        modal.style.display = 'block';
    }
}

function tryAdminLogin() {
    const pw = document.getElementById('adminPassword').value;
    if (pw === systemSettings.admin_pw) {
        isAdmin = true;
        localStorage.setItem('ace_admin_pw', pw);
        const modal = document.getElementById('adminModal');
        modal.classList.add('hidden');
        modal.style.display = 'none';
        document.getElementById('adminPassword').value = '';
        updateUI();
    } else {
        alert("비밀번호가 올바르지 않습니다.");
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
function openHistoryEditModal(id) { alert("기능 준비 중입니다."); }
async function deleteHistory(id) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await fbDeleteHistoryItem(id);
}
function openCurrentMatchEditModal(id) { alert("이름 수정 기능은 현재 구현 중입니다."); }

// 앱 시작
init();
