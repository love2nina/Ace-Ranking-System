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
            const info = rankMap.get(String(a.id));
            const rankLabel = info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
            div.innerHTML = `${a.name}${rankLabel}${isAdmin ? ` <span class="remove-btn" onclick="event.stopPropagation(); removeApplicant('${a.id}')">×</span>` : ''}`;
            list.appendChild(div);
        });
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

        const saveBtn = document.getElementById('savePreviewBtn');
        if (saveBtn && !customValue) saveBtn.style.display = 'none';
        else if (saveBtn && customValue) saveBtn.style.display = 'block';
    } else {
        const appMap = new Map(sortedApplicants.map(a => [String(a.id), a]));
        previewGroups = previewGroups.map(group =>
            group.map(p => appMap.get(String(p.id)) || p).filter(p => appMap.has(String(p.id)))
        );
        setPreviewGroups(previewGroups);

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
                updateSplitInputFromPreview(context);
                selfRender(context);
                updateOptimizationInfo(context);
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
            const info = rankMap.get(String(a.id));
            const rankLabel = info ? `<span style="font-size:0.8em; color:var(--text-secondary)">(${info.rank})</span>` : `<span style="font-size:0.8em; color:var(--accent-color)">(New)</span>`;
            tag.innerHTML = `${a.name}${rankLabel}${isAdmin ? ` <span class="remove-btn" onclick="event.stopPropagation(); removeApplicant('${a.id}')">×</span>` : ''}`;

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

        const saveBtn = document.getElementById('savePreviewBtn');
        if (saveBtn) saveBtn.style.display = 'block';

        const currentPreviewSplit = previewGroups ? previewGroups.map(g => g.length).join(',') : '';
        const inputSplit = nums.join(',');

        if (currentPreviewSplit !== inputSplit) {
            setPreviewGroups(null);
            setTimeout(() => selfRender(context), 0);
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
    const { gameCounts, applicants } = context;
    const area = document.getElementById('schedulePreviewArea');
    const grid = document.getElementById('previewStatsGrid');
    const avgEl = document.getElementById('previewAvgGames');
    if (!area || !grid) return;

    grid.innerHTML = '';
    let totalGames = 0;
    const playerIds = Object.keys(gameCounts);

    playerIds.forEach(id => {
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

    if (playerIds.length > 0) {
        avgEl.innerText = (totalGames / playerIds.length).toFixed(1);
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
                btn.onclick = () => { setActiveGroupTab(rLabel); selfRender(context); };
                tabs.appendChild(btn);
            });
        } else {
            const groups = [...new Set(currentSchedule.map(m => m.group))].sort();
            groups.forEach(g => {
                const btn = document.createElement('button');
                btn.className = `sub-tab-btn ${activeGroupTab === g ? 'active' : ''}`;
                btn.innerText = `${g}조`;
                btn.onclick = () => { setActiveGroupTab(g); selfRender(context); };
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
        if (p.vRank) return `<span style="font-size:0.8em; color:var(--text-secondary)">(${p.vRank})</span>`;
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
    const { matchHistory, historyViewMode, sessionRankSnapshots, isAdmin, actions: { openEditModal, deleteHistory } } = context;
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = matchHistory.length ? '' : '<p style="text-align:center; padding:20px">기록이 없습니다.</p>';

    const groups = {};
    matchHistory.forEach(h => {
        if (!groups[h.sessionNum]) groups[h.sessionNum] = [];
        groups[h.sessionNum].push(h);
    });

    const sortedSessions = Object.keys(groups).sort((a, b) => parseInt(b) - parseInt(a));

    sortedSessions.forEach(sNum => {
        const sessionMatches = groups[sNum];
        const date = sessionMatches[0].date;

        const card = document.createElement('div');
        card.className = 'history-session-card';

        let contentHtml = '';
        if (historyViewMode === 'match') {
            contentHtml = sessionMatches.map(h => {
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

                let left_change = 0;
                if (isSwap) {
                    left_change = h.elo_at_match?.change2 || 0;
                } else {
                    left_change = h.elo_at_match?.change1 || 0;
                }

                let elo_change = left_change;

                const expVal = h.elo_at_match?.expected || 0.5;
                const left_expected = isSwap ? (1 - expVal) : expVal;
                const expPcnt = (left_expected * 100).toFixed(0);

                const getRankStrArr = (ids, names, sessNum) => {
                    return names.map((n, i) => {
                        return `<span style="font-size:0.9rem;"><strong>${n}</strong></span>`;
                    });
                };

                const t1_arr = getRankStrArr(isSwap ? h.t2_ids : h.t1_ids, t1_disp, h.sessionNum);
                const t2_arr = getRankStrArr(isSwap ? h.t1_ids : h.t2_ids, t2_disp, h.sessionNum);

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
                            ${isAdmin ? `<div style="margin-top:5px"><button class="edit-btn" onclick="openEditModal(${h.id})">수정</button><button class="delete-btn" onclick="deleteHistory(${h.id})">삭제</button></div>` : ''}
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
                        else playerStats[id].draws++;
                        playerStats[id].eloSum += t.change;
                    });
                });
            });

            const sortedPlayers = Object.values(playerStats).sort((a, b) => {
                const rankA = (sessionRankSnapshots[sNum] && sessionRankSnapshots[sNum][a.id]) || 9999;
                const rankB = (sessionRankSnapshots[sNum] && sessionRankSnapshots[sNum][b.id]) || 9999;
                return rankA - rankB;
            });
            contentHtml = sortedPlayers.map(p => {
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
                </div>`;
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
    const { members, matchHistory, rankMap, currentSessionState } = context;
    const tbody = document.querySelector('#rankingTable tbody'); if (!tbody) return;
    tbody.innerHTML = '';
    const uSess = [...new Set(matchHistory.map(h => (h.sessionNum || '').toString()))].filter(Boolean);
    const sorted = members.filter(m => m.matchCount > 0).sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.wins !== a.wins) return b.wins - a.wins;
        const bWinRate = b.matchCount > 0 ? b.wins / b.matchCount : 0;
        const aWinRate = a.matchCount > 0 ? a.wins / a.matchCount : 0;
        if (bWinRate !== aWinRate) return bWinRate - aWinRate;
        if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
        return String(a.name).localeCompare(String(b.name));
    });

    sorted.forEach((p, i) => {
        const att = ((p.participationArr?.length || 0) / (uSess.length || 1) * 100).toFixed(0);
        const tr = document.createElement('tr');
        const rInfo = rankMap.get(String(p.id));

        let rankChangeIcon = '';
        const currentSessionNum = currentSessionState.sessionNum;
        const isFirstTime = !p.participationArr || p.participationArr.length === 0 ||
            (p.participationArr.length === 1 && p.participationArr[0].toString() === currentSessionNum.toString());

        if (isFirstTime && p.matchCount > 0) rankChangeIcon = `<span class="rank-new">NEW</span>`;
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
}

export function switchTab(id, context) {
    const { actions: { renderStatsDashboard } } = context;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(`tab-${id}`);
    if (target) target.classList.add('active');

    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    if (btn) btn.classList.add('active');

    if (id === 'stats' && renderStatsDashboard) {
        renderStatsDashboard(context);
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

let eloChart = null;
let trendChart = null;

export function renderEloChart(context) {
    const { members } = context;
    const ctx = document.getElementById('eloChart')?.getContext('2d');
    if (!ctx) return;

    const data = members.filter(m => m.matchCount > 0).sort((a, b) => b.rating - a.rating).slice(0, 15);
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
    const playerId = document.getElementById('playerSelect')?.value;
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
    members.forEach(mem => memberRatingsSim[mem.id] = ELO_INITIAL);

    sessionIds.forEach(sId => {
        const sessionMatches = matchHistory.filter(h => (h.sessionNum || '').toString() === sId);

        sessionMatches.forEach(h => {
            const isT1 = h.t1_ids.includes(m.id);
            const isT2 = h.t2_ids.includes(m.id);

            if (isT1) currentRating += (h.elo_at_match?.change1 || 0);
            if (isT2) currentRating += (h.elo_at_match?.change2 || 0);

            h.t1_ids.forEach(pid => {
                if (memberRatingsSim[pid] !== undefined) memberRatingsSim[pid] += (h.elo_at_match?.change1 || 0);
            });
            h.t2_ids.forEach(pid => {
                if (memberRatingsSim[pid] !== undefined) memberRatingsSim[pid] += (h.elo_at_match?.change2 || 0);
            });
        });

        labels.push(`${sId}회`);
        data.push(Math.round(currentRating));

        const sum = Object.values(memberRatingsSim).reduce((a, b) => a + b, 0);
        const avg = sum / members.length;
        averageData.push(Math.round(avg));
    });

    const allRatings = members.map(m => m.rating);
    const maxRating = Math.ceil(Math.max(...allRatings, ELO_INITIAL) / 50) * 50 + 50;

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
                        tension: 0.3,
                        fill: true,
                        zIndex: 2
                    },
                    {
                        label: '평균(1500)',
                        data: Array(labels.length).fill(1500),
                        borderColor: '#fbbf24',
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
                        max: Math.max(maxRating, 1800),
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}
