# RuleStress — 코어 메커니즘 설계

- 날짜: 2026-09-08
- 대상: Wanted AI Championship 2026 (마감 9/20)
- 빌드 조건: 솔로, ~12일, Codex에 구현 다수 위임 전제
- 상태: GPT 외부 검증 완료 (GO), 4건 수정 + decoy invariant 제거 반영

---

## 0. 핵심 주장

개별로는 모두 합리적인 여러 규칙이 특정 행동 순서로 결합될 때 기획 의도(invariant)를
위반하는 경우가 있다. RuleStress는 그 순서를 **미리 알지 못한 상태**에서 bounded
state-space search로 찾아내고, deterministic simulator로 실제 실행 가능함을 증명한다.

- LLM: 자연어 → 구조화 스펙 변환, 결과 설명. **MVP에서는 구조화 입력으로 대체, LLM은 설명(explain)만 담당.**
- Simulator + Search: counterexample 발견과 검증. 결정론적, LLM 없음.

핵심 구분: LLM은 허점을 *제안*할 수 있다. RuleStress는 허점이 *실제로 실행되는지* 증명한다.

---

## 1. 스코프 (A안 — 코어만, 데모 1개에 올인)

**IN**
- Reward Settlement 시나리오 하나에 맞춘 도메인/액션/파라미터
- 그 시나리오가 쓰는 Generic Primitive만 (~10개)
- Deterministic Transition Engine (액션 3개)
- Invariant Evaluator (invariant 1개)
- Bounded BFS + 완전직렬화 canonicalization + visited + trace
- 구조화 입력 UI + trace 결과 UI + Before/After
- 벤치마크 시나리오 3개 + LLM-Direct baseline 비교
- LLM explain endpoint (root cause + risk label)

**OUT (스코프 밖, 후속)**
- 자연어 → RulesSpec 컴파일러 (여유되면 Day 11 얇게 시도, 아니면 컷)
- Parameter Domain Generator 자동화 (시나리오별 수동 지정)
- Time Domain / WAIT 액션
- multi-account / self-referral / 쿠폰
- rule cascading
- 대칭 축소 canonicalization
- 로그인, history, dashboard, share URL, 애니메이션, 다국어, 결제

---

## 2. Domain / State Model

시뮬레이션 상태는 순수 데이터. 단일 identity 기준.

```ts
type SimulationState = {
  currentTime: number;              // 추상 tick. MVP에서는 항상 0 (WAIT 없음)
  identities: Identity[];
  orders: Order[];
  rewards: Reward[];
  liabilities: Liability[];
  ledger: Record<IdentityId, Ledger>;
};

type Identity = { id: string; flags: Record<string, boolean> };

type Order = {
  id: string;
  identityId: string;
  amount: number;                   // 결제 금액 = 상품 가치
  status: 'PAID' | 'CANCELLED';
  paymentKind: 'CASH' | 'POINTS';   // 취소 가능 여부 / 환불 형태 결정
  createdAt: number;
};

type Reward = {
  id: string;
  identityId: string;
  sourceOrderId: string;            // 인과 추적: 어떤 주문이 이 보상을 발생시켰나
  grantedAmount: number;
  remainingAmount: number;
  spentAmount: number;
  reclaimedAmount: number;
};

type Liability = {
  id: string;
  identityId: string;
  amount: number;
  sourceOrderId: string;
};

type Ledger = {
  cashPaid: number;                 // 누적 현금 결제액
  cashRefunded: number;             // 누적 환불액
  goodsRetained: number;            // 현재 보유 상품 가치 (반품분 차감됨, 음수 불가)
  pointsBalance: number;            // 현재 사용 가능 포인트
};
```

### 내부 불변식 (invariant와 별개, 엔진 자체 검증용)

- `pointsBalance[id] == Σ { r.remainingAmount : r.identityId == id }`
- 각 reward: `grantedAmount == remainingAmount + spentAmount + reclaimedAmount`
- `goodsRetained[id] >= 0`

이 세 개는 매 transition 후 assert. 깨지면 엔진 버그.

### Liability 의미 (명시적 가정)

