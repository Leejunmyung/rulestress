import { NextResponse, type NextRequest } from 'next/server';
import { callLLM } from '../../../src/llm/provider';
import { buildExplainPrompt, parseExplain } from '../../../src/llm/explain';

export const runtime = 'nodejs';

const ACTION_TYPES = new Set(['PURCHASE', 'PURCHASE_WITH_POINTS', 'CANCEL_ORDER']);
const INVARIANT_ID = /^[a-z][a-z0-9_]*$/;

// Per-instance rate limit: a Map of recent request timestamps per client IP.
// This is per serverless instance only — a real deploy would use a shared store.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const RATE_MAP_CAP = 5000;
const rateBuckets = new Map<string, number[]>();

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

    const { system, user } = buildExplainPrompt(trace, violations);
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
