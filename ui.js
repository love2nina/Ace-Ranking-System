import { calculateBadges, getPlayerInsights } from './statsService.js';

let eloChart = null;
let trendChart = null;

export function updateAdminUI(context) {
    const { isAdmin } = context;
    const status = document.getElementById('adminLoginBtn');
    const adminAreas = document.querySelectorAll('.admin-only');
    const guestAreas = document.querySelectorAll('.guest-only');

    if (isAdmin) {
        status.innerText = "로그아웃 (Admin)";
        status.classList.remove('secondary');
        status.classList.add('success');
        adminAreas.forEach(el => el.style.display = 'block');
        guestAreas.forEach(el => el.style.display = 'none');
        const exportBtn = document.getElementById('exportCsvBtn');
        if (exportBtn) exportBtn.style.display = 'block';
    } else {
        status.innerText = "관리자 로그인";
        status.classList.add('secondary');
        status.classList.remove('success');
        adminAreas.forEach(el => el.style.display = 'none');
        guestAreas.forEach(el => el.style.display = 'block');
    }
}

export function renderSessionStatus(context) {
    const { currentSessionState, isAdmin, matchHistory } = context;
    const banner = document.getElementById('roundStatusBanner');
    const form = document.getElementById('applicationForm');
    const adminPanel = document.getElementById('nextSessionNum')?.parentElement?.parentElement;

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

        if (isAdmin) {
            const nextSeq = (matchHistory.length > 0 ? Math.max(...matchHistory.map(h => parseInt(h.sessionNum) || 0)) : 0) + 1;
            const input = document.getElementById('nextSessionNum');
            if (input && !input.value) input.value = nextSeq;
        }
    }

    if (banner) {
        const infoHtml = currentSessionState.info ? `<div style="font-size:0.9rem; margin-top:5px; color:var(--accent-color);">${currentSessionState.info}</div>` : '';
        banner.innerHTML = `<h3 style="margin:0">${statusText}</h3>${infoHtml}`;
        banner.style.background = statusColor;
    }

    if (isAdmin) {
        const radios = document.querySelectorAll('input[name="matchMode"]');
        radios.forEach(r => {
            if (r.value === currentSessionState.matchMode) r.checked = true;
        });
    }

    if (adminPanel && isAdmin) {
        if (currentSessionState.status === 'playing') {
            adminPanel.style.display = 'none';
        } else {
            adminPanel.style.display = 'block';
        }
    }

    if (isAdmin) {
        if (currentSessionState.status === 'recruiting') {
            const infoSelect = document.getElementById('sessionInfoSelect');
            const manualInput = document.getElementById('manualSessionInfo');
            if (infoSelect) {
                const infoValue = currentSessionState.info || '';
                const options = Array.from(infoSelect.options).map(opt => opt.value);
                if (options.includes(infoValue)) {
                    infoSelect.value = infoValue;
                    if (manualInput) manualInput.style.display = 'none';
                } else if (infoValue) {
                    infoSelect.value = 'manual';
                    if (manualInput) {
                        manualInput.value = infoValue;
                        manualInput.style.display = 'inline-block';
                    }
                } else {
                    infoSelect.value = '';
                    if (manualInput) manualInput.style.display = 'none';
                }
            }
        }
    }

    const openBtn = document.getElementById('openRoundBtn');
    if (openBtn) {
        openBtn.disabled = (currentSessionState.status === 'recruiting');
        openBtn.innerText = currentSessionState.status === 'recruiting' ? "접수 진행 중" : "참가 접수 시작";
    }
}