Liability는 단순 레코드가 아니라 **경제적으로 강제되는 채무 / 정산에서 실제 차감되는
마이너스**다. `IDENTITY_NET_EXTRACTED_VALUE`에서 liability를 빼는 계산은 이 가정 위에서만
유효하다. 발표에서 "liability 생성 = 손실 제거"라고 말하려면 이 가정을 함께 명시한다.

---

## 3. Generic Business Primitive — Effect

규칙과 액션이 상태를 바꾸는 유일한 수단. Risk 이름은 들어가지 않는다.
MVP에서 쓰는 것만:

| Primitive | 파라미터 | 의미 |
|---|---|---|
| `CREATE_ORDER` | identityId, amount, paymentKind | 주문 생성 (status=PAID) |
| `SET_ORDER_STATUS` | orderId, status | 주문 상태 변경 |
| `ADD_CASH_PAID` | identityId, value | ledger.cashPaid += value |
| `ADD_CASH_REFUNDED` | identityId, value | ledger.cashRefunded += value |
| `ADD_GOODS` | identityId, value | ledger.goodsRetained += value (음수 가능, 결과는 clamp 안 함 — 음수 되면 엔진 버그) |
| `ISSUE_REWARD` | identityId, amount, sourceOrderId | Reward 생성 (granted=remaining=amount), pointsBalance += amount |
| `SPEND_REWARD` | identityId, amount | remainingAmount>0인 reward를 createdAt 오래된 순으로 소진: remaining -= k, spent += k, pointsBalance -= k |
| `RECLAIM_REWARD` | sourceOrderId, limit | §8의 버그 버전. remaining만 회수 |
| `RECLAIM_REWARD_FULL` | sourceOrderId | §8의 수정 버전. remaining 회수 + 부족분 liability |
| `CREATE_LIABILITY` | identityId, amount, sourceOrderId | Liability 생성 |
| `SET_FLAG` | identityId, key, value | identity.flags[key] = value |

모든 effect는 `apply(state, effect) => state` 순수 함수. 입력 state를 mutate 하지 않고
새 객체 반환 (structural sharing 여부는 구현 재량, 관찰 가능 동작은 동일).

---

## 4. RulesSpec

```ts
type RulesSpec = { rules: Rule[] };

type Rule = {
  id: string;
  trigger: { type: EventType };          // 'ORDER_PAID' | 'ORDER_CANCELLED' | 'POINTS_SPENT'
  conditions: Expr[];                     // AND 결합. 모두 true여야 발화
  effects: EffectTemplate[];              // 순서대로 적용. event 필드 참조 가능
};

// 표현식 AST
type Expr =
  | { op: 'gte'|'lte'|'gt'|'lt'|'eq'|'ne'; left: Ref; right: Ref }
  | { op: 'and'|'or'; args: Expr[] }
  | { op: 'not'; arg: Expr };

type Ref =
  | { field: string }        // 'event.amount' | 'event.orderId' | 'event.paymentKind'
                             // | 'ledger.pointsBalance' | 'identity.flags.<key>'
  | { constant: number | string | boolean };
```

**원칙:** LLM은 JavaScript를 생성하지 않는다. 미리 정의된 이 DSL만 생성한다
(MVP에서는 사람이 폼으로 입력). DSL에 Risk 이름 없음. Risk 라벨은 결과 설명 단계에서만
LLM이 붙인다.

`EffectTemplate`는 §3 Primitive에 파라미터로 리터럴 또는 `{ field: 'event.xxx' }` 참조를
넣을 수 있는 형태. 예: `ISSUE_REWARD(identityId={field:'event.identityId'}, amount=10000,
sourceOrderId={field:'event.orderId'})`.

---

## 5. Action Space (데모 시나리오)

```ts
type Action =
  | { type: 'PURCHASE'; identityId: string; amount: number }
  | { type: 'PURCHASE_WITH_POINTS'; identityId: string; amount: number }
  | { type: 'CANCEL_ORDER'; identityId: string; orderId: string };
```

각 액션의 precondition과 base effect (규칙과 무관하게 항상 실행):

