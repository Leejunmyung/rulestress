export type IdentityId = string;
export type OrderId = string;
export type RewardId = string;
export type LiabilityId = string;

export type OrderStatus = 'PAID' | 'CANCELLED';
export type PaymentKind = 'CASH' | 'POINTS';

export interface Identity {
  id: IdentityId;
  flags: Record<string, boolean>;
}

export interface Order {
  id: OrderId;
  identityId: IdentityId;
  amount: number;
  status: OrderStatus;
  paymentKind: PaymentKind;
}

export interface Reward {
  id: RewardId;
  identityId: IdentityId;
  sourceOrderId: OrderId;
  grantedAmount: number;
  remainingAmount: number;
  spentAmount: number;
  reclaimedAmount: number;
  settledByClawback: boolean;
}

export interface Liability {
  id: LiabilityId;
  identityId: IdentityId;
  amount: number;
  sourceOrderId: OrderId;
}

export interface Ledger {
  cashPaid: number;
  cashRefunded: number;
  goodsRetained: number;
  pointsBalance: number;
}

export interface SimulationState {
  currentTime: number;
  identities: Identity[];
  orders: Order[];
  rewards: Reward[];
  liabilities: Liability[];
  ledger: Record<IdentityId, Ledger>;
}

export type EventType = 'ORDER_PAID' | 'ORDER_CANCELLED' | 'POINTS_SPENT';

export interface SimEvent {
  type: EventType;
  identityId: IdentityId;
  orderId?: OrderId;
  amount?: number;
  paymentKind?: PaymentKind;
}

export type Effect =
  | { primitive: 'CREATE_ORDER'; identityId: IdentityId; amount: number; paymentKind: PaymentKind }
  | { primitive: 'SET_ORDER_STATUS'; orderId: OrderId; status: OrderStatus }
  | { primitive: 'ADD_CASH_PAID'; identityId: IdentityId; value: number }
  | { primitive: 'ADD_CASH_REFUNDED'; identityId: IdentityId; value: number }
  | { primitive: 'ADD_GOODS'; identityId: IdentityId; value: number }
  | { primitive: 'ISSUE_REWARD'; identityId: IdentityId; amount: number; sourceOrderId: OrderId }
  | { primitive: 'SPEND_REWARD'; identityId: IdentityId; amount: number }
  | { primitive: 'RECLAIM_REWARD'; sourceOrderId: OrderId; limit: number }
  | { primitive: 'RECLAIM_REWARD_FULL'; sourceOrderId: OrderId }
  | { primitive: 'CREATE_LIABILITY'; identityId: IdentityId; amount: number; sourceOrderId: OrderId }
  | { primitive: 'SET_FLAG'; identityId: IdentityId; key: string; value: boolean };

export type PrimitiveType = Effect['primitive'];

export type Ref = { field: string } | { constant: number | string | boolean };

export type Expr =
  | { op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'ne'; left: Ref; right: Ref }
  | { op: 'and' | 'or'; args: Expr[] }
  | { op: 'not'; arg: Expr };

export interface EffectTemplate {
  primitive: PrimitiveType;
  args: Record<string, Ref>;
}

export interface Rule {
  id: string;
  trigger: { type: EventType };
  conditions: Expr[];
  effects: EffectTemplate[];
}

export interface RulesSpec {
  rules: Rule[];
}

export type MetricName = 'IDENTITY_NET_EXTRACTED_VALUE' | 'NET_BENEFIT_FROM_ORDER';

export type InvOperand = { metric: MetricName } | { thisField: string } | { constant: number | string | boolean };

export type InvExpr =
  | { op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'ne'; left: InvOperand; right: InvOperand }
  | { op: 'and' | 'or'; args: InvExpr[] }
  | { op: 'not'; arg: InvExpr }
  | { op: 'implies'; when: InvExpr; then: InvExpr }
  | { op: 'forall'; entity: 'order' | 'identity'; body: InvExpr };

export interface Invariant {
  id: string;
  expr: InvExpr;
}

export interface InvariantSpec {
  invariants: Invariant[];
}

export type Action =
  | { type: 'PURCHASE'; identityId: IdentityId; amount: number }
  | { type: 'PURCHASE_WITH_POINTS'; identityId: IdentityId; amount: number }
  | { type: 'CANCEL_ORDER'; identityId: IdentityId; orderId: OrderId };

export type ActionType = Action['type'];

export interface Bounds {
  maxDepth: number;
  maxOrders: number;
}

export interface ParamCandidates {
  PURCHASE_amount: number[];
  PURCHASE_WITH_POINTS_amount: number[];
}

export interface Scenario {
  name: string;
  initialState: SimulationState;
  rules: RulesSpec;
  invariants: InvariantSpec;
  bounds: Bounds;
  params: ParamCandidates;
}

export interface Violation {
  invariantId: string;
  detail: string;
}

export interface TraceStep {
  action: Action;
  stateBefore: SimulationState;
  stateAfter: SimulationState;
}

export interface CounterexampleTrace {
  steps: TraceStep[];
  finalState: SimulationState;
}

export interface SearchResult {
  trace: CounterexampleTrace | null;
  violations: Violation[];
  explored: number;
}
