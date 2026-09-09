import type { SimulationState, SimEvent, Ref, Expr, Effect, EffectTemplate } from '../domain/types.js';
import { compare } from '../shared/compare.js';

export type EvalCtx = { state: SimulationState; event: SimEvent };

export function resolveRef(ref: Ref, ctx: EvalCtx): number | string | boolean {
  if ('constant' in ref) return ref.constant;
  const path = ref.field;
  if (path.startsWith('event.')) {
    const key = path.slice('event.'.length);
    const v = (ctx.event as unknown as Record<string, unknown>)[key];
    if (v === undefined) throw new Error(`resolveRef: event has no field ${key}`);
    return v as number | string | boolean;
  }
  if (path.startsWith('ledger.')) {
    const key = path.slice('ledger.'.length) as keyof SimulationState['ledger'][string];
    const ledger = ctx.state.ledger[ctx.event.identityId];
    if (!ledger) throw new Error(`resolveRef: no ledger for ${ctx.event.identityId}`);
    if (!(key in ledger)) throw new Error(`resolveRef: unknown ledger key ${key}`);
    return ledger[key];
  }
  if (path.startsWith('identity.flags.')) {
    const key = path.slice('identity.flags.'.length);
    const identity = ctx.state.identities.find((i) => i.id === ctx.event.identityId);
    return identity?.flags[key] ?? false;
  }
  throw new Error(`resolveRef: unknown ref ${path}`);
}

export function evalExpr(expr: Expr, ctx: EvalCtx): boolean {
  switch (expr.op) {
    case 'and': return expr.args.every((a) => evalExpr(a, ctx));
    case 'or': return expr.args.some((a) => evalExpr(a, ctx));
    case 'not': return !evalExpr(expr.arg, ctx);
    default: return compare(expr.op, resolveRef(expr.left, ctx), resolveRef(expr.right, ctx));
  }
}

export function materializeEffect(tmpl: EffectTemplate, ctx: EvalCtx): Effect {
  const out: Record<string, unknown> = { primitive: tmpl.primitive };
  for (const [k, ref] of Object.entries(tmpl.args)) {
    out[k] = resolveRef(ref, ctx);
  }
  return out as unknown as Effect;
}
