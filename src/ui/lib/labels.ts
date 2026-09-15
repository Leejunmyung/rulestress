import type { ActionType, EventType, Ledger, PrimitiveType } from '../../domain/types.js';

/**
 * Human-readable Korean labels for the engine's internal identifiers.
 *
 * The domain model's names (primitive types, event types, ledger fields) are
 * chosen for the engine's own clarity, not for a first-time viewer. This
 * module is the one place that translates them for display — nothing here
 * affects simulation, matching, or validation.
 *
 * The closed enums (EventType, PrimitiveType, ActionType, Ledger keys) use
 * exhaustive Records so a new primitive/action/field fails to compile here
 * until it's given a label. Invariant and rule ids are scenario-authored
 * strings (open-ended), so those use a lookup map with a raw-id fallback.
 */

export const EVENT_LABELS: Record<EventType, string> = {
  ORDER_PAID: '결제 완료 시',
  ORDER_CANCELLED: '주문 취소 시',
  POINTS_SPENT: '포인트 사용 시',
};

export const PRIMITIVE_LABELS: Record<PrimitiveType, string> = {
  CREATE_ORDER: '주문 생성',
  SET_ORDER_STATUS: '주문 상태 변경',
  ADD_CASH_PAID: '결제 금액 반영',
  ADD_CASH_REFUNDED: '환불 처리',
  ADD_GOODS: '재화 지급',
  ISSUE_REWARD: '포인트 지급',
  SPEND_REWARD: '포인트 사용',
  RECLAIM_REWARD: '포인트 잔액만큼만 회수 (버그)',
  // Not a true full recovery: the already-spent portion becomes a liability
  // (an assumed-collectible debt), not cash actually clawed back. See
  // TraceView's liability callout, which surfaces this assumption in the demo.
  RECLAIM_REWARD_FULL: '전액 정산 (초과분은 채무로 기록, 수정)',
  CREATE_LIABILITY: '미회수 채무 기록',
  SET_FLAG: '플래그 설정',
};

export const ACTION_LABELS: Record<ActionType, string> = {
  PURCHASE: '구매',
  PURCHASE_WITH_POINTS: '포인트로 구매',
  CANCEL_ORDER: '주문 취소',
};

export const LEDGER_FIELD_LABELS: Record<keyof Ledger, string> = {
  cashPaid: '결제 금액',
  cashRefunded: '환불 금액',
  goodsRetained: '보유 재화',
  pointsBalance: '포인트 잔액',
};

/** Rule ids are scenario-authored, not a closed enum — fall back to the raw id. */
const RULE_LABELS: Record<string, string> = {
  purchase_reward: '구매 시 포인트 적립',
  clawback_on_cancel: '취소 시 포인트 회수',
};

/** Invariant ids are scenario-authored — fall back to the raw id. */
const INVARIANT_LABELS: Record<string, string> = {
  no_benefit_after_cancel: '취소된 주문은 사용자에게 순경제적 혜택을 남기지 않는다',
};

export function ruleLabel(id: string): string {
  return RULE_LABELS[id] ?? id;
}

export function invariantLabel(id: string): string {
  return INVARIANT_LABELS[id] ?? id;
}
