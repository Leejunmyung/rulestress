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
