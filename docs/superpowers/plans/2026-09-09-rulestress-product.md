# RuleStress Product (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the RuleStress engine in a Next.js product — structured input → Web Worker BFS → trace result → Before/After, plus an LLM explain endpoint and a lightweight benchmark vs LLM-Direct.

**Architecture:** The engine (`src/domain`, `src/rules`, `src/simulation`, `src/invariants`, `src/search`, `src/scenarios`, `src/shared`) is unchanged and reused verbatim. A Next.js app router UI is added around it. BFS runs in a Web Worker (the engine is pure, no DOM). The LLM is called only from `/api/explain` and the benchmark runner — never in the search path.

**Tech Stack:** Next.js 15 (app router) + React 19 + Tailwind CSS 3, TypeScript strict, pnpm. Vitest for logic tests (node env). Anthropic SDK for LLM. Vercel deploy.

## Global Constraints

- The engine under `src/domain|rules|simulation|invariants|search|scenarios|shared` is FROZEN except Task 1 (schema hardening). Do not change engine behavior; UI consumes it as-is.
- Determinism: BFS/transition stay pure and LLM-free. LLM calls only in `src/llm/*`, `app/api/explain/route.ts`, `src/benchmark/llm-direct.ts`.
- `SearchResult` shape is `{ trace: CounterexampleTrace | null, violations: Violation[], explored: number }` (from `src/domain/types.ts`). `explored` exact pins: BUGGY search = 22, FIXED exhaustive = 71 for the Reward Settlement scenario.
- The demo counterexample is exactly `[PURCHASE(50000), PURCHASE_WITH_POINTS(10000), CANCEL_ORDER(o1)]`, Net Extracted Value ₩10,000.
- `no_benefit_after_cancel` invariant text: "전액 환불된(취소된) 주문은 사용자에게 순경제적 혜택을 남기지 않는다."
- LLM never computes numbers — all economic figures come from `identityNetExtractedValue` / `netBenefitFromOrder` on the simulator's `finalState`.
- Imports use `.js` extensions for engine modules (ESM + bundler resolution).
- `pnpm test` and `pnpm typecheck` must stay green after every task.
- No login. `ANTHROPIC_API_KEY` via env var (`.env.local` locally, Vercel env in prod). Never commit the key.

Spec: `docs/superpowers/specs/2026-09-09-rulestress-product-design.md` and `docs/superpowers/specs/2026-09-08-rulestress-core-design.md` §10-11.

---

### Task 1: Schema hardening — primitive enum + required-arg validation

**Files:**
- Modify: `src/domain/schema.ts`
- Test: `test/schema.test.ts` (extend)

**Interfaces:**
- Consumes: `PrimitiveType` from `src/domain/types.ts`.
- Produces: `loadScenario` now rejects unknown primitives and missing required args with a readable `Error`.

- [ ] **Step 1: Write failing tests (append to `test/schema.test.ts`)**

```ts
describe('loadScenario — effect validation', () => {
  const base = () => structuredClone(valid); // `valid` fixture already in this file

  it('rejects an unknown primitive', () => {
    const bad = base();
    bad.rules.rules = [{
      id: 'r', trigger: { type: 'ORDER_PAID' }, conditions: [],
      effects: [{ primitive: 'NOT_A_PRIMITIVE', args: {} }],
    }] as any;
    expect(() => loadScenario(bad)).toThrow(/unknown primitive|invalid enum|NOT_A_PRIMITIVE/i);
  });

  it('rejects an effect missing a required arg', () => {
    const bad = base();
    bad.rules.rules = [{
      id: 'r', trigger: { type: 'ORDER_PAID' }, conditions: [],
      effects: [{ primitive: 'ISSUE_REWARD', args: { identityId: { field: 'event.identityId' } } }],
    }] as any;
    expect(() => loadScenario(bad)).toThrow(/ISSUE_REWARD.*(missing|required).*(amount|sourceOrderId)/i);
  });

  it('accepts a well-formed effect', () => {
    const ok = base();
    ok.rules.rules = [{
      id: 'r', trigger: { type: 'ORDER_PAID' }, conditions: [],
      effects: [{ primitive: 'ISSUE_REWARD', args: {
        identityId: { field: 'event.identityId' },
        amount: { constant: 10000 },
        sourceOrderId: { field: 'event.orderId' },
      } }],
    }] as any;
    expect(() => loadScenario(ok)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test schema`
Expected: 3 new tests FAIL (unknown primitive accepted; missing arg accepted).

- [ ] **Step 3: Implement in `src/domain/schema.ts`**

Add near the top (after imports):

