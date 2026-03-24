import React, { useState, useMemo } from 'react';
import { calculateBadges, getPlayerInsights } from '../statsService';
import './Dashboard.css';

const Dashboard = ({ members, matchHistory }) => {
    const [selectedPlayerId, setSelectedPlayerId] = useState(members[0]?.id || '');

    // 뱃지 데이터 계산 (메모이제이션)
    const badges = useMemo(() => calculateBadges(members, matchHistory), [members, matchHistory]);

    // 선택된 사용자의 인사이트 계산
    const playerInsight = useMemo(() =>
        getPlayerInsights(selectedPlayerId, members, matchHistory),
        [selectedPlayerId, members, matchHistory]
    );

    return (
        <div className="dashboard-container">
            {/* 1. 기록 달성 뱃지 섹션 */}
            <section className="badge-section">
                <h2 className="section-title">🏆 명예의 전당 (Badge Hall)</h2>
                <div className="badge-grid">
                    <BadgeCard
                        title="베이글 장인"
                        emoji="🥇"
                        description="6:0 완승 기록 보유자"
                        players={badges.bagelMasters}
                    />
                    <BadgeCard
                        title="불타는 연승"
                        emoji="🔥"
                        description="현재 3연승 이상 순항 중"
                        players={badges.hotStreaks}
                    />
                    <BadgeCard
                        title="늪지대 방어군"
                        emoji="🛡️"
                        description="끈질긴 5:5 무승부 최다"
                        players={badges.swampGuards}
                    />
                    <BadgeCard
                        title="코트의 철인"
                        emoji="🏋️‍♂️"
                        description="최다 매치 소화 리스펙"
                        players={badges.ironMen}
                    />
                </div>
            </section>

            {/* 2. 개인별 인맥 통계 섹션 */}
            <section className="insight-section">
                <div className="section-header">
                    <h2 className="section-title">🔍 개인 분석 리포트</h2>
                    <select
                        className="player-select"
                        value={selectedPlayerId}
                        onChange={(e) => setSelectedPlayerId(e.target.value)}
                    >
                        {members.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                </div>

                {playerInsight ? (
                    <div className="insight-grid">
                        <InsightCard
                            title="나의 천적"
                            emoji="🏹"
                            label="주의대상"
                            data={playerInsight.nemesis}
                            footerText={playerInsight.nemesis ? `${Math.round(playerInsight.nemesis.eloLost)} ELO 탈취당함` : '기록 없음'}
                            type="danger"
                        />
                        <InsightCard
                            title="환상의 파트너"
                            emoji="🤝"
                            label="최고승률"
                            data={playerInsight.bestPartner}
                            footerText={playerInsight.bestPartner ? `승률 ${(playerInsight.bestPartner.winRate * 100).toFixed(0)}% / +${Math.round(playerInsight.bestPartner.eloGain)} ELO` : '최소 3경기 필요'}
                            type="success"
                        />
                        <InsightCard
                            title="환장하는 파트너"
                            emoji="🚫"
                            label="웃픈조합"
                            data={playerInsight.worstPartner}
                            footerText={playerInsight.worstPartner ? `${playerInsight.worstPartner.losses}패 / ${Math.round(playerInsight.worstPartner.eloGain)} ELO 손실` : '기록 없음'}
                            type="warning"
                        />
                    </div>
                ) : (
                    <p className="no-data">선수를 선택하면 통계가 표시됩니다.</p>
                )}
            </section>
        </div>
    );
};

/* 내부 컴포넌트: 뱃지 카드 */
const BadgeCard = ({ title, emoji, description, players }) => (
    <div className="stat-card badge-card">
        <div className="card-icon">{emoji}</div>
        <div className="card-content">
            <h3>{title}</h3>
            <p className="card-desc">{description}</p>
            <div className="player-list">
                {players.length > 0 ? (
                    players.map((name, idx) => (
                        <span key={idx} className="player-name">{name}</span>
                    ))
                ) : (
                    <span className="empty-msg">대상자 없음</span>
                )}
            </div>
        </div>
    </div>
);

/* 내부 컴포넌트: 인사이트 카드 */
const InsightCard = ({ title, emoji, label, data, footerText, type }) => (
    <div className={`stat-card insight-card ${type}`}>
        <div className="card-header">
            <span className="card-label">{label}</span>
            <span className="card-emoji">{emoji}</span>
        </div>
        <div className="card-body">
            <h3>{title}</h3>
            <div className="target-name">{data?.name || '---'}</div>
        </div>
        <div className="card-footer">
            {footerText}
        </div>
    </div>
);

export default Dashboard;
