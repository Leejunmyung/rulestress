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

export const BUGGY_RULES: RulesSpec = {
  rules: [
    purchaseReward,
    {
      id: 'clawback_on_cancel',
      trigger: { type: 'ORDER_CANCELLED' },
      conditions: [],
      effects: [
        {
          primitive: 'RECLAIM_REWARD',
          args: {
            sourceOrderId: { field: 'event.orderId' },
            limit: { field: 'ledger.pointsBalance' },
          },
        },
      ],
    },
  ],
};

export const FIXED_RULES: RulesSpec = {
  rules: [
    purchaseReward,
    {
      id: 'clawback_on_cancel',
      trigger: { type: 'ORDER_CANCELLED' },
      conditions: [],
      effects: [
        {
          primitive: 'RECLAIM_REWARD_FULL',
          args: { sourceOrderId: { field: 'event.orderId' } },
        },
      ],
    },
  ],
};

export const rewardSettlementScenario: Scenario = {
  name: 'Reward Settlement',
  initialState: {
    currentTime: 0,
    identities: [{ id: 'id1', flags: {} }],
    orders: [],
    rewards: [],
    liabilities: [],
    ledger: { id1: { cashPaid: 0, cashRefunded: 0, goodsRetained: 0, pointsBalance: 0 } },
  },
  rules: BUGGY_RULES,
  invariants: {
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
  },
  bounds: { maxDepth: 4, maxOrders: 3 },
  params: { PURCHASE_amount: [50000, 49999], PURCHASE_WITH_POINTS_amount: [10000] },
};
