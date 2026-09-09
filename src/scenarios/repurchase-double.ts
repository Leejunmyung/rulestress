import type { RulesSpec, Scenario } from '../domain/types.js';
import { purchaseReward } from './reward-settlement.js';

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
