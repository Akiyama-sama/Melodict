import parseLyrics from '../../common/parseLyrics';
import { callNeteaseForBody } from './client';
import { readNeteaseSession } from './session';

/**
 * Fetches lyrics for a NetEase song and shapes them into the app's `SongLyrics` contract so the
 * whole downstream stack (parseLyrics consumers, romanize, translation, LLM analysis) works
 * unmodified.
 *
 * `yrc` (word-by-word "eapi lyrics") is converted into enhanced-synced LRC with `<start:end>` word
 * timestamps, which the shared parser already understands.
 */

interface NeteaseLyricBody {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  romalrc?: { lyric?: string };
  yrc?: { lyric?: string };
  ytlrc?: { lyric?: string };
  yromalrc?: { lyric?: string };
  code?: number;
  nolyric?: boolean;
  sgst?: unknown;
  syc?: unknown;
}

const getLyricBody = async (neteaseId: number): Promise<NeteaseLyricBody> => {
  const session = await readNeteaseSession();

  try {
    const body = await callNeteaseForBody(
      'lyric_new',
      {
        id: neteaseId,
        lv: -1,
        kv: -1,
        tv: -1,
        rv: -1,
        yv: 1,
        ytv: 1,
        yrv: 1
      },
      session ? { cookie: session.cookie } : {}
    );
    return body as NeteaseLyricBody;
  } catch {
    // Older deployments may not know the v1 params; fall back to the classic endpoint.
    const body = await callNeteaseForBody(
      'lyric',
      { id: neteaseId, lv: -1, tv: -1, rv: -1 },
      session ? { cookie: session.cookie } : {}
    );
    return body as NeteaseLyricBody;
  }
};

const YRC_LINE_REGEX = /^\[(?<start>\d+),(?<end>\d+)\](?<payload>.*)$/;
const YRC_WORD_REGEX = /[(](?<start>\d+),(?<duration>\d+),\d+[)](?<word>[^()]*)/g;

/**
 * `lyric_new` returns the `lrc` field as JSON karaoke lines — `{"t":<ms>,"c":[{"tx":..},..]}` —
 * instead of bracketed LRC. Payloads mix formats: metadata lines are JSON while the actual lyric
 * lines may be plain LRC. Flattens JSON lines into bracketed LRC (`[mm:ss.mmm]tx1 tx2…`, dropping
 * non-text entries like embedded artist links) and keeps plain lines as-is.
 */
export const convertJsonLrcToLrc = (lrcLyric: string): string => {
  const trimmed = lrcLyric.trim();
  if (!trimmed.startsWith('{')) return lrcLyric;

  const lines: string[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) {
      // Already bracketed LRC (mixed payloads) — keep it.
      lines.push(line);
      continue;
    }

    try {
      const parsed = JSON.parse(line) as { t?: number; c?: { tx?: string }[] };
      const text = (parsed.c ?? [])
        .map((chunk) => chunk.tx ?? '')
        .join('')
        .trim();
      const lineMs = parsed.t;
      if (text.length === 0 || lineMs === undefined || !Number.isFinite(lineMs)) continue;
      lines.push(`[${millisecondsToLrcTime(lineMs)}]${text}`);
    } catch {
      // Not a JSON karaoke line; keep the parser from dying on stray content.
    }
  }

  return lines.join('\n');
};

/** Converts NetEase yrc milliseconds into `mm:ss.mmm` LRC timestamps. */
export const millisecondsToLrcTime = (ms: number) => {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millisPart = (totalMs % 1000).toString().padStart(3, '0');
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millisPart}`;
};

/**
 * Converts a NetEase `yrc` payload into enhanced-synced LRC text
 * (`[mm:ss.mmm]word<mm:ss.mmm>word<mm:ss.mmm>` lines), the format the shared parser handles
 * natively for word-level timings.
 */
export const convertYrcToEnhancedLrc = (yrcLyric: string): string => {
  const lines: string[] = [];

  for (const rawLine of yrcLyric.split('\n')) {
    const lineMatch = YRC_LINE_REGEX.exec(rawLine.trim());
    YRC_LINE_REGEX.lastIndex = 0;
    if (!lineMatch?.groups) continue;

    const { start, payload } = lineMatch.groups;
    const startMs = Number.parseInt(start, 10);
    if (!Number.isFinite(startMs)) continue;

    // Lines without word-level payload are plain synced lines (instrumental or spoken).
    const words: string[] = [];
    let wordMatch: RegExpExecArray | null;
    YRC_WORD_REGEX.lastIndex = 0;
    while ((wordMatch = YRC_WORD_REGEX.exec(payload)) !== null) {
      const word = wordMatch.groups?.word ?? '';
      if (word.length > 0) {
        // YRC word tuples are `(absoluteStartMs, durationMs, 0)`; the enhanced-LRC word tag wants
        // the end time, so add the duration to the start.
        const wordStartMs = Number.parseInt(wordMatch.groups?.start ?? '0', 10);
        const wordDurationMs = Number.parseInt(wordMatch.groups?.duration ?? '0', 10);
        words.push(`${word}<${millisecondsToLrcTime(wordStartMs + wordDurationMs)}>`);
      }
    }

    if (payload.trim().length > 0 && words.length === 0) {
      // Plain synced line: `[mm:ss.mmm]payload` — no word timestamps.
      lines.push(`[${millisecondsToLrcTime(startMs)}]${payload.trim()}`);
      continue;
    }

    const lineStart = `[${millisecondsToLrcTime(startMs)}]`;
    lines.push(`${lineStart}${words.join('')}`);
  }

  return lines.join('\n');
};

const joinTranslationWithTiming = (baseLyric: string, translationLyric: string): string => {
  // parseLyrics merges same-timestamp lines into translated rows, so concatenating the two LRCs
  // with matching timestamps is all that's needed.
  if (!translationLyric.trim()) return baseLyric;
  return `${baseLyric}\n${translationLyric.trim()}`;
};

export const getNeteaseLyrics = async (neteaseId: number): Promise<SongLyrics | undefined> => {
  const body = await getLyricBody(neteaseId);

  // No lyrics at all (instrumental-only or restricted).
  if (body.nolyric === true && !body.lrc?.lyric?.trim() && !body.yrc?.lyric?.trim()) {
    return undefined;
  }

  const isEnhanced = Boolean(body.yrc?.lyric?.trim());
  const baseLrc = body.yrc?.lyric?.trim()
    ? convertYrcToEnhancedLrc(body.yrc.lyric)
    : convertJsonLrcToLrc(body.lrc?.lyric ?? '');

  if (!baseLrc.trim()) return undefined;

  const withTranslation = joinTranslationWithTiming(
    baseLrc,
    body.ytlrc?.lyric ?? body.tlyric?.lyric ?? ''
  );

  return {
    title: '',
    source: 'NETEASE',
    lyricsType: isEnhanced ? 'ENHANCED_SYNCED' : 'SYNCED',
    lyrics: parseLyrics(withTranslation),
    isOfflineLyricsAvailable: false
  };
};
