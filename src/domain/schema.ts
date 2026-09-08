import { z } from 'zod';
import type { Scenario } from './types.js';
import { assertInternalInvariants } from './invariants.js';

const nonNegInt = z
  .number()
  .int({ message: 'must be a non-negative integer' })
  .nonnegative({ message: 'must be a non-negative integer' });

const ledgerSchema = z.object({
  cashPaid: nonNegInt,
  cashRefunded: nonNegInt,
  goodsRetained: z.number().int(), // can be 0+; negative caught by assertInternalInvariants
  pointsBalance: nonNegInt,
});

const stateSchema = z.object({
  currentTime: z.number().int(),
  identities: z.array(z.object({ id: z.string(), flags: z.record(z.boolean()) })),
  orders: z.array(
    z.object({
      id: z.string(),
      identityId: z.string(),
      amount: nonNegInt,
      status: z.enum(['PAID', 'CANCELLED']),
      paymentKind: z.enum(['CASH', 'POINTS']),
    }),
  ),
  rewards: z.array(
    z.object({
      id: z.string(),
      identityId: z.string(),
      sourceOrderId: z.string(),
      grantedAmount: nonNegInt,
      remainingAmount: nonNegInt,
      spentAmount: nonNegInt,
      reclaimedAmount: nonNegInt,
      settledByClawback: z.boolean(),
    }),
  ),
  liabilities: z.array(
    z.object({
      id: z.string(),
      identityId: z.string(),
      amount: nonNegInt,
      sourceOrderId: z.string(),
    }),
  ),
  ledger: z.record(ledgerSchema),
});

const refSchema: z.ZodType = z.union([
  z.object({ field: z.string() }),
  z.object({ constant: z.union([z.number(), z.string(), z.boolean()]) }),
]);

const exprSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'ne']), left: refSchema, right: refSchema }),
    z.object({ op: z.enum(['and', 'or']), args: z.array(exprSchema) }),
    z.object({ op: z.literal('not'), arg: exprSchema }),
  ]),
);

const invOperandSchema = z.union([
  z.object({ metric: z.enum(['IDENTITY_NET_EXTRACTED_VALUE', 'NET_BENEFIT_FROM_ORDER']) }),
  z.object({ thisField: z.string() }),
  z.object({ constant: z.union([z.number(), z.string(), z.boolean()]) }),
]);

const invExprSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'ne']), left: invOperandSchema, right: invOperandSchema }),
    z.object({ op: z.enum(['and', 'or']), args: z.array(invExprSchema) }),
    z.object({ op: z.literal('not'), arg: invExprSchema }),
    z.object({ op: z.literal('implies'), when: invExprSchema, then: invExprSchema }),
    z.object({ op: z.literal('forall'), entity: z.enum(['order', 'identity']), body: invExprSchema }),
  ]),
);

const scenarioSchema = z.object({
  name: z.string(),
  initialState: stateSchema,
  rules: z.object({
    rules: z.array(
      z.object({
        id: z.string(),
        trigger: z.object({ type: z.enum(['ORDER_PAID', 'ORDER_CANCELLED', 'POINTS_SPENT']) }),
        conditions: z.array(exprSchema),
        effects: z.array(z.object({ primitive: z.string(), args: z.record(refSchema) })),
      }),
    ),
  }),
  invariants: z.object({ invariants: z.array(z.object({ id: z.string(), expr: invExprSchema })) }),
  bounds: z.object({ maxDepth: nonNegInt, maxOrders: nonNegInt }),
  params: z.object({
    PURCHASE_amount: z.array(nonNegInt),
    PURCHASE_WITH_POINTS_amount: z.array(nonNegInt),
  }),
});

function assertSequentialIds(prefix: string, ids: string[]): void {
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== `${prefix}${i + 1}`) {
      throw new Error(
        `fixture must use sequential ids: expected ${prefix}${i + 1}, got ${ids[i]}`,
      );
    }
  }
}

export function loadScenario(raw: unknown): Scenario {
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    if (/non-negative integer/i.test(msg)) {
      throw new Error(`non-negative integer required — ${msg}`);
    }
    throw new Error(`invalid scenario — ${msg}`);
  }
  const s = parsed.data as unknown as Scenario;

  assertSequentialIds('o', s.initialState.orders.map((o) => o.id));
  assertSequentialIds('r', s.initialState.rewards.map((r) => r.id));
  assertSequentialIds('l', s.initialState.liabilities.map((l) => l.id));

  assertInternalInvariants(s.initialState);

  return s;
}
