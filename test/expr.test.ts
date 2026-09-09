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

  it('throws on an unknown ledger key', () => {
    expect(() => resolveRef({ field: 'ledger.bogus' }, ctx())).toThrow(/unknown ledger key/i);
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

  it('evaluates or and not', () => {
    const c = ctx();
    expect(evalExpr({ op: 'or', args: [
      { op: 'eq', left: { field: 'event.paymentKind' }, right: { constant: 'POINTS' } },
      { op: 'gte', left: { field: 'event.amount' }, right: { constant: 50000 } },
    ] }, c)).toBe(true);
    expect(evalExpr({ op: 'not', arg: { op: 'eq', left: { field: 'event.paymentKind' }, right: { constant: 'CASH' } } }, c)).toBe(false);
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
