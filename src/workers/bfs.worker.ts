/// <reference lib="webworker" />
import { bfs } from '../search/bfs.js';
import type { Scenario, RulesSpec } from '../domain/types.js';

self.onmessage = (e: MessageEvent<{ scenario: Scenario; rules?: RulesSpec }>) => {
  try {
    const result = bfs(e.data.scenario, e.data.rules);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
