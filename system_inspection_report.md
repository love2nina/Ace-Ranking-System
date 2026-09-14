# 🔍 도토리키재기 시스템 점검 보고서

> 작성일: 2026-09-14  
> 대상 시스템: ACE 랭킹 시스템 (도토리키재기) v7.x  
> 상태: **점검 완료 — 구현 보류**

---

## 📋 점검 항목 요약

| # | 항목 | 심각도 | 현재 상태 |
|---|------|--------|-----------|
| 1 | MMR 관리 및 2026 상반기 DB 이관 | 🔴 높음 | 잠재적 버그 존재 가능 |
| 2 | 랭킹전 종료 시 전체 재계산 구조 | 🟡 중간 | 정상 작동, 설계 개선 여지 있음 |
| 3 | 데이터 로딩 성능 | 🟡 중간 | 최적화 미구현 상태 |
| 4 | 천적·파트너 분석 로직 | 🟠 주의 | 최소 경기 수 제한 미흡 |
| 5 | 참가신청 순위와 랭킹보드 순위 불일치 | 🔴 높음 | 구조적 차이 확인됨 |
| 6 | Firebase DB 구조 개선 가능성 | 🔵 낮음 | 현재 구조는 작동하나 직관성 부족 |

---

## 1️⃣ MMR 관리 및 2026 상반기 DB 이관 문제

### 현재 구조 (코드 기반 분석)

**[engine.js L83-96]** recalculateAll() 실행 시:
```
m.mmr = (m.baseMmr !== undefined) ? m.baseMmr : ELO_INITIAL(1500)
```
- `baseMmr`: 시즌 이관 시점의 이전 시즌 최종 MMR값을 저장하는 기준값
- `mmr`: 재계산 중 실시간으로 변동되는 현재 누적 MMR

**[firebase-api.js L609-614]** 시즌 이관(switchDatabase) 시:
```javascript
const carriedMmr = m.mmr || m.rating || 1500;
return {
    mmr: carriedMmr,
    baseMmr: carriedMmr,  // 이 값이 다음 시즌 재계산의 시작점
    rating: 1500,         // 시즌 내 순위용 ELO는 리셋
}
```

### 의심되는 문제점

#### 문제 A: 2026 상반기 DB 이관 시 baseMmr 누락 가능성
- 구 버전 DB에는 `baseMmr` 필드가 없었을 가능성이 있음
- `baseMmr`이 `undefined`인 멤버는 재계산 시 `mmr = 1500`으로 초기화됨
- 반면, 이관 당시 실제 MMR이 높았던 선수(예: 곽정엽)는 새 시즌에서
  `baseMmr`에 그 값이 기록되지 않고, 현재 시즌 경기 결과만 누산될 경우
  실제보다 낮아야 할 MMR이 높게 나타나는 이상 현상이 발생할 수 있음
- 또는 반대로: 이관 시 `m.mmr || m.rating || 1500` 순서로 fallback하는데,
  구 버전 데이터에서 `mmr` 필드 자체가 없고 `rating`이 높았다면
  `rating`값이 MMR로 이관되어 과도하게 높게 설정될 수 있음

#### 문제 B: 기대승률 계산 기준 MMR 왜곡
- **[engine.js L248-253]** 기대승률은 `sessionStartMmrs`
  (해당 회차 첫 경기 시점의 MMR 스냅샷)를 기준으로 계산
- 이 스냅샷은 `recalculateAll()` 실행 중에만 존재하는 인메모리 값
- 이관 당시 MMR이 잘못 설정되었다면 기대승률도 전체적으로 왜곡됨

### 확인 방법 제안

1. Firebase 콘솔 → `clusters/[2026상반기DB]` 문서 열기
2. `members` 배열에서 곽정엽 등 해당 선수의 필드 확인:
   - `mmr` 현재값
   - `baseMmr` 존재 여부 및 값
   - `rating` 값