export function updateApplyButtonState(context) {
    const { currentSessionState } = context;
    const btn = document.getElementById('addPlayerBtn');
    const input = document.getElementById('playerName');
    if (!btn || !input) return;

    const isPlaying = currentSessionState.status === 'playing';

    if (isPlaying) {
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

export function renderApplicants(context) {
    let { previewGroups } = context;
    const { currentSessionState, applicants, rankMap, isAdmin, getSplits, GAME_COUNTS, actions: { setPreviewGroups, updateSplitInputFromPreview, renderApplicants: selfRender, updateOptimizationInfo } } = context;

    const list = document.getElementById('playerList'); if (!list) return;
    list.innerHTML = '';
    const dashboard = document.getElementById('dashboard');

    if (currentSessionState.status === 'playing') {
        list.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-secondary);">
                <div style="font-size:3rem; margin-bottom:15px;">🎾</div>
                <h3 style="color:var(--accent-color); margin-bottom:10px;">현재 랭킹전이 진행 중입니다.</h3>
                <p style="font-size:0.9rem; opacity:0.8;">대진표 탭에서 경기 결과를 입력해 주세요.<br>대진표를 초기화하면 다시 명단 수정이 가능합니다.</p>
            </div>
        `;
        if (dashboard) dashboard.style.display = 'none';
        return;
    }

    const rankedApplicants = applicants.filter(a => rankMap.has(String(a.id))).sort((a, b) => {
        const rA = rankMap.get(String(a.id))?.rank || 9999;
        const rB = rankMap.get(String(b.id))?.rank || 9999;
        return rA - rB;
    });
    const newApplicants = applicants.filter(a => !rankMap.has(String(a.id)));
    const sortedApplicants = [...rankedApplicants, ...newApplicants];

    if (sortedApplicants.length < 4 || currentSessionState.matchMode === 'court') {
        setPreviewGroups(null);
        sortedApplicants.forEach(a => {
            const div = document.createElement('div'); div.className = 'player-tag';
            if (a.lateJoin) div.classList.add('late-join');
            const info = rankMap.get(String(a.id));
            const rankLabel = info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
            
            let lateBtn = '';
            if (isAdmin) {
                const isLate = a.lateJoin;
                const icon = isLate ? '⏰' : '🕒';
                const style = isLate ? 'color: var(--accent-color); font-weight: bold;' : 'opacity: 0.5; filter: grayscale(1);';
                lateBtn = ` <span style="cursor:pointer; margin-left:5px; font-size:1.1em; ${style}" onclick="event.stopPropagation(); window.toggleLateJoin('${a.id}')" title="눌러서 2라운드부터 참여(지각) 토글">${icon}</span>`;
            }
            
            div.innerHTML = `${a.name}${rankLabel}${lateBtn}${isAdmin ? ` <span class="remove-btn" onclick="event.stopPropagation(); removeApplicant('${a.id}')">×</span>` : ''}`;
            list.appendChild(div);
        });

        // [v34] 코트 모드여도 신청 인원이 충분하면 대진표 생성 버튼(Dashboard)을 보여줘야 함
        if (sortedApplicants.length >= 4) {
            updateOptimizationInfo(context);
        }
        return;
    }

    let split;
    const customInput = document.getElementById('customSplitInput');
    const customValue = customInput ? customInput.value.trim() : "";

    if (customValue) {
        split = customValue.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        const sum = split.reduce((a, b) => a + b, 0);
        if (sum !== sortedApplicants.length) split = getSplits(sortedApplicants.length);
    } else {
        split = getSplits(sortedApplicants.length);
    }

    if (!split || split.length === 0) { setPreviewGroups(null); return; }

    const totalInPreview = previewGroups ? previewGroups.reduce((s, g) => s + g.length, 0) : 0;
    // [v49] 공백 제거 후 비교하여 4,4 와 4, 4 차이로 인한 리셋 방지
    const currentStructure = previewGroups ? previewGroups.map(g => g.length).join(',') : '';
    const targetStructure = split.join(',');

    if (!previewGroups || totalInPreview !== sortedApplicants.length || currentStructure !== targetStructure) {
        previewGroups = [];
        let cur = 0;
        split.forEach(s => {
            previewGroups.push(sortedApplicants.slice(cur, cur + s));
            cur += s;
        });
        setPreviewGroups(previewGroups);
        context.previewGroups = previewGroups; // [v47] 드래그 얩 드롭 컨텍스트 참조 지속성 보장

        const saveBtn = document.getElementById('savePreviewBtn');
        if (saveBtn && !customValue) saveBtn.style.display = 'none';
        else if (saveBtn && customValue) saveBtn.style.display = 'block';
    } else {
        const appMap = new Map(sortedApplicants.map(a => [String(a.id), a]));
        previewGroups = previewGroups.map(group =>
            group.map(p => appMap.get(String(p.id)) || p).filter(p => appMap.has(String(p.id)))
        );
        setPreviewGroups(previewGroups);
        context.previewGroups = previewGroups; // [v47] 드래그 얩 드롭 컨텍스트 참조 지속성 보장

        const newTotal = previewGroups.reduce((s, g) => s + g.length, 0);
        if (newTotal !== sortedApplicants.length) {
            setPreviewGroups(null);
            selfRender(context);
            return;
        }
    }

    const container = document.createElement('div');
    container.className = 'group-preview-container';

    previewGroups.forEach((group, groupIdx) => {
        const groupLabel = String.fromCharCode(65 + groupIdx);
        const box = document.createElement('div');
        box.className = 'group-preview-box';
        box.dataset.groupIdx = groupIdx;

        if (isAdmin) {
            box.addEventListener('dragover', (e) => {
                e.preventDefault();
                box.classList.add('drag-over');
            });
            box.addEventListener('dragleave', () => {
                box.classList.remove('drag-over');
            });
            box.addEventListener('drop', (e) => {
                e.preventDefault();
                box.classList.remove('drag-over');
                const playerId = e.dataTransfer.getData('text/plain');
                const fromGroupIdx = parseInt(e.dataTransfer.getData('fromGroup'));
                const toGroupIdx = groupIdx;

                if (fromGroupIdx === toGroupIdx) return;

                const playerIdx = previewGroups[fromGroupIdx].findIndex(p => String(p.id) === playerId);
                if (playerIdx === -1) return;
                const [player] = previewGroups[fromGroupIdx].splice(playerIdx, 1);
                previewGroups[toGroupIdx].push(player);

                const saveBtn = document.getElementById('savePreviewBtn');
                if (saveBtn) saveBtn.style.display = 'block';

                setPreviewGroups(previewGroups);
                context.previewGroups = previewGroups; // [v47] 최신 조편성을 context에 업데이트하여 updateSplitInputFromPreview가 올바르게 작동하도록 함
                updateSplitInputFromPreview(context);
                
                // [v47] 브라우저 드래그 이벤트 루프 종료 후 DOM 업데이트를 수행하도록 지연
                setTimeout(() => {
                    if (context.actions?.updateUI) {
                        context.actions.updateUI();
                    }
                    updateOptimizationInfo(context);
                }, 10);
            });
        }

        const header = document.createElement('div');
        header.className = 'group-preview-header';
        const gameCount = GAME_COUNTS[group.length] || '?';
        header.innerHTML = `<span class="group-label">${groupLabel}조</span><span class="group-count">${group.length}명 · ${gameCount}경기</span>`;
        box.appendChild(header);

        const membersDiv = document.createElement('div');
        membersDiv.className = 'group-preview-members';

        group.forEach(a => {
            const tag = document.createElement('div');
            tag.className = 'player-tag' + (isAdmin ? ' draggable' : '');
            if (a.lateJoin) tag.classList.add('late-join');
            const info = rankMap.get(String(a.id));
            const rankLabel = info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
            
            let lateBtn = '';
            if (isAdmin) {
                const isLate = a.lateJoin;
                const icon = isLate ? '⏰' : '🕒';
                const style = isLate ? 'color: var(--accent-color); font-weight: bold;' : 'opacity: 0.5; filter: grayscale(1);';
                // [v44, v47] 지각 허용 상한 로직 (조별 모드 한정)
                let isDisabled = false;
                let disabledMsg = '';
                
                if (currentSessionState && currentSessionState.matchMode === 'group') {
                    const maxLate = Math.max(0, group.length - 4);
                    const currentLateCount = group.filter(p => p.lateJoin && String(p.id) !== String(a.id)).length;
                    
                    // [v6.5-UI] 4인 조에서도 지각자 표시 자체는 허용 (대기 조 배정을 위해)
                    // 다만 한 조에 4명이 참여할 수 없는 수준(지각자가 너무 많음)은 경고
                    if (!isLate && group.length - (currentLateCount + 1) < 0) {
                        isDisabled = true;
                        disabledMsg = '조 인원보다 지각자가 많을 수 없습니다.';
                    }
                }

                const clickHandler = isDisabled ? `alert('${disabledMsg}')` : `window.toggleLateJoin('${a.id}')`;
                const disabledStyle = isDisabled ? 'opacity: 0.2; cursor: not-allowed;' : 'cursor: pointer;';
                
                lateBtn = ` <span style="${disabledStyle} margin-left:5px; font-size:1.1em; ${isDisabled ? '' : style}" onclick="event.stopPropagation(); ${clickHandler}" title="${isDisabled ? disabledMsg : '눌러서 2라운드부터 참여(지각) 토글'}">${icon}</span>`;
            }

            tag.innerHTML = `${a.name}${rankLabel}${lateBtn}${isAdmin ? ` <span class="remove-btn" onclick="event.stopPropagation(); removeApplicant('${a.id}')">×</span>` : ''}`;

            if (isAdmin) {
                tag.draggable = true;
                tag.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', String(a.id));
                    e.dataTransfer.setData('fromGroup', String(groupIdx));
                    tag.classList.add('dragging');
                    setTimeout(() => tag.classList.add('dragging'), 0);
                });
                tag.addEventListener('dragend', () => {
                    tag.classList.remove('dragging');
                });
            }

            membersDiv.appendChild(tag);
        });

        box.appendChild(membersDiv);
        container.appendChild(box);
    });

    list.appendChild(container);

    const dashboardEl = document.getElementById('dashboard');
    if (dashboardEl) {
        updateOptimizationInfo(context);
    }
}

export function validateCustomSplit(context) {
    const { applicants, previewGroups, GAME_COUNTS, actions: { selfRender, setPreviewGroups } } = context;
    const input = document.getElementById('customSplitInput').value.trim();
    const status = document.getElementById('splitStatus');
    const btn = document.getElementById('generateScheduleBtn');

    if (!input) {
        if (status) status.innerText = "";
        btn.disabled = false;
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

        // [v47, v49] 사용성 개선: 입력 즉시 조편성을 자동 변경하되, 공백 차이로 인한 무한 루프 방지
        const currentPreviewSplit = previewGroups ? previewGroups.map(g => g.length).join(',') : '';
        const inputSplit = nums.join(',');

        if (currentPreviewSplit !== inputSplit) {
            console.log(`[UI] Split changed: ${currentPreviewSplit} -> ${inputSplit}. Resetting preview.`);
            if (context.actions?.setPreviewGroups) context.actions.setPreviewGroups(null);
            setTimeout(() => { if (context.actions?.updateUI) context.actions.updateUI(); }, 0);
        }

        const info = document.getElementById('optimizationInfo');
        if (info) info.innerHTML = `<div>현재 참여: ${applicants.length}명 | 커스텀: <strong>${nums.join(', ')}분할</strong></div><div style="margin-top:5px">총 경기: <span class="session-info" style="background:${totalGames <= 18 ? 'var(--success)' : 'var(--danger)'}; color:white">${totalGames}게임</span></div>`;
        return true;
    }
}

export function updateOptimizationInfo(context) {
    const { currentSessionState, applicants, previewGroups, GAME_COUNTS, getSplits } = context;
    const dash = document.getElementById('dashboard'); if (!dash) return;

    if (currentSessionState.status !== 'recruiting' || applicants.length < 4) {
        dash.style.display = 'none';
        return;
    }
    dash.style.display = 'block';
    const inputField = document.getElementById('customSplitInput');
    const inputVal = inputField ? inputField.value.trim() : "";
    const info = document.getElementById('optimizationInfo');

    if (!inputVal) {
        const split = (previewGroups && previewGroups.length > 0) ? previewGroups.map(g => g.length) : getSplits(applicants.length);
        const games = split.reduce((a, b) => a + (GAME_COUNTS[b] || 0), 0);
        const label = (previewGroups && previewGroups.length > 0) ? "현재 조" : "추천";
        if (info) info.innerHTML = `<div>현재 참여: ${applicants.length}명 | ${label}: <strong>${split.join(', ')}분할</strong></div><div style="margin-top:5px">총 경기: <span class="session-info" style="background:${games <= 18 ? 'var(--success)' : 'var(--danger)'}; color:white">${games}게임</span></div>`;
    } else {
        validateCustomSplit(context);
    }
}

export function updateSplitInputFromPreview(context) {
    const { previewGroups, applicants, GAME_COUNTS } = context;
    if (!previewGroups) return;
    const splitArr = previewGroups.map(g => g.length);
    const input = document.getElementById('customSplitInput');
    if (input) {
        input.value = splitArr.join(', ');
        const status = document.getElementById('splitStatus');
        const nums = splitArr;
        const totalGames = nums.reduce((a, b) => a + (GAME_COUNTS[b] || 0), 0);
        if (status) {
            status.innerText = `구성 가능 ✅ (총 ${totalGames}게임)`;
            status.className = "status-success";
        }
        const info = document.getElementById('optimizationInfo');
        if (info) info.innerHTML = `<div>현재 참여: ${applicants.length}명 | 현재 조: <strong>${nums.join(', ')}분할</strong></div><div style="margin-top:5px">총 경기: <span class="session-info" style="background:${totalGames <= 18 ? 'var(--success)' : 'var(--danger)'}; color:white">${totalGames}게임</span></div>`;
    }
}

export function renderSchedulePreview(context) {
    const { gameCounts, applicants, rankMap } = context;
    const area = document.getElementById('schedulePreviewArea');
    const grid = document.getElementById('previewStatsGrid');
    const avgEl = document.getElementById('previewAvgGames');
    if (!area || !grid) return;

    grid.innerHTML = '';
    let totalGames = 0;
    
    // 랭킹 기반 정렬 (New 선수는 하단 배치)
    const sortedApplicants = [...applicants].sort((a, b) => {
        const rA = rankMap ? (rankMap.get(String(a.id))?.rank || 9999) : 9999;
        const rB = rankMap ? (rankMap.get(String(b.id))?.rank || 9999) : 9999;
        if (rA !== rB) return rA - rB;
        return (b.rating || 1500) - (a.rating || 1500);
    });
    const sortedPlayerIds = sortedApplicants.map(a => String(a.id)).filter(id => gameCounts[id] !== undefined);

    sortedPlayerIds.forEach(id => {
        const p = applicants.find(a => String(a.id) === String(id));
        if (!p) return;

        const div = document.createElement('div');
        div.style.cssText = "background:rgba(255,255,255,0.05); padding:8px; border-radius:4px; text-align:center; font-size:0.8rem;";
        div.innerHTML = `
            <div style="color:var(--text-secondary); margin-bottom:4px;">${p.name}</div>
            <div style="font-weight:bold; color:var(--accent-color); font-size:1rem;">${gameCounts[id]}</div>
        `;
        grid.appendChild(div);
        totalGames += gameCounts[id];
    });

    if (sortedPlayerIds.length > 0) {
        avgEl.innerText = (totalGames / sortedPlayerIds.length).toFixed(1);
    }

    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth' });
}

export function renderCurrentMatches(context) {
    const { currentSchedule, currentSessionState, isAdmin, activeGroupTab, rankMap, ELO_INITIAL, actions: { setActiveGroupTab, renderCurrentMatches: selfRender, openCurrentMatchEditModal } } = context;
    const container = document.getElementById('matchContainer'),
        footer = document.getElementById('matchFooter'),
        tabs = document.getElementById('groupTabsContainer'),
        adminControls = document.getElementById('adminMatchControls');

    if (!container) return;
    container.innerHTML = '';

    if (currentSchedule.length === 0 || currentSessionState.status !== 'playing') {
        if (footer) footer.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        if (adminControls) adminControls.style.display = 'none';
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:var(--text-secondary); background:rgba(255,255,255,0.02); border-radius:12px; border:1px dashed rgba(255,255,255,0.1); margin:20px 0;">
                <div style="font-size:3.5rem; margin-bottom:20px; filter:grayscale(0.5);">📋</div>
                <h3 style="color:var(--text-secondary); margin-bottom:10px; font-weight:400;">대진표 생성을 기다리고 있습니다.</h3>
                <p style="font-size:0.9rem; opacity:0.7;">관리자가 대진표를 생성하면 이곳에 경기 일정이 표시됩니다.</p>
            </div>
        `;
        return;
    }

    if (footer) footer.style.display = 'block';
    if (tabs) tabs.style.display = 'block';
    if (adminControls && isAdmin) adminControls.style.display = 'block';

    const matchMode = currentSessionState.matchMode || 'group';
    if (tabs) {
        tabs.innerHTML = '';
        if (matchMode === 'court') {
            const rounds = [...new Set(currentSchedule.map(m => m.groupRound))].sort((a, b) => a - b);
            rounds.forEach(r => {
                const rLabel = `${r}R`;
                const btn = document.createElement('button');
                btn.className = `sub-tab-btn ${activeGroupTab === rLabel ? 'active' : ''}`;
                btn.innerText = rLabel;
                btn.onclick = () => { setActiveGroupTab(rLabel); };
                tabs.appendChild(btn);
            });
        } else {
            const groups = [...new Set(currentSchedule.map(m => m.group))].sort();
            groups.forEach(g => {
                const btn = document.createElement('button');
                btn.className = `sub-tab-btn ${activeGroupTab === g ? 'active' : ''}`;
                btn.innerText = `${g}조`;
                btn.onclick = () => { setActiveGroupTab(g); };
                tabs.appendChild(btn);
            });
        }
    }

    const sessionNum = currentSchedule[0].sessionNum;
    let filtered = [];
    let groupTitle = "";

    if (matchMode === 'court') {
        const roundNum = parseInt(activeGroupTab) || 1;
        filtered = currentSchedule.filter(m => m.groupRound === roundNum);
        groupTitle = `${roundNum}라운드`;
    } else {
        filtered = currentSchedule.filter(m => m.group === activeGroupTab);
        groupTitle = `${activeGroupTab}조`;
    }

    container.innerHTML = `<h3 style="text-align:center; margin-bottom:20px">${groupTitle} 대진표</h3>`;

    const getRank = (p) => {
        if (p.vRank) return `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
        const info = rankMap.get(String(p.id));
        return info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : '';
    };

    const renderMatchCard = (m) => {
        const r1 = m.t1[0].rating || ELO_INITIAL;
        const r2 = m.t1[1].rating || ELO_INITIAL;
        const r3 = m.t2[0].rating || ELO_INITIAL;
        const r4 = m.t2[1].rating || ELO_INITIAL;
        const avg1 = (r1 + r2) / 2;
        const avg2 = (r3 + r4) / 2;
        const expected = 1 / (1 + Math.pow(10, (avg2 - avg1) / 400));
        const expPcnt = (expected * 100).toFixed(0);

        const div = document.createElement('div');
        div.className = 'match-card';
        div.setAttribute('data-match-id', m.id);
        div.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; justify-content:center; gap:2px;">
                <div><strong>${m.t1[0].name}${getRank(m.t1[0])}</strong></div>
                <div><strong>${m.t1[1].name}${getRank(m.t1[1])}</strong></div>
            </div>
            <div class="vs" style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                <div style="display:flex; align-items:center;">
                    <input type="number" class="score-input" value="${m.s1 !== null ? m.s1 : ''}" placeholder="-" min="0" max="6" inputmode="numeric" onchange="updateLiveScore('${m.id}',1,this.value)" style="width:55px; font-size:1.1rem; padding:5px 0;"> 
                    <span style="margin:0 5px; font-weight:bold;">:</span> 
                    <input type="number" class="score-input" value="${m.s2 !== null ? m.s2 : ''}" placeholder="-" min="0" max="6" inputmode="numeric" onchange="updateLiveScore('${m.id}',2,this.value)" style="width:55px; font-size:1.1rem; padding:5px 0;">
                </div>
                <div style="font-size:0.7rem; color:var(--text-secondary); opacity:0.8;">(기대승률 ${expPcnt}%)</div>
                <button class="save-score-btn" style="display:none;" onclick="saveMatchScore('${m.id}')">💾 점수 저장</button>
            </div>
            <div style="flex:1; text-align:right; display:flex; flex-direction:column; justify-content:center; gap:2px;">
                <div><strong>${m.t2[0].name}${getRank(m.t2[0])}</strong></div>
                <div><strong>${m.t2[1].name}${getRank(m.t2[1])}</strong></div>
            </div>
        `;
        container.appendChild(div);
    };

    if (matchMode === 'court') {
        const sortedInRound = [...filtered].sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));
        sortedInRound.forEach(match => {
            const headerDiv = document.createElement('div');
            headerDiv.style.display = 'flex';
            headerDiv.style.justifyContent = 'space-between';
            headerDiv.style.alignItems = 'center';
            headerDiv.style.margin = '20px 0 10px 0';

            const h = document.createElement('h4');
            h.style.margin = '0';
            h.style.color = 'var(--accent-color)';
            h.innerText = match.group;
            headerDiv.appendChild(h);

            if (isAdmin) {
                const editAllBtn = document.createElement('button');
                editAllBtn.style.fontSize = '0.7rem';
                editAllBtn.style.color = 'var(--text-secondary)';
                editAllBtn.style.background = 'none';
                editAllBtn.style.border = 'none';
                editAllBtn.style.padding = '0';
                editAllBtn.style.cursor = 'pointer';
                editAllBtn.style.opacity = '0.6';
                editAllBtn.style.textDecoration = 'underline';
                editAllBtn.innerText = '이름 수정';
                editAllBtn.onclick = () => openCurrentMatchEditModal(match.id);
                headerDiv.appendChild(editAllBtn);
            }

            container.appendChild(headerDiv);
            renderMatchCard(match);
        });
    } else {
        const roundsInGroup = [...new Set(filtered.map(m => m.groupRound))].sort((a, b) => a - b);
        roundsInGroup.forEach(rNum => {
            const headerDiv = document.createElement('div');
            headerDiv.style.display = 'flex';
            headerDiv.style.justifyContent = 'space-between';
            headerDiv.style.alignItems = 'center';
            headerDiv.style.margin = '20px 0 10px 0';

            const h = document.createElement('h4');
            h.style.margin = '0';
            h.style.color = 'var(--accent-color)';
            h.innerText = `${rNum}회전`;
            headerDiv.appendChild(h);

            if (isAdmin) {
                const editAllBtn = document.createElement('button');
                editAllBtn.style.fontSize = '0.7rem';
                editAllBtn.style.color = 'var(--text-secondary)';
                editAllBtn.style.background = 'none';
                editAllBtn.style.border = 'none';
                editAllBtn.style.padding = '0';
                editAllBtn.style.cursor = 'pointer';
                editAllBtn.style.opacity = '0.6';
                editAllBtn.style.textDecoration = 'underline';
                editAllBtn.innerText = '이름 수정';

                const roundMatches = filtered.filter(m => m.groupRound === rNum);
                if (roundMatches.length > 0) {
                    editAllBtn.onclick = () => openCurrentMatchEditModal(roundMatches[0].id);
                }
                headerDiv.appendChild(editAllBtn);
            }

            container.appendChild(headerDiv);

            filtered.filter(m => m.groupRound === rNum).forEach(m => renderMatchCard(m));
        });
    }

    const finishedCount = currentSchedule.filter(m =>
        m.s1 !== null && m.s1 !== undefined && typeof m.s1 === 'number' &&
        m.s2 !== null && m.s2 !== undefined && typeof m.s2 === 'number'
    ).length;

    const eloBtn = document.getElementById('updateEloBtn');
    const footerMsg = footer ? footer.querySelector('p') : null;

    if (eloBtn) {
        if (finishedCount === currentSchedule.length && currentSchedule.length > 0) {
            eloBtn.style.display = 'block';
            eloBtn.disabled = false;
            eloBtn.innerText = "🏆 랭킹전 종료 및 결과 확정";
            if (footerMsg) footerMsg.innerText = "* 모든 경기가 종료되었습니다. 결과를 확정하세요.";
        } else {
            eloBtn.style.display = 'block';
            eloBtn.disabled = true;
            eloBtn.innerText = `경기 진행 중 (${finishedCount}/${currentSchedule.length})`;
            if (footerMsg) footerMsg.innerText = "⚠️ 모든 경기의 점수를 입력하면 [종료] 버튼이 활성화됩니다.";
        }
    }
}

