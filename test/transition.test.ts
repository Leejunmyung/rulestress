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