3. 이관 이전 DB에서 동일 선수의 시즌 말 `mmr` 값과 비교
4. 불일치 시: 관리자 "시스템 재계산" 버튼은 `baseMmr`을 재설정하지 않으므로,
   Firestore 콘솔에서 직접 `baseMmr` 필드 수정 필요

### 수정 제안 (구현 보류)
- `switchDatabase()` 로직에 `baseMmr` 세팅 검증 로그 추가
- 이관 전 "MMR 사전 스냅샷 확인" 단계 UI 제공
- 이관 후 "MMR 검증 리포트" 자동 생성 기능

---

## 2️⃣ 랭킹전 종료 시 전체 재계산 구조

### 현재 구조 (코드 기반 분석)

**[app.js L954-963]** commitSession() 흐름:
```
1. 현재 경기 결과를 matchHistory 배열에 push (메모리)
2. recalculateAll() 실행 → 전체 히스토리 처음부터 재계산
3. 재계산된 elo_at_match 포함된 신규 경기만 Firestore에 저장 (fbAddHistoryItem)
4. 최종 members 점수를 Firestore에 저장
```

### 현재 상태 평가

- **의도한 바**: 신규 경기 결과를 반영한 후, 그 경기의 `elo_at_match`(ELO 변동 상세)를
  계산하기 위해 전체 재계산 필요
- **실제 저장**: Firestore에는 **신규 경기 문서만** 저장(`fbAddHistoryItem`),
  기존 경기 문서는 건드리지 않음
- **즉, 과거 기록은 덮어쓰기 되지 않음** → 이 부분은 정상 작동

### 주의: 아래 상황에서는 전체 재계산 결과가 DB에 반영됨

```
히스토리 수정(saveEdit)
  → recalculateAll()
  → fbSaveToCloud(members)   ← members 점수 전체 갱신됨
```
- 과거 경기 점수를 수정하면 이후 모든 회차 ELO가 연쇄 변동
- 이 경우 전체 재계산은 필수이며, 최종 `members` 점수가 갱신되는 것은 정상

### 동작 정리

| 동작 | 재계산 범위 | 기존 경기 기록 덮어쓰기 |
|------|-----------|----------------------|
| 랭킹전 종료(commitSession) | 전체 재계산 (메모리) | 없음 — 신규 경기만 추가 |
| 히스토리 점수 수정 | 전체 재계산 (메모리) | 없음 — members 점수만 갱신 |
| 관리자 시스템 재계산 버튼 | 전체 재계산 | elo_at_match 전체 업데이트 |

> **결론**: 이전 경기 결과를 재덮어쓰는 구조는 아님.
> 단, 관리자 시스템 재계산 실행 시에는 모든 elo_at_match가 갱신되므로 유의 필요.

### 수정 제안 (구현 보류)
- `optimization_plan_lazy_recalc.md`에 이미 설계된 Lazy Recalc 방식 채택 검토
  - 로드 시 재계산 제거 → `commitSession` 시에만 계산 후 저장
  - 과거 경기는 기저장된 `elo_at_match` 값 그대로 사용

---

## 3️⃣ 데이터 로딩 성능 문제

### 현재 구조 분석

**[app.js L145-151]** 앱 로드 시 흐름:
```
Firestore onSnapshot (history 수신)
  → matchHistory 갱신
  → recalculateAll() ← 현재는 제거된 상태 (최적화 적용됨, L147 주석 참조)
  → updateRanks() → updateUI()
```

> 이미 `onHistoryLoaded`에서 `recalculateAll()` 호출이 제거된 것이 코드에서 확인됨.
> 따라서 현재는 로딩 시 전체 재계산이 트리거되지 않음.

### 남아있는 성능 부담 요인

| 요인 | 설명 | 심각도 |
|------|------|--------|
| Firestore 첫 로드 지연 | IndexedDB 캐시 미스 시 네트워크 왕복 발생 | 중간 |
| recalculateAll() 잔존 호출 | commitSession(L957), saveEdit(L1421), 수동재계산(L1542) | 정상 |
| updateUI() 무거운 렌더링 | 9개 탭 전체 재렌더링 가능성 | 중간 |
| PWA 서비스워커 캐시 | JS/CSS 캐시는 됨, Firestore 데이터는 별도 관리 | 정상 |

