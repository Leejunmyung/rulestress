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
  // clawbackUsed is the ruleset THIS result was actually searched with — not
  // necessarily the current toggle state, since the toggle can move (or get
  // synced by a later re-run) after the search that produced this result.
  | { kind: 'done'; result: SearchResult; clawbackUsed: 'buggy' | 'fixed' }
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

  // Internal errors (worker crashes, invariant assertions) carry engine identifiers
  // that mean nothing to a viewer — log the real message for debugging, show a
  // generic one in the UI.
  const GENERIC_ERROR = '탐색 중 오류가 발생했습니다. 다시 시도해주세요.';

  async function run() {
    setPhase({ kind: 'running' });
    setAfterResult(null);
    setRerun({ running: false, error: null });
    try {
      const result = await runSearch(preset.scenario, activeRules);
      setPhase({ kind: 'done', result, clawbackUsed: clawback });
    } catch (e) {
      console.error('search failed', e);
      setPhase({ kind: 'error', message: GENERIC_ERROR });
    }
  }

  async function rerunWithFix() {
    setRerun({ running: true, error: null });
    try {
      const result = await runSearch(preset.scenario, preset.fixedRules);
      setAfterResult(result);
      setRerun({ running: false, error: null });
    } catch (e) {
      console.error('re-run failed', e);
      setRerun({ running: false, error: GENERIC_ERROR });
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Reward Settlement</h1>
      <p className="mt-2 text-sm text-neutral-400">
        기획 의도: 전액 환불된(취소된) 주문은 사용자에게 순경제적 혜택을 남기지 않는다.
      </p>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400">
        아래 두 규칙은 실제 포인트 적립·회수 로직입니다. <strong className="text-neutral-300">탐색 시작</strong>을
        누르면 가능한 모든 구매·취소 순서를 컴퓨터가 하나도 빠짐없이 대입해보고, 위 의도를 깨는 경로가
        있는지 찾아냅니다.
      </p>

      <section className="mt-8">
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-400">포인트 회수 방식</span>
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
            {clawback === 'buggy' ? '부분 회수 (버그)' : '전액 정산 (수정)'}
          </button>
        </div>
        <div className="mt-4">
          <RuleList rules={activeRules} />
        </div>
        {afterResult !== null && (
          <p className="mt-2 text-xs text-neutral-500">
            위 규칙 목록·토글은 다음 탐색에 쓸 설정입니다. 아래 결과의 "수정 전"은 최초 탐색 당시
            규칙, "수정 후"는 전액 정산 규칙 기준입니다.
          </p>
        )}
      </section>

      <button
        onClick={run}
        disabled={busy}
        className="mt-8 rounded bg-emerald-500 px-4 py-2 font-medium text-neutral-950 disabled:opacity-50"
      >
        {phase.kind === 'running' ? '탐색 중…' : '탐색 시작'}
      </button>

      <section className="mt-8" data-testid="result">
        {phase.kind === 'error' && <p className="text-red-400">{phase.message}</p>}
        {phase.kind === 'done' && (
          <TraceView
            result={phase.result}
            clawback={phase.clawbackUsed}
            bounds={preset.scenario.bounds}
            params={preset.scenario.params}
          />
        )}
        {phase.kind === 'done' && phase.result.trace && (
          <>
            {rerun.error && <p className="mt-4 text-sm text-red-400">{rerun.error}</p>}
            {afterResult === null && (
              <button
                onClick={rerunWithFix}
                disabled={rerun.running}
                className="mt-6 rounded border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-300 disabled:opacity-50"
              >
                {rerun.running ? '탐색 중…' : '수정한 규칙으로 다시 탐색'}
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
