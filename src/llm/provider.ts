import Anthropic from '@anthropic-ai/sdk';

export async function callLLM(
  system: string,
  user: string,
  opts?: { maxTokens?: number },
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    // baseline model — bump to claude-opus-5 for the published comparison if desired
    model: 'claude-sonnet-5',
    max_tokens: opts?.maxTokens ?? 700,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}
