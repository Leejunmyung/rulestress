import { describe, it, expect } from 'vitest';
import { bfs } from '../src/search/bfs.js';
import { rewardSettlementScenario, BUGGY_RULES } from '../src/scenarios/reward-settlement.js';
import { buildExplainPrompt, collectIdentifiers, parseExplain } from '../src/llm/explain.js';

describe('explain prompt', () => {
  it('includes the action sequence and forbids figure computation', () => {
    const { trace, violations } = bfs(rewardSettlementScenario, BUGGY_RULES);
    expect(trace).not.toBeNull();
    const { system, user } = buildExplainPrompt(trace!, violations, BUGGY_RULES);
    expect(system).toMatch(/NEVER compute/i);
    // action sequence is in Korean, not the English wire identifiers
    expect(user).toContain('현금 구매');
    expect(user).toContain('포인트로 구매');
    expect(user).toContain('주문 취소');
    expect(user).toContain('no_benefit_after_cancel');
    // the rule/effect grounding block is present (structure, not figures)
    expect(user).toContain('purchase_reward');
    expect(user).toContain('RECLAIM_REWARD');
    // no amounts / currency figures are ever sent to the model
    expect(user).not.toMatch(/50000|10000|amount=/);
  });

  it('elides numeric rule constants to a placeholder', () => {
    const { trace, violations } = bfs(rewardSettlementScenario, BUGGY_RULES);
    const { user } = buildExplainPrompt(trace!, violations, BUGGY_RULES);
    expect(user).toContain('<threshold>');
    expect(user).not.toMatch(/\b50000\b|\b10000\b/);
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

  it('redacts full-width digits and Korean numeral+unit phrases', () => {
    const out = parseExplain(
      'ROOT_CAUSE: 취소 후 １００００원이 남고, 오만원 상당의 상품과 십만 포인트가 남고 만원이 남는다.\nRISK_LABEL: X',
    );
    expect(out.rootCause).not.toMatch(/[０-９]/);
    expect(out.rootCause).not.toMatch(/오만원|십만 ?포인트|만원/);
    expect(out.rootCause).toContain('(금액)');
  });

  it('does not mangle ordinary Korean words that happen to contain numeral characters', () => {
    const out = parseExplain(
      'ROOT_CAUSE: 근본 원인이 무엇인지 살펴보면, 결국 구원받을 방법은 규칙 수정뿐이다.\nRISK_LABEL: X',
    );
    expect(out.rootCause).toBe('근본 원인이 무엇인지 살펴보면, 결국 구원받을 방법은 규칙 수정뿐이다.');
  });

  it('does not mangle single-syllable-numeral words like 사원/이점/오점/만점/백점', () => {
    const out = parseExplain(
      'ROOT_CAUSE: 이 규칙의 이점을 악용하면 사원 계정도 오점 없이 만점짜리 백점 결과를 만든다.\nRISK_LABEL: X',
    );
    expect(out.rootCause).toBe(
      '이 규칙의 이점을 악용하면 사원 계정도 오점 없이 만점짜리 백점 결과를 만든다.',
    );
  });

  it('scrubs known wire identifiers (rule/event/primitive/invariant ids) from ROOT_CAUSE', () => {
    const ids = collectIdentifiers(BUGGY_RULES, [{ invariantId: 'no_benefit_after_cancel', detail: '' }]);
    expect(ids).toEqual(
      expect.arrayContaining(['purchase_reward', 'clawback_on_cancel', 'RECLAIM_REWARD', 'ISSUE_REWARD', 'no_benefit_after_cancel']),
    );
    const out = parseExplain(
      'ROOT_CAUSE: RECLAIM_REWARD가 사용된 포인트를 처리하지 못해 no_benefit_after_cancel이 깨진다.\nRISK_LABEL: X',
      ids,
    );
    expect(out.rootCause).not.toMatch(/RECLAIM_REWARD|no_benefit_after_cancel/);
    expect(out.rootCause).toContain('(규칙 이름 생략)');
  });

  it('also scrubs known wire identifiers from RISK_LABEL, not just ROOT_CAUSE', () => {
    const ids = collectIdentifiers(BUGGY_RULES, [{ invariantId: 'no_benefit_after_cancel', detail: '' }]);
    const out = parseExplain('ROOT_CAUSE: 설명\nRISK_LABEL: RECLAIM_REWARD', ids);
    expect(out.riskLabel).not.toMatch(/RECLAIM_REWARD/);
    expect(out.riskLabel).toBe('(규칙 이름 생략)');
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
