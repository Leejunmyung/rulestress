import type { RulesSpec, Scenario } from '../domain/types.js';

const purchaseReward = {
  id: 'purchase_reward',
  trigger: { type: 'ORDER_PAID' as const },
  conditions: [
    { op: 'gte' as const, left: { field: 'event.amount' }, right: { constant: 50000 } },
    { op: 'eq' as const, left: { field: 'event.paymentKind' }, right: { constant: 'CASH' } },
  ],
  effects: [
    {
      primitive: 'ISSUE_REWARD' as const,
      args: {
        identityId: { field: 'event.identityId' },
        amount: { constant: 10000 },
        sourceOrderId: { field: 'event.orderId' },
      },
    },
  ],
};

export const REPURCHASE_RULES: RulesSpec = {
  rules: [purchaseReward],
};

export const repurchaseDoubleScenario: Scenario = {
  name: 'Repurchase Double',
  initialState: {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  },
  rules: REPURCHASE_RULES,
  invariants: {
    invariants: [
      {
        id: 'max_benefit_per_identity',
        expr: {
          op: 'forall',
          entity: 'identity',
          body: { op: 'lte', left: { metric: 'IDENTITY_NET_EXTRACTED_VALUE' }, right: { constant: 10000 } },
        },
      },
    ],
  },
  bounds: { maxDepth: 3, maxOrders: 3 },
  params: { PURCHASE_amount: [50000], PURCHASE_WITH_POINTS_amount: [10000] },
};
