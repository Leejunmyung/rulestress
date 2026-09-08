# RuleStress Engine + Gate 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic simulation engine + bounded BFS that finds the Reward Settlement counterexample with no hardcoded sequence, and passes Gate 1.

**Architecture:** Pure-function core. `applyEffect` mutates a `structuredClone` and returns it. `transition(state, action, rules)` applies action base effects, emits events, matches rules on each event's entry snapshot, applies rule effects sequentially, asserts internal invariants. `bfs(scenario, rules)` does level-order search over canonicalised states, returning the first (shortest) invariant violation with a full trace.

**Tech Stack:** TypeScript (strict), Vitest, Zod. Node 24, pnpm. No framework in this plan — pure library + tests. Next.js/UI is a separate later plan.

## Global Constraints

- TypeScript strict mode; no `any` in exported signatures (internal `any` in generic helpers is tolerated).
- All money amounts are **non-negative integers**. `ADD_GOODS` value may be negative (reversal); a negative *result* is an engine bug.
- Determinism: no `Date.now()`, no `Math.random()`, no global mutable counters. Entity ids derive from array length only (`o${orders.length+1}`, `r${rewards.length+1}`, `l${liabilities.length+1}`).
- No rule cascading: rule effects never emit events; within one event, rule matching is fixed on that event's entry snapshot.
- Reward consumption order = `rewards` array order (FIFO). No `createdAt`.
- `RECLAIM_REWARD_FULL` is idempotent via `reward.settledByClawback`.
- `reclaimedAmount` holds actually-reclaimed points only; liability-covered shortfall is NOT added to it (keeps `granted == remaining + spent + reclaimed`).
- Demo scenario bounds: `maxDepth: 4`, `maxOrders: 3`, single identity `id1`, params `PURCHASE.amount ∈ {50000, 49999}`, `PURCHASE_WITH_POINTS.amount ∈ {10000}`.

Spec: `docs/superpowers/specs/2026-09-08-rulestress-core-design.md`.

---

### Task 1: Project scaffold + core types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/domain/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type below. Later tasks import from `src/domain/types.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "rulestress",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `src/domain/types.ts`**

```ts
export type IdentityId = string;
export type OrderId = string;
export type RewardId = string;
export type LiabilityId = string;

export type OrderStatus = 'PAID' | 'CANCELLED';
export type PaymentKind = 'CASH' | 'POINTS';

export interface Identity {
  id: IdentityId;
  flags: Record<string, boolean>;
}

export interface Order {
  id: OrderId;
  identityId: IdentityId;
  amount: number;
  status: OrderStatus;
  paymentKind: PaymentKind;
}

export interface Reward {
  id: RewardId;
  identityId: IdentityId;
  sourceOrderId: OrderId;
  grantedAmount: number;
  remainingAmount: number;
  spentAmount: number;
  reclaimedAmount: number;
  settledByClawback: boolean;
}

export interface Liability {
  id: LiabilityId;
  identityId: IdentityId;
  amount: number;
  sourceOrderId: OrderId;
}

export interface Ledger {
  cashPaid: number;
  cashRefunded: number;
  goodsRetained: number;
  pointsBalance: number;
}

export interface SimulationState {
  currentTime: number;
  identities: Identity[];
  orders: Order[];
  rewards: Reward[];
  liabilities: Liability[];
  ledger: Record<IdentityId, Ledger>;
}

export type EventType = 'ORDER_PAID' | 'ORDER_CANCELLED' | 'POINTS_SPENT';

export interface SimEvent {
  type: EventType;
  identityId: IdentityId;
  orderId?: OrderId;
  amount?: number;
  paymentKind?: PaymentKind;
}

export type Effect =
  | { primitive: 'CREATE_ORDER'; identityId: IdentityId; amount: number; paymentKind: PaymentKind }
  | { primitive: 'SET_ORDER_STATUS'; orderId: OrderId; status: OrderStatus }
  | { primitive: 'ADD_CASH_PAID'; identityId: IdentityId; value: number }
  | { primitive: 'ADD_CASH_REFUNDED'; identityId: IdentityId; value: number }
  | { primitive: 'ADD_GOODS'; identityId: IdentityId; value: number }
  | { primitive: 'ISSUE_REWARD'; identityId: IdentityId; amount: number; sourceOrderId: OrderId }
  | { primitive: 'SPEND_REWARD'; identityId: IdentityId; amount: number }
  | { primitive: 'RECLAIM_REWARD'; sourceOrderId: OrderId; limit: number }
  | { primitive: 'RECLAIM_REWARD_FULL'; sourceOrderId: OrderId }
  | { primitive: 'CREATE_LIABILITY'; identityId: IdentityId; amount: number; sourceOrderId: OrderId }
  | { primitive: 'SET_FLAG'; identityId: IdentityId; key: string; value: boolean };

export type PrimitiveType = Effect['primitive'];

export type Ref = { field: string } | { constant: number | string | boolean };

export type Expr =
  | { op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'ne'; left: Ref; right: Ref }
  | { op: 'and' | 'or'; args: Expr[] }
  | { op: 'not'; arg: Expr };

export interface EffectTemplate {
  primitive: PrimitiveType;
  args: Record<string, Ref>;
}

export interface Rule {
  id: string;
  trigger: { type: EventType };
  conditions: Expr[];
  effects: EffectTemplate[];
}

export interface RulesSpec {
  rules: Rule[];
}

export type MetricName = 'IDENTITY_NET_EXTRACTED_VALUE' | 'NET_BENEFIT_FROM_ORDER';

export type InvOperand = { metric: MetricName } | { thisField: string } | { constant: number | string | boolean };

export type InvExpr =
  | { op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'ne'; left: InvOperand; right: InvOperand }
  | { op: 'and' | 'or'; args: InvExpr[] }
  | { op: 'not'; arg: InvExpr }
  | { op: 'implies'; when: InvExpr; then: InvExpr }
  | { op: 'forall'; entity: 'order' | 'identity'; body: InvExpr };

export interface Invariant {
  id: string;
  expr: InvExpr;
}

export interface InvariantSpec {
  invariants: Invariant[];
}

export type Action =
  | { type: 'PURCHASE'; identityId: IdentityId; amount: number }
  | { type: 'PURCHASE_WITH_POINTS'; identityId: IdentityId; amount: number }
  | { type: 'CANCEL_ORDER'; identityId: IdentityId; orderId: OrderId };

export type ActionType = Action['type'];

export interface Bounds {
  maxDepth: number;
  maxOrders: number;
}

export interface ParamCandidates {
  PURCHASE_amount: number[];
  PURCHASE_WITH_POINTS_amount: number[];
}

export interface Scenario {
  name: string;
  initialState: SimulationState;
  rules: RulesSpec;
  invariants: InvariantSpec;
  bounds: Bounds;
  params: ParamCandidates;
}

export interface Violation {
  invariantId: string;
  detail: string;
}

export interface TraceStep {
  action: Action;
  stateBefore: SimulationState;
  stateAfter: SimulationState;
}

export interface CounterexampleTrace {
  steps: TraceStep[];
  finalState: SimulationState;
}

export interface SearchResult {
  trace: CounterexampleTrace | null;
  violations: Violation[];
  explored: number;
}
```

- [ ] **Step 5: Install and typecheck**

Run: `pnpm install && pnpm typecheck`
Expected: no errors (types.ts compiles clean).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/domain/types.ts pnpm-lock.yaml
git commit -m "feat: project scaffold + core types"
```

---

### Task 2: Primitives (`applyEffect`) + internal invariant assertion

**Files:**
- Create: `src/domain/invariants.ts`
- Create: `src/domain/primitives.ts`
- Test: `test/primitives.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `Effect` from `src/domain/types.ts`.
- Produces:
  - `assertInternalInvariants(state: SimulationState): void` — throws `Error` on violation.
  - `applyEffect(state: SimulationState, effect: Effect): SimulationState` — pure, returns new state, does NOT assert.

- [ ] **Step 1: Write `src/domain/invariants.ts`**