// --------------------------------------------------------
// --- 3. 기타 UI 렌더링 (히스토리, 랭킹, 차트, 탭 등) ---
// --------------------------------------------------------

export function renderHistory(context) {
    const { matchHistory = [], historyViewMode, sessionRankSnapshots, rankMap, isAdmin, actions: { openEditModal, deleteHistory } } = context;
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = matchHistory.length ? '' : '<p style="text-align:center; padding:20px">기록이 없습니다.</p>';

    const groups = {};
    matchHistory.forEach(h => {
        if (!groups[h.sessionNum]) groups[h.sessionNum] = [];
        groups[h.sessionNum].push(h);
    });

    const sortedSessions = Object.keys(groups).sort((a, b) => parseInt(b) - parseInt(a));

    let finalHtml = '';
    sortedSessions.forEach(sNum => {
        const sessionMatches = groups[sNum];
        // 회차별 경기 정렬 (A조 -> B조 ..., 라운드 순 정방향)
        sessionMatches.sort((a, b) => {
            const gA = a.group || 'Z'; 
            const gB = b.group || 'Z';
            if (gA !== gB) return gA.localeCompare(gB, undefined, { numeric: true });
            return (a.groupRound || 0) - (b.groupRound || 0);
        });

        const date = sessionMatches[0].date;
        let contentHtml = '';

        if (historyViewMode === 'match') {
            contentHtml = sessionMatches.map(h => {
                const s1 = h.score1 !== null ? h.score1 : 0;
                const s2 = h.score2 !== null ? h.score2 : 0;
                const chg1 = h.elo_at_match?.change1 || 0;
                const chg2 = h.elo_at_match?.change2 || 0;
                const exp1 = h.elo_at_match ? Math.round(h.elo_at_match.expected * 100) : 50;
                const exp2 = 100 - exp1;

                // 역전(Swap) 기준:
                // 1. 점수가 등록되어 있고 T2가 승리한 경우
                // 2. 무승부이거나 점수가 없을 때, T2의 기대승률이 더 낮은 경우 (즉 exp1 > exp2)
                let isSwap = false;
                if (h.score1 !== null && h.score2 !== null) {
                    if (s2 > s1) isSwap = true;
                    else if (s2 === s1 && exp1 > exp2) isSwap = true;
                } else {
                    if (exp1 > exp2) isSwap = true;
                }

                const s1_disp = h.score1 !== null ? (isSwap ? s2 : s1) : '-';
                const s2_disp = h.score2 !== null ? (isSwap ? s1 : s2) : '-';
                const elo_change = isSwap ? chg2 : chg1;
                const expPcnt = isSwap ? exp2 : exp1;
                
                const t1Ids = isSwap ? h.t2_ids : h.t1_ids;
                const t1Names = isSwap ? h.t2_names : h.t1_names;
                const t2Ids = isSwap ? h.t1_ids : h.t2_ids;
                const t2Names = isSwap ? h.t1_names : h.t2_names;

                const getRankStrArr = (ids, names, sId) => {
                    return names.map((n, i) => {
                        return `<div style="font-size:0.85rem; white-space:nowrap;"><strong>${n}</strong></div>`;
                    });
                };

                const t1_arr = getRankStrArr(t1Ids, t1Names, h.sessionNum);
                const t2_arr = getRankStrArr(t2Ids, t2Names, h.sessionNum);

                return `
                    <div class="history-match-item">
                        <div style="flex:2; display:flex; flex-direction:column; gap:2px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="display:flex; flex-direction:column;">
                                    ${t1_arr[0]}
                                    ${t1_arr[1]}
                                </div>
                                <span style="font-size:0.8rem; color:var(--text-secondary); margin:0 5px;">vs</span>
                                <div style="display:flex; flex-direction:column; text-align:right;">
                                    ${t2_arr[0]}
                                    ${t2_arr[1]}
                                </div>
                            </div>
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                            <div style="color:var(--accent-color); font-weight:bold; font-size:1.1rem">${s1_disp} : ${s2_disp}</div>
                        </div>
                        <div style="flex:1; text-align:right; display:flex; flex-direction:column; justify-content:center; align-items:flex-end;">
                            <div style="font-size:0.65rem; color:var(--text-secondary); opacity:0.8; margin-bottom:2px;">기대승률 ${expPcnt}%</div>
                            <span class="history-elo-tag" style="color:${elo_change >= 0 ? 'var(--success)' : 'var(--danger)'}">
                                ${elo_change >= 0 ? '+' : ''}${elo_change.toFixed(1)}
                            </span>
                            ${isAdmin ? `<div style="margin-top:5px; display:flex; gap:5px;"><button class="edit-btn" onclick="window.openHistoryEditModal('${h.id}')">수정</button><button class="delete-btn" onclick="window.deleteHistoryItem('${h.id}')">삭제</button></div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
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
                        else if (t.score === t.oppScore && t.score !== null) playerStats[id].draws++;
                        playerStats[id].eloSum += t.change;
                    });
                });
            });
            // [v44] 랭킹보드와 동일한 현재 순위(rankMap) 기준으로 정렬 및 표시
            const sortedPlayers = Object.values(playerStats).sort((a, b) => {
                const rankA = rankMap?.get(String(a.id))?.rank || 9999;
                const rankB = rankMap?.get(String(b.id))?.rank || 9999;
                return rankA - rankB;
            });
            contentHtml = sortedPlayers.map(p => {
                const rInfo = rankMap?.get(String(p.id));
                let rankVal = rInfo ? rInfo.rank : '-';
                return `
                <div class="player-history-item">
                    <div>
                        <div class="player-history-info">${p.name} <span style="font-size:0.75rem; color:var(--text-secondary)">(${rankVal})</span></div>
                        <div class="player-history-stats">${p.wins}승 ${p.draws}무 ${p.losses}패</div>
                    </div>
                    <div style="text-align:right">
                        <span class="history-elo-tag" style="color:${p.eloSum >= 0 ? 'var(--success)' : 'var(--danger)'}">
                           ${p.eloSum >= 0 ? '+' : ''}${p.eloSum.toFixed(1)}
                        </span>
                    </div>
                </div>`;
            }).join('');
        }

        finalHtml += `
            <div class="history-session-card">
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
            </div>
        `;
    });
    list.innerHTML = finalHtml || '<p style="text-align:center; padding:20px">기록이 없습니다.</p>';
}

