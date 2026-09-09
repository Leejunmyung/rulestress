'use client';

import { useMemo, useState } from 'react';
import type { SearchResult } from '../../src/domain/types';
import { getPreset } from '../../src/ui/lib/preset';
import { runSearch } from '../../src/ui/lib/worker-client';
import { RuleList } from '../../src/ui/components/RuleList';
import { TraceView } from '../../src/ui/components/TraceView';

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: SearchResult }
  | { kind: 'error'; message: string };

export default function SimulatePage() {
  const preset = useMemo(() => getPreset(), []);
  const [clawback, setClawback] = useState<'buggy' | 'fixed'>('buggy');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const activeRules = clawback === 'buggy' ? preset.buggyRules : preset.fixedRules;

  async function run() {
    setPhase({ kind: 'running' });
    try {
      const result = await runSearch(preset.scenario, activeRules);
      setPhase({ kind: 'done', result });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Reward Settlement</h1>
      <p className="mt-2 text-sm text-neutral-400">
        기획 의도: 전액 환불된(취소된) 주문은 사용자에게 순경제적 혜택을 남기지 않는다.
      </p>

      <section className="mt-8">
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-400">Clawback 규칙</span>
          <button
            onClick={() => {
              setClawback(clawback === 'buggy' ? 'fixed' : 'buggy');
              setPhase({ kind: 'idle' });
            }}
            className="rounded border border-neutral-700 px-3 py-1 text-sm"
          >
            {clawback === 'buggy' ? 'RECLAIM_REWARD (원본)' : 'RECLAIM_REWARD_FULL (수정)'}
          </button>
        </div>
        <div className="mt-4">
          <RuleList rules={activeRules} />
        </div>
      </section>

      <button
        onClick={run}
        disabled={phase.kind === 'running'}
        className="mt-8 rounded bg-emerald-500 px-4 py-2 font-medium text-neutral-950 disabled:opacity-50"
      >
        {phase.kind === 'running' ? '탐색 중…' : 'Run'}
      </button>

      <section className="mt-8" data-testid="result">
        {phase.kind === 'error' && <p className="text-red-400">에러: {phase.message}</p>}
        {phase.kind === 'done' && <TraceView result={phase.result} />}
      </section>
    </main>
  );
}
