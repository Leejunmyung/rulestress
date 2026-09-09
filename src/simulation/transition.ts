import type { SimulationState, Action, RulesSpec } from '../domain/types.js';
import { actionPrecondition, applyBaseEffects } from './actions.js';
import { matchRules, applyMatchedRules } from '../rules/engine.js';
import { assertInternalInvariants } from '../domain/invariants.js';

export function transition(
  state: SimulationState,
  action: Action,
  rules: RulesSpec,
  maxOrders: number,
): { nextState: SimulationState; invalid: boolean } {
  if (actionPrecondition(state, action, maxOrders) !== null) {
    return { nextState: state, invalid: true };
  }

  const base = applyBaseEffects(state, action);
  let cur = base.state;

  for (const event of base.events) {
    const snapshot = cur; // per-event entry snapshot
    const matched = matchRules(snapshot, event, rules);
    cur = applyMatchedRules(cur, matched, event);
  }

  assertInternalInvariants(cur);
  return { nextState: cur, invalid: false };
}