| Action | Precondition | Base Effects (순서대로) | Emits |
|---|---|---|---|
| `PURCHASE(id, amt)` | amt > 0; identity의 order 수 < maxOrders | CREATE_ORDER(id, amt, CASH); ADD_CASH_PAID(id, amt); ADD_GOODS(id, amt) | `ORDER_PAID{orderId, identityId, amount, paymentKind:'CASH'}` |
| `PURCHASE_WITH_POINTS(id, amt)` | pointsBalance[id] >= amt; identity의 order 수 < maxOrders | SPEND_REWARD(id, amt); ADD_GOODS(id, amt); CREATE_ORDER(id, amt, POINTS) | `ORDER_PAID{orderId, identityId, amount, paymentKind:'POINTS'}`, `POINTS_SPENT{identityId, amount}` |
| `CANCEL_ORDER(id, oid)` | order 존재; status==PAID; paymentKind==CASH | SET_ORDER_STATUS(oid, CANCELLED); ADD_CASH_REFUNDED(id, order.amount); ADD_GOODS(id, -order.amount) | `ORDER_CANCELLED{orderId, identityId}` |

모델링 결정:
- **POINTS로 결제한 주문은 취소 불가** (현금 환불 루프 차단). `CANCEL_ORDER` precondition의 `paymentKind==CASH`.
- 액션 의미를 특수화하지 않는다. `PURCHASE_WITH_POINTS`도 일반 `ORDER_PAID`를 emit하고, 정책은 rule이 `event.paymentKind`로 결정한다.

---

## 6. Transition 파이프라인 (결정론)

```
transition(state, action) -> { nextState, events }:
  1. precondition 검사. 실패 시 { invalid: true } 반환 (search가 스킵)
  2. action의 base effects를 순서대로 apply  ->  S1
  3. action이 emit한 events 수집 (위 표의 순서)
  4. 각 event를 emit 순서대로 처리:
       a. matching: trigger.type == event.type 이고 conditions가 S1에서 모두 true인
          rule을 rules 배열 순서대로 "전부 확정" (조건 평가는 전부 S1 스냅샷 기준)
       b. apply: 확정된 rule들의 effects를 rule 순서대로 순차 apply  ->  S2, S3, ...
          (effect 적용 후 다른 rule의 condition을 재평가하지 않는다)
  5. 내부 불변식 assert (§2)
  6. return { nextState, events }
```

- **rule cascading 없음**: rule의 effect가 다시 rule을 트리거하지 않는다. 매칭은 단일
  스냅샷에서 확정. MVP의 명시적 가정. 실제 시스템은 cascade 하기도 함 → 후속 과제.
- 랜덤 없음, wall-clock 없음, 시간 진행 없음. 동일 입력 → 동일 출력.
- 여러 event가 있을 때: event N의 rule effect가 적용된 후 event N+1의 rule matching은
  그 시점 state에서 평가된다 (event 간에는 순차, event 내에서는 스냅샷).

---

## 7. InvariantSpec + Metrics

```ts
type InvariantSpec = { invariants: Invariant[] };

type Invariant = {
  id: string;
  expr: InvExpr;
};

type InvExpr =
  | { op: 'lte'|'gte'|'lt'|'gt'|'eq'; left: MetricRef; right: Ref }
  | { op: 'implies'; when: InvExpr; then: InvExpr }
  | { op: 'forall'; entity: 'order'|'identity'; body: InvExpr };  // body 안에서 'this' 참조
```

### Metric 정의 (정확한 식)

```
IDENTITY_NET_EXTRACTED_VALUE(id) =
    ledger.goodsRetained[id]
  + ledger.cashRefunded[id]
  + ledger.pointsBalance[id]
  - ledger.cashPaid[id]
  - Σ { l.amount : l.identityId == id }

NET_BENEFIT_FROM_ORDER(o) =
    Σ { (r.grantedAmount - r.reclaimedAmount) : r.sourceOrderId == o.id }
  - Σ { l.amount : l.sourceOrderId == o.id }
```

`grantedAmount - reclaimedAmount` = 아직 회수되지 않은 보상 가치 (remaining + spent).

### 데모의 invariant (1개)

| ID | 식 |
|---|---|
| `no_benefit_after_cancel` | `forall order o: (o.status == CANCELLED) implies (NET_BENEFIT_FROM_ORDER(o) <= 0)` |

기획 의도: "전액 환불된(취소된) 주문은 사용자에게 순경제적 혜택을 남기지 않는다."

