import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { loadScenario } from '../src/domain/schema.js';
import { repurchaseDoubleScenario } from '../src/scenarios/repurchase-double.js';
import { identityNetExtractedValue } from '../src/invariants/metrics.js';

describe('repurchase double scenario', () => {
  it('is a valid scenario per loadScenario', () => {
    expect(() => loadScenario(repurchaseDoubleScenario)).not.toThrow();
  });

  it('bfs finds a 2-step counterexample with violation', () => {
    const result = bfs(repurchaseDoubleScenario);
    expect(result.trace).not.toBeNull();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].invariantId).toBe('max_benefit_per_identity');
  });

  it('counterexample trace has exactly 2 steps, both PURCHASE actions', () => {
    const result = bfs(repurchaseDoubleScenario);
    expect(result.trace).not.toBeNull();
    const trace = result.trace!;
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].action.type).toBe('PURCHASE');
    expect(trace.steps[1].action.type).toBe('PURCHASE');
  });

  it('identityNetExtractedValue for id1 is 20000', () => {
    const result = bfs(repurchaseDoubleScenario);
    expect(result.trace).not.toBeNull();
    const finalState = result.trace!.finalState;
    const value = identityNetExtractedValue(finalState, 'id1');
    expect(value).toBe(20000);
  });
});
