import type { SimulationState } from './types.js';

export function assertInternalInvariants(state: SimulationState): void {
  for (const id of Object.keys(state.ledger)) {
    const ledger = state.ledger[id];
    const sumRemaining = state.rewards
      .filter((r) => r.identityId === id)
      .reduce((a, r) => a + r.remainingAmount, 0);
    if (ledger.pointsBalance !== sumRemaining) {
      throw new Error(
        `internal invariant: pointsBalance ${ledger.pointsBalance} != Σremaining ${sumRemaining} for ${id}`,
      );
    }
    if (ledger.goodsRetained < 0) {
      throw new Error(`internal invariant: goodsRetained ${ledger.goodsRetained} < 0 for ${id}`);
    }
  }
  for (const r of state.rewards) {
    if (r.grantedAmount !== r.remainingAmount + r.spentAmount + r.reclaimedAmount) {
      throw new Error(
        `internal invariant: reward ${r.id} conservation broken ` +
          `(${r.grantedAmount} != ${r.remainingAmount}+${r.spentAmount}+${r.reclaimedAmount})`,
      );
    }
  }

  // Reverse check: every reward/liability identity must have a ledger row, otherwise
  // the pointsBalance == Σremaining conservation check above would silently skip it.
  for (const r of state.rewards) {
    if (state.ledger[r.identityId] === undefined) {
      throw new Error(
        `internal invariant: reward ${r.id} references identity ${r.identityId} with no ledger`,
      );
    }
  }
  for (const l of state.liabilities) {
    if (state.ledger[l.identityId] === undefined) {
      throw new Error(
        `internal invariant: liability ${l.id} references identity ${l.identityId} with no ledger`,
      );
    }
  }
}
