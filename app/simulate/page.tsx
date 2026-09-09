'use client';

import { useMemo, useState } from 'react';
import type { SearchResult } from '../../src/domain/types';
import { getPreset } from '../../src/ui/lib/preset';
import { runSearch } from '../../src/ui/lib/worker-client';
import { RuleList } from '../../src/ui/components/RuleList';
import { TraceView } from '../../src/ui/components/TraceView';
import { BeforeAfterPanel } from '../../src/ui/components/BeforeAfterPanel';

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: SearchResult }
  | { kind: 'error'; message: string };

export default function SimulatePage() {
  const preset = useMemo(() => getPreset(), []);
  const [clawback, setClawback] = useState<'buggy' | 'fixed'>('buggy');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [afterResult, setAfterResult] = useState<SearchResult | null>(null);
  const [rerun, setRerun] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  });

  const activeRules = clawback === 'buggy' ? preset.buggyRules : preset.fixedRules;
  const busy = phase.kind === 'running' || rerun.running;

  async function run() {
    setPhase({ kind: 'running' });
    setAfterResult(null);
    setRerun({ running: false, error: null });
    try {
      const result = await runSearch(preset.scenario, activeRules);
      setPhase({ kind: 'done', result });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function rerunWithFix() {
    setRerun({ running: true, error: null });
    try {
      const result = await runSearch(preset.scenario, preset.fixedRules);
      setAfterResult(result);
      setRerun({ running: false, error: null });
    } catch (e) {
      setRerun({ running: false, error: e instanceof Error ? e.message : String(e) });
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
              setAfterResult(null);
              setRerun({ running: false, error: null });
            }}
            disabled={busy}
            className="rounded border border-neutral-700 px-3 py-1 text-sm disabled:opacity-50"
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
        disabled={busy}
        className="mt-8 rounded bg-emerald-500 px-4 py-2 font-medium text-neutral-950 disabled:opacity-50"
      >
        {phase.kind === 'running' ? '탐색 중…' : 'Run'}
      </button>

      <section className="mt-8" data-testid="result">
        {phase.kind === 'error' && <p className="text-red-400">에러: {phase.message}</p>}
        {phase.kind === 'done' && <TraceView result={phase.result} />}
        {phase.kind === 'done' && phase.result.trace && (
          <>
            {rerun.error && <p className="mt-4 text-sm text-red-400">Re-run 에러: {rerun.error}</p>}
            {afterResult === null && (
              <button
                onClick={rerunWithFix}
                disabled={rerun.running}
                className="mt-6 rounded border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-300 disabled:opacity-50"
              >
                {rerun.running ? '탐색 중…' : 'Re-run with fix'}
              </button>
            )}
            {afterResult !== null && (
              <BeforeAfterPanel before={phase.result} after={afterResult} />
            )}
          </>
        )}
      </section>
    </main>
  );
}
