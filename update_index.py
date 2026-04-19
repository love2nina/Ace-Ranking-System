import re

with open('c:\\Users\\user\\Documents\\AI\\ACE\\RankingSystem\\web\\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Update tab-container
old_tabs = """        <div class="tab-container">
            <button class="tab-btn active" data-tab="rank" onclick="switchTab('rank')">종합랭킹</button>
            <button class="tab-btn" data-tab="caster" onclick="switchTab('caster')">전력분석실</button>
            <button class="tab-btn" data-tab="apply" onclick="switchTab('apply')">참가신청</button>
            <button class="tab-btn" data-tab="match" onclick="switchTab('match')">대진표</button>
            <button class="tab-btn" data-tab="history" onclick="switchTab('history')">히스토리</button>
        </div>"""

new_tabs = """        <div class="tab-container" id="mainTabContainer">
            <button class="tab-btn" data-tab="badge" onclick="switchTab('badge')">명예의 전당</button>
            <button class="tab-btn" data-tab="rank" onclick="switchTab('rank')">종합랭킹</button>
            <button class="tab-btn" data-tab="insight" onclick="switchTab('insight')">개인분석</button>
            <button class="tab-btn" data-tab="apply" onclick="switchTab('apply')">참가신청</button>
            <button class="tab-btn" data-tab="match" onclick="switchTab('match')">대진표</button>
            <button class="tab-btn" data-tab="history" onclick="switchTab('history')">히스토리</button>
            <button class="tab-btn" data-tab="report" onclick="switchTab('report')">분석리포트</button>
            <button class="tab-btn" data-tab="video" onclick="switchTab('video')">영상자료실</button>
        </div>"""

html = html.replace(old_tabs, new_tabs)
html = html.replace('<div id="tab-rank" class="tab-content active">', '<div id="tab-rank" class="tab-content">')

# 2. Extract contents from tab-caster
match = re.search(r'<!-- 6\. 전력분석실 섹션 -->\s*<div id="tab-caster" class="tab-content">\s*<div class="card caster-card">\s*<div class="analysis-capsule-tabs">.*?</div>\s*<!-- 6-1\. 명예의 전당 탭 내용 -->\s*<div id="subtab-badge"[^>]*>(.*?)</div>\s*<!-- 6-2\. 개인 분석 탭 내용 -->\s*<div id="subtab-insight"[^>]*>(.*?)</div>\s*<!-- 6-3\. 리포트 탭 내용 -->\s*<div id="subtab-report"[^>]*>(.*?)</div>\s*<!-- 6-2\. 비디오 갤러리 탭 내용 \(신규\) -->\s*<div id="subtab-video"[^>]*>(.*?)</div>\s*</div>\s*</div>', html, re.DOTALL)

if match:
    badge_content = match.group(1).strip()
    insight_content = match.group(2).strip()
    report_content = match.group(3).strip()
    video_content = match.group(4).strip()

    new_sections = f"""        <!-- 6. 명예의 전당 섹션 -->
        <div id="tab-badge" class="tab-content active">
            <div class="card caster-card">
                {badge_content}
            </div>
        </div>

        <!-- 7. 개인 분석 섹션 -->
        <div id="tab-insight" class="tab-content">
            <div class="card caster-card">
                {insight_content}
            </div>
        </div>

        <!-- 8. 분석 리포트 섹션 -->
        <div id="tab-report" class="tab-content">
            <div class="card caster-card">
                {report_content}
            </div>
        </div>

        <!-- 9. 비디오 갤러리 섹션 -->
        <div id="tab-video" class="tab-content">
            <div class="card caster-card">
                {video_content}
            </div>
        </div>"""

    html = html[:match.start()] + new_sections + html[match.end():]
else:
    print("Could not find tab-caster block")

with open('c:\\Users\\user\\Documents\\AI\\ACE\\RankingSystem\\web\\index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("Updated index.html successfully.")