> decoy invariant(`max_benefit_per_identity`)는 제거했다. `PURCHASE(50000)` 2회로
> depth-2에서 위반되어 "3-step이 최단 반례"라는 데모 서사를 깨기 때문. 별도 벤치마크
> 시나리오로는 재활용 가능.

---

## 8. 데모 시나리오 전체 명세

### 초기 상태
```
currentTime: 0
identities: [ { id: 'id1', flags: {} } ]
orders: []   rewards: []   liabilities: []
ledger['id1']: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 }
```

### 규칙 — 버그 버전
```
R1 purchase_reward:
  trigger:    ORDER_PAID
  conditions: [ event.amount gte 50000,  event.paymentKind eq 'CASH' ]
  effects:    [ ISSUE_REWARD(identityId=event.identityId, amount=10000,
                             sourceOrderId=event.orderId) ]

R2 clawback_on_cancel  (BUGGY):
  trigger:    ORDER_CANCELLED
  conditions: []
  effects:    [ RECLAIM_REWARD(sourceOrderId=event.orderId,
                               limit=ledger.pointsBalance) ]
```

`RECLAIM_REWARD(sid, limit)` 의미 (버그):
```
limitLeft = limit
for r in rewards where r.sourceOrderId == sid (createdAt 오름차순):
    k = min(r.remainingAmount, limitLeft)
    r.remainingAmount  -= k
    r.reclaimedAmount  += k
    pointsBalance       -= k
    limitLeft           -= k
# spentAmount는 절대 건드리지 않음. 부족분 liability 생성 안 함.  <- 버그
```

### 규칙 — 수정 버전 (Before/After에서 교체)
```
R2' clawback_on_cancel  (FIXED):
  trigger:    ORDER_CANCELLED
  conditions: []
  effects:    [ RECLAIM_REWARD_FULL(sourceOrderId=event.orderId) ]
```

`RECLAIM_REWARD_FULL(sid)` 의미:
```
for r in rewards where r.sourceOrderId == sid (createdAt 오름차순):
    unreclaimed = r.grantedAmount - r.reclaimedAmount        # remaining + spent
    fromBalance = min(r.remainingAmount, pointsBalance)
    r.remainingAmount -= fromBalance
    r.reclaimedAmount += fromBalance
    pointsBalance      -= fromBalance
    shortfall = unreclaimed - fromBalance
    if shortfall > 0:
        CREATE_LIABILITY(r.identityId, shortfall, sid)
        r.reclaimedAmount += shortfall    # liability로 회수한 것으로 간주
```

### Bounds
```
maxDepth:   4
maxOrders:  3   (identity당)
identities: 1 (고정)
파라미터 후보:
  PURCHASE.amount            ∈ { 50000, 49999 }   # 49999 = threshold 경계 후보
  PURCHASE_WITH_POINTS.amount ∈ { 10000 }
  CANCEL_ORDER.orderId       = 현재 PAID + CASH 주문 각각
```

### 기대 counterexample trace (버그 버전)

```
State0  cashPaid 0   refunded 0   goods 0   points 0   orders[]   rewards[]

A1: PURCHASE(id1, 50000)
    base: CREATE_ORDER(o1, 50000, CASH); cashPaid 50000; goods 50000
    emit ORDER_PAID{o1, id1, 50000, CASH}
    R1 매칭 (50000>=50000, CASH): ISSUE_REWARD -> reward{r1, src:o1, granted 10000,
                                  remaining 10000}; points 10000
State1  cashPaid 50000   goods 50000   points 10000   orders[o1:PAID]

A2: PURCHASE_WITH_POINTS(id1, 10000)
    pre: pointsBalance 10000 >= 10000  ok
    base: SPEND_REWARD(10000) -> r1 remaining 0, spent 10000; points 0
          ADD_GOODS 10000; CREATE_ORDER(o2, 10000, POINTS)
    emit ORDER_PAID{o2, id1, 10000, POINTS}   (R1 조건 paymentKind==CASH 불충족 -> 미발화)
    emit POINTS_SPENT{id1, 10000}             (매칭 rule 없음)
State2  goods 60000   points 0   rewards[r1: remaining 0, spent 10000]
        orders[o1:PAID, o2:PAID]

A3: CANCEL_ORDER(id1, o1)
    pre: o1 PAID, CASH  ok
    base: SET_ORDER_STATUS(o1, CANCELLED); cashRefunded 50000; ADD_GOODS -50000
    emit ORDER_CANCELLED{o1, id1}
    R2 매칭: RECLAIM_REWARD(src:o1, limit:0)
        r1.remainingAmount = 0 -> k = min(0, 0) = 0 -> 변화 없음
        r1 spent 10000 그대로. liability 없음.
State3  cashPaid 50000   refunded 50000   goods 10000   points 0
        orders[o1:CANCELLED, o2:PAID]
        rewards[r1: granted 10000, remaining 0, spent 10000, reclaimed 0]
        liabilities[]

── Invariant 검사 ──
no_benefit_after_cancel, forall order, o1 (status==CANCELLED):
  NET_BENEFIT_FROM_ORDER(o1)
    = Σ (r.granted - r.reclaimed) for src==o1   = (10000 - 0) = 10000
    - Σ l.amount for src==o1                     = 0
    = 10000   >   0        ❌ VIOLATED

경제 요약:
  IDENTITY_NET_EXTRACTED_VALUE(id1)
    = goods 10000 + refunded 50000 + points 0 - cashPaid 50000 - liab 0
    = 10000
```

