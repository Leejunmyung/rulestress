import type { SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';
import { ledgerDelta } from '../lib/state-diff';
import { StateDeltaTable } from './StateDeltaTable';
import { ExplainCard } from './ExplainCard';

export function TraceView({ result }: { result: SearchResult }) {
  if (!result.trace) {
    return (
      <div className="rounded border border-neutral-800 p-4">
        <p className="font-medium text-neutral-300">
          No violation found within explored bounds ({result.explored} states)
        </p>
      </div>
    );
  }
  const { trace, violations } = result;
  const nev = identityNetExtractedValue(trace.finalState, 'id1');
  return (
    <div className="space-y-4">
      <div className="rounded border border-red-900 bg-red-950/40 p-4">
        <p className="text-sm font-semibold text-red-300">Verified Counterexample</p>
        <p className="mt-1 text-xs text-neutral-400">
          Violated intent: {violations.map((v) => v.invariantId).join(', ')} · {result.explored} states explored
        </p>
        {trace && <ExplainCard trace={trace} violations={violations} />}
      </div>

      <ol className="space-y-3">
        {trace.steps.map((step, i) => (
          <li key={i} className="rounded border border-neutral-800 p-3">
            <div className="text-sm font-medium">
              {i + 1}. {step.action.type}
              {'amount' in step.action && <span className="text-neutral-400"> ({step.action.amount.toLocaleString()})</span>}
              {'orderId' in step.action && <span className="text-neutral-400"> {step.action.orderId}</span>}
            </div>
            <StateDeltaTable rows={ledgerDelta(step.stateBefore, step.stateAfter, 'id1')} />
          </li>
        ))}
      </ol>

      <div className="rounded border border-emerald-900 bg-emerald-950/30 p-4">
        <p className="text-xs text-neutral-400">Net Extracted Value</p>
        <p className="text-2xl font-semibold text-emerald-300">₩{nev.toLocaleString()}</p>
      </div>
    </div>
  );
}