export function toggleHistoryContent(header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.toggle-icon');
    const isActive = content.classList.contains('active');

    if (isActive) {
        content.classList.remove('active');
        icon.innerText = '▼';
    } else {
        content.classList.add('active');
        icon.innerText = '▲';
    }
}

export function renderRanking(context) {
    const { members, matchHistory, rankMap, currentSessionState, applicants, currentSchedule } = context;
    const tbody = document.querySelector('#rankingTable tbody'); if (!tbody) return;
    tbody.innerHTML = '';

    // [v43] 세션 배지 업데이트 (총 대회 횟수 표시)
    const sessionBadge = document.getElementById('sessionBadge');
    if (sessionBadge) {
        const uniqueSessionCount = [...new Set(matchHistory.map(h => String(h.sessionNum)))].length;
        sessionBadge.innerText = `진행된 대회: ${uniqueSessionCount}회차`;
    }

    // 모든 세션 ID 추출 (오름차순: [1, 2, 3...])
    const allSessionsSorted = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))]
        .filter(Boolean)
        .sort((a, b) => parseInt(a) - parseInt(b));

    // 가장 최근 세션 ID (마지막 요소)
    const latestSessionId = allSessionsSorted[allSessionsSorted.length - 1];

    // 최근 3회차 세션 ID 추출 (내림차순 정렬: [3, 2, 1...])
    const recent3 = [...allSessionsSorted].reverse().slice(0, 3);

    // 활동성 기반 필터링: 최근 3회차 참여 기록이 있거나, 현재 회차에 참여 중인 회원만 선별
    const filteredMembers = members.filter(m => {
        // [수정] 경기를 한 번이라도 치른 선수만 노출 (사용자 요청)
        if (m.matchCount === 0) return false;

        // 최근 3회차 참여 여부 확인
        const isRecentlyActive = m.participationArr?.some(s => recent3.includes(s.toString()));

        // 복귀 규칙: 현재 참여 중인 경우 (dormant였더라도) 활성으로 간주
        const isCurrentParticipant = (applicants && applicants.some(a => String(a.id) === String(m.id))) ||
            (currentSchedule && currentSchedule.some(match =>
                [...match.t1, ...match.t2].some(p => String(p.id) === String(m.id))
            ));

        return isRecentlyActive || isCurrentParticipant;
    });

    const sorted = filteredMembers.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.wins !== a.wins) return b.wins - a.wins;
        const bWinRate = b.matchCount > 0 ? b.wins / b.matchCount : 0;
        const aWinRate = a.matchCount > 0 ? a.wins / a.matchCount : 0;
        if (bWinRate !== aWinRate) return bWinRate - aWinRate;
        if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
        return String(a.name).localeCompare(String(b.name));
    });

    sorted.forEach((p, i) => {
        const att = ((p.participationArr?.length || 0) / (allSessionsSorted.length || 1) * 100).toFixed(0);
        const tr = document.createElement('tr');
        const rInfo = rankMap.get(String(p.id));

        let rankChangeIcon = '';
        const currentSessionNum = currentSessionState.sessionNum;

        // [정교화] 신규 회원 판별: 참여 세션이 단 하나고, 그게 전체 역사상 마지막 세션인 경우
        const isFirstTime = p.participationArr && p.participationArr.length === 1 &&
            p.participationArr[0].toString() === (latestSessionId || '').toString();

        if (isFirstTime) rankChangeIcon = `<span class="rank-new">NEW</span>`;
        else if (rInfo && rInfo.change > 0) rankChangeIcon = `<span class="rank-up">▲${rInfo.change}</span>`;
        else if (rInfo && rInfo.change < 0) rankChangeIcon = `<span class="rank-down">▼${Math.abs(rInfo.change)}</span>`;

        const winRateValue = p.matchCount > 0 ? Math.round((p.wins / p.matchCount) * 100) : 0;

        tr.innerHTML = `
            <td><span class="rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</span>${rankChangeIcon}</td>
            <td><strong>${p.name}</strong></td>
            <td style="color:var(--accent-color); font-weight:bold">${Math.round(p.rating)}</td>
            <td>${p.wins}승 ${p.draws}무 ${p.losses}패</td>
            <td>${winRateValue}%</td>
            <td style="color:${p.scoreDiff >= 0 ? 'var(--success)' : 'var(--danger)'}">${p.scoreDiff > 0 ? '+' : ''}${p.scoreDiff}</td>
            <td><span class="attendance-badge">${att}%</span></td>
        `;
        tbody.appendChild(tr);
    });

    // 랭킹 보드 하단 안내 문구 추가
    let footerNote = document.getElementById('rankingFooterNote');
    if (!footerNote) {
        footerNote = document.createElement('div');
        footerNote.id = 'rankingFooterNote';
        footerNote.className = 'ranking-footer-note';
        const tableResponsive = tbody.closest('.table-responsive');
        if (tableResponsive) {
            tableResponsive.parentNode.appendChild(footerNote);
        }
    }
    if (footerNote) {
        footerNote.innerText = "※ 최근 3회차 연속 불참자는 순위에서 제외됩니다.";
    }
}

