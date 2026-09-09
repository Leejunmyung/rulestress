# RuleStress Product (Plan B) — Design

- 날짜: 2026-09-09
- 전제: 엔진(Plan A)이 `master`에 머지됨. Gate 1 PASS. 49 테스트.
- 대상: Wanted AI Championship 2026, 마감 9/20 (~11일 남음, 솔로)
- 스코프: A안 (데모 1개 + 가벼운 벤치마크 변형 2개)
- 관련: `2026-09-08-rulestress-core-design.md` §10(benchmark), §11(스택/디렉토리)

---

## 0. 목표

엔진을 감싸는 최소 제품:
- 구조화 입력 → Web Worker에서 BFS → trace 결과 → Before/After
- counterexample를 LLM이 자연어로 설명 + risk label (LLM은 숫자 안 만짐)
- LLM-Direct baseline과 비교표 (RuleStress의 실행검증 가치 입증)
- 랜딩 + Vercel 배포

**바뀌지 않는 것:** 엔진(`src/domain`, `src/rules`, `src/simulation`, `src/invariants`, `src/search`, `src/scenarios`, `src/shared`)은 그대로 재사용. UI는 그 위에 올라간다.

---

## 1. 스키마 하드닝 (엔진 후속 이슈 #5 — 이제 마감)

UI/LLM이 `RulesSpec`을 작성하기 시작하므로 로더가 실제 검증기가 되어야 한다.

`src/domain/schema.ts` 변경:
- `EffectTemplate.primitive`: `z.string()` → `z.enum([...PrimitiveType 11종])`
- primitive별 필수 인자 맵 추가. 예:
  ```
  ISSUE_REWARD: ['identityId', 'amount', 'sourceOrderId']
  RECLAIM_REWARD: ['sourceOrderId', 'limit']
  RECLAIM_REWARD_FULL: ['sourceOrderId']
  SET_FLAG: ['identityId', 'key', 'value']
  ...
  ```
  `loadScenario`가 각 effect template의 `args` 키가 필수 인자를 모두 포함하는지 확인, 아니면 `Error` ("effect <primitive> missing required arg <name>").
- 잘못된 primitive/누락 인자는 **BFS 진입 전에** 거부된다.

기존 계약(sequential id, 내부 불변식, non-negative int)은 유지. 테스트 3~4개 추가.

---

## 2. 아키텍처 — Next.js + Web Worker

```
package.json     — next, react, react-dom, tailwindcss 추가. "type": "module" 유지 여부는
                   Next 요구에 맞춤 (Next 15는 ESM OK). vitest 설정 영향 없게.
next.config.ts   — 기본. Worker 지원은 Next 15 기본 webpack5로 동작
app/
  layout.tsx     — Tailwind, 다크 기본
  page.tsx       — 랜딩
  simulate/page.tsx  — 입력 → 실행 → 결과 → Before/After (단일 화면, 클라이언트 컴포넌트)
  api/explain/route.ts  — LLM explain (서버, Node runtime)
src/
  workers/
    bfs.worker.ts   — onmessage: { scenario, rules } → postMessage(SearchResult)
                      import { bfs } from '../search/bfs.js'. 순수 엔진이라 Worker에서 그대로 돈다.
  ui/
    lib/worker-client.ts  — runSearch(scenario, rules): Promise<SearchResult>. Worker 1회성 생성/종료.
    lib/serialize.ts      — SearchResult(중첩 state 포함)는 structured-clone 가능하므로 postMessage 그대로. 확인만.
    components/            — RuleEditor, InvariantView, TraceView, StateDeltaTable, BeforeAfterPanel, ExplainCard
  llm/
    provider.ts     — callLLM(system, user): Promise<string>. Anthropic SDK 얇게. 키는 process.env.ANTHROPIC_API_KEY
    explain.ts      — explainCounterexample(trace, violations): { rootCause: string, riskLabel: string }
  benchmark/
    scenarios/      — reward-settlement 는 src/scenarios 재사용 + coupon-double.ts, repurchase-double.ts
    runner.ts       — 각 시나리오에 bfs 실행 → { detected, steps, netValue }
    llm-direct.ts   — §10 공정비교: 동일 initialState/action+precondition/param/bounds/실행규칙을 프롬프트에 넣고
                      LLM이 낸 시퀀스를 simulator에 replay (length ≤ maxDepth, param ∈ 후보, precondition 통과, 실제 위반)
```

- **결정론 유지**: Worker도 같은 엔진 코드. LLM 호출은 explain/benchmark에만, 검색 경로엔 없음.
- **배포**: Vercel. `/api/explain`는 Node runtime. `ANTHROPIC_API_KEY`는 Vercel 환경변수.
- **GitHub**: 배포 전 레포 생성 필요 (사용자가 `gh repo create` 또는 웹).

---

## 3. 입력 화면 (`/simulate`)

단일 클라이언트 컴포넌트. 상태는 로컬(useState) — 서버 상태 없음, URL 상태는 P1.

- **프리셋**: "Reward Settlement" 선택 → `rewardSettlementScenario`를 편집 가능한 형태로 폼에 로드
- **규칙 리스트**: 각 규칙 = trigger + conditions + effects. 편집 UI는 최소 —
  - MVP: 규칙별 JSON textarea + Zod 검증 표시 (완전 폼 빌더는 P2)
  - "clawback 규칙"만 프리셋 토글로 BUGGY ↔ FIXED 전환 (Before/After 데모용)
