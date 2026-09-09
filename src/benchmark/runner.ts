import type { Action, RulesSpec, Scenario } from '../domain/types.js';
import { bfs } from '../search/bfs.js';
import { identityNetExtractedValue } from '../invariants/metrics.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../scenarios/reward-settlement.js';
import { repurchaseDoubleScenario, REPURCHASE_RULES } from '../scenarios/repurchase-double.js';
import { llmDirectAttempt } from './llm-direct.js';

export type BenchRow = {
  name: string;
  ruleStress: { detected: boolean; steps: number | null; netValue: number | null };
  llmDirect: { executableCounterexample: boolean };
};

export type LlmAttemptFn = (
  scenario: Scenario,
  rules: RulesSpec,
) => Promise<{ executableCounterexample: boolean; sequence: Action[] | null }>;

const BENCH_SCENARIOS: { scenario: Scenario; rules: RulesSpec }[] = [
  { scenario: rewardSettlementScenario, rules: BUGGY_RULES },
  { scenario: repurchaseDoubleScenario, rules: REPURCHASE_RULES },
];

export async function runBenchmark(opts?: { llmAttempt?: LlmAttemptFn }): Promise<BenchRow[]> {
  const llmAttempt = opts?.llmAttempt ?? llmDirectAttempt;
  const rows: BenchRow[] = [];

  for (const { scenario, rules } of BENCH_SCENARIOS) {
    const result = bfs(scenario, rules);
    const ruleStress = {
      detected: result.trace !== null,
      steps: result.trace ? result.trace.steps.length : null,
      netValue: result.trace ? identityNetExtractedValue(result.trace.finalState, 'id1') : null,
    };

    const attempt = await llmAttempt(scenario, rules);

    rows.push({
      name: scenario.name,
      ruleStress,
      llmDirect: { executableCounterexample: attempt.executableCounterexample },
    });
  }

  return rows;
}