export function switchTab(id, context) {
    const { actions: { renderEloChart, renderPlayerTrend } } = context;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(`tab-${id}`);
    if (target) target.classList.add('active');

    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    if (btn) btn.classList.add('active');

    if (id === 'rank' && renderEloChart) {
        renderEloChart(context);
    }
    
    if (id === 'caster') {
        renderAnalystReport(context);
        renderVideoGallery(context);
        // [v61] 전력분석실로 이동된 명예의 전당과 개인 분석 렌더링
        if (typeof renderBadgeHall === 'function') renderBadgeHall(context);
        if (typeof updateInsightPlayerSelect === 'function') updateInsightPlayerSelect(context);
        // [v62] ELO 차트 및 성장 추이 차트 렌더링
        if (renderEloChart) renderEloChart(context);
        if (renderPlayerTrend) renderPlayerTrend(context);
    }
}

export function updateStatistics(context) {
    const { members, matchHistory } = context;
    const activeMembers = members.filter(m => m.matchCount > 0);
    const totalPlayers = activeMembers.length;
    const totalSessions = [...new Set(matchHistory.map(h => h.sessionNum.toString()))].length;
    const totalMatches = matchHistory.length;

    const sortedMembers = [...activeMembers].sort((a, b) => b.rating - a.rating);
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

export function renderStatsDashboard(context) {
    const { actions: { renderEloChart, updatePlayerSelect, renderPlayerTrend } } = context;
    if (document.getElementById('tab-stats').classList.contains('active')) {
        renderEloChart(context);
        updatePlayerSelect(context);
        renderPlayerTrend(context);
    }
}

/**
 * 🏆 명예의 전당 (Badge Hall) 렌더링
 */
export function renderBadgeHall(context) {
    const { members, matchHistory } = context;
    const badgeContainer = document.getElementById('badgeGrid');
    if (!badgeContainer) return;

    const badges = calculateBadges(members, matchHistory);

    const badgeHTML = `
        <div class="stat-card badge-card accent">
            <div class="card-icon">💎</div>
            <div class="card-content">
                <h3>최고의 도토리</h3>
                <p class="card-desc">현재 랭킹 1위 (ELO 최고)</p>
                <div class="player-list">
                    ${badges.topAcorns.length > 0
            ? badges.topAcorns.map(name => `<span class="player-name highlight">${name}</span>`).join('')
            : '<span class="empty-msg">대상자 없음</span>'}
                </div>
            </div>
        </div>
        <div class="stat-card badge-card">
            <div class="card-icon">🥇</div>
            <div class="card-content">
                <h3>베이글 장인</h3>
                <p class="card-desc">6:0 완승 기록 보유자</p>
                <div class="player-list">
                    ${badges.bagelMasters.length > 0
            ? badges.bagelMasters.map(name => `<span class="player-name">${name}</span>`).join('')
            : '<span class="empty-msg">대상자 없음</span>'}
                </div>
            </div>
        </div>
        <div class="stat-card badge-card">
            <div class="card-icon">🔥</div>
            <div class="card-content">
                <h3>불타는 연승</h3>
                <p class="card-desc">현재 3연승 이상 순항 중</p>
                <div class="player-list">
                    ${badges.hotStreaks.length > 0
            ? badges.hotStreaks.map(name => `<span class="player-name">${name}</span>`).join('')
            : '<span class="empty-msg">대상자 없음</span>'}
                </div>
            </div>
        </div>
        <div class="stat-card badge-card">
            <div class="card-icon">🛡️</div>
            <div class="card-content">
                <h3>늪지대 방어군</h3>
                <p class="card-desc">끈질긴 5:5 무승부 최다</p>
                <div class="player-list">
                    ${badges.swampGuards.length > 0
            ? badges.swampGuards.map(name => `<span class="player-name">${name}</span>`).join('')
            : '<span class="empty-msg">대상자 없음</span>'}
                </div>
            </div>
        </div>
        <div class="stat-card badge-card">
            <div class="card-icon">🏋️‍♂️</div>
            <div class="card-content">
                <h3>코트의 철인</h3>
                <p class="card-desc">최다 매치 소화 리스펙</p>
                <div class="player-list">
                    ${badges.ironMen.length > 0
            ? badges.ironMen.map(name => `<span class="player-name">${name}</span>`).join('')
            : '<span class="empty-msg">대상자 없음</span>'}
                </div>
            </div>
        </div>
    `;
    badgeContainer.innerHTML = badgeHTML;
}

/**
 * 🔍 개인 통계 선수 선택 업데이트
 */
export function updateInsightPlayerSelect(context) {
    const { members } = context;
    const select = document.getElementById('insightPlayerSelect');
    if (!select) return;

    // 초기화 및 정렬
    const currentVal = select.value;
    select.innerHTML = '<option value="" disabled selected>선수 선택</option>';

    const activeMembers = members.filter(m => m.matchCount > 0).sort((a, b) => a.name.localeCompare(b.name));
    activeMembers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = m.name;
        select.appendChild(opt);
    });

    // 이벤트 리스너 (중복 방지 및 통합 연동)
    select.onchange = () => {
        renderPlayerInsights(select.value, context);
        if (typeof renderPlayerTrend === 'function') {
            renderPlayerTrend(context);
        }
    };

    // 기본값 설정 (최상위 랭커)
    if (!currentVal && activeMembers.length > 0) {
        const topPlayer = [...activeMembers].sort((a, b) => b.rating - a.rating)[0];
        select.value = topPlayer.id;
        renderPlayerInsights(topPlayer.id, context);
        renderPlayerTrend(context);
    } else if (currentVal) {
        select.value = currentVal;
        renderPlayerInsights(currentVal, context);
        renderPlayerTrend(context);
    }
}

