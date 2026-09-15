import type { SearchResult } from '../../domain/types';
import { identityNetExtractedValue } from '../../invariants/metrics';

function summary(r: SearchResult): string {
  if (!r.trace) return `위반 없음 (탐색한 상태 ${r.explored}개)`;
  const nev = identityNetExtractedValue(r.trace.finalState, 'id1');
  return `반례 발견 · ${r.trace.steps.length}단계 · 새어나간 금액 ₩${nev.toLocaleString()}`;
}

export function BeforeAfterPanel({ before, after }: { before: SearchResult; after: SearchResult }) {
  return (
    <div className="mt-8">
      <p className="text-xs text-neutral-500">회수 규칙 변경: 부분 회수 (버그) → 전액 회수 (수정)</p>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded border border-red-900 p-4 text-sm">
          <p className="font-semibold text-red-300">수정 전</p>
          <p className="mt-1 text-neutral-300">{summary(before)}</p>
        </div>
        <div className="rounded border border-emerald-900 p-4 text-sm">
          <p className="font-semibold text-emerald-300">수정 후</p>
          <p className="mt-1 text-neutral-300">{summary(after)}</p>
        </div>
      </div>
    </div>
  );
}
