import type { SimulationState, Action, SimEvent } from '../domain/types.js';
import { applyEffect } from '../domain/primitives.js';

export function actionPrecondition(
  state: SimulationState,
  action: Action,
  maxOrders: number,
): string | null {
  const orderCount = state.orders.filter((o) => o.identityId === action.identityId).length;
  switch (action.type) {
    case 'PURCHASE':
      if (action.amount <= 0) return 'PURCHASE: amount must be positive';
      if (orderCount >= maxOrders) return 'PURCHASE: maxOrders reached';
      return null;
    case 'PURCHASE_WITH_POINTS':
      if (action.amount <= 0) return 'PURCHASE_WITH_POINTS: amount must be positive';
      if (orderCount >= maxOrders) return 'PURCHASE_WITH_POINTS: maxOrders reached';
      if ((state.ledger[action.identityId]?.pointsBalance ?? 0) < action.amount)
        return 'PURCHASE_WITH_POINTS: not enough points';
      return null;
    case 'CANCEL_ORDER': {
      const o = state.orders.find((o) => o.id === action.orderId);
      if (!o) return `CANCEL_ORDER: no order ${action.orderId}`;
      if (o.status !== 'PAID') return 'CANCEL_ORDER: order not PAID';
      if (o.paymentKind !== 'CASH') return 'CANCEL_ORDER: only CASH orders can be cancelled';
      return null;
    }
  }
}

export function applyBaseEffects(
  state: SimulationState,
  action: Action,
): { state: SimulationState; events: SimEvent[] } {
  switch (action.type) {
    case 'PURCHASE': {
      const orderId = `o${state.orders.length + 1}`;
      let s = applyEffect(state, { primitive: 'CREATE_ORDER', identityId: action.identityId, amount: action.amount, paymentKind: 'CASH' });
      s = applyEffect(s, { primitive: 'ADD_CASH_PAID', identityId: action.identityId, value: action.amount });
      s = applyEffect(s, { primitive: 'ADD_GOODS', identityId: action.identityId, value: action.amount });
      return {
        state: s,
        events: [{ type: 'ORDER_PAID', identityId: action.identityId, orderId, amount: action.amount, paymentKind: 'CASH' }],
      };
    }
    case 'PURCHASE_WITH_POINTS': {
      const orderId = `o${state.orders.length + 1}`;
      let s = applyEffect(state, { primitive: 'SPEND_REWARD', identityId: action.identityId, amount: action.amount });
      s = applyEffect(s, { primitive: 'ADD_GOODS', identityId: action.identityId, value: action.amount });
      s = applyEffect(s, { primitive: 'CREATE_ORDER', identityId: action.identityId, amount: action.amount, paymentKind: 'POINTS' });
      return {
        state: s,
        events: [
          { type: 'ORDER_PAID', identityId: action.identityId, orderId, amount: action.amount, paymentKind: 'POINTS' },
          { type: 'POINTS_SPENT', identityId: action.identityId, amount: action.amount },
        ],
      };
    }
    case 'CANCEL_ORDER': {
      const order = state.orders.find((o) => o.id === action.orderId);
      if (!order) throw new Error(`applyBaseEffects: no order ${action.orderId}`);
      let s = applyEffect(state, { primitive: 'SET_ORDER_STATUS', orderId: action.orderId, status: 'CANCELLED' });
      s = applyEffect(s, { primitive: 'ADD_CASH_REFUNDED', identityId: action.identityId, value: order.amount });
      s = applyEffect(s, { primitive: 'ADD_GOODS', identityId: action.identityId, value: -order.amount });
      return { state: s, events: [{ type: 'ORDER_CANCELLED', identityId: action.identityId, orderId: action.orderId }] };
    }
  }
}