/**
 * 🔍 개인별 인맥 통계 (User Insights) 렌더링
 */
export function renderPlayerInsights(playerId, context) {
    const { members, matchHistory } = context;
    const insightContainer = document.getElementById('insightGrid');
    if (!insightContainer) return;

    const insights = getPlayerInsights(playerId, members, matchHistory);
    if (!insights) {
        insightContainer.innerHTML = '<p class="no-data-msg">데이터 분석 중...</p>';
        return;
    }

    const { nemesis, bestPartner, worstPartner } = insights;

    const nemesisHTML = `
        <div class="stat-card insight-card danger">
            <div class="card-header">
                <span class="card-label">주의대상 (천적)</span>
                <span class="card-emoji">🏹</span>
            </div>
            <div class="card-body">
                <h3>나의 천적</h3>
                <div class="target-name">${nemesis ? nemesis.name : '---'}</div>
            </div>
            <div class="card-footer">
                ${nemesis ? `${Math.round(nemesis.eloLost)} ELO 탈취당함` : '기록 없음'}
            </div>
        </div>
    `;

    const bestPartnerHTML = `
        <div class="stat-card insight-card success">
            <div class="card-header">
                <span class="card-label">최고승률 파트너</span>
                <span class="card-emoji">🤝</span>
            </div>
            <div class="card-body">
                <h3>환상의 파트너</h3>
                <div class="target-name">${bestPartner ? bestPartner.name : '---'}</div>
            </div>
            <div class="card-footer">
                ${bestPartner ? `승률 ${(bestPartner.winRate * 100).toFixed(0)}% / +${Math.round(bestPartner.eloGain)} ELO` : '조건에 맞는 파트너 부족'}
            </div>
        </div>
    `;

    const worstPartnerHTML = `
        <div class="stat-card insight-card warning">
            <div class="card-header">
                <span class="card-label">웃픈조합 파트너</span>
                <span class="card-emoji">🚫</span>
            </div>
            <div class="card-body">
                <h3>환장하는 파트너</h3>
                <div class="target-name">${worstPartner ? worstPartner.name : '---'}</div>
            </div>
            <div class="card-footer">
                ${worstPartner ? `${worstPartner.losses}패 / ${Math.round(worstPartner.eloGain)} ELO 손실` : '조건에 맞는 파트너 부족'}
            </div>
        </div>
    `;

    insightContainer.innerHTML = nemesisHTML + bestPartnerHTML + worstPartnerHTML;
}

