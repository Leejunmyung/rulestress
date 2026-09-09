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

  it('accepts and returns a valid scenario with multiple orders', () => {
    const withOrders = structuredClone(valid);
    withOrders.initialState.orders = [
      { id: 'o1', identityId: 'id1', amount: 100, status: 'PAID', paymentKind: 'CASH' },
      { id: 'o2', identityId: 'id1', amount: 200, status: 'PAID', paymentKind: 'CASH' },
    ] as any;
    withOrders.initialState.ledger.id1.cashPaid = 300;
    withOrders.initialState.ledger.id1.goodsRetained = 300;

    const result = loadScenario(withOrders);
    expect(result).toBeDefined();
    expect(result.initialState.orders[1].id).toBe('o2');
  });
});