```ts
import type { SimulationState } from './types.js';

export function assertInternalInvariants(state: SimulationState): void {
  for (const id of Object.keys(state.ledger)) {
    const ledger = state.ledger[id];
    const sumRemaining = state.rewards
      .filter((r) => r.identityId === id)
      .reduce((a, r) => a + r.remainingAmount, 0);
    if (ledger.pointsBalance !== sumRemaining) {
      throw new Error(
        `internal invariant: pointsBalance ${ledger.pointsBalance} != Σremaining ${sumRemaining} for ${id}`,
      );
    }
    if (ledger.goodsRetained < 0) {
      throw new Error(`internal invariant: goodsRetained ${ledger.goodsRetained} < 0 for ${id}`);
    }
  }
  for (const r of state.rewards) {
    if (r.grantedAmount !== r.remainingAmount + r.spentAmount + r.reclaimedAmount) {
      throw new Error(
        `internal invariant: reward ${r.id} conservation broken ` +
          `(${r.grantedAmount} != ${r.remainingAmount}+${r.spentAmount}+${r.reclaimedAmount})`,
      );
    }
  }
}
```

- [ ] **Step 2: Write failing test `test/primitives.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SimulationState } from '../src/domain/types.js';
import { applyEffect } from '../src/domain/primitives.js';
import { assertInternalInvariants } from '../src/domain/invariants.js';

function blank(): SimulationState {
  return {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  };
}

describe('applyEffect', () => {
  it('CREATE_ORDER assigns deterministic id and does not mutate input', () => {
    const s0 = blank();
    const s1 = applyEffect(s0, { primitive: 'CREATE_ORDER', identityId: 'id1', amount: 50000, paymentKind: 'CASH' });
    expect(s0.orders).toHaveLength(0);
    expect(s1.orders).toHaveLength(1);
    expect(s1.orders[0]).toMatchObject({ id: 'o1', amount: 50000, status: 'PAID', paymentKind: 'CASH' });
  });

  it('ISSUE_REWARD then SPEND_REWARD keeps conservation and FIFO', () => {
    let s = blank();
    s = applyEffect(s, { primitive: 'ISSUE_REWARD', identityId: 'id1', amount: 10000, sourceOrderId: 'o1' });
    expect(s.ledger.id1.pointsBalance).toBe(10000);
    s = applyEffect(s, { primitive: 'SPEND_REWARD', identityId: 'id1', amount: 10000 });
    expect(s.ledger.id1.pointsBalance).toBe(0);
    expect(s.rewards[0]).toMatchObject({ remainingAmount: 0, spentAmount: 10000, reclaimedAmount: 0 });
    assertInternalInvariants(s);
  });

  it('RECLAIM_REWARD (buggy) only pulls from remaining, leaves spent', () => {
    let s = blank();
    s = applyEffect(s, { primitive: 'ISSUE_REWARD', identityId: 'id1', amount: 10000, sourceOrderId: 'o1' });
    s = applyEffect(s, { primitive: 'SPEND_REWARD', identityId: 'id1', amount: 10000 });
    s = applyEffect(s, { primitive: 'RECLAIM_REWARD', sourceOrderId: 'o1', limit: 0 });
    expect(s.rewards[0]).toMatchObject({ remainingAmount: 0, spentAmount: 10000, reclaimedAmount: 0, settledByClawback: false });
    expect(s.liabilities).toHaveLength(0);
  });

  it('RECLAIM_REWARD_FULL creates a liability for the spent shortfall and is idempotent', () => {
    let s = blank();
    s = applyEffect(s, { primitive: 'ISSUE_REWARD', identityId: 'id1', amount: 10000, sourceOrderId: 'o1' });
    s = applyEffect(s, { primitive: 'SPEND_REWARD', identityId: 'id1', amount: 10000 });
    s = applyEffect(s, { primitive: 'RECLAIM_REWARD_FULL', sourceOrderId: 'o1' });
    expect(s.liabilities).toHaveLength(1);
    expect(s.liabilities[0]).toMatchObject({ amount: 10000, sourceOrderId: 'o1' });
    expect(s.rewards[0].settledByClawback).toBe(true);
    assertInternalInvariants(s);
    const before = JSON.stringify(s);
    s = applyEffect(s, { primitive: 'RECLAIM_REWARD_FULL', sourceOrderId: 'o1' });
    expect(s.liabilities).toHaveLength(1);
    expect(JSON.stringify(s)).toBe(before);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test primitives`
Expected: FAIL — `applyEffect` not found.

- [ ] **Step 4: Write `src/domain/primitives.ts`**

```ts
import type { SimulationState, Effect } from './types.js';

export function applyEffect(state: SimulationState, effect: Effect): SimulationState {
  const s: SimulationState = structuredClone(state);
  switch (effect.primitive) {
    case 'CREATE_ORDER': {
      s.orders.push({
        id: `o${s.orders.length + 1}`,
        identityId: effect.identityId,
        amount: effect.amount,
        status: 'PAID',
        paymentKind: effect.paymentKind,
      });
      return s;
    }
    case 'SET_ORDER_STATUS': {
      const o = s.orders.find((o) => o.id === effect.orderId);
      if (!o) throw new Error(`SET_ORDER_STATUS: no order ${effect.orderId}`);
      o.status = effect.status;
      return s;
    }
    case 'ADD_CASH_PAID': {
      s.ledger[effect.identityId].cashPaid += effect.value;
      return s;
    }
    case 'ADD_CASH_REFUNDED': {
      s.ledger[effect.identityId].cashRefunded += effect.value;
      return s;
    }
    case 'ADD_GOODS': {
      s.ledger[effect.identityId].goodsRetained += effect.value;
      return s;
    }
    case 'ISSUE_REWARD': {
      s.rewards.push({
        id: `r${s.rewards.length + 1}`,
        identityId: effect.identityId,
        sourceOrderId: effect.sourceOrderId,
        grantedAmount: effect.amount,
        remainingAmount: effect.amount,
        spentAmount: 0,
        reclaimedAmount: 0,
        settledByClawback: false,
      });
      s.ledger[effect.identityId].pointsBalance += effect.amount;
      return s;
    }
    case 'SPEND_REWARD': {
      let left = effect.amount;
      for (const r of s.rewards) {
        if (left <= 0) break;
        if (r.identityId !== effect.identityId || r.remainingAmount <= 0) continue;
        const k = Math.min(r.remainingAmount, left);
        r.remainingAmount -= k;
        r.spentAmount += k;
        s.ledger[effect.identityId].pointsBalance -= k;
        left -= k;
      }
      if (left > 0) throw new Error('SPEND_REWARD: insufficient remaining points');
      return s;
    }
    case 'RECLAIM_REWARD': {
      let left = effect.limit;
      for (const r of s.rewards) {
        if (left <= 0) break;
        if (r.sourceOrderId !== effect.sourceOrderId) continue;
        const k = Math.min(r.remainingAmount, left);
        r.remainingAmount -= k;
        r.reclaimedAmount += k;
        s.ledger[r.identityId].pointsBalance -= k;
        left -= k;
      }
      return s;
    }
    case 'RECLAIM_REWARD_FULL': {
      for (const r of s.rewards) {
        if (r.sourceOrderId !== effect.sourceOrderId || r.settledByClawback) continue;
        const bal = s.ledger[r.identityId].pointsBalance;
        const fromBalance = Math.min(r.remainingAmount, bal);
        r.remainingAmount -= fromBalance;
        r.reclaimedAmount += fromBalance;
        s.ledger[r.identityId].pointsBalance -= fromBalance;
        const shortfall = r.grantedAmount - r.reclaimedAmount;
        if (shortfall > 0) {
          s.liabilities.push({
            id: `l${s.liabilities.length + 1}`,
            identityId: r.identityId,
            amount: shortfall,
            sourceOrderId: effect.sourceOrderId,
          });
        }
        r.settledByClawback = true;
      }
      return s;
    }
    case 'CREATE_LIABILITY': {
      s.liabilities.push({
        id: `l${s.liabilities.length + 1}`,
        identityId: effect.identityId,
        amount: effect.amount,
        sourceOrderId: effect.sourceOrderId,
      });
      return s;
    }
    case 'SET_FLAG': {
      const i = s.identities.find((i) => i.id === effect.identityId);
      if (!i) throw new Error(`SET_FLAG: no identity ${effect.identityId}`);
      i.flags[effect.key] = effect.value;
      return s;
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test primitives`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/primitives.ts src/domain/invariants.ts test/primitives.test.ts
git commit -m "feat: primitive effects + internal invariant assertion"
```

---

### Task 3: Zod schema + scenario loader

**Files:**
- Create: `src/domain/schema.ts`
- Test: `test/schema.test.ts`

**Interfaces:**
- Consumes: types from `src/domain/types.ts`, `assertInternalInvariants` from `src/domain/invariants.ts`.
- Produces:
  - `loadScenario(raw: unknown): Scenario` — Zod-parses, then runs structural checks (id contract, non-negative ints, internal invariants on `initialState`). Throws `Error` with a readable message on any failure.

- [ ] **Step 1: Write failing test `test/schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { loadScenario } from '../src/domain/schema.js';

