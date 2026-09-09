import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';

describe('bfs worker contract', () => {
  it('the payload the worker posts back is a well-formed SearchResult', () => {
    const result = bfs(rewardSettlementScenario, BUGGY_RULES);
    const payload = { ok: true, result };
    // structured-clone round-trip (what postMessage does)
    const cloned = structuredClone(payload);
    expect(cloned.ok).toBe(true);
    expect(cloned.result.trace!.steps).toHaveLength(3);
    expect(cloned.result.explored).toBe(22);
    expect(cloned.result.violations[0].invariantId).toBe('no_benefit_after_cancel');
  });
});
