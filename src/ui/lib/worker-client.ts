import type { Scenario, RulesSpec, SearchResult } from '../../domain/types.js';

export function runSearch(scenario: Scenario, rules?: RulesSpec): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/bfs.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: SearchResult; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? 'search failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ scenario, rules });
  });
}
