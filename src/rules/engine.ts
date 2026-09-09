import type { SimulationState, SimEvent, RulesSpec, Rule } from '../domain/types.js';
import { evalExpr, materializeEffect } from './expr.js';
import { applyEffect } from '../domain/primitives.js';

export function matchRules(snapshot: SimulationState, event: SimEvent, spec: RulesSpec): Rule[] {
  return spec.rules.filter(
    (r) =>
      r.trigger.type === event.type &&
      r.conditions.every((c) => evalExpr(c, { state: snapshot, event })),
  );
}

export function applyMatchedRules(
  current: SimulationState,
  matched: Rule[],
  event: SimEvent,
): SimulationState {
  let s = current;
  for (const rule of matched) {
    for (const tmpl of rule.effects) {
      const effect = materializeEffect(tmpl, { state: s, event });
      s = applyEffect(s, effect);
    }
  }
  return s;
}
