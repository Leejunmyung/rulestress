import { describe, it, expect } from 'vitest';
import { loadScenario } from '../src/domain/schema.js';
import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../src/scenarios/reward-settlement.js';

describe('reward settlement scenario', () => {
  it('is a valid scenario per loadScenario', () => {
    expect(() => loadScenario(rewardSettlementScenario)).not.toThrow();
  });
  it('buggy and fixed rulesets differ only in the clawback rule', () => {
    expect(BUGGY_RULES.rules[0]).toEqual(FIXED_RULES.rules[0]);
    expect(BUGGY_RULES.rules[1].effects[0].primitive).toBe('RECLAIM_REWARD');
    expect(FIXED_RULES.rules[1].effects[0].primitive).toBe('RECLAIM_REWARD_FULL');
  });
  it('bounds and params match the spec', () => {
    expect(rewardSettlementScenario.bounds).toEqual({ maxDepth: 4, maxOrders: 3 });
    expect(rewardSettlementScenario.params.PURCHASE_amount).toEqual([50000, 49999]);
    expect(rewardSettlementScenario.params.PURCHASE_WITH_POINTS_amount).toEqual([10000]);
  });
});
