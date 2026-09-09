import type { SimulationState, Scenario, Action } from '../domain/types.js';

export function validActions(state: SimulationState, scenario: Scenario): Action[] {
  const out: Action[] = [];
  const { maxOrders } = scenario.bounds;
  for (const identity of state.identities) {
    const id = identity.id;
    const orderCount = state.orders.filter((o) => o.identityId === id).length;
    for (const amount of scenario.params.PURCHASE_amount) {
      if (amount > 0 && orderCount < maxOrders) out.push({ type: 'PURCHASE', identityId: id, amount });
    }
    for (const amount of scenario.params.PURCHASE_WITH_POINTS_amount) {
      if (amount > 0 && orderCount < maxOrders && (state.ledger[id]?.pointsBalance ?? 0) >= amount) {
        out.push({ type: 'PURCHASE_WITH_POINTS', identityId: id, amount });
      }
    }
  }
  for (const o of state.orders) {
    if (o.status === 'PAID' && o.paymentKind === 'CASH') {
      out.push({ type: 'CANCEL_ORDER', identityId: o.identityId, orderId: o.id });
    }
  }
  return out;
}