```ts
const PRIMITIVE_TYPES = [
  'CREATE_ORDER', 'SET_ORDER_STATUS', 'ADD_CASH_PAID', 'ADD_CASH_REFUNDED', 'ADD_GOODS',
  'ISSUE_REWARD', 'SPEND_REWARD', 'RECLAIM_REWARD', 'RECLAIM_REWARD_FULL', 'CREATE_LIABILITY',
  'SET_FLAG',
] as const;

const REQUIRED_ARGS: Record<string, string[]> = {
  CREATE_ORDER: ['identityId', 'amount', 'paymentKind'],
  SET_ORDER_STATUS: ['orderId', 'status'],
  ADD_CASH_PAID: ['identityId', 'value'],
  ADD_CASH_REFUNDED: ['identityId', 'value'],
  ADD_GOODS: ['identityId', 'value'],
  ISSUE_REWARD: ['identityId', 'amount', 'sourceOrderId'],
  SPEND_REWARD: ['identityId', 'amount'],
  RECLAIM_REWARD: ['sourceOrderId', 'limit'],
  RECLAIM_REWARD_FULL: ['sourceOrderId'],
  CREATE_LIABILITY: ['identityId', 'amount', 'sourceOrderId'],
  SET_FLAG: ['identityId', 'key', 'value'],
};
```

In the `rules.effects` array element schema, change `primitive: z.string()` to `primitive: z.enum(PRIMITIVE_TYPES)`.

After the Zod parse succeeds and before returning `s`, add:

```ts
for (const rule of s.rules.rules) {
  for (const effect of rule.effects) {
    const required = REQUIRED_ARGS[effect.primitive] ?? [];
    for (const arg of required) {
      if (!(arg in effect.args)) {
        throw new Error(
          `invalid scenario — effect ${effect.primitive} in rule ${rule.id} missing required arg ${arg}`,
        );
      }
    }
  }
}
```

Make sure the Zod enum failure message still routes to a readable throw (it already goes through the generic `invalid scenario — …` path).

- [ ] **Step 4: Run tests**

Run: `pnpm test schema && pnpm test`
Expected: all pass (schema file +3, full suite still green).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/domain/schema.ts test/schema.test.ts
git commit -m "feat: schema hardening — primitive enum + required-arg validation"
```

---

### Task 2: Next.js scaffold (coexisting with the engine + vitest)

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `.env.local.example`

**Interfaces:**
- Produces: `pnpm dev` serves a Next app at :3000 with a placeholder landing page; `pnpm test` and `pnpm typecheck` still pass.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add next@15 react@19 react-dom@19
pnpm add -D @types/react @types/react-dom tailwindcss@3 postcss autoprefixer
```

- [ ] **Step 2: Update `package.json` scripts**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "gate1": "vitest run test/gate1.test.ts"
}
```

- [ ] **Step 3: `next.config.ts`**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 4: Tailwind config**

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/ui/**/*.{ts,tsx}'],
  theme: { extend: {} },
} satisfies Config;
```

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
body { @apply bg-neutral-950 text-neutral-100 antialiased; }
```

- [ ] **Step 5: `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RuleStress',
  description: 'Break your promotion before users do.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: `app/page.tsx` (placeholder)**

```tsx
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold">RuleStress</h1>
      <p className="mt-4 text-neutral-400">Break your promotion before users do.</p>
      <a href="/simulate" className="mt-8 inline-block rounded bg-emerald-500 px-4 py-2 font-medium text-neutral-950">
        내 이벤트 스트레스 테스트하기
      </a>
    </main>
  );
}
```

- [ ] **Step 7: `tsconfig.json` — add Next plugin + jsx**

Merge into `compilerOptions`:
```json
"jsx": "preserve",
"plugins": [{ "name": "next" }],
"lib": ["ES2022", "DOM", "DOM.Iterable"],
"paths": { "@/*": ["./*"] }
```
Add to `include`: `"next-env.d.ts"`, `".next/types/**/*.ts"`.

- [ ] **Step 8: `.gitignore` — add** `.next`, `.env.local`, `next-env.d.ts`

- [ ] **Step 9: `.env.local.example`**

```
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 10: Verify**

```bash
pnpm install
pnpm typecheck        # clean
pnpm test             # engine suite still green
pnpm build            # Next build succeeds
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: Next.js 15 scaffold + Tailwind, engine + vitest intact"
```

---

### Task 3: Web Worker for BFS + `runSearch` client

**Files:**
- Create: `src/workers/bfs.worker.ts`
- Create: `src/ui/lib/worker-client.ts`
- Test: `test/worker-client.test.ts`

**Interfaces:**
- Consumes: `bfs` from `src/search/bfs.js`; `Scenario`, `RulesSpec`, `SearchResult` from `src/domain/types.js`.
- Produces:
  - `runSearch(scenario: Scenario, rules?: RulesSpec): Promise<SearchResult>` — spawns a one-shot worker, runs `bfs`, resolves with the result, terminates the worker. On worker error, rejects.

- [ ] **Step 1: `src/workers/bfs.worker.ts`**

```ts
import { bfs } from '../search/bfs.js';
import type { Scenario, RulesSpec } from '../domain/types.js';

