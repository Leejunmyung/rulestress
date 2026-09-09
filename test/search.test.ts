import { describe, it, expect } from 'vitest';
import { canonicalKey } from '../src/search/canonical.js';
import { validActions } from '../src/search/valid-actions.js';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../src/scenarios/reward-settlement.js';

describe('canonicalKey', () => {
  it('is stable regardless of object key order', () => {
    const a = { currentTime: 0, identities: [], orders: [], rewards: [], liabilities: [], ledger: {} } as any;
    const b = { ledger: {}, liabilities: [], rewards: [], orders: [], identities: [], currentTime: 0 } as any;
    expect(canonicalKey(a)).toBe(canonicalKey(b));
  });

  it('sorts nested object keys and preserves array order', () => {
    const a = { x: { a: 1, b: 2 }, arr: [1, 2] } as any;
    const b = { arr: [1, 2], x: { b: 2, a: 1 } } as any;
    expect(canonicalKey(a)).toBe(canonicalKey(b));
    const c = { arr: [2, 1] } as any;
    const d = { arr: [1, 2] } as any;
    expect(canonicalKey(c)).not.toBe(canonicalKey(d));
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

    const steps = r.trace!.steps;
    expect(steps[0].stateBefore).toBe(rewardSettlementScenario.initialState);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].stateBefore).toBe(steps[i - 1].stateAfter);
    }
    expect(r.trace!.finalState).toBe(steps[steps.length - 1].stateAfter);
    expect(r.explored).toBeGreaterThan(0);
  });

  it('finds no counterexample with FIXED_RULES at the same bounds', () => {
    const r = bfs(rewardSettlementScenario, FIXED_RULES);
    expect(r.trace).toBeNull();
    expect(r.violations).toEqual([]);
    expect(r.explored).toBeGreaterThan(1);
  });
});
