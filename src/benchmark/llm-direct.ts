import type { Action, RulesSpec, Scenario } from '../domain/types.js';
import { actionPrecondition } from '../simulation/actions.js';
import { transition } from '../simulation/transition.js';
import { evaluateInvariants } from '../invariants/evaluate.js';
import { callLLM } from '../llm/provider.js';

const DEFAULT_IDENTITY = 'id1';

/**
 * Build the LLM-Direct prompt. Per spec §10 the LLM must receive the *exact same*
 * search conditions BFS gets: initial state, allowed actions + preconditions,
 * parameter candidates, bounds, and the FIFO + per-event snapshot execution rules.
 */
export function buildLlmDirectPrompt(
  scenario: Scenario,
  rules: RulesSpec,
): { system: string; user: string } {
  const { initialState, invariants, bounds, params } = scenario;

  const system = [
    'You are a formal-verification assistant that searches for rule-engine exploits.',
    'You are given an initial state, a rule set, an invariant, the allowed actions with',
    'their preconditions, the execution semantics, and a set of parameter candidates.',
    'Your job: find an action sequence that makes the invariant FALSE.',
    'You must use ONLY the parameter candidate values, and the sequence length must be',
    '<= maxDepth. Reply with the sequence and nothing else, one action per line.',
  ].join('\n');

  const actionSpec = [
    'Allowed actions (identity is always "id1"):',
    '- PURCHASE <amount>          base effects: create a CASH order, add cashPaid, add goods;',
    '                             emits ORDER_PAID(paymentKind=CASH). precondition: amount>0,',
    '                             identity order count < maxOrders.',
    '- PURCHASE_WITH_POINTS <amount>  base effects: spend rewards FIFO, add goods, create a',
    '                             POINTS order; emits ORDER_PAID(paymentKind=POINTS) then',
    '                             POINTS_SPENT. precondition: amount>0, order count < maxOrders,',
    '                             pointsBalance >= amount.',
    '- CANCEL_ORDER <orderId>     base effects: set order CANCELLED, refund cash, remove goods;',
    '                             emits ORDER_CANCELLED. precondition: order exists, belongs to',
    '                             the identity, status is PAID, paymentKind is CASH (POINTS',
    '                             orders cannot be cancelled). Order ids are assigned o1, o2, ...',
    '                             in creation order.',
  ].join('\n');

  const primitiveSemantics = [
    'Primitive semantics (what each rule effect does when it runs):',
    '- ISSUE_REWARD(identityId, amount, sourceOrderId): appends a reward {grantedAmount=amount,',
    '  remainingAmount=amount, spentAmount=0, reclaimedAmount=0} tagged with sourceOrderId, and',
    '  adds amount to pointsBalance.',
    '- SPEND_REWARD(identityId, amount): drains that identity\'s rewards in array order (FIFO) —',
    '  for each reward: k = min(remainingAmount, left); remainingAmount -= k; spentAmount += k;',
    '  pointsBalance -= k. Errors if the rewards cannot cover amount.',
    '- RECLAIM_REWARD(sourceOrderId, limit): walks rewards for that sourceOrderId and reclaims',
    '  ONLY from their current remainingAmount: k = min(remainingAmount, left); remainingAmount -= k;',
    '  reclaimedAmount += k; pointsBalance -= k; left -= k, starting from left = limit. `limit` is',
    '  bound to pointsBalance at execution time. It does not touch amounts already spent',
    '  (spentAmount), and it creates no liability.',
    '- RECLAIM_REWARD_FULL(sourceOrderId): reclaims what the balance allows',
    '  (fromBalance = min(remainingAmount, pointsBalance)), then books the remaining shortfall',
    '  (grantedAmount - reclaimedAmount, which includes already-spent amounts) as a liability',
    '  against the identity.',
    '- CREATE_LIABILITY(identityId, amount, sourceOrderId): records a debt; liabilities reduce the',
    '  identity\'s net extracted value.',
    '- Ref resolution timing: values inside an effect\'s args (field / constant) are resolved',
    '  against the RUNNING state at the moment that effect executes; a rule\'s trigger/conditions',
    '  are matched against the per-event entry snapshot (see below).',
    '- IDENTITY_NET_EXTRACTED_VALUE = goodsRetained + cashRefunded + pointsBalance - cashPaid -',
    '  (sum of that identity\'s liabilities). NET_BENEFIT_FROM_ORDER = sum over that order\'s',
    '  rewards of (grantedAmount - reclaimedAmount) - (that order\'s liabilities). Invariants are',
    '  checked against these metrics.',
  ].join('\n');

  const execRules = [
    'Execution semantics:',
    '- Actions are applied in the given order. Each action first applies its base effects,',
    '  then for each emitted event the rule engine runs.',
    '- Rule matching for one event uses a snapshot of the state taken at the start of that',
    "  event; an effect from an earlier-in-the-list rule does not change a later rule's match.",
    '- No rule cascading: an effect never emits a new event.',
    '- EffectTemplate Ref values (field / constant) are resolved against the snapshot + event.',
    '- Reward consumption (SPEND_REWARD, RECLAIM_REWARD) drains rewards in array order (FIFO).',
    '- Single identity only.',
  ].join('\n');

  const user = [
    `Initial state (JSON):`,
    JSON.stringify(initialState, null, 2),
    ``,
    `Rule set (JSON):`,
    JSON.stringify(rules, null, 2),
    ``,
    `Invariant that must be broken (JSON):`,
    JSON.stringify(invariants, null, 2),
    ``,
    actionSpec,
    ``,
    primitiveSemantics,
    ``,
    execRules,
    ``,
    `Bounds: maxDepth=${bounds.maxDepth} (max sequence length), maxOrders=${bounds.maxOrders}.`,
    ``,
    `Parameter candidates (use ONLY these values):`,
    `- PURCHASE amount: ${JSON.stringify(params.PURCHASE_amount)}`,
    `- PURCHASE_WITH_POINTS amount: ${JSON.stringify(params.PURCHASE_WITH_POINTS_amount)}`,
    ``,
    `Find an action sequence (length <= ${bounds.maxDepth}, parameters from the candidate sets`,
    `only) that makes the invariant false. Output one action per line, exactly in one of these`,
    `forms:`,
    `  PURCHASE 50000`,
    `  PURCHASE_WITH_POINTS 10000`,
    `  CANCEL_ORDER o1`,
    `Output only the sequence.`,
  ].join('\n');

  return { system, user };
}