### 핸드폰 vs 시스템 문제 구별 방법

| 확인 항목 | 방법 |
|-----------|------|
| Firestore 로드 시간 측정 | 크롬 DevTools Network 탭 → firestore.googleapis.com 요청 타임 확인 |
| 재계산 시간 측정 | Console에 [Engine] Recalculate Start 로그 타임 확인 |
| 캐시 효과 확인 | 앱 재방문 시 로딩이 빠른지 비교 (IndexedDB 캐시 효과) |
| 핸드폰 단독 문제 | 같은 WiFi에서 PC 브라우저와 속도 비교 |

### 추가 개선 제안 (구현 보류)
- `updateUI()` → 탭별 지연 렌더링 적용 (활성 탭 먼저, 나머지는 idle callback)
- `optimization_plan_lazy_recalc.md`의 Phase 1~4 구현 완료 시 로딩 체감 속도 대폭 향상 예상

---

## 4️⃣ 개인 분석 — 천적·환상의 파트너·웃픈 파트너 현실성 검토

### 현재 구조 (statsService.js 분석)

```javascript
const PARTNER_MIN_GAMES = 3; // 파트너 최소 경기 수 기준
```

#### 천적 (nemesis) — [statsService.js L283-285]
```javascript
const nemesis = antagonists
    .filter(a => a.netEloChange < 0)           // ELO가 순감소한 상대만
    .sort((a, b) => a.netEloChange - b.netEloChange)[0]; // 가장 많이 깎인 상대
```
- **문제점**: 최소 경기 수 필터 없음. 단 1경기에서 지더라도 천적으로 등록될 수 있음
- 예: A가 B를 단 1번 만나 크게 졌다면 B가 A의 천적이 됨 → 신뢰도 낮음
- `prevSeasonStats`(이전 시즌 누적)도 합산하여 멀티 시즌 누적은 됨

#### 환상의 파트너 (bestPartner) — [statsService.js L288-290]
```javascript
const bestPartner = partners
    .filter(p => p.games >= PARTNER_MIN_GAMES && p.winRate >= 0.5) // 최소 3경기 + 50% 이상 승률
    .sort((a, b) => b.winRate - a.winRate || b.eloGain - a.eloGain)[0];
```
- **비교적 합리적**: 3경기 이상 + 승률 50% 이상 필터 존재
- **문제점**: 3경기에서 3승(100% 승률)하면 환상의 파트너. 표본이 너무 적을 수 있음

#### 웃픈 파트너 (worstPartner) — [statsService.js L293-295]
```javascript
const worstPartner = partners
    .filter(p => p.games >= PARTNER_MIN_GAMES && (p.losses / p.games) > 0.5) // 최소 3경기 + 패율 50% 초과
    .sort((a, b) => b.losses - a.losses || a.eloGain - b.eloGain)[0];
```
- **비교적 합리적**: 3경기 이상 + 패율 50% 초과 필터 존재
- **문제점**: 전체 경기 수가 적은 초기 시즌에는 왜곡 발생 가능

### 핵심 문제: 천적 판정의 최소 경기 수 제한 부재

| 항목 | 현재 최소 기준 | 권장 최소 기준 |
|------|--------------|--------------|
| 천적 | 없음 (1경기도 가능) | 최소 3경기 이상 |
| 환상의 파트너 | 3경기 | 5경기 (더 신뢰성 높음) |
| 웃픈 파트너 | 3경기 | 5경기 (더 신뢰성 높음) |

### 수정 제안 (구현 보류)

```javascript
// 천적 — 최소 경기 수 필터 추가 권장
const NEMESIS_MIN_GAMES = 3; // 현재 없음 → 추가 필요

const nemesis = antagonists
    .filter(a => a.games >= NEMESIS_MIN_GAMES && a.netEloChange < 0) // 추가 필요
    .sort((a, b) => a.netEloChange - b.netEloChange)[0];
```

