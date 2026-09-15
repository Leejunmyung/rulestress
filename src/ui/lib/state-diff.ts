import type { Ledger, SimulationState } from '../../domain/types.js';

const LEDGER_KEYS = [
  'cashPaid',
  'cashRefunded',
  'goodsRetained',
  'pointsBalance',
] as const satisfies readonly (keyof Ledger)[];

export function ledgerDelta(before: SimulationState, after: SimulationState, identityId: string) {
  const b = before.ledger[identityId];
  const a = after.ledger[identityId];
  if (b === undefined || a === undefined) {
    throw new Error(`ledgerDelta: no ledger for ${identityId}`);
  }
  const out: { key: string; before: number; after: number }[] = [];
  for (const k of LEDGER_KEYS) {
    if (b[k] !== a[k]) out.push({ key: k, before: b[k], after: a[k] });
  }
  return out;
}

/** Sum of liabilities (debt recorded, not cash actually recovered) for one
 *  identity. Liabilities live outside the Ledger, so ledgerDelta alone would
 *  hide the fact that a "fix" can zero out net extracted value by assuming a
 *  collectible debt instead of physically reclaiming anything. */
export function totalLiability(state: SimulationState, identityId: string): number {
  return state.liabilities
    .filter((l) => l.identityId === identityId)
    .reduce((sum, l) => sum + l.amount, 0);
}
