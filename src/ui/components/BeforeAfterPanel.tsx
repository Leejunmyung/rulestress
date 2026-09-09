import type { SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';

function summary(r: SearchResult): string {
  if (!r.trace) return `No violation found within explored bounds (${r.explored} states)`;
  const nev = identityNetExtractedValue(r.trace.finalState, 'id1');
  return `Verified Counterexample · ${r.trace.steps.length} steps · Net ₩${nev.toLocaleString()}`;
}

export function BeforeAfterPanel({ before, after }: { before: SearchResult; after: SearchResult }) {
  return (
    <div className="mt-8">
      <p className="text-xs text-neutral-500">Rule change: RECLAIM_REWARD → RECLAIM_REWARD_FULL</p>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded border border-red-900 p-4 text-sm">
          <p className="font-semibold text-red-300">Before</p>
          <p className="mt-1 text-neutral-300">{summary(before)}</p>
        </div>
        <div className="rounded border border-emerald-900 p-4 text-sm">
          <p className="font-semibold text-emerald-300">After</p>
          <p className="mt-1 text-neutral-300">{summary(after)}</p>
        </div>
      </div>
    </div>
  );
}
