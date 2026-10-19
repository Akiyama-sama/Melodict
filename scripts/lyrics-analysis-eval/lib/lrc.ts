/**
 * Shared LRC parsing for the evaluation harness (verbatim from run.ts — the alignment/fingerprint
 * semantics depend on it).
 */
import fs from 'node:fs/promises';

export const LRC_TIMESTAMP_REGEX = /^\s*\[(?<min>\d+):(?<sec>\d+)(?:[.:](?<ms>\d{1,3}))?\]\s*/;
// `[ar:…]`-style tags and NetEase's JSON credit lines ({"t":0,"c":[{"tx":"作词: "}…]}) are metadata,
// not lyrics. Without the second pattern those JSON blobs reach the analyzer as lyric lines and
// get "analyzed" as gibberish, wasting a batch and polluting alignment.
export const LRC_METADATA_LINE_REGEX = /^(?:\[[a-z]+:|\{"t":)/i;

/** Content lines of an LRC file, keeping each line's timestamp when it has one. */
export const parseLrcFile = async (filePath: string) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  const entries: Array<{ atMs: number | undefined; text: string }> = [];

  for (const line of raw.split('\n')) {
    const match = LRC_TIMESTAMP_REGEX.exec(line);
    const text = line.replace(LRC_TIMESTAMP_REGEX, '').trim();
    if (text.length === 0 || LRC_METADATA_LINE_REGEX.test(text)) continue;

    if (match?.groups) {
      const minutes = Number.parseInt(match.groups.min, 10);
      const seconds = Number.parseInt(match.groups.sec, 10);
      const ms = Number.parseInt((match.groups.ms ?? '0').padEnd(3, '0'), 10);
      entries.push({ atMs: minutes * 60000 + seconds * 1000 + ms, text });
    } else {
      entries.push({ atMs: undefined, text });
    }
  }

  return entries;
};
