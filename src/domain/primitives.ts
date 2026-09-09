import type { SimulationState, Effect } from './types.js';

export function applyEffect(state: SimulationState, effect: Effect): SimulationState {
  const s: SimulationState = structuredClone(state);
  switch (effect.primitive) {
    case 'CREATE_ORDER': {
      s.orders.push({
        id: `o${s.orders.length + 1}`,
        identityId: effect.identityId,
        amount: effect.amount,
        status: 'PAID',
        paymentKind: effect.paymentKind,
      });
      return s;
    }
    case 'SET_ORDER_STATUS': {
      const o = s.orders.find((o) => o.id === effect.orderId);
      if (!o) throw new Error(`SET_ORDER_STATUS: no order ${effect.orderId}`);
      o.status = effect.status;
      return s;
    }
    case 'ADD_CASH_PAID': {
      s.ledger[effect.identityId].cashPaid += effect.value;
      return s;
    }
    case 'ADD_CASH_REFUNDED': {
      s.ledger[effect.identityId].cashRefunded += effect.value;
      return s;
    }
    case 'ADD_GOODS': {
      s.ledger[effect.identityId].goodsRetained += effect.value;
      return s;
    }
    case 'ISSUE_REWARD': {
      s.rewards.push({
        id: `r${s.rewards.length + 1}`,
        identityId: effect.identityId,
        sourceOrderId: effect.sourceOrderId,
        grantedAmount: effect.amount,
        remainingAmount: effect.amount,
        spentAmount: 0,
        reclaimedAmount: 0,
        settledByClawback: false,
      });
      s.ledger[effect.identityId].pointsBalance += effect.amount;
      return s;
    }
    case 'SPEND_REWARD': {
      let left = effect.amount;
      for (const r of s.rewards) {
        if (left <= 0) break;
        if (r.identityId !== effect.identityId || r.remainingAmount <= 0) continue;
        const k = Math.min(r.remainingAmount, left);
        r.remainingAmount -= k;
        r.spentAmount += k;
        s.ledger[effect.identityId].pointsBalance -= k;
        left -= k;
      }
      if (left > 0) throw new Error('SPEND_REWARD: insufficient remaining points');
      return s;
    }
    case 'RECLAIM_REWARD': {
      let left = effect.limit;
      for (const r of s.rewards) {
        if (left <= 0) break;
        if (r.sourceOrderId !== effect.sourceOrderId) continue;
        const k = Math.min(r.remainingAmount, left);
        r.remainingAmount -= k;
        r.reclaimedAmount += k;
        s.ledger[r.identityId].pointsBalance -= k;
        left -= k;
      }
      return s;
    }
    case 'RECLAIM_REWARD_FULL': {
      for (const r of s.rewards) {
        if (r.sourceOrderId !== effect.sourceOrderId || r.settledByClawback) continue;
        const bal = s.ledger[r.identityId].pointsBalance;
        const fromBalance = Math.min(r.remainingAmount, bal);
        r.remainingAmount -= fromBalance;
        r.reclaimedAmount += fromBalance;
        s.ledger[r.identityId].pointsBalance -= fromBalance;
        const shortfall = r.grantedAmount - r.reclaimedAmount;
        if (shortfall > 0) {
          s.liabilities.push({
            id: `l${s.liabilities.length + 1}`,
            identityId: r.identityId,
            amount: shortfall,
            sourceOrderId: effect.sourceOrderId,
          });
        }
        r.settledByClawback = true;
      }
      return s;
    }
    case 'CREATE_LIABILITY': {
      s.liabilities.push({
        id: `l${s.liabilities.length + 1}`,
        identityId: effect.identityId,
        amount: effect.amount,
        sourceOrderId: effect.sourceOrderId,
      });
      return s;
    }
    case 'SET_FLAG': {
      const i = s.identities.find((i) => i.id === effect.identityId);
      if (!i) throw new Error(`SET_FLAG: no identity ${effect.identityId}`);
      i.flags[effect.key] = effect.value;
      return s;
    }
    default: {
      const _never: never = effect;
      throw new Error(`applyEffect: unknown primitive ${(effect as { primitive: string }).primitive}`);
    }
  }
}
