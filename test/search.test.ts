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
    // Regression lock on canonicalKey + validActions: BUGGY halts on first
    // counterexample, so this is the count explored up to that point.
    expect(r.explored).toBe(22);
  });

  it('finds no counterexample with FIXED_RULES at the same bounds', () => {
    const r = bfs(rewardSettlementScenario, FIXED_RULES);
    expect(r.trace).toBeNull();
    expect(r.violations).toEqual([]);
    // FIXED explores the space exhaustively; 71 matches the spec's independent
    // enumeration (§8: "서로 다른 상태 71개"). A change here means canonicalKey
    // or validActions drifted.
    expect(r.explored).toBe(71);
  });

  // §9: initial state already violating -> { steps: [], finalState: initialState }, explored 1
  it('reports an already-violating initial state with an empty step list', () => {
    const scenario = structuredClone(rewardSettlementScenario);
    // The buggy final state from the demo, used directly as the initial state:
    // one CANCELLED CASH order whose spent reward leaves net benefit 10000 > 0.
    scenario.initialState = {
      currentTime: 0,
      identities: [{ id: 'id1', flags: {} }],
      orders: [{ id: 'o1', identityId: 'id1', amount: 50000, status: 'CANCELLED', paymentKind: 'CASH' }],
      rewards: [
        {
          id: 'r1',
          identityId: 'id1',
          sourceOrderId: 'o1',
          grantedAmount: 10000,
          remainingAmount: 0,
          spentAmount: 10000,
          reclaimedAmount: 0,
          settledByClawback: false,
        },
      ],
      liabilities: [],
      ledger: { id1: { cashPaid: 50000, cashRefunded: 50000, goodsRetained: 10000, pointsBalance: 0 } },
    };

    const r = bfs(scenario);
    expect(r.trace).not.toBeNull();
    expect(r.trace!.steps).toHaveLength(0);
    expect(r.trace!.finalState).toBe(scenario.initialState);
    expect(r.violations[0].invariantId).toBe('no_benefit_after_cancel');
    expect(r.explored).toBe(1);
  });

  // §9: a depth-1 counterexample threads stateBefore back to the initial state.
  it('threads a depth-1 counterexample from the initial state', () => {
    const scenario = structuredClone(rewardSettlementScenario);
    // A PAID CASH order with an already-spent reward. The order is not yet
    // CANCELLED, so the invariant holds initially; a single CANCEL_ORDER makes
    // NET_BENEFIT_FROM_ORDER(o1) = 10000 > 0.
    scenario.initialState = {
      currentTime: 0,
      identities: [{ id: 'id1', flags: {} }],
      orders: [{ id: 'o1', identityId: 'id1', amount: 50000, status: 'PAID', paymentKind: 'CASH' }],
      rewards: [
        {
          id: 'r1',
          identityId: 'id1',
          sourceOrderId: 'o1',
          grantedAmount: 10000,
          remainingAmount: 0,
          spentAmount: 10000,
          reclaimedAmount: 0,
          settledByClawback: false,
        },
      ],
      liabilities: [],
      ledger: { id1: { cashPaid: 50000, cashRefunded: 0, goodsRetained: 60000, pointsBalance: 0 } },
    };

    const r = bfs(scenario, BUGGY_RULES);
    expect(r.trace).not.toBeNull();
    expect(r.trace!.steps).toHaveLength(1);
    expect(r.trace!.steps[0].action.type).toBe('CANCEL_ORDER');
    expect(r.trace!.steps[0].stateBefore).toBe(scenario.initialState);
    expect(r.trace!.finalState).toBe(r.trace!.steps[0].stateAfter);
    expect(r.violations[0].invariantId).toBe('no_benefit_after_cancel');
  });
});