self.onmessage = (e: MessageEvent<{ scenario: Scenario; rules?: RulesSpec }>) => {
  try {
    const result = bfs(e.data.scenario, e.data.rules);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
```

- [ ] **Step 2: `src/ui/lib/worker-client.ts`**

```ts
import type { Scenario, RulesSpec, SearchResult } from '../../domain/types.js';

export function runSearch(scenario: Scenario, rules?: RulesSpec): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/bfs.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: SearchResult; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? 'search failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ scenario, rules });
  });
}
```

- [ ] **Step 3: Write `test/worker-client.test.ts`** — a node-env test that verifies the worker MESSAGE CONTRACT by calling `bfs` directly the way the worker does, and asserts the postMessage payload shape (the worker file itself can't run under vitest node env without a Worker polyfill; test the contract instead).

```ts
import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';

describe('bfs worker contract', () => {
  it('the payload the worker posts back is a well-formed SearchResult', () => {
    const result = bfs(rewardSettlementScenario, BUGGY_RULES);
    const payload = { ok: true, result };
    // structured-clone round-trip (what postMessage does)
    const cloned = structuredClone(payload);
    expect(cloned.ok).toBe(true);
    expect(cloned.result.trace!.steps).toHaveLength(3);
    expect(cloned.result.explored).toBe(22);
    expect(cloned.result.violations[0].invariantId).toBe('no_benefit_after_cancel');
  });
});
```

- [ ] **Step 4: Run**

Run: `pnpm test worker-client && pnpm typecheck`
Expected: pass. (`SearchResult` is plain JSON — structuredClone works.)

- [ ] **Step 5: Commit**

```bash
git add src/workers/bfs.worker.ts src/ui/lib/worker-client.ts test/worker-client.test.ts
git commit -m "feat: BFS web worker + runSearch client"
```

---

### Task 4: `/simulate` — preset load, clawback toggle, Run

**Files:**
- Create: `app/simulate/page.tsx`
- Create: `src/ui/lib/preset.ts`
- Create: `src/ui/components/RuleList.tsx`

**Interfaces:**
- Consumes: `rewardSettlementScenario`, `BUGGY_RULES`, `FIXED_RULES` from `src/scenarios/reward-settlement.js`; `runSearch` from `src/ui/lib/worker-client.js`; `SearchResult` type.
- Produces:
  - `src/ui/lib/preset.ts` → `getPreset(): { scenario: Scenario; buggyRules: RulesSpec; fixedRules: RulesSpec }`
  - `/simulate` client page: preset is loaded; a toggle switches the clawback rule BUGGY↔FIXED; **[Run]** calls `runSearch(scenario, activeRules)` and stores the `SearchResult` in state; loading + error states handled.

- [ ] **Step 1: `src/ui/lib/preset.ts`**

```ts
import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../../scenarios/reward-settlement.js';
import type { Scenario, RulesSpec } from '../../domain/types.js';

export function getPreset(): { scenario: Scenario; buggyRules: RulesSpec; fixedRules: RulesSpec } {
  return {
    scenario: structuredClone(rewardSettlementScenario),
    buggyRules: structuredClone(BUGGY_RULES),
    fixedRules: structuredClone(FIXED_RULES),
  };
}
```

- [ ] **Step 2: `src/ui/components/RuleList.tsx`** — read-only rendering of a `RulesSpec` (rule id, trigger, conditions summary, effects summary). Small, presentational.

```tsx
import type { RulesSpec } from '../../domain/types';

