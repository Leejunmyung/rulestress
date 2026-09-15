import type { Bounds, ParamCandidates, SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';
import { ledgerDelta, totalLiability } from '../lib/state-diff';
import { ACTION_LABELS, invariantLabel } from '../lib/labels';
import { StateDeltaTable } from './StateDeltaTable';
import { ExplainCard } from './ExplainCard';

function BoundsCaption({ bounds, params }: { bounds: Bounds; params: ParamCandidates }) {
  return (
    <p className="mt-1 text-xs text-neutral-500">
      탐색 범위: 최대 {bounds.maxDepth}단계, 동시 주문 최대 {bounds.maxOrders}개, 구매 금액 후보{' '}
      {params.PURCHASE_amount.map((n) => n.toLocaleString()).join('/')}원, 포인트 구매 금액 후보{' '}
      {params.PURCHASE_WITH_POINTS_amount.map((n) => n.toLocaleString()).join('/')}원
    </p>
  );
}

export function TraceView({
  result,
  clawback,
  bounds,
  params,
}: {
  result: SearchResult;
  clawback: 'buggy' | 'fixed';
  bounds: Bounds;
  params: ParamCandidates;
}) {
  if (!result.trace) {
    return (
      <div className="rounded border border-neutral-800 p-4">
        <p className="font-medium text-neutral-300">
          탐색한 범위 안에서는 위반을 찾지 못했습니다 (탐색한 상태 {result.explored}개)
        </p>
        <BoundsCaption bounds={bounds} params={params} />
      </div>
    );
  }
  const { trace, violations } = result;
  const nev = identityNetExtractedValue(trace.finalState, 'id1');
  const liability = totalLiability(trace.finalState, 'id1');
  return (
    <div className="space-y-4">
      <div className="rounded border border-red-900 bg-red-950/40 p-4">
        <p className="text-sm font-semibold text-red-300">실행으로 검증된 반례를 찾았습니다</p>
        <p className="mt-1 text-xs text-neutral-400">
          위반된 기획 의도: {violations.map((v) => invariantLabel(v.invariantId)).join(', ')} · 상태{' '}
          {result.explored}개 탐색
        </p>
        <BoundsCaption bounds={bounds} params={params} />
        {trace && <ExplainCard trace={trace} violations={violations} clawback={clawback} />}
      </div>

      <ol className="space-y-3">
        {trace.steps.map((step, i) => {
          const liabBefore = totalLiability(step.stateBefore, 'id1');
          const liabAfter = totalLiability(step.stateAfter, 'id1');
          return (
            <li key={i} className="rounded border border-neutral-800 p-3">
              <div className="text-sm font-medium">
                {i + 1}. {ACTION_LABELS[step.action.type]}
                {'amount' in step.action && <span className="text-neutral-400"> ({step.action.amount.toLocaleString()}원)</span>}
                {'orderId' in step.action && <span className="text-neutral-400"> (주문 {step.action.orderId})</span>}
              </div>
              <StateDeltaTable rows={ledgerDelta(step.stateBefore, step.stateAfter, 'id1')} />
              {liabBefore !== liabAfter && (
                <p className="mt-2 text-xs text-amber-400">
                  미회수 채무(강제 가능하다고 가정한 빚) {liabBefore.toLocaleString()} → {liabAfter.toLocaleString()}원
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="rounded border border-emerald-900 bg-emerald-950/30 p-4">
        <p className="text-xs text-neutral-400">이 경로로 새어나간 금액</p>
        <p className="text-2xl font-semibold text-emerald-300">₩{nev.toLocaleString()}</p>
        {liability > 0 && (
          <p className="mt-2 text-xs text-amber-400">
            이 결과는 {liability.toLocaleString()}원의 채무를 실제로 받아낼 수 있다고 가정합니다 —
            현금이 물리적으로 회수된 것이 아닙니다.
          </p>
        )}
      </div>
    </div>
  );
}
