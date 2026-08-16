# ⚡ ACE 랭킹 시스템 — 로딩 부하 최적화 계획

> 작성일: 2026-06-22  
> 목표: 앱 로드 시마다 발생하는 전체 타임라인 재계산 제거  
> 상태: **미구현 (설계 완료)**

---

## 📌 문제 정의

### 현재 로드 흐름 (문제 있음)

```
앱 실행
  └─ onHistoryLoaded (Firestore history 수신)
       └─ recalculateAll() ← ⚠️ 전체 경기 기록을 처음부터 재계산
            └─ 모든 회차 × 모든 경기 순차 처리
            └─ ELO 누산, 세션 스냅샷 생성, elo_at_match 계산
  └─ fbSubscribeToAchievements (입상 기록 수신)
       └─ recalculateAll() ← ⚠️ 또 전체 재계산
```

**결과**: 회차가 늘수록 로딩 시간이 선형으로 증가. 현재 약 10회차 이상 누적 시 명확한 지연 발생.

---

## ✅ 개선 목표

| 항목 | 현재 | 목표 |
|------|------|------|
| 앱 로드 시 재계산 | 매번 전체 실행 | **제거** (DB 캐시값 직접 사용) |
| `recalculateAll()` 실행 시점 | 로드/수정/입상등록마다 | **관리자 "시스템 재계산" 버튼 클릭 시에만** |
| `commitSession()` 종료 시 | 재계산 후 DB 저장 | 유지 (회차 종료는 계산 필수) |
| 히스토리 수정 시 | 재계산 실행 | 유지 (과거 수정 → 전체 재계산 필수) |

---

## 🔍 각 기능별 상세 분석

### 1. ELO 막대 차트 (`renderEloChart` → `tab-compare`)
- **현황**: `members.rating` 값을 막대 차트로 표시. `sessionRankSnapshots` 미사용.
- **재계산 필요 여부**: ❌ 불필요
- **개선 방법**: 현재도 DB에서 읽은 `members.rating`을 그대로 씀. 변경 없음.

---

### 2. 개인 성장 추이 차트 (`renderPlayerTrend` → `tab-insight`)
- **현황**: `matchHistory` 전체를 루프하며 `elo_at_match.change1/change2`를 누산해 그래프 생성.
- **재계산 필요 여부**: ❌ 불필요 (단, 전제 조건 있음)
- **전제 조건**: 각 경기 문서에 `elo_at_match` 필드가 저장되어 있어야 함.
  - `runFullSystemRecalculate()` 를 **한 번 실행**하면 모든 기존 경기에 `elo_at_match` 저장됨.
  - 이후 `commitSession()` 시 자동으로 신규 경기에 `elo_at_match` 저장되도록 수정 필요.
- **개선 방법**: `recalculateAll()` 호출 없이 DB에서 읽은 matchHistory의 `elo_at_match` 값을 그대로 사용.

---

### 3. 히스토리 "선수별 뷰" 당시 순위 (`sessionRankSnapshots`)
- **현황**: 히스토리 탭 > 선수별 보기에서 "(3위)" 같은 당시 순위 표시에 사용.
- **재계산 필요 여부**: △ 선택적 (부차적 기능)
- **개선 방법 옵션**:
  - **Option A (권장)**: `commitSession()` 시점에 `sessionRankSnapshots`를 Firestore에 별도 저장
    - 저장 경로: `clusters/{dbName}/snapshots/{sessionNum}`
    - 로드 시 해당 컬렉션에서 읽어옴
  - **Option B (간단)**: 현재 `rankMap` (최신 순위)으로 대체 표시
    - 과거 회차의 "당시 순위"가 아닌 "현재 순위"를 표시하게 됨 (정확도 낮아짐)
    - UI에 "※ 현재 기준 순위" 안내문 추가로 커버 가능

---

### 4. `members` ELO/MMR 점수
- **현황**: 재계산 결과로 도출되지만, `commitSession()` 종료 시 DB에 이미 저장됨.
- **재계산 필요 여부**: ❌ 불필요
- **개선 방법**: 로드 시 DB의 `members` 값을 그대로 사용.

---