export function RuleList({ rules }: { rules: RulesSpec }) {
  return (
    <ul className="space-y-2">
      {rules.rules.map((r) => (
        <li key={r.id} className="rounded border border-neutral-800 p-3 text-sm">
          <div className="font-medium text-emerald-400">{r.id}</div>
          <div className="text-neutral-400">on {r.trigger.type}</div>
          <div className="mt-1 text-neutral-300">
            {r.conditions.length > 0 && <span>if {r.conditions.length} condition(s) · </span>}
            {r.effects.map((e) => e.primitive).join(', ')}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: `app/simulate/page.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { SearchResult } from '../../src/domain/types';
import { getPreset } from '../../src/ui/lib/preset';
import { runSearch } from '../../src/ui/lib/worker-client';
import { RuleList } from '../../src/ui/components/RuleList';

type Phase = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: SearchResult } | { kind: 'error'; message: string };

export default function SimulatePage() {
  const preset = useMemo(() => getPreset(), []);
  const [clawback, setClawback] = useState<'buggy' | 'fixed'>('buggy');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const activeRules = clawback === 'buggy' ? preset.buggyRules : preset.fixedRules;

  async function run() {
    setPhase({ kind: 'running' });
    try {
      const result = await runSearch(preset.scenario, activeRules);
      setPhase({ kind: 'done', result });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Reward Settlement</h1>
      <p className="mt-2 text-sm text-neutral-400">
        기획 의도: 전액 환불된(취소된) 주문은 사용자에게 순경제적 혜택을 남기지 않는다.
      </p>

      <section className="mt-8">
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-400">Clawback 규칙</span>
          <button
            onClick={() => setClawback((c) => (c === 'buggy' ? 'fixed' : 'buggy'))}
            className="rounded border border-neutral-700 px-3 py-1 text-sm"
          >
            {clawback === 'buggy' ? 'RECLAIM_REWARD (원본)' : 'RECLAIM_REWARD_FULL (수정)'}
          </button>
        </div>
        <div className="mt-4">
          <RuleList rules={activeRules} />
        </div>
      </section>

      <button
        onClick={run}
        disabled={phase.kind === 'running'}
        className="mt-8 rounded bg-emerald-500 px-4 py-2 font-medium text-neutral-950 disabled:opacity-50"
      >
        {phase.kind === 'running' ? '탐색 중…' : 'Run'}
      </button>

      <section className="mt-8" data-testid="result">
        {phase.kind === 'error' && <p className="text-red-400">에러: {phase.message}</p>}
        {phase.kind === 'done' && (
          <pre className="overflow-x-auto rounded bg-neutral-900 p-4 text-xs">
            {JSON.stringify(
              { trace: phase.result.trace ? phase.result.trace.steps.map((s) => s.action.type) : null,
                violations: phase.result.violations, explored: phase.result.explored },
              null, 2,
            )}
          </pre>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Verify manually**

```bash
pnpm dev
# open http://localhost:3000/simulate
# Run with clawback=buggy → JSON shows 3 action types + no_benefit_after_cancel + explored 22
# toggle to fixed → Run → trace null, violations [], explored 71
```

- [ ] **Step 5: `pnpm typecheck` + `pnpm build` + commit**

```bash
pnpm typecheck && pnpm build
git add app/simulate src/ui
git commit -m "feat: /simulate — preset, clawback toggle, worker-backed Run"
```

---

### Task 5: Trace result view — steps, state deltas, Net Value

**Files:**
- Create: `src/ui/components/TraceView.tsx`
- Create: `src/ui/components/StateDeltaTable.tsx`
- Create: `src/ui/lib/state-diff.ts`
- Modify: `app/simulate/page.tsx` (render `TraceView` instead of the `<pre>`)
- Test: `test/state-diff.test.ts`

**Interfaces:**
- Consumes: `CounterexampleTrace`, `TraceStep`, `SimulationState`, `Violation` from types; `identityNetExtractedValue` from `src/invariants/metrics.js`.
- Produces:
  - `src/ui/lib/state-diff.ts` → `ledgerDelta(before: SimulationState, after: SimulationState, identityId: string): { key: string; before: number; after: number }[]` — only changed ledger fields.
  - `TraceView({ result }: { result: SearchResult })` — renders violation header, per-step cards with `StateDeltaTable`, and the Net Extracted Value.

- [ ] **Step 1: `src/ui/lib/state-diff.ts`**

```ts
import type { SimulationState } from '../../domain/types.js';

const LEDGER_KEYS = ['cashPaid', 'cashRefunded', 'goodsRetained', 'pointsBalance'] as const;

export function ledgerDelta(before: SimulationState, after: SimulationState, identityId: string) {
  const b = before.ledger[identityId];
  const a = after.ledger[identityId];
  const out: { key: string; before: number; after: number }[] = [];
  for (const k of LEDGER_KEYS) {
    if (b[k] !== a[k]) out.push({ key: k, before: b[k], after: a[k] });
  }
  return out;
}
```

- [ ] **Step 2: `test/state-diff.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';
import { ledgerDelta } from '../src/ui/lib/state-diff.js';

describe('ledgerDelta', () => {
  it('reports only changed ledger fields per step of the demo counterexample', () => {
    const { trace } = bfs(rewardSettlementScenario, BUGGY_RULES);
    const s1 = trace!.steps[0]; // PURCHASE 50000
    const d1 = ledgerDelta(s1.stateBefore, s1.stateAfter, 'id1');
    expect(d1.map((x) => x.key).sort()).toEqual(['cashPaid', 'goodsRetained', 'pointsBalance']);
    const cash = d1.find((x) => x.key === 'cashPaid')!;
    expect([cash.before, cash.after]).toEqual([0, 50000]);
  });
});
```

- [ ] **Step 3: `src/ui/components/StateDeltaTable.tsx`**

```tsx
export function StateDeltaTable({ rows }: { rows: { key: string; before: number; after: number }[] }) {
  if (rows.length === 0) return <p className="text-xs text-neutral-500">원장 변화 없음</p>;
  return (
    <table className="mt-2 text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="pr-4 text-neutral-400">{r.key}</td>
            <td className="pr-2 text-neutral-500">{r.before.toLocaleString()}</td>
            <td className="pr-2 text-neutral-600">→</td>
            <td className="text-emerald-400">{r.after.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: `src/ui/components/TraceView.tsx`**

```tsx
import type { SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';
import { ledgerDelta } from '../lib/state-diff';
import { StateDeltaTable } from './StateDeltaTable';

export function TraceView({ result }: { result: SearchResult }) {
  if (!result.trace) {
    return (
      <div className="rounded border border-neutral-800 p-4">
        <p className="font-medium text-neutral-300">
          No violation found within explored bounds ({result.explored} states)
        </p>
      </div>
    );
  }
  const { trace, violations } = result;
  const nev = identityNetExtractedValue(trace.finalState, 'id1');
  return (
    <div className="space-y-4">
      <div className="rounded border border-red-900 bg-red-950/40 p-4">
        <p className="text-sm font-semibold text-red-300">Verified Counterexample</p>
        <p className="mt-1 text-xs text-neutral-400">
          Violated intent: {violations.map((v) => v.invariantId).join(', ')} · {result.explored} states explored
        </p>
      </div>

      <ol className="space-y-3">
        {trace.steps.map((step, i) => (
          <li key={i} className="rounded border border-neutral-800 p-3">
            <div className="text-sm font-medium">
              {i + 1}. {step.action.type}
              {'amount' in step.action && <span className="text-neutral-400"> ({step.action.amount.toLocaleString()})</span>}
              {'orderId' in step.action && <span className="text-neutral-400"> {step.action.orderId}</span>}
            </div>
            <StateDeltaTable rows={ledgerDelta(step.stateBefore, step.stateAfter, 'id1')} />
          </li>
        ))}
      </ol>

      <div className="rounded border border-emerald-900 bg-emerald-950/30 p-4">
        <p className="text-xs text-neutral-400">Net Extracted Value</p>
        <p className="text-2xl font-semibold text-emerald-300">₩{nev.toLocaleString()}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire into `app/simulate/page.tsx`** — replace the `phase.kind === 'done'` `<pre>` block with `<TraceView result={phase.result} />`.

- [ ] **Step 6: Verify**

Run: `pnpm test state-diff && pnpm typecheck && pnpm build`
Manual: `/simulate` Run (buggy) → 3 step cards with deltas, "Verified Counterexample", Net ₩10,000.

- [ ] **Step 7: Commit**

```bash
git add src/ui app/simulate test/state-diff.test.ts
git commit -m "feat: trace result view — steps, ledger deltas, Net Extracted Value"
```

---

### Task 6: Before / After panel

**Files:**
- Create: `src/ui/components/BeforeAfterPanel.tsx`
- Modify: `app/simulate/page.tsx`

**Interfaces:**
- Consumes: `SearchResult`, `runSearch`, preset rules.
- Produces: after a buggy run produced a counterexample, a **[Re-run with fix]** action runs `runSearch(scenario, fixedRules)` and renders a two-column Before/After comparison (Before: Verified Counterexample + Net ₩10,000; After: No violation found within explored bounds) plus the one-line rule diff.

- [ ] **Step 1: `src/ui/components/BeforeAfterPanel.tsx`**

```tsx
import type { SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';

function summary(r: SearchResult): string {
  if (!r.trace) return `No violation found within explored bounds (${r.explored} states)`;
  const nev = identityNetExtractedValue(r.trace.finalState, 'id1');
  return `Verified Counterexample · ${r.trace.steps.length} steps · Net ₩${nev.toLocaleString()}`;
}

export function BeforeAfterPanel({ before, after }: { before: SearchResult; after: SearchResult }) {
  return (
    <div className="mt-8">
      <p className="text-xs text-neutral-500">Rule change: RECLAIM_REWARD → RECLAIM_REWARD_FULL</p>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div className="rounded border border-red-900 p-4 text-sm">
          <p className="font-semibold text-red-300">Before</p>
          <p className="mt-1 text-neutral-300">{summary(before)}</p>
        </div>
        <div className="rounded border border-emerald-900 p-4 text-sm">
          <p className="font-semibold text-emerald-300">After</p>
          <p className="mt-1 text-neutral-300">{summary(after)}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `app/simulate/page.tsx`** — add `afterResult` state; when `phase.kind === 'done' && phase.result.trace`, show a **[Re-run with fix]** button that calls `runSearch(preset.scenario, preset.fixedRules)` and sets `afterResult`; render `<BeforeAfterPanel before={phase.result} after={afterResult} />` when both present.

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm build`; manual: Run (buggy) → Re-run with fix → two-column panel, Before "Net ₩10,000", After "No violation found".

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/BeforeAfterPanel.tsx app/simulate/page.tsx
git commit -m "feat: Before/After panel — re-run with fix, side-by-side comparison"
```

---

### Task 7: LLM explain — provider, endpoint, card

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/explain.ts`
- Create: `app/api/explain/route.ts`
- Create: `src/ui/components/ExplainCard.tsx`
- Modify: `app/simulate/page.tsx`
- Test: `test/explain.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk`; `CounterexampleTrace`, `Violation` from types.
- Produces:
  - `src/llm/provider.ts` → `callLLM(system: string, user: string): Promise<string>` — thin Anthropic wrapper, model `claude-sonnet-5`, reads `process.env.ANTHROPIC_API_KEY`.
  - `src/llm/explain.ts` → `buildExplainPrompt(trace, violations): { system: string; user: string }` and `parseExplain(raw: string): { rootCause: string; riskLabel: string }`.
  - `POST /api/explain` — body `{ trace, violations }` → `{ rootCause, riskLabel }`. Node runtime.
  - `ExplainCard` — calls the endpoint, shows loading/error, renders root cause + risk label badge.

- [ ] **Step 1: `pnpm add @anthropic-ai/sdk`**

- [ ] **Step 2: `src/llm/provider.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';

export async function callLLM(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}
```

- [ ] **Step 3: `src/llm/explain.ts`**

```ts
import type { CounterexampleTrace, Violation } from '../domain/types.js';

export function buildExplainPrompt(trace: CounterexampleTrace, violations: Violation[]) {
  const system =
    'You explain, in Korean, why a verified counterexample from a promotion-rule simulator ' +
    'violates the stated business intent. You NEVER compute or restate monetary figures — the ' +
    'simulator already did. Output exactly two lines:\n' +
    'ROOT_CAUSE: <2-4 sentences on the rule interaction that caused it>\n' +
    'RISK_LABEL: <a short English label like "Reward Clawback Bypass">';
  const steps = trace.steps
    .map((s, i) => `${i + 1}. ${s.action.type}${'amount' in s.action ? ` amount=${s.action.amount}` : ''}${'orderId' in s.action ? ` order=${s.action.orderId}` : ''}`)
    .join('\n');
  const user =
    `Violated invariant(s): ${violations.map((v) => v.invariantId).join(', ')}\n\n` +
    `Action sequence:\n${steps}\n\n` +
    `Explain the rule interaction. Two lines only.`;
  return { system, user };
}

export function parseExplain(raw: string): { rootCause: string; riskLabel: string } {
  const rc = raw.match(/ROOT_CAUSE:\s*(.+?)(?:\n|$)/s)?.[1]?.trim() ?? raw.trim();
  const rl = raw.match(/RISK_LABEL:\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? 'Business Logic Abuse';
  return { rootCause: rc.replace(/RISK_LABEL:[\s\S]*$/, '').trim(), riskLabel: rl };
}
```

- [ ] **Step 4: `test/explain.test.ts`** — no network. Test `buildExplainPrompt` includes the step sequence and the "never compute figures" instruction; test `parseExplain` on a sample raw string.

```ts
import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';
import { buildExplainPrompt, parseExplain } from '../src/llm/explain.js';

describe('explain prompt', () => {
  it('includes the action sequence and forbids figure computation', () => {
    const { trace, violations } = bfs(rewardSettlementScenario, BUGGY_RULES);
    const { system, user } = buildExplainPrompt(trace!, violations);
    expect(system).toMatch(/NEVER compute/i);
    expect(user).toContain('PURCHASE_WITH_POINTS');
    expect(user).toContain('CANCEL_ORDER');
    expect(user).toContain('no_benefit_after_cancel');
  });
  it('parses a two-line response', () => {
    const raw = 'ROOT_CAUSE: 보상이 소진된 뒤 원 주문을 취소하면 clawback이 잔액 한도로만 실행되어 회수되지 않는다. 결과적으로 취소 거래가 순혜택을 남긴다.\nRISK_LABEL: Reward Clawback Bypass';
    const out = parseExplain(raw);
    expect(out.riskLabel).toBe('Reward Clawback Bypass');
    expect(out.rootCause).toMatch(/clawback/);
    expect(out.rootCause).not.toMatch(/RISK_LABEL/);
  });
});
```

- [ ] **Step 5: `app/api/explain/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '../../../src/llm/provider';
import { buildExplainPrompt, parseExplain } from '../../../src/llm/explain';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { trace, violations } = await req.json();
    const { system, user } = buildExplainPrompt(trace, violations);
    const raw = await callLLM(system, user);
    return NextResponse.json(parseExplain(raw));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 6: `src/ui/components/ExplainCard.tsx`**

```tsx
'use client';
import { useState } from 'react';
import type { CounterexampleTrace, Violation } from '../../domain/types';

export function ExplainCard({ trace, violations }: { trace: CounterexampleTrace; violations: Violation[] }) {
  const [state, setState] = useState<
    { k: 'idle' } | { k: 'loading' } | { k: 'done'; rootCause: string; riskLabel: string } | { k: 'error'; m: string }
  >({ k: 'idle' });

  async function explain() {
    setState({ k: 'loading' });
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trace, violations }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'explain failed');
      setState({ k: 'done', rootCause: data.rootCause, riskLabel: data.riskLabel });
    } catch (e) {
      setState({ k: 'error', m: (e as Error).message });
    }
  }

  if (state.k === 'idle')
    return <button onClick={explain} className="mt-4 rounded border border-neutral-700 px-3 py-1 text-sm">Explain</button>;
  if (state.k === 'loading') return <p className="mt-4 text-sm text-neutral-400">분석 중…</p>;
  if (state.k === 'error') return <p className="mt-4 text-sm text-red-400">에러: {state.m}</p>;
  return (
    <div className="mt-4 rounded border border-neutral-800 p-4">
      <span className="inline-block rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
        {state.riskLabel}
      </span>
      <p className="mt-2 text-sm text-neutral-300">{state.rootCause}</p>
    </div>
  );
}
```

- [ ] **Step 7: Wire into `TraceView`** — when `result.trace`, render `<ExplainCard trace={result.trace} violations={result.violations} />`.

- [ ] **Step 8: Verify**

Run: `pnpm test explain && pnpm typecheck && pnpm build`
Manual (needs `ANTHROPIC_API_KEY` in `.env.local`): `/simulate` Run → Explain → root cause + risk label render.

- [ ] **Step 9: Commit**

```bash
git add src/llm app/api src/ui/components/ExplainCard.tsx src/ui/components/TraceView.tsx test/explain.test.ts package.json
git commit -m "feat: LLM explain — provider, /api/explain, ExplainCard (no numbers)"
```

---

### Task 8: Landing page

**Files:**
- Modify: `app/page.tsx`

**Interfaces:** none.

- [ ] **Step 1: `app/page.tsx`**

```tsx
import Link from 'next/link';

const PILLARS = [
  ['AI Formalization', '자연어 규칙·의도를 구조화된 스펙으로'],
  ['Finite Abstraction', '무한 입력 공간을 의미 있는 유한 상태로'],
  ['Deterministic Simulation', '규칙을 실제로 실행'],
  ['Bounded Exhaustive Search', '경계 안의 모든 reachable state 검사'],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold leading-tight">
        이벤트는 정상 사용자를 기준으로 테스트합니다.
        <br />
        <span className="text-neutral-400">어뷰저는 정상적으로 사용하지 않습니다.</span>
      </h1>
      <p className="mt-6 text-neutral-300">
        RuleStress는 이벤트 규칙과 기획 의도를 구조화하고, 가능한 행동 순서를 직접 시뮬레이션해
        예상하지 못한 허점을 출시 전에 찾아냅니다.
      </p>
      <Link
        href="/simulate"
        className="mt-8 inline-block rounded bg-emerald-500 px-5 py-2.5 font-medium text-neutral-950"
      >
        내 이벤트 스트레스 테스트하기
      </Link>
      <ul className="mt-16 grid grid-cols-2 gap-4">
        {PILLARS.map(([t, d]) => (
          <li key={t} className="rounded border border-neutral-800 p-4">
            <p className="font-medium text-emerald-400">{t}</p>
            <p className="mt-1 text-sm text-neutral-400">{d}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify** `pnpm build` + manual look.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: landing page"
```

---

### Task 9: Deploy readiness

**Files:**
- Create: `README.md`
- Modify: `.env.local.example` (if needed)

**Interfaces:** none — produces docs + a verified production build.

- [ ] **Step 1: `README.md`** — what it is, `pnpm install && pnpm dev`, `ANTHROPIC_API_KEY` requirement, `pnpm test` / `pnpm gate1`, the 3-step demo path, deploy = Vercel (set `ANTHROPIC_API_KEY` env var).

- [ ] **Step 2: Full verification**

```bash
pnpm install
pnpm typecheck   # clean
pnpm test        # all green (engine + product logic tests)
pnpm gate1       # 4/4
pnpm build       # succeeds, no type errors, worker bundles
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README + deploy notes"
```

- [ ] **Step 4: Hand off to the human** — Vercel deploy needs a GitHub repo. Report: "Push to GitHub (`gh repo create rulestress --private --source=. --push`), import to Vercel, set `ANTHROPIC_API_KEY`. Then verify the deployed `/simulate` runs the 3-step demo and Explain works."

---

### Task 10 (P1): Benchmark scenario 2 — Repurchase Double

**Files:**
- Create: `src/scenarios/repurchase-double.ts`
- Test: `test/scenario-repurchase-double.test.ts`

**Interfaces:**
- Produces: `repurchaseDoubleScenario: Scenario` + `REPURCHASE_RULES: RulesSpec`. Passes `loadScenario`. `bfs` finds a 2-step `[PURCHASE(50000), PURCHASE(50000)]` counterexample against a `max_benefit_per_identity` invariant (`forall identity: IDENTITY_NET_EXTRACTED_VALUE <= 10000`).

- [ ] **Step 1: Write the scenario** — reuse the `purchase_reward` rule (no once-per-identity guard), single identity, `params.PURCHASE_amount: [50000]`, `bounds: { maxDepth: 3, maxOrders: 3 }`, invariant:

```ts
{
  id: 'max_benefit_per_identity',
  expr: {
    op: 'forall', entity: 'identity',
    body: { op: 'lte', left: { metric: 'IDENTITY_NET_EXTRACTED_VALUE' }, right: { constant: 10000 } },
  },
}
```

- [ ] **Step 2: Test** — `loadScenario` passes; `bfs` returns a 2-step trace, both actions `PURCHASE`, violation `max_benefit_per_identity`; `identityNetExtractedValue(finalState, 'id1') === 20000`.

- [ ] **Step 3: `pnpm test && pnpm typecheck` + commit**

```bash
git commit -m "feat: benchmark scenario — Repurchase Double (2-step, uncapped reward)"
```

---

### Task 11 (P1): Benchmark runner + LLM-Direct baseline

**Files:**
- Create: `src/benchmark/runner.ts`
- Create: `src/benchmark/llm-direct.ts`
- Create: `src/benchmark/index.ts` (a script entry)
- Test: `test/benchmark-runner.test.ts`
- Modify: `package.json` (add `"benchmark"` script)

**Interfaces:**
- Consumes: `bfs`, all scenarios, `callLLM`, `transition`/`actionPrecondition` for replay.
- Produces:
  - `runBenchmark(): Promise<BenchRow[]>` where `BenchRow = { name, ruleStress: { detected: boolean; steps: number | null; netValue: number | null }, llmDirect: { executableCounterexample: boolean } }`.
  - `llm-direct.ts` → `llmDirectAttempt(scenario, rules): Promise<{ executableCounterexample: boolean; sequence: Action[] | null }>` — builds a prompt with the SAME initialState / actions+preconditions / param candidates / bounds / FIFO+snapshot rules (spec §10), asks for a violating sequence, replays it through `transition` with the same constraints (`sequence.length <= maxDepth`, params in candidates, preconditions pass, actual violation), returns whether it executably violates.

- [ ] **Step 1: `src/benchmark/runner.ts`** — for each scenario: `const r = bfs(scenario, rules)`; row `ruleStress` = `{ detected: !!r.trace, steps: r.trace?.steps.length ?? null, netValue: r.trace ? identityNetExtractedValue(r.trace.finalState, 'id1') : null }`.

- [ ] **Step 2: `src/benchmark/llm-direct.ts`** — prompt builder (spec §10 verbatim conditions) + replay validator. Replay = fold `transition` over the LLM's sequence starting from `scenario.initialState`, checking each action's `actionPrecondition` and that its params are in the candidate set and `sequence.length <= bounds.maxDepth`; then `evaluateInvariants` on the final state.

- [ ] **Step 3: `test/benchmark-runner.test.ts`** — no network: test `runBenchmark`'s RuleStress column only (mock/omit the LLM column, or inject a fake `llmDirectAttempt`). Assert Reward Settlement row = `{ detected: true, steps: 3, netValue: 10000 }` and Repurchase Double = `{ detected: true, steps: 2, netValue: 20000 }`. Test the replay validator directly: a hand-written valid sequence → `executableCounterexample: true`; an out-of-candidate param → `false`; a too-long sequence → `false`.

- [ ] **Step 4: `src/benchmark/index.ts`** — `runBenchmark().then(rows => console.table(rows))`. `package.json`: `"benchmark": "tsx src/benchmark/index.ts"` (add `tsx` dev dep) — needs `ANTHROPIC_API_KEY` for the LLM column.

- [ ] **Step 5: `pnpm test benchmark-runner && pnpm typecheck` + commit**

```bash
git commit -m "feat: benchmark runner + LLM-Direct baseline (fair-comparison replay)"
```

---

## Self-Review

**Spec coverage:**

| Spec (product-design.md) section | Task |
|---|---|
| §1 schema hardening | Task 1 |
| §2 Next.js + Worker architecture | Task 2, 3 |
| §3 input screen (preset, clawback toggle) | Task 4 |
| §4 result screen (trace, deltas, Net Value) | Task 5 |
| §5 Before/After | Task 6 |
| §5 LLM explain | Task 7 |
| §6 benchmark + LLM-Direct | Task 10, 11 (P1) |
| §7 landing | Task 8 |
| §8 P0/P1 priority | P0 = Tasks 1-9; P1 = Tasks 10-11 |
| §10 Gate 2 | Task 9 verification + manual demo path |

Gaps: benchmark scenario 3 (Coupon Double) is explicitly P2/cut (needs engine extension) — not in this plan. Full form rule-builder is P2. Natural-language compiler is out of scope (product-design §9.2).

**Placeholder scan:** Component styling uses concrete Tailwind classes; no "add styling here". API/worker/llm code is complete. UI tasks rely on manual verification (no jsdom component tests) — this is stated, not a gap.

**Type consistency:** `runSearch(scenario, rules?)` — Task 3 def ↔ Task 4/6 calls. `SearchResult` shape consistent everywhere (`.trace`, `.violations`, `.explored`). `identityNetExtractedValue(state, 'id1')` — Task 5/6/10/11. `buildExplainPrompt(trace, violations)` / `parseExplain(raw)` — Task 7 def ↔ route ↔ test. `ledgerDelta(before, after, id)` — Task 5 def ↔ TraceView.
