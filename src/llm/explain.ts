import type {
  ActionType,
  CounterexampleTrace,
  Expr,
  PrimitiveType,
  Ref,
  RulesSpec,
  Violation,
} from '../domain/types.js';

// The model is asked to respond in Korean — feeding it Korean action names
// (rather than the English wire identifiers) means there's no English token
// left for it to echo back verbatim into the rendered explanation.
const ACTION_LABELS_KO: Record<ActionType, string> = {
  PURCHASE: '현금 구매',
  PURCHASE_WITH_POINTS: '포인트로 구매',
  CANCEL_ORDER: '주문 취소',
};

// Base effects every action applies before any rule runs — the model has no
// other way to know these, and guessing wrong here (e.g. assuming
// PURCHASE_WITH_POINTS grants points instead of spending them) produces a
// confidently wrong root cause.
const ACTION_SEMANTICS = [
  'Action base effects (always applied before any rule fires; rules run on top of these):',
  '- PURCHASE: creates a CASH order; does not touch reward points.',
  '- PURCHASE_WITH_POINTS: SPENDS existing reward points (FIFO) to pay for a POINTS order.',
  '  It does NOT grant, issue, or accrue any reward — it only consumes previously issued points.',
  '- CANCEL_ORDER: refunds cash and removes goods for a CASH order. This is the event that',
  '  rules (e.g. a reward clawback rule) react to.',
].join('\n');

const PRIMITIVE_GLOSSARY: Partial<Record<PrimitiveType, string>> = {
  ISSUE_REWARD: 'grants new reward points to the identity, tied to the source order.',
  SPEND_REWARD: "consumes reward points FIFO; does not grant points.",
  RECLAIM_REWARD:
    'reclaims reward points ONLY up to the current point balance (`limit`). It does NOT touch ' +
    'any portion of the reward already spent, and it creates no liability for that shortfall — ' +
    'already-spent points are simply never recovered.',
  RECLAIM_REWARD_FULL:
    'reclaims what the current point balance allows, and for the remaining shortfall (including ' +
    'any portion already spent) records a liability — a debt — against the identity instead. It ' +
    'does not physically claw back cash or goods already spent; it assumes that debt is collectible.',
  CREATE_LIABILITY: 'records a debt against the identity, which counts against their net extracted value.',
};

function describeRef(ref: Ref): string {
  if ('constant' in ref) return typeof ref.constant === 'number' ? '<threshold>' : JSON.stringify(ref.constant);
  return ref.field;
}

