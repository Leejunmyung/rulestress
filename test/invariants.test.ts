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