### 5. 뱃지 계산 (`calculateBadges` in `statsService.js`)
- **현황**: `matchHistory` 루프 (베이글 횟수, 연승 등 집계).
- **재계산 필요 여부**: ⚠️ 현재 방식 유지 필요 (경량)
- **참고**: `matchHistory`에서 단순 필터/집계만 하므로 엔진 재계산과 무관함. 그대로 유지.

---

## 🛠️ 구현 계획

### Phase 0: 사전 준비 (일회성)
> **관리자 작업**: 앱에서 "시스템 재계산" 버튼 한 번 실행
- 모든 기존 경기 문서에 `elo_at_match` 저장 완료
- 이후 `commitSession()`이 신규 경기에 자동으로 저장하도록 수정

---

### Phase 1: `commitSession()` 수정 (app.js)

**현재 코드 (app.js L900~946)**:
```javascript
async function commitSession() {
    for (const m of currentSchedule) {
        // 경기를 history에 추가 (elo_at_match 없음)
        await fbAddHistoryItem(historyItem);
    }
    recalculateAll(); // ← 재계산으로 elo_at_match 생성
    await fbSaveToCloud({ members, ... });
}
```

**수정 후**:
```javascript
async function commitSession() {
    // 1. 먼저 로컬 재계산 실행 (elo_at_match 계산 목적)
    recalculateAll();

    // 2. 재계산된 elo_at_match가 포함된 상태로 history 저장
    for (const m of currentSchedule) {
        const historyItem = {
            ...m,
            elo_at_match: m.elo_at_match || null, // 계산된 값 포함
        };
        await fbAddHistoryItem(historyItem);
    }

    // 3. sessionRankSnapshots도 DB에 저장 (Option A 선택 시)
    const sessionNum = currentSchedule[0]?.sessionNum;
    if (sessionNum && sessionRankSnapshots[sessionNum]) {
        await fbSaveSessionSnapshot(sessionNum, sessionRankSnapshots[sessionNum]);
    }

    // 4. members 최종값 저장
    await fbSaveToCloud({ members, currentSchedule: [], applicants: [] }, 'commitSession:final');
}
```

---

### Phase 2: 로드 시 `recalculateAll()` 제거 (app.js)

**현재 코드 (app.js L137~143)**:
```javascript
onHistoryLoaded: (historyList) => {
    matchHistory = historyList;
    recalculateAll(); // ← 제거 대상
    updateUI();
},
```

**수정 후**:
```javascript
onHistoryLoaded: (historyList) => {
    matchHistory = historyList;
    // recalculateAll() 제거
    // members는 DB에서 이미 올바른 값으로 로드됨 (onDataLoaded에서)
    updateRanks(); // 순위 맵만 가볍게 갱신
    updateUI();
},
```

**현재 코드 (app.js L189~206)**:
```javascript
fbSubscribeToAchievements(async (list) => {
    achievements = list;
    recalculateAll(); // ← 제거 대상
    updateUI();
});
```

**수정 후**:
```javascript
fbSubscribeToAchievements(async (list) => {
    achievements = list;
    // recalculateAll() 제거
    // 입상 보너스는 등록 시 members.mmr에 즉시 반영되므로 (processAddAchievement) 재계산 불필요
    updateUI();
});
```

---

### Phase 3: `firebase-api.js`에 sessionSnapshot 저장 함수 추가 (Option A 선택 시)

```javascript
/**
 * 회차 종료 시 순위 스냅샷을 Firestore에 저장
 * @param {string|number} sessionNum - 회차 번호
 * @param {Object} snapshot - { memberId: rank } 형태의 순위 객체
 */
export async function saveSessionSnapshot(sessionNum, snapshot) {
    const { doc, setDoc } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? 'clusters' : `clubs/${currentClubId}/clusters`;
    const snapRef = doc(db, clusterPath, currentDbName, 'snapshots', String(sessionNum));
    try {
        await setDoc(snapRef, { ranks: snapshot, savedAt: new Date().toISOString() });
    } catch (e) {
        console.error('[Firebase] saveSessionSnapshot Error:', e);
    }
}

/**
 * 앱 로드 시 저장된 순위 스냅샷을 일괄 로드
 */
export async function loadSessionSnapshots() {
    const { collection, getDocs } = window.FB_SDK;
    const clusterPath = currentClubId === 'Default' ? 'clusters' : `clubs/${currentClubId}/clusters`;
    const snapCol = collection(db, clusterPath, currentDbName, 'snapshots');
    try {
        const snap = await getDocs(snapCol);
        const result = {};
        snap.forEach(d => { result[d.id] = d.data().ranks; });
        return result;
    } catch (e) {
        console.error('[Firebase] loadSessionSnapshots Error:', e);
        return {};
    }
}
```