```javascript
// 파트너 최소 기준 상향 검토
const PARTNER_MIN_GAMES = 5; // 3 → 5으로 상향 시 신뢰도 향상
```

- UI에 "(n경기 기준)" 표시 추가로 투명성 제고

---

## 5️⃣ 참가신청 순위 vs 랭킹보드 순위 불일치

### 현재 구조 분석

#### 참가신청 탭의 순위 표시 — [ui.js L170-173]
```javascript
const info = rankMap.get(String(a.id));
// rankMap은 현재 시즌 rating 기반으로 실시간 계산된 순위
const rankLabel = (info && hasMatches)
    ? `(${info.rank})`   // rankMap의 rank 사용
    : `(New)`;
```

#### 랭킹보드(종합 랭킹 탭)의 순위 — [app.js L711-717]
```javascript
function recalculateAll() {
    engineRecalculateAll({
        members, matchHistory, rankMap, sessionRankSnapshots, ...
    });
}
```
- `rankMap`은 `recalculateAll()` 실행 후 갱신됨
- 랭킹보드도 동일한 `rankMap` 기반

#### 히스토리 선수별 뷰의 순위 — [ui.js L892-893]
```javascript
// 해당 회차 종료 시점의 스냅샷 순위(sessionRankSnapshots)를 우선 참조
const sSnapshot = sessionRankSnapshots?.[sNum.toString()] || {};
```
- `sessionRankSnapshots`: commitSession 종료 시 저장된 **당시 회차 기준 순위**

### 불일치 원인 분석

| 화면 | 순위 기준 | 정렬 기준 |
|------|----------|----------|
| 참가신청 탭 이름 옆 순위 | rankMap.rank | members.rating (현재 시즌 ELO) |
| 종합 랭킹보드 | rankMap.rank | members.rating (현재 시즌 ELO) |
| 히스토리 선수별 뷰 순위 | sessionRankSnapshots | 해당 회차 종료 시점 순위 |

**원인 1 — rankMap 갱신 타이밍 불일치**:
- 앱 로드 시 `onDataLoaded`(members 수신)와 `onHistoryLoaded`(history 수신)
  타이밍이 달라, rankMap이 불완전한 상태에서 렌더링될 수 있음
- members만 있고 history 없이 rankMap을 계산하면 당연히 순위가 달라짐

**원인 2 — updateRanks() vs recalculateAll() 차이**:
- `updateRanks()`: `members.rating` 기반으로 단순 정렬하여 `rankMap` 갱신
- `recalculateAll()`: 전체 경기 기록 재연산 후 `members.rating` 갱신 → `rankMap` 갱신
- 로드 시 `recalculateAll()`이 제거된 상태에서 DB의 `rating`값이 최신이 아닌 경우
  불일치 발생 가능

**원인 3 — 동률 처리 방식 차이**:
- `rankMap` 계산 시 동점자 처리 로직이 랭킹보드 렌더링과 미세하게 다를 수 있음

### 수정 제안 (구현 보류)

1. `updateRanks()`와 랭킹보드 정렬 기준을 동일하게 통일
2. `onDataLoaded`와 `onHistoryLoaded` 양쪽 모두 수신 완료 후 rankMap 갱신하는 구조로 개선
3. 참가신청 탭의 순위는 `rankMap` 의존에서 `members.rating` 직접 정렬 기반으로 독립 계산 검토
4. 디버깅용: 콘솔에 `rankMap` vs `members` 정렬 비교 로그 추가 (임시)

---

## 6️⃣ Firebase DB 구조 개선 가능성

### 현재 구조
```
Firestore
├── system/
│   ├── settings           → active_cluster, admin_pw, courtConfigs
│   └── sessionStatus_{db} → status, sessionNum, info, matchMode
├── clusters/
│   └── {dbName}/          → members[], currentSchedule[], applicants[]
│       ├── history/        → 경기 기록 (서브컬렉션, 문서별 1경기)
│       └── reports/        → 회차별 AI 리포트 (서브컬렉션)
├── videos/                → 영상 자료실
└── achievements/          → 외부 대회 입상 기록
```

