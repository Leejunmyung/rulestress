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