export function renderEloChart(context) {
    const { members, rankMap } = context;
    const ctx = document.getElementById('eloChart')?.getContext('2d');
    if (!ctx) return;

    // 비활성 인원 제외 및 랭킹 정렬
    const data = members
        .filter(m => rankMap.get(String(m.id)))
        .sort((a, b) => rankMap.get(String(a.id)).rank - rankMap.get(String(b.id)).rank)
        .slice(0, 8);
    const labels = data.map(m => m.name);
    const ratings = data.map(m => Math.round(m.rating));
    if (ratings.length === 0) return;

    if (eloChart) eloChart.destroy();

    // 차트 JS가 전역으로 로드되어 있다고 가정 (app.js 원래 방식)
    if (typeof Chart !== 'undefined') {
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
}

export function updatePlayerSelect(context) {
    const { members, actions: { renderPlayerTrend } } = context;
    const select = document.getElementById('playerSelect');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>선수 선택</option>';

    const sortedMembers = members.filter(m => m.matchCount > 0).sort((a, b) => a.name.localeCompare(b.name));
    sortedMembers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = m.name;
        select.appendChild(opt);
    });

    if (!select.value && sortedMembers.length > 0) {
        const topPlayer = members.filter(m => m.matchCount > 0).sort((a, b) => {
            if (b.rating !== a.rating) return b.rating - a.rating;
            if (b.wins !== a.wins) return b.wins - a.wins;
            return b.scoreDiff - a.scoreDiff;
        })[0];

        if (topPlayer) {
            select.value = topPlayer.id;
            renderPlayerTrend(context);
        }
    }
}

export function renderPlayerTrend(context) {
    const { members, matchHistory, ELO_INITIAL } = context;
    const ctx = document.getElementById('trendChart')?.getContext('2d');
    const playerId = document.getElementById('insightPlayerSelect')?.value;
    if (!ctx) return;

    if (!playerId) {
        if (trendChart) trendChart.destroy();
        return;
    }

    const m = members.find(x => x.id.toString() === playerId.toString());
    if (!m) return;

    let currentRating = ELO_INITIAL;
    const labels = ['초기'];
    const data = [ELO_INITIAL];
    const averageData = [ELO_INITIAL];

    const sessionIds = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean).sort((a, b) => parseInt(a) - parseInt(b));

    let memberRatingsSim = {};
    members.forEach(mem => {
        if (mem.id) {
            memberRatingsSim[mem.id.toString()] = ELO_INITIAL;
        }
    });

    sessionIds.forEach(sId => {
        const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);

        sessionMatches.forEach(h => {
            const isT1 = h.t1_ids && h.t1_ids.map(id => id.toString()).includes(m.id.toString());
            const isT2 = h.t2_ids && h.t2_ids.map(id => id.toString()).includes(m.id.toString());

            if (isT1) currentRating += Number(h.elo_at_match?.change1 || 0);
            if (isT2) currentRating += Number(h.elo_at_match?.change2 || 0);

            if (isNaN(currentRating)) currentRating = ELO_INITIAL;

            (h.t1_ids || []).forEach(pid => {
                const pKey = pid.toString();
                if (memberRatingsSim[pKey] !== undefined) {
                    memberRatingsSim[pKey] += Number(h.elo_at_match?.change1 || 0);
                }
            });
            (h.t2_ids || []).forEach(pid => {
                const pKey = pid.toString();
                if (memberRatingsSim[pKey] !== undefined) {
                    memberRatingsSim[pKey] += Number(h.elo_at_match?.change2 || 0);
                }
            });
        });

        labels.push(`${sId}회`);
        data.push(Math.round(currentRating));

        const values = Object.values(memberRatingsSim).filter(v => !isNaN(v));
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : ELO_INITIAL;
        averageData.push(Math.round(avg));
    });

    if (trendChart) trendChart.destroy();
    if (typeof Chart !== 'undefined') {
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
                        borderWidth: 2.5,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#22c55e',
                        tension: 0.3,
                        fill: true,
                        order: 1
                    },
                    {
                        label: '평균 점수',
                        data: averageData,
                        borderColor: '#fbbf24',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        order: 2
                    }
                ]
            },
            options: {
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 1300,
                        max: 1700,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            stepSize: 100,
                            color: 'rgba(255,255,255,0.6)'
                        }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}

