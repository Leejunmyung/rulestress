import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../../scenarios/reward-settlement.js';
import type { Scenario, RulesSpec } from '../../domain/types.js';

export function getPreset(): { scenario: Scenario; buggyRules: RulesSpec; fixedRules: RulesSpec } {
  return {
    scenario: structuredClone(rewardSettlementScenario),
    buggyRules: structuredClone(BUGGY_RULES),
    fixedRules: structuredClone(FIXED_RULES),
  };
}
