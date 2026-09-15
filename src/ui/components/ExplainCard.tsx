'use client';

import { useState } from 'react';
import type { CounterexampleTrace, Violation } from '../../domain/types';

type State =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'done'; rootCause: string; riskLabel: string }
  | { k: 'error'; message: string };

export function ExplainCard({
  trace,
  violations,
  clawback,
}: {
  trace: CounterexampleTrace;
  violations: Violation[];
  clawback: 'buggy' | 'fixed';
}) {
  const [state, setState] = useState<State>({ k: 'idle' });

  async function explain() {
    setState({ k: 'loading' });
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trace, violations, clawback }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'explain failed');
      setState({ k: 'done', rootCause: data.rootCause, riskLabel: data.riskLabel });
    } catch {
      setState({ k: 'error', message: '설명을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }
  }

  if (state.k === 'idle') {
    return (
      <button
        onClick={explain}
        className="mt-4 rounded border border-neutral-700 px-3 py-1 text-sm"
      >
        왜 깨졌는지 설명 보기
      </button>
    );
  }

  if (state.k === 'loading') {
    return <p className="mt-4 text-sm text-neutral-400">분석 중…</p>;
  }

  if (state.k === 'error') {
    return (
      <div className="mt-4 text-sm text-red-400">
        <p>에러: {state.message}</p>
        <button
          onClick={explain}
          className="mt-2 rounded border border-neutral-700 px-3 py-1 text-neutral-300"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded border border-neutral-800 p-4">
      <span className="inline-block rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
        {state.riskLabel}
      </span>
      <p className="mt-2 text-sm leading-relaxed text-neutral-300">{state.rootCause}</p>
    </div>
  );
}
