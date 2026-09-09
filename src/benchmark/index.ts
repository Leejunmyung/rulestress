import { runBenchmark } from './runner.js';

/**
 * Benchmark script entry. Runs the real LLM-Direct baseline, so it needs
 * ANTHROPIC_API_KEY. Run with: `pnpm benchmark`.
 */
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
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