const valid = {
  name: 'x',
  initialState: {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  },
  rules: { rules: [] },
  invariants: { invariants: [] },
  bounds: { maxDepth: 4, maxOrders: 3 },
  params: { PURCHASE_amount: [50000], PURCHASE_WITH_POINTS_amount: [10000] },
};

describe('loadScenario', () => {
  it('accepts a valid scenario', () => {
    expect(() => loadScenario(valid)).not.toThrow();
  });

  it('rejects negative amounts', () => {
    const bad = structuredClone(valid);
    bad.params.PURCHASE_amount = [-1];
    expect(() => loadScenario(bad)).toThrow(/non-negative integer/i);
  });

  it('rejects non-sequential fixture order ids', () => {
    const bad = structuredClone(valid);
    bad.initialState.orders = [
      { id: 'o2', identityId: 'id1', amount: 100, status: 'PAID', paymentKind: 'CASH' },
    ] as any;
    expect(() => loadScenario(bad)).toThrow(/sequential id/i);
  });

  it('rejects an initialState that breaks internal invariants', () => {
    const bad = structuredClone(valid);
    bad.initialState.ledger.id1.pointsBalance = 5;
    expect(() => loadScenario(bad)).toThrow(/internal invariant/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test schema`
Expected: FAIL — `loadScenario` not found.

- [ ] **Step 3: Write `src/domain/schema.ts`**

```ts
import { z } from 'zod';
import type { Scenario } from './types.js';
import { assertInternalInvariants } from './invariants.js';

const nonNegInt = z.number().int().nonnegative();

const ledgerSchema = z.object({
  cashPaid: nonNegInt,
  cashRefunded: nonNegInt,
  goodsRetained: z.number().int(), // can be 0+; negative caught by assertInternalInvariants
  pointsBalance: nonNegInt,
});

const stateSchema = z.object({
  currentTime: z.number().int(),
  identities: z.array(z.object({ id: z.string(), flags: z.record(z.boolean()) })),
  orders: z.array(
    z.object({
      id: z.string(),
      identityId: z.string(),
      amount: nonNegInt,
      status: z.enum(['PAID', 'CANCELLED']),
      paymentKind: z.enum(['CASH', 'POINTS']),
    }),
  ),
  rewards: z.array(
    z.object({
      id: z.string(),
      identityId: z.string(),
      sourceOrderId: z.string(),
      grantedAmount: nonNegInt,
      remainingAmount: nonNegInt,
      spentAmount: nonNegInt,
      reclaimedAmount: nonNegInt,
      settledByClawback: z.boolean(),
    }),
  ),
  liabilities: z.array(
    z.object({
      id: z.string(),
      identityId: z.string(),
      amount: nonNegInt,
      sourceOrderId: z.string(),
    }),
  ),
  ledger: z.record(ledgerSchema),
});

const refSchema: z.ZodType = z.union([
  z.object({ field: z.string() }),
  z.object({ constant: z.union([z.number(), z.string(), z.boolean()]) }),
]);

const exprSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'ne']), left: refSchema, right: refSchema }),
    z.object({ op: z.enum(['and', 'or']), args: z.array(exprSchema) }),
    z.object({ op: z.literal('not'), arg: exprSchema }),
  ]),
);

const invOperandSchema = z.union([
  z.object({ metric: z.enum(['IDENTITY_NET_EXTRACTED_VALUE', 'NET_BENEFIT_FROM_ORDER']) }),
  z.object({ thisField: z.string() }),
  z.object({ constant: z.union([z.number(), z.string(), z.boolean()]) }),
]);

const invExprSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'ne']), left: invOperandSchema, right: invOperandSchema }),
    z.object({ op: z.enum(['and', 'or']), args: z.array(invExprSchema) }),
    z.object({ op: z.literal('not'), arg: invExprSchema }),
    z.object({ op: z.literal('implies'), when: invExprSchema, then: invExprSchema }),
    z.object({ op: z.literal('forall'), entity: z.enum(['order', 'identity']), body: invExprSchema }),
  ]),
);

const scenarioSchema = z.object({
  name: z.string(),
  initialState: stateSchema,
  rules: z.object({
    rules: z.array(
      z.object({
        id: z.string(),
        trigger: z.object({ type: z.enum(['ORDER_PAID', 'ORDER_CANCELLED', 'POINTS_SPENT']) }),
        conditions: z.array(exprSchema),
        effects: z.array(z.object({ primitive: z.string(), args: z.record(refSchema) })),
      }),
    ),
  }),
  invariants: z.object({ invariants: z.array(z.object({ id: z.string(), expr: invExprSchema })) }),
  bounds: z.object({ maxDepth: nonNegInt, maxOrders: nonNegInt }),
  params: z.object({
    PURCHASE_amount: z.array(nonNegInt),
    PURCHASE_WITH_POINTS_amount: z.array(nonNegInt),
  }),
});

function assertSequentialIds(prefix: string, ids: string[]): void {
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== `${prefix}${i + 1}`) {
      throw new Error(
        `fixture must use sequential ids: expected ${prefix}${i + 1}, got ${ids[i]}`,
      );
    }
  }
}

export function loadScenario(raw: unknown): Scenario {
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) {
    // surface non-negative-int failures with the phrase the tests look for
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    if (/nonnegative|greater than or equal to 0|expected int/i.test(msg)) {
      throw new Error(`non-negative integer required — ${msg}`);
    }
    throw new Error(`invalid scenario — ${msg}`);
  }
  const s = parsed.data as unknown as Scenario;

  assertSequentialIds('o', s.initialState.orders.map((o) => o.id));
  assertSequentialIds('r', s.initialState.rewards.map((r) => r.id));
  assertSequentialIds('l', s.initialState.liabilities.map((l) => l.id));

  assertInternalInvariants(s.initialState);

  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test schema`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/schema.ts test/schema.test.ts
git commit -m "feat: zod schema + scenario loader with structural checks"
```

---

### Task 4: Expression evaluator + effect materialization

**Files:**
- Create: `src/rules/expr.ts`
- Test: `test/expr.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `SimEvent`, `Ref`, `Expr`, `Effect`, `EffectTemplate` from types.
- Produces:
  - `type EvalCtx = { state: SimulationState; event: SimEvent }`
  - `resolveRef(ref: Ref, ctx: EvalCtx): number | string | boolean`
  - `evalExpr(expr: Expr, ctx: EvalCtx): boolean`
  - `materializeEffect(tmpl: EffectTemplate, ctx: EvalCtx): Effect`

- [ ] **Step 1: Write failing test `test/expr.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SimulationState, SimEvent } from '../src/domain/types.js';
import { resolveRef, evalExpr, materializeEffect } from '../src/rules/expr.js';

function ctx(overrides: Partial<SimEvent> = {}) {
  const state: SimulationState = {
    currentTime: 0,
    identities: [{ id: 'id1', flags: { promo_claimed: true } }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 7000 } },
  };
  const event: SimEvent = { type: 'ORDER_PAID', identityId: 'id1', orderId: 'o1', amount: 50000, paymentKind: 'CASH', ...overrides };
  return { state, event };
}

describe('resolveRef', () => {
  it('reads event fields, ledger of event identity, and identity flags', () => {
    const c = ctx();
    expect(resolveRef({ field: 'event.amount' }, c)).toBe(50000);
    expect(resolveRef({ field: 'event.paymentKind' }, c)).toBe('CASH');
    expect(resolveRef({ field: 'ledger.pointsBalance' }, c)).toBe(7000);
    expect(resolveRef({ field: 'identity.flags.promo_claimed' }, c)).toBe(true);
    expect(resolveRef({ field: 'identity.flags.missing' }, c)).toBe(false);
    expect(resolveRef({ constant: 42 }, c)).toBe(42);
  });
});

describe('evalExpr', () => {
  it('evaluates comparisons and boolean combinators', () => {
    const c = ctx();
    expect(evalExpr({ op: 'gte', left: { field: 'event.amount' }, right: { constant: 50000 } }, c)).toBe(true);
    expect(evalExpr({ op: 'eq', left: { field: 'event.paymentKind' }, right: { constant: 'POINTS' } }, c)).toBe(false);
    expect(
      evalExpr({ op: 'and', args: [
        { op: 'gte', left: { field: 'event.amount' }, right: { constant: 1 } },
        { op: 'eq', left: { field: 'event.paymentKind' }, right: { constant: 'CASH' } },
      ] }, c),
    ).toBe(true);
  });
});

