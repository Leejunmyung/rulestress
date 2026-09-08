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