**Net Extracted Value = ₩10,000.** 전액 환불된 주문에서 사용자가 상품 1만원어치를 무상 취득.

### 재탐색 결과 (수정 버전, 동일 bound)

```
A3에서 R2' 매칭: RECLAIM_REWARD_FULL(src:o1)
  r1: unreclaimed = 10000 - 0 = 10000
      fromBalance = min(remaining 0, points 0) = 0
      shortfall = 10000 - 0 = 10000  > 0
      -> CREATE_LIABILITY(id1, 10000, o1);  r1.reclaimed = 10000
State3' liabilities[ {10000, src:o1} ]   r1 reclaimed 10000

NET_BENEFIT_FROM_ORDER(o1) = (10000 - 10000) - 10000 = -10000  <= 0   ✓
IDENTITY_NET_EXTRACTED_VALUE = 10000 + 50000 + 0 - 50000 - 10000 = 0   ✓

BFS 결과: "No invariant violation found within explored state space
          (N states, depth <= 4)"
```

### 최단 반례 확인 (외부 검증 완료)

1~2 action으로는 `no_benefit_after_cancel`를 깰 수 없다.
- `PURCHASE(50000) -> CANCEL(o1)`: r1 remaining 10000 -> 전액 reclaim -> `NET_BENEFIT_FROM_ORDER(o1) = 0`. 위반 없음.
- 반드시 reward를 `spent` 상태로 먼저 만들어야 하므로 **최단 반례 = 정확히 3 action.**

BFS에 넘기는 것은 `initialState / actionSpace / RulesSpec / InvariantSpec / bounds`뿐.
expected sequence는 코드 어디에도 없다.

---

## 9. Search

```
bfs(rulesSpec, invariantSpec, initialState, bounds) -> SearchResult:
  queue   = [ initialState ]
  visited = { canonicalKey(initialState) }
  parent  = {}                          # canonicalKey -> { prevKey, action }
  depthOf = { canonicalKey(initialState): 0 }

  while queue not empty:
    s = queue.dequeue()
    if depthOf[key(s)] >= bounds.maxDepth: continue
    for action in validActions(s, bounds):        # precondition 통과 + 파라미터 후보 전개
      { nextState, invalid } = transition(s, action)
      if invalid: continue
      violations = evaluateInvariants(nextState, invariantSpec)
      if violations not empty:
        return { trace: reconstruct(parent, s, action, nextState),
                 violations, explored: visited.size }
      k = canonicalKey(nextState)
      if k in visited: continue
      visited.add(k)
      parent[k]  = { prevKey: canonicalKey(s), action }
      depthOf[k] = depthOf[canonicalKey(s)] + 1
      queue.enqueue(nextState)

  return { trace: null, explored: visited.size }
```

- **canonicalKey (MVP 최소 버전):** 전체 state를 결정론적으로 직렬화. 엔티티 id 그대로,
  배열은 생성 순서 유지, 객체 키 정렬. identity 1개라 대칭 축소 불필요.
  구현: 재귀적으로 키 정렬한 뒤 `JSON.stringify`.
