import type { SimulationState, InvariantSpec, InvExpr, InvOperand, Violation } from '../domain/types.js';
import { identityNetExtractedValue, netBenefitFromOrder } from './metrics.js';
import { compare } from '../rules/compare.js';

type Entity = { id: string } & Record<string, unknown>;

function resolveOperand(
  operand: InvOperand,
  state: SimulationState,
  thisEntity: Entity | null,
  entityKind: 'order' | 'identity' | null,
): number | string | boolean {
  if ('constant' in operand) return operand.constant;
  if ('thisField' in operand) {
    if (!thisEntity) throw new Error(`resolveOperand: thisField outside forall`);
    const v = thisEntity[operand.thisField];
    if (v === undefined) throw new Error(`resolveOperand: no field ${operand.thisField}`);
    return v as number | string | boolean;
  }
  // metric
  if (!thisEntity) throw new Error(`resolveOperand: metric outside forall`);
  if (operand.metric === 'IDENTITY_NET_EXTRACTED_VALUE') {
    if (entityKind !== 'identity') throw new Error('IDENTITY_NET_EXTRACTED_VALUE needs forall identity');
    return identityNetExtractedValue(state, thisEntity.id);
  }
  if (operand.metric === 'NET_BENEFIT_FROM_ORDER') {
    if (entityKind !== 'order') throw new Error('NET_BENEFIT_FROM_ORDER needs forall order');
    return netBenefitFromOrder(state, thisEntity.id);
  }
  throw new Error(`resolveOperand: unknown metric`);
}

function evalInv(
  e: InvExpr,
  state: SimulationState,
  thisEntity: Entity | null,
  entityKind: 'order' | 'identity' | null,
): boolean {
  switch (e.op) {
    case 'forall': {
      const list: Entity[] = e.entity === 'order' ? (state.orders as unknown as Entity[]) : (state.identities as unknown as Entity[]);
      return list.every((ent) => evalInv(e.body, state, ent, e.entity));
    }
    case 'and': return e.args.every((a) => evalInv(a, state, thisEntity, entityKind));
    case 'or': return e.args.some((a) => evalInv(a, state, thisEntity, entityKind));
    case 'not': return !evalInv(e.arg, state, thisEntity, entityKind);
    case 'implies':
      return !evalInv(e.when, state, thisEntity, entityKind) || evalInv(e.then, state, thisEntity, entityKind);
    default:
      return compare(
        e.op,
        resolveOperand(e.left, state, thisEntity, entityKind),
        resolveOperand(e.right, state, thisEntity, entityKind),
      );
  }
}

function firstFailingEntity(
  e: InvExpr,
  state: SimulationState,
): { kind: 'order' | 'identity'; id: string } | null {
  if (e.op === 'forall') {
    const list: Entity[] = e.entity === 'order' ? (state.orders as unknown as Entity[]) : (state.identities as unknown as Entity[]);
    for (const ent of list) {
      if (!evalInv(e.body, state, ent, e.entity)) return { kind: e.entity, id: ent.id };
    }
  }
  return null;
}

export function evaluateInvariants(state: SimulationState, spec: InvariantSpec): Violation[] {
  const out: Violation[] = [];
  for (const inv of spec.invariants) {
    if (!evalInv(inv.expr, state, null, null)) {
      const failing = firstFailingEntity(inv.expr, state);
      const detail = failing ? `${failing.kind}=${failing.id}` : 'invariant violated';
      out.push({ invariantId: inv.id, detail });
    }
  }
  return out;
}