### 제안하는 개선 구조 (직관적 계층화)

```
Firestore
├── system/
│   └── settings           → 전역 설정 (변경 없음)
│
└── seasons/               ← "clusters" → "seasons"로 명칭 변경
    └── {seasonName}/      (예: "2026_1", "2026_2")
        ├── (doc)          → sessionStatus, applicants[], currentSchedule[]
        │
        ├── members/       ← 배열 → 서브컬렉션으로 변경
        │   └── {memberId}/
        │       └── (doc)  → name, rating, mmr, baseMmr, matchCount, ...
        │
        ├── matches/       ← "history" → "matches"로 명칭 변경
        │   └── {matchId}/ → 경기 1건 (변경 없음)
        │
        ├── reports/       → AI 리포트 (변경 없음)
        └── snapshots/     → 회차별 순위 스냅샷 (변경 없음)
```

### 제안 구조의 장단점 분석

| 항목 | 현재 구조 | 제안 구조 |
|------|----------|----------|
| members 저장 방식 | 문서 내 배열 (최대 1MB 제한) | 서브컬렉션 (무제한 확장) |
| 멤버 1명 수정 | 전체 members 배열 덮어쓰기 | 해당 멤버 문서만 업데이트 |
| 읽기 비용 | members 전체 항상 로드 | 필요한 멤버만 선택적 로드 가능 |
| 마이그레이션 비용 | — | 높음 (전체 재구성 필요) |
| 코드 수정 범위 | — | firebase-api.js 전체, app.js 대부분 |
| 실시간 구독 | history 서브컬렉션 구독 | members 서브컬렉션도 별도 구독 필요 |

### 현실적 제약

- 현재 members가 **배열**로 저장되어 있어 `fbSaveToCloud()`가 배열 전체를 덮어씀
- 멤버 수가 많아질수록 문서 크기가 커지지만, **아직 1MB 한계에 근접하지 않음**
- 구조 변경 시 `firebase-api.js`, `app.js`, `engine.js` 등 핵심 파일 전면 수정 필요
- **현재 시스템이 정상 작동 중인 상황에서 구조 변경은 높은 위험 부담**

### 현실적 개선 방향 (구현 보류)

전면 재구조화 대신 **점진적 개선** 권장:

1. **단기**: 명칭만 정리 (clusters → seasons, history → matches) — 새 시즌 생성 시 적용
2. **중기**: members를 서브컬렉션으로 분리 — 멤버 수 100명 이상이 될 경우 검토
3. **장기**: 전면 재구조화 — 시스템 v2.0 개발 시 반영

---

## 📌 종합 우선순위 및 액션 아이템

### 즉시 확인 필요 (수동 점검 — 코드 수정 없이 가능)
- [ ] Firebase 콘솔에서 곽정엽 등 의심 선수의 `mmr`, `baseMmr` 필드 값 직접 확인
- [ ] 이전 시즌 DB에서 해당 선수의 시즌 말 MMR과 현재 `baseMmr` 비교
- [ ] PC 브라우저와 핸드폰에서 로딩 속도 비교 테스트

### 구현 시 우선순위 (추후 진행)

| 우선순위 | 항목 | 예상 공수 |
|---------|------|---------|
| P1 (높음) | 천적 판정 최소 경기 수 필터 추가 (`statsService.js` 1줄) | 소 (5분) |
| P1 (높음) | 참가신청 순위 불일치 원인 코드 디버깅 | 중 (1시간) |
| P2 (중간) | Lazy Recalc 구현 (optimization_plan_lazy_recalc.md 참조) | 대 (반나절) |
| P3 (낮음) | DB 구조 개선 | 매우 큰 (전면 재작성 수준) |

---

*본 문서는 코드 정적 분석 기반으로 작성되었습니다.*
*실제 Firebase 콘솔 데이터 확인 및 런타임 테스트를 통한 추가 검증이 필요합니다.*
