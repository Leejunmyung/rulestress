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

  it('threads state across effects within a single rule', () => {
    // Test A: State threading — second effect reads what first effect wrote
    const threadingRules: RulesSpec = {
      rules: [
        {
          id: 'issue_then_reclaim',
          trigger: { type: 'ORDER_PAID' },
          conditions: [],
          effects: [
            // First effect: issue 10000 points
            { primitive: 'ISSUE_REWARD', args: {
              identityId: { field: 'event.identityId' },
              amount: { constant: 10000 },
              sourceOrderId: { field: 'event.orderId' },
            } },
            // Second effect: reclaim based on balance left by first effect
            { primitive: 'RECLAIM_REWARD', args: {
              sourceOrderId: { field: 'event.orderId' },
              limit: { field: 'ledger.pointsBalance' },
            } },
          ],
        },
      ],
    };
    const s0 = blank();
    const matched = matchRules(s0, paidEvent, threadingRules);
    const s1 = applyMatchedRules(s0, matched, paidEvent);
    // If state threading works: ISSUE grants 10000, RECLAIM reads that balance and reclaims all 10000
    expect(s1.ledger.id1.pointsBalance).toBe(0);
    expect(s1.rewards[0].remainingAmount).toBe(0);
    expect(s1.rewards[0].reclaimedAmount).toBe(10000);
  });

  it('does not cascade effects within a single event (matching is fixed on entry snapshot)', () => {
    // Test B: No cascading — rule 2 must NOT match even if rule 1 sets the flag
    const cascadingRules: RulesSpec = {
      rules: [
        {
          id: 'rule1',
          trigger: { type: 'ORDER_PAID' },
          conditions: [],
          effects: [
            { primitive: 'SET_FLAG', args: {
              identityId: { field: 'event.identityId' },
              key: { constant: 'got_reward' },
              value: { constant: true },
            } },
          ],
        },
        {
          id: 'rule2',
          trigger: { type: 'ORDER_PAID' },
          conditions: [
            { op: 'eq', left: { field: 'identity.flags.got_reward' }, right: { constant: true } },
          ],
          effects: [
            { primitive: 'ISSUE_REWARD', args: {
              identityId: { field: 'event.identityId' },
              amount: { constant: 5000 },
              sourceOrderId: { field: 'event.orderId' },
            } },
          ],
        },
      ],
    };
    const s0 = blank();
    // Matching is against entry snapshot where flag is absent
    const matched = matchRules(s0, paidEvent, cascadingRules);
    expect(matched.map((r) => r.id)).toEqual(['rule1']);
    // rule2 must NOT match because matching is fixed on the entry snapshot
    // (even though rule1's effect would set the flag)
  });
});
