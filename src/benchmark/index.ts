import { readFileSync, existsSync } from 'node:fs';
import { runBenchmark } from './runner.js';

/**
 * Unlike `next dev`/`next build`, `tsx` does not read `.env.local` on its own —
 * load it here so `pnpm benchmark` works right after following the README's
 * `cp .env.local.example .env.local` step, with no separate shell-export step.
 * Minimal KEY=VALUE parser (no quoting/escaping) — sufficient for this file's
 * one line; doesn't overwrite a key already set in the real environment.
 */
function loadEnvLocal(): void {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

/**
 * Benchmark script entry. Runs the real LLM-Direct baseline, so it needs
 * ANTHROPIC_API_KEY. Run with: `pnpm benchmark`.
 */
loadEnvLocal();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    'ANTHROPIC_API_KEY is not set (checked the environment and .env.local). ' +
      'The table below will show every LLM-Direct attempt as a call failure, ' +
      'NOT as "the LLM tried and found nothing" — see the LLM error column.',
  );
}

runBenchmark()
  .then((rows) => {
    console.table(rows.map((r) => ({
      scenario: r.name,
      'RS detected': r.ruleStress.detected,
      'RS steps': r.ruleStress.steps,
      'RS netValue': r.ruleStress.netValue,
      'LLM-Direct executable': r.llmDirect.executableCounterexample,
      'LLM error': r.llmError ?? '',
    })));
    const failed = rows.filter((r) => r.llmError);
    if (failed.length > 0) {
      console.error(
        `\n${failed.length}/${rows.length} scenario(s) could not call the LLM at all ` +
          '(see "LLM error" above) — "LLM-Direct executable: false" for those rows means ' +
          'the call failed, NOT that the model searched and found no counterexample. ' +
          'Do not report these rows as a negative result for the LLM.',
      );
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
