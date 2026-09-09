import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';
import { ledgerDelta } from '../src/ui/lib/state-diff.js';

describe('ledgerDelta', () => {
  it('reports only changed ledger fields per step of the demo counterexample', () => {
    const { trace } = bfs(rewardSettlementScenario, BUGGY_RULES);
    const s1 = trace!.steps[0]; // PURCHASE 50000
    const d1 = ledgerDelta(s1.stateBefore, s1.stateAfter, 'id1');
    expect(d1.map((x) => x.key).sort()).toEqual(['cashPaid', 'goodsRetained', 'pointsBalance']);
    const cash = d1.find((x) => x.key === 'cashPaid')!;
    expect([cash.before, cash.after]).toEqual([0, 50000]);
  });
});
