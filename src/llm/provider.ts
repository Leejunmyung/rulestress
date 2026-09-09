import Anthropic from '@anthropic-ai/sdk';

export async function callLLM(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}
