import { describe, it, expect } from 'vitest';
import type { Action } from '../src/domain/types.js';
import { runBenchmark } from '../src/benchmark/runner.js';
import {
  replayLlmSequence,
  parseSequence,
  buildLlmDirectPrompt,
} from '../src/benchmark/llm-direct.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';
import { repurchaseDoubleScenario, REPURCHASE_RULES } from '../src/scenarios/repurchase-double.js';

const fakeAttempt = async () => ({ executableCounterexample: false, sequence: null });

describe('runBenchmark (network-free, injected llmAttempt)', () => {
  it('reports the RuleStress column from bfs for each scenario', async () => {
    const rows = await runBenchmark({ llmAttempt: fakeAttempt });

    const reward = rows.find((r) => r.name === 'Reward Settlement');
    expect(reward).toBeDefined();
    expect(reward!.ruleStress).toEqual({ detected: true, steps: 3, netValue: 10000 });

    const repurchase = rows.find((r) => r.name === 'Repurchase Double');
    expect(repurchase).toBeDefined();
    expect(repurchase!.ruleStress).toEqual({ detected: true, steps: 2, netValue: 20000 });
  });

  it('passes the injected llmAttempt result into the llmDirect column', async () => {
    const rows = await runBenchmark({
      llmAttempt: async () => ({ executableCounterexample: true, sequence: [] }),
    });
    for (const row of rows) {
      expect(row.llmDirect).toEqual({ executableCounterexample: true });
    }
  });
});

describe('replayLlmSequence', () => {
  const validSeq: Action[] = [
    { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
    { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 },
    { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' },
  ];

  it('accepts a hand-written valid violating 3-step sequence', () => {
    const res = replayLlmSequence(rewardSettlementScenario, BUGGY_RULES, validSeq);
    expect(res.executableCounterexample).toBe(true);
  });

  it('rejects an out-of-candidate parameter', () => {
    const seq: Action[] = [
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 5000 },
      { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' },
    ];
    expect(replayLlmSequence(rewardSettlementScenario, BUGGY_RULES, seq).executableCounterexample).toBe(
      false,
    );
  });

  it('rejects a sequence longer than maxDepth', () => {
    const seq: Action[] = [
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
    ];
    expect(seq.length).toBeGreaterThan(rewardSettlementScenario.bounds.maxDepth);
    expect(replayLlmSequence(rewardSettlementScenario, BUGGY_RULES, seq).executableCounterexample).toBe(
      false,
    );
  });

  it('accepts a sequence that violates at an intermediate step', () => {
    const seq: Action[] = [
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
    ];
    expect(seq.length).toBeLessThanOrEqual(repurchaseDoubleScenario.bounds.maxDepth);
    const res = replayLlmSequence(repurchaseDoubleScenario, REPURCHASE_RULES, seq);
    expect(res.executableCounterexample).toBe(true);
    expect(res.reason).toBe('violation at step 2');
  });

  it('rejects a valid, in-bounds sequence that produces no violation', () => {
    const seq: Action[] = [{ type: 'PURCHASE', identityId: 'id1', amount: 50000 }];
    expect(replayLlmSequence(rewardSettlementScenario, BUGGY_RULES, seq).executableCounterexample).toBe(
      false,
    );
  });
});

describe('parseSequence', () => {
  it('parses the simple line format', () => {
    const raw = [
      'Here is the sequence:',
      '1. PURCHASE 50000',
      '2. PURCHASE_WITH_POINTS 10000',
      '3. CANCEL_ORDER o1',
    ].join('\n');
    expect(parseSequence(raw)).toEqual([
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 },
      { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' },
    ]);
  });

  it('returns null when nothing parseable is present', () => {
    expect(parseSequence('I cannot find a violating sequence.')).toBeNull();
  });

  it('parses a single-line comma-separated answer with trailing punctuation', () => {
    expect(
      parseSequence('PURCHASE 50000, PURCHASE_WITH_POINTS 10000, CANCEL_ORDER o1.'),
    ).toEqual([
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 },
      { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' },
    ]);
  });

  it('parses a sequence that follows a paragraph of reasoning', () => {
    const raw = [
      'Let me think. First we buy to earn the reward, then spend it, then cancel.',
      'The clawback only reclaims from the balance, so:',
      'PURCHASE 50000',
      'PURCHASE_WITH_POINTS 10000',
      'CANCEL_ORDER o1',
    ].join('\n');
    expect(parseSequence(raw)).toEqual([
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 },
      { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' },
    ]);
  });

  it('parses only the SEQUENCE: block, ignoring actions named in the reasoning', () => {
    const raw = [
      'Let me reason through this carefully.',
      'If I try PURCHASE 50000 then CANCEL_ORDER o1 right away, the clawback fires and nothing leaks.',
      'What about PURCHASE 49999 then PURCHASE_WITH_POINTS 10000 then CANCEL_ORDER o2? No, o2 is a POINTS order.',
      'The reward sits on o1, so I should spend the points first, then cancel o1.',
      '',
      'SEQUENCE:',
      'PURCHASE 50,000',
      'PURCHASE_WITH_POINTS 10,000',
      'CANCEL_ORDER o1',
    ].join('\n');
    expect(parseSequence(raw)).toEqual([
      { type: 'PURCHASE', identityId: 'id1', amount: 50000 },
      { type: 'PURCHASE_WITH_POINTS', identityId: 'id1', amount: 10000 },
      { type: 'CANCEL_ORDER', identityId: 'id1', orderId: 'o1' },
    ]);
  });

  it('fails closed when a SEQUENCE: block contains an unparseable line (e.g. WAIT)', () => {
    const raw = ['SEQUENCE:', 'PURCHASE 50000', 'WAIT 1', 'PURCHASE_WITH_POINTS 10000', 'CANCEL_ORDER o1'].join(
      '\n',
    );
    // The model's literal answer isn't a valid action sequence — replaying only the
    // three actions the parser recognizes and calling that success would credit the
    // LLM for an answer it never actually gave.
    expect(parseSequence(raw)).toBeNull();
  });

  it('stays lenient (no marker): skips prose lines that match no action pattern', () => {
    const raw = ['Some unrelated commentary here.', 'PURCHASE 50000'].join('\n');
    expect(parseSequence(raw)).toEqual([{ type: 'PURCHASE', identityId: 'id1', amount: 50000 }]);
  });
});

describe('buildLlmDirectPrompt', () => {
  it('includes the fair-comparison conditions', () => {
    const { system, user } = buildLlmDirectPrompt(rewardSettlementScenario, BUGGY_RULES);
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain('maxDepth');
    expect(user).toContain('maxOrders');
    expect(user).toContain('FIFO');
    expect(user).toContain('50000');
    expect(user).toContain('"identities"');
    // primitive semantics (§3) + Ref-resolution timing (§4) must be in the prompt
    expect(user).toContain('Primitive semantics');
    expect(user).toContain('ISSUE_REWARD');
    expect(user).toContain('RECLAIM_REWARD');
    expect(user).toContain('RECLAIM_REWARD_FULL');
    expect(user).toContain('CREATE_LIABILITY');
    expect(user).toContain('Ref resolution timing');
  });
});