- **Invariant**: 읽기 전용 표시 (AI 제안은 P1) — `no_benefit_after_cancel` 요약 문구
- **Bounds/params**: 표시, 편집은 P1
- **[Run]** → `runSearch` → 결과 영역

## 4. 결과 화면

- **헤더**: `Verified Counterexample` 또는 `No violation found within explored bounds (N states, depth ≤ D)`
- **Violated Intent**: invariant id + 자연어 요약
- **Trace**: 스텝 카드 리스트. 각 카드 = 액션 + 그 액션이 바꾼 상태 필드 (StateDeltaTable: before → after, 변한 것만 하이라이트)
- **Economic Impact**: `Net Extracted Value = ₩10,000` — simulator 계산값 (`identityNetExtractedValue(finalState, 'id1')`)
- **[Explain]** → `/api/explain` 호출 → ExplainCard (root cause 문단 + risk label 배지). 로딩/에러 처리.

## 5. Before / After

- clawback 토글을 FIXED로 바꾸고 **[Re-run]** (동일 bounds)
- BeforeAfterPanel: 좌 "Before: Verified Counterexample, Net ₩10,000" / 우 "After: No violation found within explored bounds"
- 규칙 diff 표시 (한 줄: `RECLAIM_REWARD` → `RECLAIM_REWARD_FULL`)

## 6. 벤치마크 (가벼운 변형)

3개 시나리오, 전부 엔진 재사용:
1. **Reward Settlement** (기존) — 3-step, Net ₩10,000
2. **Repurchase Double** — R1을 "1인 1회"로 안 막았을 때 2회 구매로 20,000P. 2-step. (decoy invariant `max_benefit_per_identity ≤ 10000`를 이 시나리오에서만 씀)
3. **Coupon Double** — 쿠폰 1장을 두 주문에 적용 가능한 규칙 허점. `APPLY_DISCOUNT` primitive + `coupon.used` 플래그 미체크. 2~3-step.
   - 새 primitive/entity 필요 → 엔진에 `Coupon` 최소 추가 (couponId, discount, minAmount, used) + `APPLY_COUPON` 액션 + `APPLY_DISCOUNT` primitive. **이건 엔진 확장** → 별도 태스크, 신중히.
   - 시간 압박 시 시나리오 3은 컷하고 1+2로 벤치마크.

**LLM-Direct 비교표** (§10 공정비교 원칙 엄수):
| 시나리오 | LLM-Direct: 실행검증 통과 | RuleStress |
|---|---|---|
| Reward Settlement | ? | ✅ 3-step, Net ₩10,000 |
| Repurchase Double | ? | ? |
| Coupon Double | ? | ? |

숫자는 **실측 후에만**. 러너가 자동 생성.

---

## 7. 랜딩

- Hero: "이벤트는 정상 사용자를 기준으로 테스트합니다. 어뷰저는 정상적으로 사용하지 않습니다."
- 한 줄 설명 + [내 이벤트 스트레스 테스트하기] → `/simulate?preset=reward-settlement`
- 핵심 기술 4가지 (AI Formalization / Finite Abstraction / Deterministic Simulation / Bounded Exhaustive Search) 간단히

---

## 8. 우선순위 / 컷 순서

**P0** (데모 필수):
- 스키마 하드닝
- Next 스캐폴드 + Worker + `runSearch`
- `/simulate` 입력(프리셋 + clawback 토글) + 결과 trace + Net Value
- Before/After
- LLM explain
- 랜딩 + 배포

**P1** (여유되면):
- 벤치마크 시나리오 2 (Repurchase Double) + 러너 + LLM-Direct 표
- 규칙 JSON 편집 + Zod 검증 표시
- Bounds/params 편집

**P2 / 컷**:
- 벤치마크 시나리오 3 (Coupon Double — 엔진 확장 필요)
- 완전 폼 규칙 빌더
- Share URL, 애니메이션, AI invariant 제안, 자연어 컴파일러

---

## 9. 한계 / 가정

1. 규칙 편집은 MVP에서 JSON + 검증 (폼 빌더 아님)
2. 자연어 → RulesSpec 컴파일러는 이 제품에도 없음 (구조화 입력만). "AI"는 explain + risk label + (P1) LLM-Direct 비교
3. LLM은 검색 경로에 없다 — explain과 benchmark baseline에만
4. 벤치마크 시나리오는 엔진 액션 3종 재사용 (시나리오 3만 예외, P2)
5. 단일 identity 유지
6. Vercel 배포, 로그인 없음, `ANTHROPIC_API_KEY` 환경변수 필요

---

## 10. Gate 2 (제품 성공 판정)

1. `/simulate`에서 프리셋 로드 → Run → 3-step trace + Net ₩10,000 표시
2. clawback 토글 FIXED → Re-run → "No violation found within explored bounds", Before/After 비교 렌더
3. Explain 클릭 → LLM이 root cause 문단 + risk label 반환
4. 배포된 URL에서 로그인 없이 1~3 동작
5. (P1) 벤치마크 러너가 최소 2개 시나리오 + LLM-Direct 비교표 생성
