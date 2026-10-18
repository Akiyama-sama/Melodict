import { createOpenAI } from '@ai-sdk/openai';
import { streamText, Output, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';

const schema = z.object({
  lineId: z.string(),
  translation: z.string().nullish(),
  tokens: z
    .array(
      z.object({
        startChar: z.number().nullish(),
        endChar: z.number().nullish(),
        language: z.string().nullish(),
        card: z
          .object({
            term: z.string().nullish(),
            pronunciation: z.unknown().nullish(),
            meaning: z.string().nullish(),
            grammarFunction: z.string().nullish()
          })
          .nullish()
      })
    )
    .nullish()
});

const main = async () => {
  const provider = createOpenAI({ apiKey: 'local', baseURL: 'http://127.0.0.1:3425/v1' });
  const model = provider.chat('workbuddy/glm-5.3-flash');

  const result = streamText({
    model,
    system: 'Annotate lyrics. Return ONLY JSON {"elements":[...]} with 1-6 tokens per line.',
    prompt: JSON.stringify({
      lines: [
        { lineId: 'line-0', text: '夢ならばどれほどよかったでしょう' },
        { lineId: 'line-1', text: '未だにあなたのことを夢にみる' }
      ]
    }),
    temperature: 0,
    maxOutputTokens: 5000,
    providerOptions: { openai: { strictJsonSchema: false } },
    output: Output.array({ element: schema, name: 'lyric_lines', description: 'One annotated lyric line' })
  });

  let streamed = 0;
  for await (const el of result.elementStream) streamed += 1;
  console.log('streamed elements:', streamed);

  try {
    await result.output;
    console.log('output OK');
  } catch (e) {
    console.log('FAILED:', (e as Error).message);
    if (NoObjectGeneratedError.isInstance(e)) {
      const text = e.text ?? '';
      console.log('error.text length:', text.length);
      try {
        JSON.parse(text.trim());
        console.log('strict parse of error.text: OK');
      } catch (err) {
        console.log('strict parse fails:', (err as Error).message);
        // Show the tail and the failure neighborhood
        console.log('tail:', JSON.stringify(text.slice(-100)));
        const pos = /position (\d+)/.exec((err as Error).message)?.[1];
        if (pos) console.log('near:', JSON.stringify(text.slice(Math.max(0, +pos - 60), +pos + 60)));
      }
    }
  }
};

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