const COND_OP: Record<string, string> = { eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' };

function describeCondition(c: Expr): string {
  if (c.op in COND_OP && 'left' in c && 'right' in c) {
    return `${describeRef(c.left)} ${COND_OP[c.op]} ${describeRef(c.right)}`;
  }
  return JSON.stringify(c);
}

function describeEffect(e: { primitive: PrimitiveType; args: Record<string, Ref> }): string {
  const args = Object.entries(e.args)
    .map(([k, v]) => `${k}: ${describeRef(v)}`)
    .join(', ');
  return `${e.primitive}(${args})`;
}

/** Renders the actual RulesSpec as text: trigger, conditions, effects. Numeric
 *  constants are elided to `<threshold>` so no scenario figures leak into the
 *  prompt via rule definitions — only the causal structure is described. */
function describeRules(rules: RulesSpec): string {
  return rules.rules
    .map((r) => {
      const cond = r.conditions.length
        ? ` when ${r.conditions.map(describeCondition).join(' AND ')}`
        : '';
      return `- ${r.id}: on ${r.trigger.type}${cond} -> ${r.effects.map(describeEffect).join(', ')}`;
    })
    .join('\n');
}

function usedPrimitives(rules: RulesSpec): PrimitiveType[] {
  return [...new Set(rules.rules.flatMap((r) => r.effects.map((e) => e.primitive)))];
}

/** Every English wire identifier that COULD appear in the prompt for this
 *  specific call: rule ids, event types, primitive names, invariant ids.
 *  The system prompt tells the model not to echo these, but that's an
 *  instruction, not a guarantee — parseExplain uses this list to scrub
 *  the response server-side as a second, code-level layer. Computed from
 *  the same `rules`/`violations` the prompt was built from, so it can only
 *  contain identifiers this app itself defines, never attacker input. */
export function collectIdentifiers(rules: RulesSpec, violations: Violation[]): string[] {
  const ids = new Set<string>();
  for (const r of rules.rules) {
    ids.add(r.id);
    ids.add(r.trigger.type);
    for (const e of r.effects) ids.add(e.primitive);
  }
  for (const v of violations) ids.add(v.invariantId);
  return [...ids];
}

export function buildExplainPrompt(
  trace: CounterexampleTrace,
  violations: Violation[],
  rules: RulesSpec,
): {
  system: string;
  user: string;
} {
  const system =
    'You explain, in Korean, why a verified counterexample from a promotion-rule simulator ' +
    'violates the stated business intent. Ground your reasoning ONLY in the rule definitions and ' +
    'primitive semantics given below — never guess what an action or rule does from its name. ' +
    'You NEVER compute or restate monetary figures — the simulator already did, and any number ' +
    'you write would be unverified. In ROOT_CAUSE, never write an English code identifier (a rule ' +
    'id, primitive name like RECLAIM_REWARD, or action name) — describe what it does in Korean ' +
    'words instead. Reason only about the rule interaction. Output exactly two lines, nothing ' +
    'else:\n' +
    'ROOT_CAUSE: <2-4 sentences, in Korean, on the rule interaction that produced the violation>\n' +
    'RISK_LABEL: <a short English label like "Reward Clawback Bypass">';

  const primitiveGlossary = usedPrimitives(rules)
    .map((p) => `- ${p}: ${PRIMITIVE_GLOSSARY[p] ?? '(no description available)'}`)
    .join('\n');

  // Korean action labels, not the English wire identifiers — no amounts either.
  // `order=oN` is an identifier, not a quantity.
  const steps = trace.steps
    .map((s, i) => {
      const a = s.action;
      const orderRef = 'orderId' in a ? ` order=${a.orderId}` : '';
      return `${i + 1}. ${ACTION_LABELS_KO[a.type]}${orderRef}`;
    })
    .join('\n');

  const user =
    `${ACTION_SEMANTICS}\n\n` +
    `Rules in effect (numeric thresholds elided to <threshold>):\n${describeRules(rules)}\n\n` +
    `Primitive semantics (what each rule effect above actually does):\n${primitiveGlossary}\n\n` +
    `Violated invariant(s): ${violations.map((v) => v.invariantId).join(', ')}\n\n` +
    `Action sequence:\n${steps}\n\n` +
    `Explain the rule interaction that let this sequence violate the intent, grounded in the rule ` +
    `and primitive definitions above. Two lines only.`;

  return { system, user };
}

/** Belt-and-suspenders: even though the system prompt forbids figures, redact any
 *  currency-looking token the model might restate, so the card never shows an
 *  unverified number next to the simulator's verified one. Best-effort regex —
 *  not a formally verified guarantee (see README "Known limits"). Covers ASCII
 *  digits, full-width digits, and common Korean numeral+unit phrases; does not
 *  attempt every possible numeral encoding. */
function redactFigures(text: string): string {
  // Require the digit run not be preceded by a letter, so entity ids (o1, r1, l1)
  // and the deliberate `order=oN` reference in the prompt are left alone.
  // Written as one literal character class (not composed from a smaller class
  // via string interpolation) — nesting a bracket expression inside another
  // bracket expression doesn't do what it looks like in JS regex.
  const digitRun = /[₩$€£¥]?\s?(?<![A-Za-z])[0-9０-９][0-9０-９,.]*\s?(원|P|포인트|점)?/g;
  // Korean numeral words (일..구, 십/백/천/만/억 and combinations) immediately
  // followed by a currency/point unit — e.g. "오만원", "만원", "십만 포인트가".
  // Real sentences attach a particle (가/이/을/를/…) directly after the unit
  // with no separator, so excluding "followed by Hangul" would exclude nearly
  // every real occurrence — there's no boundary marker to lean on.
  //
  // A single numeral syllable directly before 원/점 collides with ordinary
  // words that have nothing to do with money: 사원(employee), 구원(salvation),
  // 일원(a member), 이점(advantage), 오점(flaw), 만점(perfect score), 백점(100
  // points/full marks). The replacer below only fires a single-syllable
  // numeral for the 원 unit, and only for the *magnitude* words (만/백/천/억/십)
  // that don't collide with a common noun as "<magnitude>원" — never for a
  // bare digit word (일..구), and never for a single syllable before 점, since
  // 만점/백점 are common idioms. 포인트 never collides with a real Korean word
  // this way, so any length redacts for that unit.
  const koreanNumeralPhrase = /([일이삼사오육칠팔구십백천만억]{1,8})\s?(원|포인트|점)/gu;
  const SAFE_SINGLE_SYLLABLE_FOR_WON = new Set(['만', '백', '천', '억', '십']);
  // A currency symbol with no digits attached (dangling after digit removal, or
  // the model wrote it alone).
  const danglingSymbol = /[₩$€£¥]/g;
  return text
    .replace(digitRun, ' (금액) ')
    .replace(koreanNumeralPhrase, (whole, numeral: string, unit: string) => {
      if (unit === '포인트') return ' (금액) ';
      if (numeral.length >= 2) return ' (금액) ';
      if (unit === '원' && SAFE_SINGLE_SYLLABLE_FOR_WON.has(numeral)) return ' (금액) ';
      return whole;
    })
    .replace(danglingSymbol, ' (금액) ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Replaces any of the given wire identifiers (whole word, case-sensitive)
 *  with a Korean placeholder. English identifiers are plain ASCII/snake_case
 *  words, so a `\b` word boundary works correctly here — unlike redactFigures'
 *  Korean text, where \b is a no-op between Hangul characters. */
function redactIdentifiers(text: string, identifiers: string[]): string {
  let out = text;
  for (const id of identifiers) {
    out = out.replace(new RegExp(`\\b${id}\\b`, 'g'), '(규칙 이름 생략)');
  }
  return out;
}

export function parseExplain(
  raw: string,
  knownIdentifiers: string[] = [],
): { rootCause: string; riskLabel: string } {
  const rc =
    raw.match(/ROOT_CAUSE:\s*([\s\S]+?)(?=\nRISK_LABEL:|$)/)?.[1]?.trim() ??
    '설명을 파싱하지 못했습니다.';
  const rl = raw.match(/RISK_LABEL:\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? 'Business Logic Abuse';
  return {
    rootCause: redactFigures(redactIdentifiers(rc.replace(/RISK_LABEL:[\s\S]*$/, '').trim(), knownIdentifiers)),
    riskLabel: redactFigures(rl),
  };
}
