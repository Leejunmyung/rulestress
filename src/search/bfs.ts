import type {
  SimulationState,
  Scenario,
  RulesSpec,
  Action,
  SearchResult,
  CounterexampleTrace,
  TraceStep,
} from '../domain/types.js';
import { transition } from '../simulation/transition.js';
import { evaluateInvariants } from '../invariants/evaluate.js';
import { assertInternalInvariants } from '../domain/invariants.js';
import { canonicalKey } from './canonical.js';
import { validActions } from './valid-actions.js';

type ParentLink = { prevKey: string; action: Action; stateAfter: SimulationState };

function buildTrace(
  parent: Map<string, ParentLink>,
  initialState: SimulationState,
  stateBeforeLast: SimulationState,
  lastAction: Action,
  finalState: SimulationState,
): CounterexampleTrace {
  const rev: { action: Action; after: SimulationState }[] = [];
  let key = canonicalKey(stateBeforeLast);
  while (parent.has(key)) {
    const link = parent.get(key)!;
    rev.push({ action: link.action, after: link.stateAfter });
    key = link.prevKey;
  }
  rev.reverse();
  const ordered = [...rev, { action: lastAction, after: finalState }];

  const steps: TraceStep[] = [];
  let before = initialState;
  for (const { action, after } of ordered) {
    steps.push({ action, stateBefore: before, stateAfter: after });
    before = after;
  }
  return { steps, finalState };
}

export function bfs(scenario: Scenario, rules: RulesSpec = scenario.rules): SearchResult {
  const { initialState, invariants, bounds } = scenario;
  assertInternalInvariants(initialState);

  const visited = new Set<string>([canonicalKey(initialState)]);

  const v0 = evaluateInvariants(initialState, invariants);
  if (v0.length > 0) {
    return { trace: { steps: [], finalState: initialState }, violations: v0, explored: visited.size };
  }

  const queue: { state: SimulationState; depth: number }[] = [{ state: initialState, depth: 0 }];
  const parent = new Map<string, ParentLink>();

  while (queue.length > 0) {
    const { state: s, depth } = queue.shift()!;
    if (depth >= bounds.maxDepth) continue;

    for (const action of validActions(s, scenario)) {
      const { nextState, invalid } = transition(s, action, rules, bounds.maxOrders);
      if (invalid) continue;

      const violations = evaluateInvariants(nextState, invariants);
      if (violations.length > 0) {
        return {
          trace: buildTrace(parent, initialState, s, action, nextState),
          violations,
          explored: visited.size,
        };
      }

      const key = canonicalKey(nextState);
      if (visited.has(key)) continue;
      visited.add(key);
      parent.set(key, { prevKey: canonicalKey(s), action, stateAfter: nextState });
      queue.push({ state: nextState, depth: depth + 1 });
    }
  }

  return { trace: null, violations: [], explored: visited.size };
}
