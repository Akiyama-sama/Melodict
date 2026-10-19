import fs from 'node:fs';

// Exercise the real salvage path: analyzeLyrics with a mocked SSE gateway that returns the exact
// malformed completions captured from the lemon/gurenge eval logs.
import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';

const extractFailure = (path: string): string => {
  const log = fs.readFileSync(path, 'utf-8');
  const all = /causeMessage":"((?:[^"\\]|\\.)*)"/g;
  let last: string | undefined;
  for (const m of log.matchAll(all)) last = m[1];
  if (!last) throw new Error(`no causeMessage in ${path}`);
  const text = JSON.parse(`"${last}"`) as string;
  const body = text.replace(/^JSON parsing failed: Text: /, '');
  return body.slice(0, body.lastIndexOf('Error message:')).trimEnd();
};

const CASES = [
  { name: 'lemon', completion: extractFailure('/tmp/base-lemon.log') },
  { name: 'gurenge', completion: extractFailure('/tmp/base-gurenge.log') }
];

const lineIdsIn = (completion: string) =>
  [...completion.matchAll(/\{\s*"lineId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);

const main = async () => {
  for (const { name, completion } of CASES) {
    const ids = lineIdsIn(completion);
    console.log(`\n=== ${name}: completion ${completion.length} chars, lineIds in text: ${ids.join(', ')}`);
    const realFetch = globalThis.fetch;
    const chunks: string[] = [];
    for (let i = 0; i < completion.length; i += 180) chunks.push(completion.slice(i, i + 180));

    globalThis.fetch = (async (_input: unknown, _init?: unknown) => {
      const sse = [
        ...chunks.map(
          (c) =>
            `data: ${JSON.stringify({
              id: 'mock',
              object: 'chat.completion.chunk',
              created: Date.now(),
              model: 'mock',
              choices: [{ index: 0, delta: { content: c }, finish_reason: null }]
            })}`
        ),
        `data: ${JSON.stringify({
          id: 'mock',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'mock',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })}`,
        'data: [DONE]',
        ''
      ].join('\n\n');
      const response = new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return response as unknown as Awaited<ReturnType<typeof fetch>>;
    }) as typeof fetch;

    let emitted = 0;
    try {
      const outcome = await analyzeLyrics({
        config: { baseURL: 'http://mock.local/v1', modelId: 'mock', apiKey: 'mock' },
        uiLanguage: 'zh-CN',
        songTitle: `salvage-${name}`,
        songArtists: [],
        lines: ids.map((lineId) => ({ lineId, text: `占位 ${lineId}` })),
        onLine: (line, source) => {
          emitted += 1;
          console.log(`  onLine ${source} ${line.lineId}: ${line.tokens.length} tokens`);
        }
      });
      console.log(`  outcome lines: ${outcome.lines.length} | failed: ${JSON.stringify(outcome.failedLineIds)} | emitted: ${emitted}`);
    } catch (error) {
      console.log(`  THREW: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
};

void main();
