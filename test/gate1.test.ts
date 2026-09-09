import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { identityNetExtractedValue } from '../src/invariants/metrics.js';
import { rewardSettlementScenario, BUGGY_RULES, FIXED_RULES } from '../src/scenarios/reward-settlement.js';

describe('Gate 1 — search finds executable counterexample with no hardcoded sequence', () => {
  it('(1) buggy rules: BFS finds exactly the 3-step counterexample', () => {
    const r = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(r.trace).not.toBeNull();
    expect(r.trace!.steps.map((s) => s.action.type)).toEqual([
      'PURCHASE',
      'PURCHASE_WITH_POINTS',
      'CANCEL_ORDER',
    ]);
    const first = r.trace!.steps[0].action;
    expect(first.type === 'PURCHASE' && first.amount).toBe(50000);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].invariantId).toBe('no_benefit_after_cancel');
  });

  it('(1b) the counterexample final state has Net Extracted Value 10000', () => {
    const r = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(identityNetExtractedValue(r.trace!.finalState, 'id1')).toBe(10000);
  });

  it('(2) fixed rules: same bounds, no counterexample', () => {
    const r = bfs(rewardSettlementScenario, FIXED_RULES);
    expect(r.trace).toBeNull();
    expect(r.violations).toHaveLength(0);
    expect(r.explored).toBeGreaterThan(1);
  });

  it('(3) internal invariants never break during either search', () => {
    expect(() => bfs(rewardSettlementScenario, BUGGY_RULES)).not.toThrow();
    expect(() => bfs(rewardSettlementScenario, FIXED_RULES)).not.toThrow();
  });
});