describe('materializeEffect', () => {
  it('resolves each arg ref against ctx', () => {
    const c = ctx();
    const eff = materializeEffect(
      { primitive: 'ISSUE_REWARD', args: {
        identityId: { field: 'event.identityId' },
        amount: { constant: 10000 },
        sourceOrderId: { field: 'event.orderId' },
      } },
      c,
    );
    expect(eff).toEqual({ primitive: 'ISSUE_REWARD', identityId: 'id1', amount: 10000, sourceOrderId: 'o1' });
  });

  it('resolves ledger refs at call time (execution-time semantics)', () => {
    const c = ctx();
    c.state.ledger.id1.pointsBalance = 0;
    const eff = materializeEffect(
      { primitive: 'RECLAIM_REWARD', args: { sourceOrderId: { field: 'event.orderId' }, limit: { field: 'ledger.pointsBalance' } } },
      c,
    );
    expect(eff).toEqual({ primitive: 'RECLAIM_REWARD', sourceOrderId: 'o1', limit: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test expr`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/rules/expr.ts`**

```ts
import type { SimulationState, SimEvent, Ref, Expr, Effect, EffectTemplate } from '../domain/types.js';

export type EvalCtx = { state: SimulationState; event: SimEvent };

export function resolveRef(ref: Ref, ctx: EvalCtx): number | string | boolean {
  if ('constant' in ref) return ref.constant;
  const path = ref.field;
  if (path.startsWith('event.')) {
    const key = path.slice('event.'.length);
    const v = (ctx.event as Record<string, unknown>)[key];
    if (v === undefined) throw new Error(`resolveRef: event has no field ${key}`);
    return v as number | string | boolean;
  }
  if (path.startsWith('ledger.')) {
    const key = path.slice('ledger.'.length) as keyof SimulationState['ledger'][string];
    const ledger = ctx.state.ledger[ctx.event.identityId];
    if (!ledger) throw new Error(`resolveRef: no ledger for ${ctx.event.identityId}`);
    return ledger[key];
  }
  if (path.startsWith('identity.flags.')) {
    const key = path.slice('identity.flags.'.length);
    const identity = ctx.state.identities.find((i) => i.id === ctx.event.identityId);
    return identity?.flags[key] ?? false;
  }
  throw new Error(`resolveRef: unknown ref ${path}`);
}

function compare(op: string, l: number | string | boolean, r: number | string | boolean): boolean {
  switch (op) {
    case 'eq': return l === r;
    case 'ne': return l !== r;
    case 'gte': return (l as number) >= (r as number);
    case 'lte': return (l as number) <= (r as number);
    case 'gt': return (l as number) > (r as number);
    case 'lt': return (l as number) < (r as number);
    default: throw new Error(`compare: unknown op ${op}`);
  }
}

export function evalExpr(expr: Expr, ctx: EvalCtx): boolean {
  switch (expr.op) {
    case 'and': return expr.args.every((a) => evalExpr(a, ctx));
    case 'or': return expr.args.some((a) => evalExpr(a, ctx));
    case 'not': return !evalExpr(expr.arg, ctx);
    default: return compare(expr.op, resolveRef(expr.left, ctx), resolveRef(expr.right, ctx));
  }
}

export function materializeEffect(tmpl: EffectTemplate, ctx: EvalCtx): Effect {
  const out: Record<string, unknown> = { primitive: tmpl.primitive };
  for (const [k, ref] of Object.entries(tmpl.args)) {
    out[k] = resolveRef(ref, ctx);
  }
  return out as unknown as Effect;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test expr`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/expr.ts test/expr.test.ts
git commit -m "feat: expression evaluator + effect materialization"
```

---

### Task 5: Rules engine (snapshot matching + sequential effects)

**Files:**
- Create: `src/rules/engine.ts`
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `SimEvent`, `RulesSpec`, `Rule` from types; `evalExpr`, `materializeEffect`, `EvalCtx` from `src/rules/expr.ts`; `applyEffect` from `src/domain/primitives.ts`.
- Produces:
  - `matchRules(snapshot: SimulationState, event: SimEvent, spec: RulesSpec): Rule[]` — rules whose trigger matches and all conditions hold against `snapshot`, in spec order.
  - `applyMatchedRules(current: SimulationState, matched: Rule[], event: SimEvent): SimulationState` — applies each matched rule's effects in order; each `EffectTemplate`'s refs resolve against the running `current` state.

- [ ] **Step 1: Write failing test `test/engine.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SimulationState, SimEvent, RulesSpec } from '../src/domain/types.js';
import { matchRules, applyMatchedRules } from '../src/rules/engine.js';

function blank(): SimulationState {
  return {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [{ id: 'o1', identityId: 'id1', amount: 50000, status: 'PAID', paymentKind: 'CASH' }],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 50000, cashRefunded: 0, goodsRetained: 50000, pointsBalance: 0 } },
  };
}

const rules: RulesSpec = {
  rules: [
    {
      id: 'purchase_reward',
      trigger: { type: 'ORDER_PAID' },
      conditions: [
        { op: 'gte', left: { field: 'event.amount' }, right: { constant: 50000 } },
        { op: 'eq', left: { field: 'event.paymentKind' }, right: { constant: 'CASH' } },
      ],
      effects: [
        { primitive: 'ISSUE_REWARD', args: {
          identityId: { field: 'event.identityId' },
          amount: { constant: 10000 },
          sourceOrderId: { field: 'event.orderId' },
        } },
      ],
    },
  ],
};

const paidEvent: SimEvent = { type: 'ORDER_PAID', identityId: 'id1', orderId: 'o1', amount: 50000, paymentKind: 'CASH' };

describe('matchRules', () => {
  it('matches a rule when trigger and all conditions hold', () => {
    expect(matchRules(blank(), paidEvent, rules).map((r) => r.id)).toEqual(['purchase_reward']);
  });

  it('does not match when a condition fails (points payment)', () => {
    const ev: SimEvent = { ...paidEvent, paymentKind: 'POINTS' };
    expect(matchRules(blank(), ev, rules)).toEqual([]);
  });
});

describe('applyMatchedRules', () => {
  it('applies matched rule effects to the running state', () => {
    const s0 = blank();
    const matched = matchRules(s0, paidEvent, rules);
    const s1 = applyMatchedRules(s0, matched, paidEvent);
    expect(s1.rewards).toHaveLength(1);
    expect(s1.ledger.id1.pointsBalance).toBe(10000);
    expect(s0.rewards).toHaveLength(0); // input unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test engine`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/rules/engine.ts`**

```ts
import type { SimulationState, SimEvent, RulesSpec, Rule } from '../domain/types.js';
import { evalExpr, materializeEffect } from './expr.js';
import { applyEffect } from '../domain/primitives.js';

export function matchRules(snapshot: SimulationState, event: SimEvent, spec: RulesSpec): Rule[] {
  return spec.rules.filter(
    (r) =>
      r.trigger.type === event.type &&
      r.conditions.every((c) => evalExpr(c, { state: snapshot, event })),
  );
}

export function applyMatchedRules(
  current: SimulationState,
  matched: Rule[],
  event: SimEvent,
): SimulationState {
  let s = current;
  for (const rule of matched) {
    for (const tmpl of rule.effects) {
      const effect = materializeEffect(tmpl, { state: s, event });
      s = applyEffect(s, effect);
    }
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/engine.ts test/engine.test.ts
git commit -m "feat: rules engine — snapshot matching, sequential effects"
```

---

### Task 6: Actions — preconditions + base effects

**Files:**
- Create: `src/simulation/actions.ts`
- Test: `test/actions.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `Action`, `SimEvent` from types; `applyEffect` from primitives.
- Produces:
  - `actionPrecondition(state: SimulationState, action: Action, maxOrders: number): string | null` — `null` if valid, else a reason string.
  - `applyBaseEffects(state: SimulationState, action: Action): { state: SimulationState; events: SimEvent[] }` — applies the action's own effects (no rules), returns new state + emitted events in order.

- [ ] **Step 1: Write failing test `test/actions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SimulationState } from '../src/domain/types.js';
import { actionPrecondition, applyBaseEffects } from '../src/simulation/actions.js';

function blank(): SimulationState {
  return {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  };
}

describe('actionPrecondition', () => {
  it('PURCHASE ok when amount > 0 and under maxOrders', () => {
    expect(actionPrecondition(blank(), { type: 'PURCHASE', identityId: 'id1', amount: 50000 }, 3)).toBeNull();
  });
  it('PURCHASE_WITH_POINTS fails without enough points', () => {
    expect(actionPrecondition(blank(), { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 }, 3)).toMatch(/points/i);
  });
  it('CANCEL_ORDER fails for a points order', () => {
    const s = blank();
    s.orders.push({ id: 'o1', identityId: 'id1', amount: 10000, status: 'PAID', paymentKind: 'POINTS' });
    expect(actionPrecondition(s, { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' }, 3)).toMatch(/CASH/i);
  });
});

describe('applyBaseEffects', () => {
  it('PURCHASE emits ORDER_PAID with the new order id and CASH kind', () => {
    const { state, events } = applyBaseEffects(blank(), { type: 'PURCHASE', identityId: 'id1', amount: 50000 });
    expect(state.orders[0].id).toBe('o1');
    expect(state.ledger.id1).toMatchObject({ cashPaid: 50000, goodsRetained: 50000 });
    expect(events).toEqual([{ type: 'ORDER_PAID', identityId: 'id1', orderId: 'o1', amount: 50000, paymentKind: 'CASH' }]);
  });

  it('PURCHASE_WITH_POINTS spends points, creates a POINTS order, emits ORDER_PAID then POINTS_SPENT', () => {
    let s = blank();
    s.rewards.push({ id: 'r1', identityId: 'id1', sourceOrderId: 'o1', grantedAmount: 10000, remainingAmount: 10000, spentAmount: 0, reclaimedAmount: 0, settledByClawback: false });
    s.ledger.id1.pointsBalance = 10000;
    const { state, events } = applyBaseEffects(s, { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 });
    expect(state.ledger.id1.pointsBalance).toBe(0);
    expect(state.orders[0]).toMatchObject({ id: 'o1', paymentKind: 'POINTS' });
    expect(events).toEqual([
      { type: 'ORDER_PAID', identityId: 'id1', orderId: 'o1', amount: 10000, paymentKind: 'POINTS' },
      { type: 'POINTS_SPENT', identityId: 'id1', amount: 10000 },
    ]);
  });

  it('CANCEL_ORDER cancels, refunds, reverses goods, emits ORDER_CANCELLED', () => {
    let s = blank();
    s.orders.push({ id: 'o1', identityId: 'id1', amount: 50000, status: 'PAID', paymentKind: 'CASH' });
    s.ledger.id1 = { cashPaid: 50000, cashRefunded: 0, goodsRetained: 50000, pointsBalance: 0 };
    const { state, events } = applyBaseEffects(s, { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' });
    expect(state.orders[0].status).toBe('CANCELLED');
    expect(state.ledger.id1).toMatchObject({ cashRefunded: 50000, goodsRetained: 0 });
    expect(events).toEqual([{ type: 'ORDER_CANCELLED', identityId: 'id1', orderId: 'o1' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test actions`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/simulation/actions.ts`**

```ts
import type { SimulationState, Action, SimEvent } from '../domain/types.js';
import { applyEffect } from '../domain/primitives.js';

export function actionPrecondition(
  state: SimulationState,
  action: Action,
  maxOrders: number,
): string | null {
  const orderCount = state.orders.filter((o) => o.identityId === action.identityId).length;
  switch (action.type) {
    case 'PURCHASE':
      if (action.amount <= 0) return 'PURCHASE: amount must be positive';
      if (orderCount >= maxOrders) return 'PURCHASE: maxOrders reached';
      return null;
    case 'PURCHASE_WITH_POINTS':
      if (action.amount <= 0) return 'PURCHASE_WITH_POINTS: amount must be positive';
      if (orderCount >= maxOrders) return 'PURCHASE_WITH_POINTS: maxOrders reached';
      if ((state.ledger[action.identityId]?.pointsBalance ?? 0) < action.amount)
        return 'PURCHASE_WITH_POINTS: not enough points';
      return null;
    case 'CANCEL_ORDER': {
      const o = state.orders.find((o) => o.id === action.orderId);
      if (!o) return `CANCEL_ORDER: no order ${action.orderId}`;
      if (o.status !== 'PAID') return 'CANCEL_ORDER: order not PAID';
      if (o.paymentKind !== 'CASH') return 'CANCEL_ORDER: only CASH orders can be cancelled';
      return null;
    }
  }
}

export function applyBaseEffects(
  state: SimulationState,
  action: Action,
): { state: SimulationState; events: SimEvent[] } {
  switch (action.type) {
    case 'PURCHASE': {
      const orderId = `o${state.orders.length + 1}`;
      let s = applyEffect(state, { primitive: 'CREATE_ORDER', identityId: action.identityId, amount: action.amount, paymentKind: 'CASH' });
      s = applyEffect(s, { primitive: 'ADD_CASH_PAID', identityId: action.identityId, value: action.amount });
      s = applyEffect(s, { primitive: 'ADD_GOODS', identityId: action.identityId, value: action.amount });
      return {
        state: s,
        events: [{ type: 'ORDER_PAID', identityId: action.identityId, orderId, amount: action.amount, paymentKind: 'CASH' }],
      };
    }
    case 'PURCHASE_WITH_POINTS': {
      const orderId = `o${state.orders.length + 1}`;
      let s = applyEffect(state, { primitive: 'SPEND_REWARD', identityId: action.identityId, amount: action.amount });
      s = applyEffect(s, { primitive: 'ADD_GOODS', identityId: action.identityId, value: action.amount });
      s = applyEffect(s, { primitive: 'CREATE_ORDER', identityId: action.identityId, amount: action.amount, paymentKind: 'POINTS' });
      return {
        state: s,
        events: [
          { type: 'ORDER_PAID', identityId: action.identityId, orderId, amount: action.amount, paymentKind: 'POINTS' },
          { type: 'POINTS_SPENT', identityId: action.identityId, amount: action.amount },
        ],
      };
    }
    case 'CANCEL_ORDER': {
      const order = state.orders.find((o) => o.id === action.orderId);
      if (!order) throw new Error(`applyBaseEffects: no order ${action.orderId}`);
      let s = applyEffect(state, { primitive: 'SET_ORDER_STATUS', orderId: action.orderId, status: 'CANCELLED' });
      s = applyEffect(s, { primitive: 'ADD_CASH_REFUNDED', identityId: action.identityId, value: order.amount });
      s = applyEffect(s, { primitive: 'ADD_GOODS', identityId: action.identityId, value: -order.amount });
      return { state: s, events: [{ type: 'ORDER_CANCELLED', identityId: action.identityId, orderId: action.orderId }] };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/actions.ts test/actions.test.ts
git commit -m "feat: action preconditions + base effects"
```

---

### Task 7: Transition pipeline

**Files:**
- Create: `src/simulation/transition.ts`
- Test: `test/transition.test.ts`

**Interfaces:**
- Consumes: `actionPrecondition`, `applyBaseEffects` from `src/simulation/actions.ts`; `matchRules`, `applyMatchedRules` from `src/rules/engine.ts`; `assertInternalInvariants` from `src/domain/invariants.ts`.
- Produces:
  - `transition(state: SimulationState, action: Action, rules: RulesSpec, maxOrders: number): { nextState: SimulationState; invalid: boolean }` — precondition-checks, applies base effects, processes each event with per-event snapshot matching, asserts internal invariants, returns `nextState`. On precondition failure returns `{ nextState: state, invalid: true }`.

- [ ] **Step 1: Write failing test `test/transition.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SimulationState, RulesSpec } from '../src/domain/types.js';
import { transition } from '../src/simulation/transition.js';

function blank(): SimulationState {
  return {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  };
}

const rules: RulesSpec = {
  rules: [
    {
      id: 'purchase_reward',
      trigger: { type: 'ORDER_PAID' },
      conditions: [
        { op: 'gte', left: { field: 'event.amount' }, right: { constant: 50000 } },
        { op: 'eq', left: { field: 'event.paymentKind' }, right: { constant: 'CASH' } },
      ],
      effects: [
        { primitive: 'ISSUE_REWARD', args: {
          identityId: { field: 'event.identityId' },
          amount: { constant: 10000 },
          sourceOrderId: { field: 'event.orderId' },
        } },
      ],
    },
  ],
};

describe('transition', () => {
  it('applies base effects then fires the matching rule', () => {
    const { nextState, invalid } = transition(blank(), { type: 'PURCHASE', identityId: 'id1', amount: 50000 }, rules, 3);
    expect(invalid).toBe(false);
    expect(nextState.rewards).toHaveLength(1);
    expect(nextState.ledger.id1.pointsBalance).toBe(10000);
  });

  it('returns invalid without changing state on precondition failure', () => {
    const s = blank();
    const { nextState, invalid } = transition(s, { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'oX' }, rules, 3);
    expect(invalid).toBe(true);
    expect(nextState).toBe(s);
  });

  it('a points purchase under 50000 does not trigger the reward rule', () => {
    let s = blank();
    s.rewards.push({ id: 'r1', identityId: 'id1', sourceOrderId: 'o0', grantedAmount: 10000, remainingAmount: 10000, spentAmount: 0, reclaimedAmount: 0, settledByClawback: false });
    s.ledger.id1.pointsBalance = 10000;
    const { nextState } = transition(s, { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 }, rules, 3);
    expect(nextState.rewards).toHaveLength(1); // no new reward
    expect(nextState.ledger.id1.pointsBalance).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test transition`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/simulation/transition.ts`**

```ts
import type { SimulationState, Action, RulesSpec } from '../domain/types.js';
import { actionPrecondition, applyBaseEffects } from './actions.js';
import { matchRules, applyMatchedRules } from '../rules/engine.js';
import { assertInternalInvariants } from '../domain/invariants.js';

export function transition(
  state: SimulationState,
  action: Action,
  rules: RulesSpec,
  maxOrders: number,
): { nextState: SimulationState; invalid: boolean } {
  if (actionPrecondition(state, action, maxOrders) !== null) {
    return { nextState: state, invalid: true };
  }

  const base = applyBaseEffects(state, action);
  let cur = base.state;

  for (const event of base.events) {
    const snapshot = cur; // per-event entry snapshot
    const matched = matchRules(snapshot, event, rules);
    cur = applyMatchedRules(cur, matched, event);
  }

  assertInternalInvariants(cur);
  return { nextState: cur, invalid: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test transition`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/transition.ts test/transition.test.ts
git commit -m "feat: transition pipeline with per-event snapshot matching"
```

---

### Task 8: Metrics + invariant evaluator

**Files:**
- Create: `src/invariants/metrics.ts`
- Create: `src/invariants/evaluate.ts`
- Test: `test/invariants.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `InvariantSpec`, `InvExpr`, `InvOperand`, `Violation`, `Order`, `Identity` from types.
- Produces:
  - `identityNetExtractedValue(state: SimulationState, identityId: string): number`
  - `netBenefitFromOrder(state: SimulationState, orderId: string): number`
  - `evaluateInvariants(state: SimulationState, spec: InvariantSpec): Violation[]` — empty array = all hold.

- [ ] **Step 1: Write failing test `test/invariants.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SimulationState, InvariantSpec } from '../src/domain/types.js';
import { identityNetExtractedValue, netBenefitFromOrder } from '../src/invariants/metrics.js';
import { evaluateInvariants } from '../src/invariants/evaluate.js';

const noBenefitAfterCancel: InvariantSpec = {
  invariants: [
    {
      id: 'no_benefit_after_cancel',
      expr: {
        op: 'forall',
        entity: 'order',
        body: {
          op: 'implies',
          when: { op: 'eq', left: { thisField: 'status' }, right: { constant: 'CANCELLED' } },
          then: { op: 'lte', left: { metric: 'NET_BENEFIT_FROM_ORDER' }, right: { constant: 0 } },
        },
      },
    },
  ],
};

function buggyFinalState(): SimulationState {
  return {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [
      { id: 'o1', identityId: 'id1', amount: 50000, status: 'CANCELLED', paymentKind: 'CASH' },
      { id: 'o2', identityId: 'id1', amount: 10000, status: 'PAID', paymentKind: 'POINTS' },
    ],
    rewards: [
      { id: 'r1', identityId: 'id1', sourceOrderId: 'o1', grantedAmount: 10000, remainingAmount: 0, spentAmount: 10000, reclaimedAmount: 0, settledByClawback: false },
    ],
    liabilities: [],
    ledger: { id1: { cashPaid: 50000, cashRefunded: 50000, goodsRetained: 10000, pointsBalance: 0 } },
  };
}

describe('metrics', () => {
  it('computes identity net extracted value and per-order net benefit', () => {
    const s = buggyFinalState();
    expect(identityNetExtractedValue(s, 'id1')).toBe(10000);
    expect(netBenefitFromOrder(s, 'o1')).toBe(10000);
  });
});

describe('evaluateInvariants', () => {
  it('flags no_benefit_after_cancel on the buggy final state', () => {
    const v = evaluateInvariants(buggyFinalState(), noBenefitAfterCancel);
    expect(v).toHaveLength(1);
    expect(v[0].invariantId).toBe('no_benefit_after_cancel');
    expect(v[0].detail).toMatch(/o1/);
  });

  it('passes once a matching liability is present', () => {
    const s = buggyFinalState();
    s.liabilities.push({ id: 'l1', identityId: 'id1', amount: 10000, sourceOrderId: 'o1' });
    expect(evaluateInvariants(s, noBenefitAfterCancel)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test invariants`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/invariants/metrics.ts`**

```ts
import type { SimulationState } from '../domain/types.js';

export function identityNetExtractedValue(state: SimulationState, identityId: string): number {
  const l = state.ledger[identityId];
  if (!l) throw new Error(`identityNetExtractedValue: no ledger for ${identityId}`);
  const liabilities = state.liabilities
    .filter((x) => x.identityId === identityId)
    .reduce((a, x) => a + x.amount, 0);
  return l.goodsRetained + l.cashRefunded + l.pointsBalance - l.cashPaid - liabilities;
}

export function netBenefitFromOrder(state: SimulationState, orderId: string): number {
  const rewardValue = state.rewards
    .filter((r) => r.sourceOrderId === orderId)
    .reduce((a, r) => a + (r.grantedAmount - r.reclaimedAmount), 0);
  const liabilities = state.liabilities
    .filter((x) => x.sourceOrderId === orderId)
    .reduce((a, x) => a + x.amount, 0);
  return rewardValue - liabilities;
}
```

- [ ] **Step 4: Write `src/invariants/evaluate.ts`**

```ts
import type { SimulationState, InvariantSpec, InvExpr, InvOperand, Violation } from '../domain/types.js';
import { identityNetExtractedValue, netBenefitFromOrder } from './metrics.js';

type Entity = { id: string } & Record<string, unknown>;

function resolveOperand(
  operand: InvOperand,
  state: SimulationState,
  thisEntity: Entity | null,
  entityKind: 'order' | 'identity' | null,
): number | string | boolean {
  if ('constant' in operand) return operand.constant;
  if ('thisField' in operand) {
    if (!thisEntity) throw new Error(`resolveOperand: thisField outside forall`);
    const v = thisEntity[operand.thisField];
    if (v === undefined) throw new Error(`resolveOperand: no field ${operand.thisField}`);
    return v as number | string | boolean;
  }
  // metric
  if (!thisEntity) throw new Error(`resolveOperand: metric outside forall`);
  if (operand.metric === 'IDENTITY_NET_EXTRACTED_VALUE') {
    if (entityKind !== 'identity') throw new Error('IDENTITY_NET_EXTRACTED_VALUE needs forall identity');
    return identityNetExtractedValue(state, thisEntity.id);
  }
  if (operand.metric === 'NET_BENEFIT_FROM_ORDER') {
    if (entityKind !== 'order') throw new Error('NET_BENEFIT_FROM_ORDER needs forall order');
    return netBenefitFromOrder(state, thisEntity.id);
  }
  throw new Error(`resolveOperand: unknown metric`);
}

function compare(op: string, l: number | string | boolean, r: number | string | boolean): boolean {
  switch (op) {
    case 'eq': return l === r;
    case 'ne': return l !== r;
    case 'gte': return (l as number) >= (r as number);
    case 'lte': return (l as number) <= (r as number);
    case 'gt': return (l as number) > (r as number);
    case 'lt': return (l as number) < (r as number);
    default: throw new Error(`compare: unknown op ${op}`);
  }
}

function evalInv(
  e: InvExpr,
  state: SimulationState,
  thisEntity: Entity | null,
  entityKind: 'order' | 'identity' | null,
): boolean {
  switch (e.op) {
    case 'forall': {
      const list: Entity[] = e.entity === 'order' ? (state.orders as unknown as Entity[]) : (state.identities as unknown as Entity[]);
      return list.every((ent) => evalInv(e.body, state, ent, e.entity));
    }
    case 'and': return e.args.every((a) => evalInv(a, state, thisEntity, entityKind));
    case 'or': return e.args.some((a) => evalInv(a, state, thisEntity, entityKind));
    case 'not': return !evalInv(e.arg, state, thisEntity, entityKind);
    case 'implies':
      return !evalInv(e.when, state, thisEntity, entityKind) || evalInv(e.then, state, thisEntity, entityKind);
    default:
      return compare(
        e.op,
        resolveOperand(e.left, state, thisEntity, entityKind),
        resolveOperand(e.right, state, thisEntity, entityKind),
      );
  }
}

function firstFailingEntity(
  e: InvExpr,
  state: SimulationState,
): { kind: 'order' | 'identity'; id: string } | null {
  if (e.op === 'forall') {
    const list: Entity[] = e.entity === 'order' ? (state.orders as unknown as Entity[]) : (state.identities as unknown as Entity[]);
    for (const ent of list) {
      if (!evalInv(e.body, state, ent, e.entity)) return { kind: e.entity, id: ent.id };
    }
  }
  return null;
}

export function evaluateInvariants(state: SimulationState, spec: InvariantSpec): Violation[] {
  const out: Violation[] = [];
  for (const inv of spec.invariants) {
    if (!evalInv(inv.expr, state, null, null)) {
      const failing = firstFailingEntity(inv.expr, state);
      const detail = failing ? `${failing.kind}=${failing.id}` : 'invariant violated';
      out.push({ invariantId: inv.id, detail });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test invariants`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/invariants/metrics.ts src/invariants/evaluate.ts test/invariants.test.ts
git commit -m "feat: economic metrics + invariant evaluator"
```

---

### Task 9: Reward Settlement scenario data

**Files:**
- Create: `src/scenarios/reward-settlement.ts`
- Test: `test/scenario-reward-settlement.test.ts`

**Interfaces:**
- Consumes: `Scenario`, `RulesSpec` from types; `loadScenario` from `src/domain/schema.ts`.
- Produces:
  - `BUGGY_RULES: RulesSpec`
  - `FIXED_RULES: RulesSpec`
  - `rewardSettlementScenario: Scenario` — `.rules` is `BUGGY_RULES`. Passes `loadScenario`.

- [ ] **Step 1: Write failing test `test/scenario-reward-settlement.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { loadScenario } from '../src/domain/schema.js';
import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../src/scenarios/reward-settlement.js';

describe('reward settlement scenario', () => {
  it('is a valid scenario per loadScenario', () => {
    expect(() => loadScenario(rewardSettlementScenario)).not.toThrow();
  });
  it('buggy and fixed rulesets differ only in the clawback rule', () => {
    expect(BUGGY_RULES.rules[0]).toEqual(FIXED_RULES.rules[0]);
    expect(BUGGY_RULES.rules[1].effects[0].primitive).toBe('RECLAIM_REWARD');
    expect(FIXED_RULES.rules[1].effects[0].primitive).toBe('RECLAIM_REWARD_FULL');
  });
  it('bounds and params match the spec', () => {
    expect(rewardSettlementScenario.bounds).toEqual({ maxDepth: 4, maxOrders: 3 });
    expect(rewardSettlementScenario.params.PURCHASE_amount).toEqual([50000, 49999]);
    expect(rewardSettlementScenario.params.PURCHASE_WITH_POINTS_amount).toEqual([10000]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test scenario-reward-settlement`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/scenarios/reward-settlement.ts`**

```ts
import type { RulesSpec, Scenario } from '../domain/types.js';

const purchaseReward = {
  id: 'purchase_reward',
  trigger: { type: 'ORDER_PAID' as const },
  conditions: [
    { op: 'gte' as const, left: { field: 'event.amount' }, right: { constant: 50000 } },
    { op: 'eq' as const, left: { field: 'event.paymentKind' }, right: { constant: 'CASH' } },
  ],
  effects: [
    {
      primitive: 'ISSUE_REWARD' as const,
      args: {
        identityId: { field: 'event.identityId' },
        amount: { constant: 10000 },
        sourceOrderId: { field: 'event.orderId' },
      },
    },
  ],
};

export const BUGGY_RULES: RulesSpec = {
  rules: [
    purchaseReward,
    {
      id: 'clawback_on_cancel',
      trigger: { type: 'ORDER_CANCELLED' },
      conditions: [],
      effects: [
        {
          primitive: 'RECLAIM_REWARD',
          args: {
            sourceOrderId: { field: 'event.orderId' },
            limit: { field: 'ledger.pointsBalance' },
          },
        },
      ],
    },
  ],
};

export const FIXED_RULES: RulesSpec = {
  rules: [
    purchaseReward,
    {
      id: 'clawback_on_cancel',
      trigger: { type: 'ORDER_CANCELLED' },
      conditions: [],
      effects: [
        {
          primitive: 'RECLAIM_REWARD_FULL',
          args: { sourceOrderId: { field: 'event.orderId' } },
        },
      ],
    },
  ],
};

export const rewardSettlementScenario: Scenario = {
  name: 'Reward Settlement',
  initialState: {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  },
  rules: BUGGY_RULES,
  invariants: {
    invariants: [
      {
        id: 'no_benefit_after_cancel',
        expr: {
          op: 'forall',
          entity: 'order',
          body: {
            op: 'implies',
            when: { op: 'eq', left: { thisField: 'status' }, right: { constant: 'CANCELLED' } },
            then: { op: 'lte', left: { metric: 'NET_BENEFIT_FROM_ORDER' }, right: { constant: 0 } },
          },
        },
      },
    ],
  },
  bounds: { maxDepth: 4, maxOrders: 3 },
  params: { PURCHASE_amount: [50000, 49999], PURCHASE_WITH_POINTS_amount: [10000] },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test scenario-reward-settlement`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/reward-settlement.ts test/scenario-reward-settlement.test.ts
git commit -m "feat: Reward Settlement scenario (buggy + fixed rulesets)"
```

---

### Task 10: Search — canonical key, valid actions, BFS, trace

**Files:**
- Create: `src/search/canonical.ts`
- Create: `src/search/valid-actions.ts`
- Create: `src/search/bfs.ts`
- Test: `test/search.test.ts`

**Interfaces:**
- Consumes: `SimulationState`, `Scenario`, `Action`, `RulesSpec`, `SearchResult`, `CounterexampleTrace`, `TraceStep` from types; `transition` from `src/simulation/transition.ts`; `evaluateInvariants` from `src/invariants/evaluate.ts`; `assertInternalInvariants` from `src/domain/invariants.ts`; `actionPrecondition` from `src/simulation/actions.ts`.
- Produces:
  - `canonicalKey(state: SimulationState): string`
  - `validActions(state: SimulationState, scenario: Scenario): Action[]`
  - `bfs(scenario: Scenario, rules?: RulesSpec): SearchResult` — defaults `rules` to `scenario.rules`.

- [ ] **Step 1: Write failing test `test/search.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { canonicalKey } from '../src/search/canonical.js';
import { validActions } from '../src/search/valid-actions.js';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';

describe('canonicalKey', () => {
  it('is stable regardless of object key order', () => {
    const a = { currentTime: 0, identities: [], orders: [], rewards: [], liabilities: [], ledger: {} } as any;
    const b = { ledger: {}, liabilities: [], rewards: [], orders: [], identities: [], currentTime: 0 } as any;
    expect(canonicalKey(a)).toBe(canonicalKey(b));
  });
});

describe('validActions', () => {
  it('from the initial state, only PURCHASE candidates are valid', () => {
    const acts = validActions(rewardSettlementScenario.initialState, rewardSettlementScenario);
    expect(acts.map((a) => a.type).sort()).toEqual(['PURCHASE', 'PURCHASE']);
    expect(acts.map((a) => (a as { amount: number }).amount).sort((x, y) => x - y)).toEqual([49999, 50000]);
  });
});

describe('bfs', () => {
  it('finds the shortest counterexample with buggy rules', () => {
    const r = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(r.trace).not.toBeNull();
    expect(r.trace!.steps).toHaveLength(3);
    expect(r.trace!.steps.map((s) => s.action.type)).toEqual([
      'PURCHASE', 'PURCHASE_WITH_POINTS', 'CANCEL_ORDER',
    ]);
    expect(r.violations[0].invariantId).toBe('no_benefit_after_cancel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test search`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/search/canonical.ts`**

```ts
import type { SimulationState } from '../domain/types.js';

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`;
}

export function canonicalKey(state: SimulationState): string {
  return stable(state);
}
```

- [ ] **Step 4: Write `src/search/valid-actions.ts`**

```ts
import type { SimulationState, Scenario, Action } from '../domain/types.js';

export function validActions(state: SimulationState, scenario: Scenario): Action[] {
  const out: Action[] = [];
  const { maxOrders } = scenario.bounds;
  for (const identity of state.identities) {
    const id = identity.id;
    const orderCount = state.orders.filter((o) => o.identityId === id).length;
    for (const amount of scenario.params.PURCHASE_amount) {
      if (amount > 0 && orderCount < maxOrders) out.push({ type: 'PURCHASE', identityId: id, amount });
    }
    for (const amount of scenario.params.PURCHASE_WITH_POINTS_amount) {
      if (amount > 0 && orderCount < maxOrders && (state.ledger[id]?.pointsBalance ?? 0) >= amount) {
        out.push({ type: 'PURCHASE_WITH_POINTS', identityId: id, amount });
      }
    }
  }
  for (const o of state.orders) {
    if (o.status === 'PAID' && o.paymentKind === 'CASH') {
      out.push({ type: 'CANCEL_ORDER', identityId: o.identityId, orderId: o.id });
    }
  }
  return out;
}
```

- [ ] **Step 5: Write `src/search/bfs.ts`**

```ts
import type {
  SimulationState,
  Scenario,
  RulesSpec,
  Action,
  SearchResult,
  CounterexampleTrace,
  TraceStep,
} from '../domain/types.js';
import { transition } from '../simulation/transition.js';
import { evaluateInvariants } from '../invariants/evaluate.js';
import { assertInternalInvariants } from '../domain/invariants.js';
import { canonicalKey } from './canonical.js';
import { validActions } from './valid-actions.js';

type ParentLink = { prevKey: string; action: Action; stateAfter: SimulationState };

function buildTrace(
  parent: Map<string, ParentLink>,
  initialState: SimulationState,
  stateBeforeLast: SimulationState,
  lastAction: Action,
  finalState: SimulationState,
): CounterexampleTrace {
  const rev: { action: Action; after: SimulationState }[] = [];
  let key = canonicalKey(stateBeforeLast);
  while (parent.has(key)) {
    const link = parent.get(key)!;
    rev.push({ action: link.action, after: link.stateAfter });
    key = link.prevKey;
  }
  rev.reverse();
  const ordered = [...rev, { action: lastAction, after: finalState }];

  const steps: TraceStep[] = [];
  let before = initialState;
  for (const { action, after } of ordered) {
    steps.push({ action, stateBefore: before, stateAfter: after });
    before = after;
  }
  return { steps, finalState };
}

export function bfs(scenario: Scenario, rules: RulesSpec = scenario.rules): SearchResult {
  const { initialState, invariants, bounds } = scenario;
  assertInternalInvariants(initialState);

  const visited = new Set<string>([canonicalKey(initialState)]);

  const v0 = evaluateInvariants(initialState, invariants);
  if (v0.length > 0) {
    return { trace: { steps: [], finalState: initialState }, violations: v0, explored: visited.size };
  }

  const queue: { state: SimulationState; depth: number }[] = [{ state: initialState, depth: 0 }];
  const parent = new Map<string, ParentLink>();

  while (queue.length > 0) {
    const { state: s, depth } = queue.shift()!;
    if (depth >= bounds.maxDepth) continue;

    for (const action of validActions(s, scenario)) {
      const { nextState, invalid } = transition(s, action, rules, bounds.maxOrders);
      if (invalid) continue;

      const violations = evaluateInvariants(nextState, invariants);
      if (violations.length > 0) {
        return {
          trace: buildTrace(parent, initialState, s, action, nextState),
          violations,
          explored: visited.size,
        };
      }

      const key = canonicalKey(nextState);
      if (visited.has(key)) continue;
      visited.add(key);
      parent.set(key, { prevKey: canonicalKey(s), action, stateAfter: nextState });
      queue.push({ state: nextState, depth: depth + 1 });
    }
  }

  return { trace: null, violations: [], explored: visited.size };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test search`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/search/canonical.ts src/search/valid-actions.ts src/search/bfs.ts test/search.test.ts
git commit -m "feat: canonical key, valid actions, bounded BFS with trace"
```

---

### Task 11: Gate 1 integration test

**Files:**
- Create: `test/gate1.test.ts`
- Modify: `package.json` (add `gate1` script)

**Interfaces:**
- Consumes: `bfs` from `src/search/bfs.ts`; `identityNetExtractedValue` from `src/invariants/metrics.ts`; `rewardSettlementScenario`, `BUGGY_RULES`, `FIXED_RULES` from `src/scenarios/reward-settlement.ts`.
- Produces: nothing (terminal test).

- [ ] **Step 1: Write `test/gate1.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { identityNetExtractedValue } from '../src/invariants/metrics.js';
import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../src/scenarios/reward-settlement.js';

describe('Gate 1 — search finds executable counterexample with no hardcoded sequence', () => {
  it('(1) buggy rules: BFS finds exactly the 3-step counterexample', () => {
    const r = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(r.trace).not.toBeNull();
    expect(r.trace!.steps.map((s) => s.action.type)).toEqual([
      'PURCHASE',
      'PURCHASE_WITH_POINTS',
      'CANCEL_ORDER',
    ]);
    const first = r.trace!.steps[0].action;
    expect(first.type === 'PURCHASE' && first.amount).toBe(50000);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].invariantId).toBe('no_benefit_after_cancel');
  });

  it('(1b) the counterexample final state has Net Extracted Value 10000', () => {
    const r = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(identityNetExtractedValue(r.trace!.finalState, 'id1')).toBe(10000);
  });

  it('(2) fixed rules: same bounds, no counterexample', () => {
    const r = bfs(rewardSettlementScenario, FIXED_RULES);
    expect(r.trace).toBeNull();
    expect(r.violations).toHaveLength(0);
    expect(r.explored).toBeGreaterThan(1);
  });

  it('(3) internal invariants never break during either search', () => {
    expect(() => bfs(rewardSettlementScenario, BUGGY_RULES)).not.toThrow();
    expect(() => bfs(rewardSettlementScenario, FIXED_RULES)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `pnpm test`
Expected: ALL tests pass (primitives, schema, expr, engine, actions, transition, invariants, scenario, search, gate1).

- [ ] **Step 3: Add `gate1` script to `package.json`**

In `"scripts"`, add:

```json
"gate1": "vitest run test/gate1.test.ts"
```

- [ ] **Step 4: Run the gate**

Run: `pnpm gate1`
Expected: 4 tests pass. **This is the Day 6 gate — if it passes, the engine is proven.**

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add test/gate1.test.ts package.json
git commit -m "test: Gate 1 — BFS finds 3-step counterexample, fixed rules clean"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 domain model + internal invariants + id generation | Task 1 (types), Task 2 (assertion), Task 3 (loader id contract) |
| §3 primitives | Task 2 |
| §4 RulesSpec + Ref resolution timing | Task 1 (types), Task 4 (resolveRef/materializeEffect execution-time) |
| §5 action space + base effects | Task 6 |
| §6 transition pipeline (per-event snapshot) | Task 7 |
| §7 InvariantSpec + metrics | Task 8 |
| §8 demo scenario (buggy + fixed) | Task 9 |
| §9 BFS + SearchResult single shape + initial-state check + canonicalKey | Task 10 |
| §10 LLM-Direct baseline | **Deferred to product plan** (not engine/Gate 1) |
| §11 tech stack | Task 1 |
| §12 limits — non-negative int, fixture id contract, internal invariant fixture check | Task 3 |
| §13 Gate 1 | Task 11 |

Gaps: §10 (benchmark) and all UI are intentionally out of scope for this plan — they belong to the follow-up product plan and depend on Gate 1 passing first.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `transition(state, action, rules, maxOrders)` — 4 args, consistent between Task 7 definition and Task 10 call. `bfs(scenario, rules?)` consistent Task 10 ↔ Task 11. `evaluateInvariants(state, spec)` consistent Task 8 ↔ Task 10. `SearchResult` shape `{ trace, violations, explored }` consistent across Task 1 / Task 10 / Task 11. `Scenario.rules` is `BUGGY_RULES` (Task 9) and `bfs` default uses it (Task 10).