/**
 * Parse an LLM reply into an Action[]. Accepts a simple line format and tolerates
 * list markers / surrounding prose. Returns null if no action line is found.
 */
export function parseSequence(raw: string): Action[] | null {
  const actions: Action[] = [];
  for (const line of raw.split('\n')) {
    const cleaned = line.trim().replace(/^[-*\d.)\]\s]+/, '').trim();
    if (cleaned === '') continue;

    let m = /^PURCHASE_WITH_POINTS\s+(-?\d+)$/i.exec(cleaned);
    if (m) {
      actions.push({ type: 'PURCHASE_WITH_POINTS', identityId: DEFAULT_IDENTITY, amount: Number(m[1]) });
      continue;
    }
    m = /^PURCHASE\s+(-?\d+)$/i.exec(cleaned);
    if (m) {
      actions.push({ type: 'PURCHASE', identityId: DEFAULT_IDENTITY, amount: Number(m[1]) });
      continue;
    }
    m = /^CANCEL_ORDER\s+(\S+)$/i.exec(cleaned);
    if (m) {
      actions.push({ type: 'CANCEL_ORDER', identityId: DEFAULT_IDENTITY, orderId: m[1] });
      continue;
    }
  }
  return actions.length > 0 ? actions : null;
}

function paramInCandidates(scenario: Scenario, action: Action): boolean {
  switch (action.type) {
    case 'PURCHASE':
      return scenario.params.PURCHASE_amount.includes(action.amount);
    case 'PURCHASE_WITH_POINTS':
      return scenario.params.PURCHASE_WITH_POINTS_amount.includes(action.amount);
    case 'CANCEL_ORDER':
      return true;
  }
}

/**
 * Replay the LLM's sequence through the RuleStress simulator under the SAME
 * constraints BFS uses. Returns executableCounterexample:true only if ALL hold:
 *  - sequence.length <= maxDepth
 *  - every parameter is in the candidate set
 *  - every action's precondition passes (maxOrders included)
 *  - the final state actually violates the invariant
 */
export function replayLlmSequence(
  scenario: Scenario,
  rules: RulesSpec,
  sequence: Action[],
): { executableCounterexample: boolean; reason: string } {
  const { maxDepth, maxOrders } = scenario.bounds;

  if (sequence.length > maxDepth) {
    return { executableCounterexample: false, reason: `sequence length ${sequence.length} > maxDepth ${maxDepth}` };
  }

  let state = scenario.initialState;
  for (let i = 0; i < sequence.length; i++) {
    const action = sequence[i];
    if (!paramInCandidates(scenario, action)) {
      return { executableCounterexample: false, reason: `step ${i + 1}: parameter not in candidate set` };
    }
    const pre = actionPrecondition(state, action, maxOrders);
    if (pre !== null) {
      return { executableCounterexample: false, reason: `step ${i + 1}: precondition failed (${pre})` };
    }
    const { nextState, invalid } = transition(state, action, rules, maxOrders);
    if (invalid) {
      return { executableCounterexample: false, reason: `step ${i + 1}: transition invalid` };
    }
    state = nextState;

    // BFS flags a counterexample as soon as ANY reached state violates an invariant,
    // so a fair replay must accept an intermediate-state violation too (spec §10).
    if (evaluateInvariants(state, scenario.invariants).length > 0) {
      return { executableCounterexample: true, reason: `violation at step ${i + 1}` };
    }
  }

  // Fallback: covers the length-0 sequence and the initial state itself.
  const violations = evaluateInvariants(state, scenario.invariants);
  if (violations.length === 0) {
    return { executableCounterexample: false, reason: 'no reached state violates the invariant' };
  }

  return { executableCounterexample: true, reason: 'ok' };
}

/**
 * Full LLM-Direct attempt: build prompt -> call the model -> parse -> replay-verify.
 * This is the ONLY network-touching path in the benchmark.
 */
export async function llmDirectAttempt(
  scenario: Scenario,
  rules: RulesSpec,
): Promise<{ executableCounterexample: boolean; sequence: Action[] | null }> {
  const { system, user } = buildLlmDirectPrompt(scenario, rules);
  const raw = await callLLM(system, user);
  const sequence = parseSequence(raw);
  if (sequence === null) {
    return { executableCounterexample: false, sequence: null };
  }
  const { executableCounterexample } = replayLlmSequence(scenario, rules, sequence);
  return { executableCounterexample, sequence };
}
