import type { SimulationState } from '../domain/types.js';

export function identityNetExtractedValue(state: SimulationState, identityId: string): number {
  const l = state.ledger[identityId];
  if (!l) throw new Error(`identityNetExtractedValue: no ledger for ${identityId}`);
  const liabilities = state.liabilities
    .filter((x) => x.identityId === identityId)
    .reduce((a, x) => a + x.amount, 0);
  return l.goodsRetained + l.cashRefunded + l.pointsBalance - l.cashPaid - liabilities;
}

export function netBenefitFromOrder(state: SimulationState, orderId: string): number {
  const rewardValue = state.rewards
    .filter((r) => r.sourceOrderId === orderId)
    .reduce((a, r) => a + (r.grantedAmount - r.reclaimedAmount), 0);
  const liabilities = state.liabilities
    .filter((x) => x.sourceOrderId === orderId)
    .reduce((a, x) => a + x.amount, 0);
  return rewardValue - liabilities;
}
