# ACE 랭킹 시스템 - 고도화 대시보드 사용 가이드

본 가이드는 새롭게 작성된 `statsService.js`와 `Dashboard.jsx`를 프로젝트에 통합하는 방법을 설명합니다.

## 📂 파일 구조
- `statsService.js`: 경기 데이터 분석 로직 (Immutable Pure Functions)
- `components/Dashboard.jsx`: 리액트 기반 대시보드 UI
- `components/Dashboard.css`: 프리미엄 디자인 스타일 시트

## 🚀 통합 방법

### 1. 리액트 환경 구성 (Vite 추천)
현재 바닐라 JS 환경에서 리액트로 마이그레이션 중이라면 다음과 같이 설치합니다:
```bash
npm install react react-dom
```

### 2. 데이터 전달 및 렌더링
`app.js` 등에서 관리하는 `members`와 `matchHistory` 데이터를 리액트 루트에서 전달합니다.

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './components/Dashboard';

// 전역 변수 또는 Firebase로부터 받은 데이터
const data = {
  members: window.members,
  matchHistory: window.matchHistory
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Dashboard {...data} />);
```

## 🛠 주요 로직 및 타이브레이크 규칙 (Tie-break)
사용자 피드백을 반영하여 다음과 같은 정교한 판별 기준을 적용했습니다:

- **🥇 베이글 장인**: `6:0` 완승 기록이 1회라도 있는 선수 리스트.
- **🔥 불타는 연승**: 최신 경기부터 역순으로 탐색하여 진행 중인 연승(3회 이상)만 집계.
- **🤝 환상의 파트너**: 최소 3경기 이상 출전 / 승률이 같을 경우 **획득한 ELO 합계**가 높은 사람 우선.
- **🚫 환장하는 파트너**: 패배 횟수가 같을 경우 **잃은 ELO 합계**가 더 큰 사람 우선.

## 🎨 스타일 커스텀
`Dashboard.css`는 기존 프로젝트의 CSS 변수(`--accent-color`, `--text-primary` 등)를 참조하도록 설계되었습니다. `style.css`에 정의된 테마와 자연스럽게 어우러집니다.
