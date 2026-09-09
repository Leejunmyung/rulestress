import { NextResponse, type NextRequest } from 'next/server';
import { callLLM } from '../../../src/llm/provider';
import { buildExplainPrompt, parseExplain } from '../../../src/llm/explain';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { trace, violations } = await req.json();
    if (!trace || !Array.isArray(violations)) {
      return NextResponse.json({ error: 'body must be { trace, violations }' }, { status: 400 });
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
