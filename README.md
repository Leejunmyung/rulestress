# RuleStress

**Break your promotion before users do.**

RuleStress converts promotion rules and business intent into an executable state
model, exhaustively explores the bounded reachable state space, and returns the
shortest action sequence that violates the intent — with a full, replayable trace
and its economic impact.

> LLM은 허점을 제안할 수 있다. RuleStress는 그 허점이 실제로 실행되는지 증명한다.

Built for the Wanted AI Championship 2026.

## What's in the box

- **Deterministic engine** (`src/`) — a generic business-primitive DSL, a pure
  transition pipeline (per-event snapshot semantics, no rule cascading), economic
  metrics, and a bounded exhaustive BFS. Fully unit-tested; zero LLM in the search
  path.
- **Web app** (`app/`, Next.js 15) — `/simulate` loads the Reward Settlement demo,
  runs the search in a Web Worker, and renders the verified counterexample:
  step-by-step ledger deltas, the violated intent, and `Net Extracted Value`
  computed by the simulator. A clawback-rule toggle + **Re-run with fix** shows the
  Before/After.
- **LLM explain** (`/api/explain`) — turns a verified counterexample into a Korean
  root-cause paragraph + a risk label. The model never computes or restates
  monetary figures; all numbers come from the simulator.

## Run locally

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

The **Explain** button needs an Anthropic key:

```bash
cp .env.local.example .env.local
# edit .env.local: ANTHROPIC_API_KEY=sk-ant-...
```

Everything else (the search, the trace, Before/After) works without a key.

## Verify

```bash
pnpm test           # full suite (engine + product logic)
pnpm gate1          # Gate 1: BFS finds the 3-step counterexample with no hint,
                    #         FIXED_RULES finds none at the same bounds
pnpm typecheck
pnpm build
pnpm benchmark      # needs ANTHROPIC_API_KEY (reads it from .env.local automatically,
                    # same file the Explain button uses); prints the RuleStress vs
                    # LLM-Direct comparison table (BFS detection vs. a raw-LLM search).
                    # If the key is missing, every row's "LLM-Direct executable" is a
                    # call failure, not a negative search result — check "LLM error".
```

## The demo path

1. Open `/simulate` (preset: Reward Settlement).
2. **Run** → `PURCHASE → PURCHASE_WITH_POINTS → CANCEL_ORDER` is found in a search
   of 22 states, violating `no_benefit_after_cancel`. Net Extracted Value **₩10,000**.
   The sequence was never given to the search.
3. **Explain** → LLM names the rule interaction ("Reward Clawback Bypass").
4. **Re-run with fix** → `RECLAIM_REWARD` → `RECLAIM_REWARD_FULL`; the same bounded
   search (71 states) finds no violation.

## Deploy (Vercel)

1. Push to GitHub, import the repo in Vercel.
2. Set the `ANTHROPIC_API_KEY` environment variable.
3. `/api/explain` runs on the Node runtime; everything else is static + a client
   Web Worker.

## Design docs

- `docs/superpowers/specs/2026-09-08-rulestress-core-design.md` — engine mechanism
  (3 rounds of external review; independently reproduced 71-state enumeration)
- `docs/superpowers/specs/2026-09-09-rulestress-product-design.md` — product scope

## Known limits

- Single identity; the demo uses a fixed action space (PURCHASE / PURCHASE_WITH_POINTS / CANCEL_ORDER).
- Structured input only — no natural-language rule compiler in this build.
- `validActions` duplicates `actionPrecondition`'s predicate; unify when the action space grows.
- `/api/explain` rate limiting: the per-IP bucket keys off `x-real-ip` /
  `x-forwarded-for`, which are client-supplied headers Vercel does not verify —
  a caller can get a fresh bucket per request by varying the header. The
  per-instance **global** cap (30 calls/60s, independent of any header) is the
  actual backstop against runaway Anthropic spend; both counters reset when a
  serverless instance recycles. For a public deploy beyond a demo, put a
  monthly spend cap on the Anthropic API key in the Anthropic console, and
  replace both counters with a shared store (e.g. Upstash/Vercel KV).
- `redactFigures` (in `src/llm/explain.ts`) is a best-effort regex scrub, not a
  formally verified guarantee — it strips ASCII and full-width digit runs and
  common Korean numeral+unit phrases (e.g. `오만원`), but does not cover every
  possible numeral encoding. The system prompt instructs the model not to
  restate figures at all; the regex is defense-in-depth on top of that, not
  the sole safeguard.