export function renderAnalystReport(context) {
    const { reports = {}, matchHistory = [], isAdmin } = context;
    const contentArea = document.getElementById('casterReportContent');
    const select = document.getElementById('reportSessionSelect');
    if (!contentArea || !select) return;

    // 회차 목록 업데이트 (한 번만)
    const uniqueSessions = [...new Set(matchHistory.map(h => String(h.sessionNum)))].sort((a, b) => parseInt(b) - parseInt(a));
    const currentOptions = Array.from(select.options).map(opt => opt.value);

    uniqueSessions.forEach(sNum => {
        if (!currentOptions.includes(sNum)) {
            const opt = document.createElement('option');
            opt.value = sNum;
            opt.text = `제 ${sNum}회차`;
            select.add(opt);
        }
    });

    const targetSession = select.value || (uniqueSessions.length > 0 ? uniqueSessions[0] : null);

    if (!targetSession) {
        contentArea.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:40px;">등록된 경기 기록이 없습니다.</p>';
        return;
    }

    // 선택 박스 동기화 (초기 렌더링 시 최신 회차 선택)
    if (!select.value && targetSession) select.value = targetSession;

    const report = reports[targetSession];
    if (!report) {
        contentArea.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:var(--text-secondary); background:rgba(255,255,255,0.02); border-radius:12px; border:1px dashed rgba(255,255,255,0.1);">
                <div style="font-size:3rem; margin-bottom:20px; opacity:0.5;">📊</div>
                <h3 style="font-weight:400;">제 ${targetSession}회차 리포트가 아직 없습니다.</h3>
                <p style="font-size:0.9rem; opacity:0.7;">관리자가 리포트를 작성 중일 수 있습니다.</p>
            </div>
        `;
    } else {
        // 심플 마크다운 렌더링
        contentArea.innerHTML = `
            <div class="markdown-body">
                ${parseMarkdown(report)}
            </div>
        `;
    }

    // 관리자 입력창 회차 동기화
    if (isAdmin) {
        const postInput = document.getElementById('reportPostSessionNum');
        if (postInput && !postInput.value) postInput.value = targetSession;
    }
}

function parseMarkdown(text) {
    if (!text) return "";

    // 이스케이프 및 기본 치환
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // 헤더
    html = html.replace(/^### (.*$)/gim, '<h4 style="color:var(--accent-color); margin:20px 0 10px 0;">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 style="color:var(--accent-color); border-bottom:1px solid var(--border-color); padding-bottom:10px; margin:30px 0 15px 0;">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 style="text-align:center; color:var(--accent-color); margin-bottom:30px;">$1</h2>');

    // 강조
    html = html.replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*)\*/gim, '<em>$1</em>');

    // 수평선
    html = html.replace(/^---$/gim, '<hr style="border:0; border-top:1px solid var(--border-color); margin:30px 0;">');

    // 테이블 및 단락 처리
    const lines = html.split('\n');
    let inTable = false;
    let resultRows = [];

    lines.forEach(line => {
        const trimmed = line.trim();

        if (trimmed.includes('|')) {
            const cells = trimmed.split('|').filter(c => c.trim() !== '' || trimmed.startsWith('|') || trimmed.endsWith('|')).map(c => c.trim());
            if (cells.every(c => c.match(/^[-:| ]+$/))) return;

            if (!inTable) {
                inTable = true;
                resultRows.push('<div class="table-responsive"><table><thead><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>');
            } else {
                resultRows.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
            }
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            // 리스트 처리 (들여쓰기 지원)
            if (inTable) {
                inTable = false;
                resultRows.push('</tbody></table></div>');
            }
            const indent = line.search(/\S/);
            const listContent = trimmed.substring(2);
            if (indent >= 4) {
                resultRows.push(`<li style="margin-left:20px; list-style-type:circle;">${listContent}</li>`);
            } else {
                resultRows.push(`<li>${listContent}</li>`);
            }
        } else {
            if (inTable) {
                inTable = false;
                resultRows.push('</tbody></table></div>');
            }

            if (trimmed === "") {
                // 빈 줄은 패스
            } else {
                resultRows.push(`<p>${trimmed}</p>`);
            }
        }
    });

    if (inTable) resultRows.push('</tbody></table></div>');

    return resultRows.join('\n');
}

/**
 * 📺 영상 자료실 화면 렌더링
 */
export function renderVideoGallery(context) {
    const { videos, isAdmin, deleteVideo } = context;
    const container = document.getElementById('videoGalleryContent');
    if (!container) return;

    container.innerHTML = '';

    if (!videos || videos.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px; grid-column: 1 / -1;">등록된 영상이 없습니다. 추천 영상을 등록해 보세요!</p>';
        return;
    }

    const getYouTubeId = (url) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    videos.forEach(video => {
        const videoId = getYouTubeId(video.url);
        const card = document.createElement('div');
        card.className = 'card video-list-item';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.padding = '12px 15px';
        card.style.background = 'var(--card-bg)';
        card.style.borderRadius = '8px';
        card.style.border = '1px solid var(--border-color)';

        const dateStr = video.timestamp ? new Date(video.timestamp).toLocaleDateString('ko-KR') : '';

        // 아코디언 헤더 (제목 + 날짜 + 아이콘)
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.cursor = 'pointer';

        header.innerHTML = `
            <div style="flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-right: 10px;">
                <h4 style="margin: 0; color: var(--text-primary); font-size: 1rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis;">${video.title || '테니스 추천 영상'}</h4>
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">${dateStr}</div>
            </div>
            <div class="toggle-icon" style="color: var(--text-secondary); font-size: 0.9rem; transition: transform 0.2s;">▼</div>
        `;

        // 아코디언 본문 (영상 + 요약 + 삭제버튼)
        const content = document.createElement('div');
        content.className = 'video-accordion-content';
        content.style.display = 'none';
        content.style.marginTop = '15px';
        content.style.borderTop = '1px solid var(--border-color)';
        content.style.paddingTop = '15px';

        let iframeHtml = '';
        if (videoId) {
            iframeHtml = `
                <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 6px; margin-bottom: 15px;">
                    <iframe src="https://www.youtube.com/embed/${videoId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
            `;
        } else {
            iframeHtml = `<div style="padding: 20px; background: rgba(255,255,255,0.05); text-align: center; margin-bottom: 15px; border-radius: 6px;">
                <a href="${video.url}" target="_blank" style="color: var(--accent-color);">🔗 영상 보러가기</a>
            </div>`;
        }

        const summaryHtml = video.summary ? `<div class="markdown-body" style="font-size: 0.85rem; color: var(--text-secondary);">${parseMarkdown(video.summary)}</div>` : '';
        const deleteBtnHtml = isAdmin ? `<div style="text-align: right; margin-top: 10px;"><button class="danger-btn" style="padding: 4px 8px; font-size: 0.75rem;" onclick="window.deleteVideo('${video.id}')">🗑️ 삭제</button></div>` : '';

        content.innerHTML = `
            ${iframeHtml}
            ${summaryHtml}
            ${deleteBtnHtml}
        `;

        header.onclick = () => {
            const isVisible = content.style.display === 'block';

            // 하나만 열리도록 기존에 열려있는 다른 아코디언 모두 닫기
            if (!isVisible) {
                document.querySelectorAll('.video-accordion-content').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.video-list-item .toggle-icon').forEach(el => el.style.transform = 'rotate(0deg)');
            }

            content.style.display = isVisible ? 'none' : 'block';
            header.querySelector('.toggle-icon').style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
        };

        card.appendChild(header);
        card.appendChild(content);
        container.appendChild(card);
    });
}

/**
 * 🛠️ 히스토리 수정 모달 렌더링
 */
export function renderHistoryEditModal(match) {
    const fields = document.getElementById('editFields');
    if (!fields) return;

    fields.innerHTML = `
        <div style="margin-bottom:15px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">
            <div style="font-size:0.9rem; margin-bottom:5px; color:var(--text-secondary);">히스토리 기록 수정</div>
            <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:10px;">선수 이름과 점수를 모두 수정할 수 있습니다.</p>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-top:10px;">
            <div>
                <label style="display:block; font-size:0.75rem; margin-bottom:5px; color:var(--accent-color);">TEAM 1 선수</label>
                <input type="text" id="editHistName1" value="${match.t1_names[0]}" style="width:100%; margin-bottom:5px;">
                <input type="text" id="editHistName2" value="${match.t1_names[1]}" style="width:100%;">
                <div style="text-align:center; margin-top:10px;">
                    <label style="display:block; font-size:0.75rem; margin-bottom:5px;">SCORE</label>
                    <input type="number" id="editHistScore1" value="${match.score1}" min="0" max="6" style="width:60px; font-size:1.2rem; text-align:center;">
                </div>
            </div>
            <div>
                <label style="display:block; font-size:0.75rem; margin-bottom:5px; color:var(--accent-color);">TEAM 2 선수</label>
                <input type="text" id="editHistName3" value="${match.t2_names[0]}" style="width:100%; margin-bottom:5px;">
                <input type="text" id="editHistName4" value="${match.t2_names[1]}" style="width:100%;">
                <div style="text-align:center; margin-top:10px;">
                    <label style="display:block; font-size:0.75rem; margin-bottom:5px;">SCORE</label>
                    <input type="number" id="editHistScore2" value="${match.score2}" min="0" max="6" style="width:60px; font-size:1.2rem; text-align:center;">
                </div>
            </div>
        </div>
    `;
    
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }
}

/**
 * 🛠️ 현재 경기 수정 모달 렌더링
 */
export function renderCurrentMatchEditModal(match) {
    const fields = document.getElementById('editFields');
    if (!fields) return;

    fields.innerHTML = `
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:15px;">출전 선수 명칭을 수정합니다. (랭킹/데이터에는 영향 없음)</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px;">
            <div>
                <label style="display:block; font-size:0.75rem; margin-bottom:5px; color:var(--accent-color);">TEAM 1</label>
                <input type="text" id="editName1" value="${match.t1[0].name}" style="width:100%; margin-bottom:5px;">
                <input type="text" id="editName2" value="${match.t1[1].name}" style="width:100%;">
            </div>
            <div>
                <label style="display:block; font-size:0.75rem; margin-bottom:5px; color:var(--accent-color);">TEAM 2</label>
                <input type="text" id="editName3" value="${match.t2[0].name}" style="width:100%; margin-bottom:5px;">
                <input type="text" id="editName4" value="${match.t2[1].name}" style="width:100%;">
            </div>
        </div>
    `;

    const modal = document.getElementById('editModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }
}
