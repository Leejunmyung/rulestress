/// <reference lib="webworker" />
import { bfs } from '../search/bfs.js';
import { loadRules, loadScenario } from '../domain/schema.js';
import type { Scenario, RulesSpec } from '../domain/types.js';

self.onmessage = (e: MessageEvent<{ scenario: Scenario; rules?: RulesSpec }>) => {
  try {
    // Validate the spec at the worker boundary — a bad rule set / scenario posts
    // back { ok: false, error } instead of throwing an opaque failure mid-search.
    loadScenario(e.data.scenario);
    loadRules(e.data.rules ?? e.data.scenario.rules);
    const result = bfs(e.data.scenario, e.data.rules);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
