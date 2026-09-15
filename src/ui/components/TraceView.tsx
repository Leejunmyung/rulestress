import type { SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';
import { ledgerDelta } from '../lib/state-diff';
import { ACTION_LABELS, invariantLabel } from '../lib/labels';
import { StateDeltaTable } from './StateDeltaTable';
import { ExplainCard } from './ExplainCard';

export function TraceView({ result }: { result: SearchResult }) {
  if (!result.trace) {
    return (
      <div className="rounded border border-neutral-800 p-4">
        <p className="font-medium text-neutral-300">
          탐색한 범위 안에서는 위반을 찾지 못했습니다 (탐색한 상태 {result.explored}개)
        </p>
      </div>
    );
  }
  const { trace, violations } = result;
  const nev = identityNetExtractedValue(trace.finalState, 'id1');
  return (
    <div className="space-y-4">
      <div className="rounded border border-red-900 bg-red-950/40 p-4">
        <p className="text-sm font-semibold text-red-300">실행으로 검증된 반례를 찾았습니다</p>
        <p className="mt-1 text-xs text-neutral-400">
          위반된 기획 의도: {violations.map((v) => invariantLabel(v.invariantId)).join(', ')} · 상태{' '}
          {result.explored}개 탐색
        </p>
        {trace && <ExplainCard trace={trace} violations={violations} />}
      </div>

      <ol className="space-y-3">
        {trace.steps.map((step, i) => (
          <li key={i} className="rounded border border-neutral-800 p-3">
            <div className="text-sm font-medium">
              {i + 1}. {ACTION_LABELS[step.action.type]}
              {'amount' in step.action && <span className="text-neutral-400"> ({step.action.amount.toLocaleString()}원)</span>}
              {'orderId' in step.action && <span className="text-neutral-400"> (주문 {step.action.orderId})</span>}
            </div>
            <StateDeltaTable rows={ledgerDelta(step.stateBefore, step.stateAfter, 'id1')} />
          </li>
        ))}
      </ol>

      <div className="rounded border border-emerald-900 bg-emerald-950/30 p-4">
        <p className="text-xs text-neutral-400">이 경로로 새어나간 금액</p>
        <p className="text-2xl font-semibold text-emerald-300">₩{nev.toLocaleString()}</p>
      </div>
    </div>
  );
}