---

### Phase 4: 앱 초기화 시 snapshot 로드 (app.js)

```javascript
async function init() {
    // ... 기존 Firebase 초기화 ...
    await initFirebase(callbacks);

    // 순위 스냅샷 로드 (Option A)
    sessionRankSnapshots = await loadSessionSnapshots();

    // ... 나머지 초기화 ...
}
```

---

## ⚠️ 주의사항 및 예외 처리

### 히스토리 수정 시 (saveEdit)
- 과거 경기 점수/선수를 수정하면 이후 모든 회차 ELO가 변동됨
- **전체 재계산 필수**: 유지
- 단, 수정 후 반드시 `runFullSystemRecalculate()` 실행 또는 자동 호출
- UI에 "수정 후 시스템 재계산이 필요합니다" 안내 추가 권장

```javascript
// saveEdit() 수정 후 처리
await fbUpdateHistoryItem(editingMatchId, { ... });
alert("수정 완료. 정확한 순위 반영을 위해 '시스템 재계산'을 실행해 주세요.");
// 또는: 자동으로 runFullSystemRecalculate() 호출
```

### `elo_at_match` 미존재 경기 대응
- 구형 데이터에 `elo_at_match`가 없을 경우 차트에 0 처리됨
- `renderPlayerTrend()`에 방어 코드 추가:

```javascript
if (isT1) currentRating += Number(h.elo_at_match?.change1 || 0);
// 이미 있음 (현재 코드도 동일한 방어 처리 중)
```

---

## 📊 기대 효과

| 지표 | 현재 | 개선 후 |
|------|------|---------|
| 앱 로드 시 재계산 횟수 | 2회 (history + achievements) | **0회** |
| `recalculateAll()` 실행 시점 | 로드/수정/입상등록마다 | **관리자 수동 실행 또는 commitSession 시에만** |
| 10회차 기준 로딩 추가 연산 | 전체 히스토리 N건 처리 | **없음** |
| 20회차 기준 로딩 추가 연산 | 전체 히스토리 2N건 처리 | **없음** |
| 데이터 정합성 | 매번 재계산으로 보장 | **commitSession/재계산 버튼으로 보장** |

---

## 📋 구현 체크리스트

### 사전 작업
- [ ] 관리자 계정으로 "시스템 재계산" 1회 실행 (모든 경기에 `elo_at_match` 저장)
- [ ] 실행 후 Firestore 콘솔에서 history 문서에 `elo_at_match` 필드 존재 확인

### 코드 수정
- [ ] `app.js` — `onHistoryLoaded`에서 `recalculateAll()` 제거
- [ ] `app.js` — `fbSubscribeToAchievements`에서 `recalculateAll()` 제거
- [ ] `app.js` — `commitSession()`에서 `recalculateAll()` **먼저** 실행 후 `fbAddHistoryItem()` 호출하도록 순서 변경
- [ ] `app.js` — `commitSession()`에서 `sessionRankSnapshots` DB 저장 추가 (Option A)
- [ ] `firebase-api.js` — `saveSessionSnapshot()` 함수 추가
- [ ] `firebase-api.js` — `loadSessionSnapshots()` 함수 추가
- [ ] `app.js` — `init()`에서 `loadSessionSnapshots()` 호출 추가
- [ ] `app.js` — 히스토리 수정 후 "시스템 재계산 필요" 안내 추가

### 검증
- [ ] 앱 로드 후 종합 랭킹 점수가 DB 저장값과 동일한지 확인
- [ ] 개인 성장 추이 차트가 재계산 없이 올바르게 표시되는지 확인
- [ ] 히스토리 선수별 뷰에서 당시 순위가 표시되는지 확인
- [ ] commitSession 후 신규 경기에 `elo_at_match` 저장 여부 확인
- [ ] 관리자 재계산 버튼 후 전체 수치 정합성 확인
