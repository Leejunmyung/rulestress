import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';
import { buildExplainPrompt, parseExplain } from '../src/llm/explain.js';

describe('explain prompt', () => {
  it('includes the action sequence and forbids figure computation', () => {
    const { trace, violations } = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(trace).not.toBeNull();
    const { system, user } = buildExplainPrompt(trace!, violations);
    expect(system).toMatch(/NEVER compute/i);
    expect(user).toContain('PURCHASE');
    expect(user).toContain('PURCHASE_WITH_POINTS');
    expect(user).toContain('CANCEL_ORDER');
    expect(user).toContain('no_benefit_after_cancel');
    // no amounts / currency figures are ever sent to the model
    expect(user).not.toMatch(/50000|10000|amount=/);
  });

  it('redacts currency figures the model might restate', () => {
    const out = parseExplain(
      'ROOT_CAUSE: 취소 후에도 ₩10,000 상당의 상품과 10,000원이 남고 10,000P가 남으며 포인트 50000, 그리고 50000 상당이 남는다.\nRISK_LABEL: X',
    );
    expect(out.rootCause).not.toMatch(/₩|원/);
    expect(out.rootCause).not.toMatch(/\d/);
    expect(out.rootCause).not.toMatch(/10,000P|포인트 50000|50000 상당/);
    expect(out.rootCause).toContain('(금액)');
  });

  it('leaves entity id references (o1, r1, l1) untouched', () => {
    const out = parseExplain(
      'ROOT_CAUSE: o1 주문을 취소하면 r1 리워드\nRISK_LABEL: X',
    );
    expect(out.rootCause).toBe('o1 주문을 취소하면 r1 리워드');
  });

  it('falls back to a fixed string (not raw text) when ROOT_CAUSE is absent', () => {
    const out = parseExplain('the model rambled without the expected structure at all');
    expect(out.rootCause).toBe('설명을 파싱하지 못했습니다.');
    expect(out.rootCause).not.toContain('rambled');
  });

  it('parses a two-line response', () => {
    const raw =
      'ROOT_CAUSE: 보상이 소진된 뒤 원 주문을 취소하면 clawback이 잔액 한도로만 실행되어 회수되지 않는다. 결과적으로 취소 거래가 순혜택을 남긴다.\nRISK_LABEL: Reward Clawback Bypass';
    const out = parseExplain(raw);
    expect(out.riskLabel).toBe('Reward Clawback Bypass');
    expect(out.rootCause).toMatch(/clawback/);
    expect(out.rootCause).not.toMatch(/RISK_LABEL/);
  });

  it('defaults the risk label when RISK_LABEL is absent and strips bleed', () => {
    const raw = 'ROOT_CAUSE: 규칙 상호작용으로 순혜택이 남는다. RISK_LABEL: leaked line here';
    const out = parseExplain(raw);
    expect(out.riskLabel).toBe('leaked line here');
    expect(out.rootCause).not.toMatch(/RISK_LABEL/);

    const noLabel = 'ROOT_CAUSE: 취소 후에도 포인트가 남는다.';
    const out2 = parseExplain(noLabel);
    expect(out2.riskLabel).toBe('Business Logic Abuse');
    expect(out2.rootCause).toBe('취소 후에도 포인트가 남는다.');
  });
});
