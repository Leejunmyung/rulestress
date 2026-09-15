import { NextResponse, type NextRequest } from 'next/server';
import { callLLM } from '../../../src/llm/provider';
import { buildExplainPrompt, parseExplain } from '../../../src/llm/explain';
import { BUGGY_RULES, FIXED_RULES } from '../../../src/scenarios/reward-settlement';

export const runtime = 'nodejs';

const ACTION_TYPES = new Set(['PURCHASE', 'PURCHASE_WITH_POINTS', 'CANCEL_ORDER']);
const INVARIANT_ID = /^[a-z][a-z0-9_]*$/;

// The client picks WHICH known ruleset was active, never the ruleset itself —
// accepting an arbitrary RulesSpec from the request body would let a caller
// inject attacker-controlled strings into a server-side LLM prompt.
const RULESETS = { buggy: BUGGY_RULES, fixed: FIXED_RULES } as const;

// Per-instance rate limit: a Map of recent request timestamps per client IP.
// This is per serverless instance only — a real deploy would use a shared store.
// The IP bucket is a heuristic, NOT a security boundary: `x-real-ip` and
// `x-forwarded-for` are client-supplied headers that Vercel does not verify or
// strip, so a caller can pick a fresh value per request and get a fresh bucket
// every time. The GLOBAL cap below is what actually bounds Anthropic spend —
// it cannot be evaded by spoofing headers because it isn't keyed by IP at all.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const RATE_MAP_CAP = 5000;
const rateBuckets = new Map<string, number[]>();

// Hard ceiling on total /api/explain calls per instance per window, independent
// of client-supplied identity. This is the real backstop against cost-exposure
// abuse; the per-IP bucket above is only a secondary, spoofable heuristic.
const GLOBAL_RATE_LIMIT = 30;
let globalRecent: number[] = [];

function globalRateLimited(): boolean {
  const now = Date.now();
  globalRecent = globalRecent.filter((t) => now - t < RATE_WINDOW_MS);
  globalRecent.push(now);
  return globalRecent.length > GLOBAL_RATE_LIMIT;
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(ip, recent);

  // Evict stale entries so the Map doesn't grow without bound; hard-clear as a backstop.
  if (rateBuckets.size > RATE_MAP_CAP) {
    rateBuckets.clear();
  } else {
    for (const [key, times] of rateBuckets) {
      if (key !== ip && times.every((t) => now - t >= RATE_WINDOW_MS)) {
        rateBuckets.delete(key);
      }
    }
  }
  return recent.length > RATE_LIMIT;
}

// Prefer x-real-ip; else the RIGHTMOST x-forwarded-for hop (leftmost is client-spoofable).
// Spoofable either way (see comment above) — used only to keep one abusive caller
// from starving everyone else's slice of the global cap, not as the actual limit.
function clientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const parts = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    if (globalRateLimited()) {
      return NextResponse.json({ error: 'rate limit exceeded (server busy)' }, { status: 429 });
    }
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return NextResponse.json({ error: 'rate limit exceeded (max 10 / 60s)' }, { status: 429 });
    }

    const body = await req.json();
    const trace = body?.trace;
    const violations = body?.violations;

    if (
      !trace ||
      typeof trace !== 'object' ||
      !Array.isArray(trace.steps) ||
      trace.steps.length < 1 ||
      trace.steps.length > 20
    ) {
      return NextResponse.json(
        { error: 'trace must be an object with 1..20 steps' },
        { status: 400 },
      );
    }
    for (const step of trace.steps) {
      if (
        !step ||
        typeof step !== 'object' ||
        !step.action ||
        typeof step.action !== 'object' ||
        !ACTION_TYPES.has(step.action.type)
      ) {
        return NextResponse.json(
          { error: 'each trace step needs action.type of PURCHASE | PURCHASE_WITH_POINTS | CANCEL_ORDER' },
          { status: 400 },
        );
      }
    }
    if (
      !Array.isArray(violations) ||
      violations.length === 0 ||
      !violations.every(
        (v) =>
          v &&
          typeof v === 'object' &&
          typeof v.invariantId === 'string' &&
          INVARIANT_ID.test(v.invariantId),
      )
    ) {
      return NextResponse.json(
        { error: 'violations must be a non-empty array of { invariantId }' },
        { status: 400 },
      );
    }

    const clawbackRaw: unknown = body?.clawback;
    if (clawbackRaw !== 'buggy' && clawbackRaw !== 'fixed') {
      return NextResponse.json({ error: 'clawback must be "buggy" or "fixed"' }, { status: 400 });
    }
    const clawback: 'buggy' | 'fixed' = clawbackRaw;

    const { system, user } = buildExplainPrompt(trace, violations, RULESETS[clawback]);
    const raw = await callLLM(system, user);
    if (!raw.trim()) {
      return NextResponse.json({ error: 'empty response from model' }, { status: 502 });
    }
    return NextResponse.json(parseExplain(raw));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