- **validActions:** 각 action 타입 × 시나리오가 준 파라미터 후보. `CANCEL_ORDER`는 현재
  PAID + CASH 주문마다 하나씩 생성.
- **BFS라서 첫 발견 반례가 최단.** 발견 즉시 종료 (all-counterexamples 모드는 스코프 밖).
- Web Worker에서 실행. 메인 스레드에 `{ explored, trace, violations }` 전달.
- 예상 규모: branching ~3-5, depth 4, visited 有 → 수백~수천 state, 1초 미만.

---

## 10. Benchmark 비교 (LLM-Direct baseline)

동일 RulesSpec + InvariantSpec를 자연어로 변환해 프론티어 LLM에 전달:

> "이 프로모션에서 기획 의도를 위반하는 행동 순서를 찾아라. 아래 action 타입만 사용해
> 시퀀스로 답하라: PURCHASE(amount), PURCHASE_WITH_POINTS(amount), CANCEL_ORDER(orderId)."

LLM이 낸 시퀀스를 **RuleStress simulator에 그대로 투입**해서:
- 실제 실행 가능한가? (모든 precondition 통과)
- 정말 invariant를 위반하는가?

3개 시나리오에 대해 표 (숫자는 실제 측정 후에만 채운다):

| 시나리오 | LLM-Direct: 실행검증 통과 | RuleStress |
|---|---|---|
| Reward Settlement | ? | ✅ 3-step, Net ₩10,000 |
| (benchmark 2) | ? | ? |
| (benchmark 3) | ? | ? |

지표: Detection Recall, Executable Counterexample Rate, Intent Violation Precision.

---

## 11. 기술 스택 / 배포

- Next.js 15 (app router) + TypeScript + Tailwind, pnpm
- Web Worker: `new Worker(new URL('./search.worker.ts', import.meta.url))`
- Zod: RulesSpec / InvariantSpec / SimulationState 스키마 검증 (구조화 입력 검증)
- LLM: Vercel API route에서 호출, provider 얇은 추상화. explain + risk label 전용
- 테스트: Vitest
- 배포: Vercel, 로그인 없음

### 디렉토리
```
src/
  domain/       state.ts  entities.ts  primitives.ts  ledger.ts
  rules/        types.ts  expr.ts  engine.ts
  invariants/   types.ts  metrics.ts  evaluate.ts
  simulation/   transition.ts  apply.ts
  search/       actions.ts  bfs.ts  canonical.ts  trace.ts
  scenarios/    reward-settlement.ts  bench-*.ts
  benchmark/    runner.ts  llm-direct.ts
  llm/          explain.ts  provider.ts
  workers/      search.worker.ts
app/
  page.tsx                    # landing
  simulate/page.tsx           # 입력 -> 실행 -> 결과 -> Before/After
```

---

## 12. 명시적 한계 / 가정

1. rule cascading 없음 (1-level trigger, 매칭은 단일 스냅샷)
2. 단일 identity. multi-account / self-referral은 스코프 밖
3. 파라미터 후보는 시나리오별 수동 지정
4. canonicalization은 완전 직렬화 (대칭 축소 없음). bound가 작아 문제없음
5. "No violation found"는 `within explored bounds`이지 `SAFE`가 아니다
6. 경제 계산은 전부 simulator가 수행. LLM은 숫자를 만지지 않는다
7. POINTS 결제 주문은 취소 불가 (모델링 단순화)
8. Liability는 경제적으로 강제되는 채무라고 가정 (§2)
9. 시간 진행 없음 (currentTime 항상 0). WAIT/vesting은 benchmark 단계에서 추가

---

## 13. Gate 1 (구현 성공 판정)

다음 Vitest 테스트가 통과하면 Gate 1 통과:

> expected trace를 코드 어디에도 넣지 않은 상태에서
> (1) 버그 RulesSpec으로 BFS → 정확히 3-step 반례 자동 발견, Net ₩10,000
> (2) 수정 RulesSpec(R2')으로 동일 bound BFS → 반례 없음
> (3) 내부 불변식(§2)이 전 과정에서 한 번도 깨지지 않음

목표일: Day 6 (9/13).
