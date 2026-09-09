import type { CounterexampleTrace, Violation } from '../domain/types.js';

export function buildExplainPrompt(trace: CounterexampleTrace, violations: Violation[]): {
  system: string;
  user: string;
} {
  const system =
    'You explain, in Korean, why a verified counterexample from a promotion-rule simulator ' +
    'violates the stated business intent. You NEVER compute or restate monetary figures — the ' +
    'simulator already did, and any number you write would be unverified. Reason only about the ' +
    'rule interaction. Output exactly two lines, nothing else:\n' +
    'ROOT_CAUSE: <2-4 sentences, in Korean, on the rule interaction that produced the violation>\n' +
    'RISK_LABEL: <a short English label like "Reward Clawback Bypass">';

  // Action types only — no amounts. The LLM reasons about the rule interaction,
  // never about figures. `order=oN` is an identifier, not a quantity.
  const steps = trace.steps
    .map((s, i) => {
      const a = s.action;
      const orderRef = 'orderId' in a ? ` order=${a.orderId}` : '';
      return `${i + 1}. ${a.type}${orderRef}`;
    })
    .join('\n');

  const user =
    `Violated invariant(s): ${violations.map((v) => v.invariantId).join(', ')}\n\n` +
    `Action sequence:\n${steps}\n\n` +
    `Explain the rule interaction that let this sequence violate the intent. Two lines only.`;

  return { system, user };
}

/** Belt-and-suspenders: even though the system prompt forbids figures, redact any
 *  currency-looking token the model might restate, so the card never shows an
 *  unverified number next to the simulator's verified one. */
function redactFigures(text: string): string {
  return text.replace(/₩\s?[\d,]+|\b[\d,]{2,}\s?원/g, '(금액)');
}

export function parseExplain(raw: string): { rootCause: string; riskLabel: string } {
  const rc = raw.match(/ROOT_CAUSE:\s*([\s\S]+?)(?=\nRISK_LABEL:|$)/)?.[1]?.trim() ?? raw.trim();
  const rl = raw.match(/RISK_LABEL:\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? 'Business Logic Abuse';
  return {
    rootCause: redactFigures(rc.replace(/RISK_LABEL:[\s\S]*$/, '').trim()),
    riskLabel: rl,
  };
}
