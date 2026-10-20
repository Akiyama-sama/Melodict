import { z } from 'zod';

import { FAMILY_TO_LANGUAGE, detectLineScript } from './lyricsLanguageProfiles';

// Bumped to '2' when the normalizer gained word-boundary snapping + whitespace trimming: cached
// artifacts from v1 carry misaligned token spans that would render clipped words.
export const LYRICS_ANALYSIS_SCHEMA_VERSION = '2';
// Bumped to '3' with the language-profile directive and the romanized-reference rule: cached
// artifacts from v2 were produced without per-language guidance and without the human romaji
// reference, so their tokenization/pronunciation quality no longer matches what the prompt asks for.
// Bumped to '4' requiring per-token surface text and whole-line word coverage: cache keys must
// change because the prompt now asks for a field some models never emitted, and coverage drives
// re-ask behavior, so older cached lines cannot be compared with newer ones.
// Bumped to '5' adding the per-token pinyin field: cached artifacts from v4 predate the field and
// render without per-token pinyin until re-analyzed.
// Bumped to '6' pinning token granularity in the base prompt (one word per token, no whole-line
// single tokens): artifacts from v5 carry the coarse-merged tokenization this version repairs.
export const LYRICS_ANALYSIS_PROMPT_VERSION = '6';
export const LYRICS_ANALYSIS_DEFAULT_MODEL_ID = 'gpt-4o-mini';

export type LyricsAnalysisLanguage = 'en' | 'ja' | 'ko' | 'zh' | 'unknown';

export interface LyricsAnalysisPronunciation {
  value?: string;
  kana?: string;
  romaji?: string;
  ipa?: string;
  us?: string;
  uk?: string;
  hangul?: string;
  romanized?: string;
  /** Word-level pinyin with tone marks (Chinese tokens). */
  pinyin?: string;
}

export interface LyricsAnalysisCard {
  term: string;
  pronunciation: LyricsAnalysisPronunciation;
  meaning: string;
  grammarFunction: string;
}

export interface LyricsAnalysisToken {
  tokenId: string;
  text: string;
  startChar: number;
  endChar: number;
  language: LyricsAnalysisLanguage;
  card: LyricsAnalysisCard;
}

export type LyricsAnalysisLineStatus = 'ready' | 'degraded' | 'unavailable';

export interface LyricsAnalysisLine {
  lineId: string;
  text: string;
  translation?: string;
  tokens: LyricsAnalysisToken[];
  status: LyricsAnalysisLineStatus;
  /** Telemetry input: raw tokens the model emitted that validation dropped. */
  droppedTokenCount?: number;
}

export interface LyricsAnalysisInputLine {
  lineId: string;
  text: string;
  /**
   * Human-authored romanization of this line (e.g. NetEase `romalrc`), when the source provides
   * one. The prompt treats it as pronunciation ground truth and aligns token boundaries to it;
   * lines without a reference are analyzed from the model's own knowledge.
   */
  romanizedText?: string;
}

export type LyricsAnalysisSessionStatus =
  | 'idle'
  | 'notConfigured'
  | 'cached'
  | 'analyzing'
  | 'repairing'
  | 'ready'
  | 'error';

export type LyricsAnalysisErrorCode =
  | 'authFailed'
  | 'endpointUnsupported'
  | 'networkFailed'
  | 'invalidResponse'
  | 'unknown';

export interface LyricsAnalysisError {
  code: LyricsAnalysisErrorCode;
  message: string;
  statusCode?: number;
}

export interface LyricsAnalysisRequest {
  songPath: string;
  songTitle: string;
  songArtists: string[];
  uiLanguage: string;
  lines: LyricsAnalysisInputLine[];
  forceRefresh?: boolean;
}

export interface LyricsAnalysisSnapshot {
  songPath: string;
  fingerprint?: string;
  status: LyricsAnalysisSessionStatus;
  lines?: LyricsAnalysisLine[];
  error?: LyricsAnalysisError;
  updatedAt: number;
}

export interface LyricsAnalysisLineEvent {
  songPath: string;
  fingerprint: string;
  line: LyricsAnalysisLine;
}

export type LyricsAnalysisEvent =
  | { type: 'snapshot'; snapshot: LyricsAnalysisSnapshot }
  | { type: 'line'; event: LyricsAnalysisLineEvent };

export interface LyricsAnalysisProviderConfig {
  baseURL: string;
  modelId: string;
  apiKey?: string;
  /**
   * Ceiling for the gateway's adaptive concurrent-batch window (AIMD: grow +1 per clean batch,
   * halve on 429/timeout/network). Absent = 4. Persisted per profile; older config files read as
   * `undefined` and take the default.
   */
  maxConcurrency?: number;
}

/** One saved provider, safe to hand to the renderer: the key itself never leaves the main process. */
export interface LyricsAnalysisProviderProfile {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  hasApiKey: boolean;
  /** Masked tail for display, e.g. `••••ab12`. */
  apiKeyHint?: string;
  isActive: boolean;
  /**
   * Ceiling for the analysis gateway's concurrent-batch window. Absent on profiles saved before
   * the field existed; consumers default to 4.
   */
  maxConcurrency?: number;
}

export interface LyricsAnalysisProviderProfilesState {
  profiles: LyricsAnalysisProviderProfile[];
  activeProfileId?: string;
}

export interface LyricsAnalysisProviderProfileInput {
  /** Present when editing an existing profile. */
  id?: string;
  /** Falls back to a name derived from the base URL. */
  name?: string;
  baseURL: string;
  modelId: string;
  /** `undefined` keeps the stored key, an empty string clears it. */
  apiKey?: string;
  /** `undefined` keeps the stored value; a number overwrites it (clamped 1..64 on save). */
  maxConcurrency?: number;
}

export interface LyricsAnalysisProviderTestResult {
  ok: boolean;
  message: string;
  statusCode?: number;
  latencyMs: number;
  errorCode?: LyricsAnalysisErrorCode;
}

/**
 * Schema attached to `Output.array` in the worker. It is intentionally lenient: every token field
 * is optional, so a semantically broken token survives transport and reaches app-side validation,
 * where we know _why_ it failed. A strict schema here would make the SDK silently drop the whole
 * element and leave us with only "line missing".
 */
export const lyricsAnalysisTransportSchema = z.object({
  lineId: z.string(),
  translation: z.string().nullish(),
  tokens: z
    .array(
      z.object({
        startChar: z.number().nullish(),
        endChar: z.number().nullish(),
        // The surface form the model thinks this token is. Offsets are routinely miscounted on
        // CJK lines; this text is far more reliable, so validation re-anchors the span to where
        // the text actually occurs in the line. Zod strips unknown keys, so it must be declared.
        text: z.string().nullish(),
        language: z.string().nullish(),
        card: z
          .object({
            term: z.string().nullish(),
            // Models routinely emit a plain string here instead of the structured shape; the
            // normalizer below reads whichever variant arrived, so accept anything at transport.
            // `.nullish()` is required: bare z.unknown() makes the KEY mandatory in Zod 4, and a
            // missing pronunciation (metadata lines, proper nouns) then nukes the whole element.
            pronunciation: z.unknown().nullish(),
            meaning: z.string().nullish(),
            grammarFunction: z.string().nullish()
          })
          .nullish()
      })
    )
    .nullish()
});

export type LyricsAnalysisTransportLine = z.infer<typeof lyricsAnalysisTransportSchema>;

const LANGUAGES: LyricsAnalysisLanguage[] = ['en', 'ja', 'ko', 'zh', 'unknown'];

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const inferTokenLanguage = (text: string): LyricsAnalysisLanguage => {
  // Single-sourced with the gateway's script detection: same regexes, same kana→hangul→han→latin
  // order, and Han defaults to zh for standalone use (the song-level mix resolver overrides it
  // when kana/hangul exists elsewhere in the song).
  const script = detectLineScript(text);
  return script === 'han' ? 'zh' : FAMILY_TO_LANGUAGE[script];
};

export const buildTokenId = (lineId: string, startChar: number, endChar: number) =>
  `${lineId}:${startChar}-${endChar}`;

export const getFallbackMeaning = (lineText: string, tokenText: string) =>
  `在这句歌词“${lineText}”里，更接近“${tokenText}”这层意思。`;

const PARENTHETICAL_PAIRS: Array<[string, string]> = [
  ['(', ')'],
  ['（', '）'],
  ['【', '】'],
  ['「', '」']
];

/**
 * Marks characters inside bracketed asides. Backing vocals, translations and stage directions
 * (「パッと花火が（パッと花火が）」, 「夜の匂いに (I'll spend all thirty nights)」) are echoes: models routinely leave
 * them untokenized and that is a defensible reading, so they must not count as missing content when
 * coverage is measured.
 */
const markParenthetical = (text: string): boolean[] => {
  const mask = new Array<boolean>(text.length).fill(false);
  const stack: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    const opening = PARENTHETICAL_PAIRS.find(([open]) => open === char);
    const closing = PARENTHETICAL_PAIRS.find(([, close]) => close === char);
    if (opening) {
      stack.push(opening[1]);
      mask[index] = true;
    } else if (closing && stack.length > 0) {
      stack.pop();
      mask[index] = true;
    } else if (stack.length > 0) {
      mask[index] = true;
    }
  }
  return mask;
};

/**
 * The word atoms a line's tokens must cover. A token covers an atom when their spans intersect, so
 * a merged phrase token ("settled down") covers both of its words. Punctuation and parenthetical
 * echoes are not atoms. Used to detect lines the model annotated only partially — the failure mode
 * is invisible otherwise, because a line whose last word was never emitted still validates cleanly
 * and reports status "ready".
 */
export const findUncoveredLineWords = (text: string, tokens: LyricsAnalysisToken[]): string[] => {
  const parenthetical = markParenthetical(text);
  const uncovered: string[] = [];
  const atomRegex = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  for (const match of text.matchAll(atomRegex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (parenthetical[start]) continue;
    if (tokens.some((token) => token.startChar < end && token.endChar > start)) continue;
    uncovered.push(match[0]);
  }
  return uncovered;
};

export const getFallbackGrammarFunction = () => '歌词中的表达成分';

export type LineValidationOutcome =
  | {
      kind: 'ok';
      line: LyricsAnalysisLine;
      droppedTokenCount: number;
      /** Diagnostics for rejected raw tokens, bounded; empty when nothing was rejected. */
      droppedTokens: Array<{
        reason: 'offsets' | 'range' | 'empty' | 'duplicate' | 'overlap';
        startChar?: number;
        endChar?: number;
        text?: string;
        term?: string;
      }>;
    }
  | { kind: 'failed'; lineId: string; reason: string };

/**
 * Validates and normalizes one streamed element against the authoritative server-side line text.
 * This is where all semantic constraints live — never in the transport schema used by the SDK.
 */
export const validateAndNormalizeLineAnalysis = (input: {
  draft: LyricsAnalysisTransportLine;
  text: string;
}): LineValidationOutcome => {
  const { draft, text } = input;
  const lineId = asTrimmedString(draft.lineId);

  if (!lineId) return { kind: 'failed', lineId: '', reason: 'missing-line-id' };
  if (text.length === 0) return { kind: 'failed', lineId, reason: 'empty-line-text' };

  const rawTokens = Array.isArray(draft.tokens) ? draft.tokens : [];
  if (rawTokens.length === 0) return { kind: 'failed', lineId, reason: 'tokens-empty' };

  const seenSpans = new Set<string>();
  const validated: LyricsAnalysisToken[] = [];
  const droppedTokens: Array<{
    reason: 'offsets' | 'range' | 'empty' | 'duplicate' | 'overlap';
    startChar?: number;
    endChar?: number;
    text?: string;
    term?: string;
  }> = [];
  const noteDropped = (
    reason: 'offsets' | 'range' | 'empty' | 'duplicate' | 'overlap',
    rawToken: (typeof rawTokens)[number],
    span?: { startChar: number; endChar: number }
  ) => {
    if (droppedTokens.length >= 8) return;
    droppedTokens.push({
      reason,
      startChar: span?.startChar ?? asInteger(rawToken?.startChar),
      endChar: span?.endChar ?? asInteger(rawToken?.endChar),
      text: asTrimmedString(rawToken?.text),
      term: asTrimmedString(rawToken?.card?.term)
    });
  };

  for (const rawToken of rawTokens) {
    const claimedStart = asInteger(rawToken?.startChar);
    const claimedEnd = asInteger(rawToken?.endChar);

    if (claimedStart === undefined || claimedEnd === undefined) {
      noteDropped('offsets', rawToken);
      continue;
    }
    let startChar = claimedStart;
    let endChar = claimedEnd;

    // Weak models routinely miscount code-unit offsets on CJK lines while reporting the token's
    // surface text correctly — badly enough that the claimed span may even fall outside the
    // line. When that text appears verbatim in the line, re-anchor the span to its real
    // position: a unique occurrence wins outright, otherwise the occurrence closest to the
    // model's own offsets does. This repairs whole-line drift without trusting the counts.
    const rawTokenText = asTrimmedString(rawToken?.text);
    if (rawTokenText && !rawTokenText.includes('　')) {
      const first = text.indexOf(rawTokenText);
      if (first >= 0) {
        let anchor = first;
        if (text.indexOf(rawTokenText, first + 1) >= 0) {
          // Ambiguous text: pick the occurrence minimizing distance to the claimed offsets.
          let bestDistance = Number.POSITIVE_INFINITY;
          for (
            let at = text.indexOf(rawTokenText);
            at >= 0;
            at = text.indexOf(rawTokenText, at + 1)
          ) {
            const distance = Math.abs(at - claimedStart);
            if (distance < bestDistance) {
              bestDistance = distance;
              anchor = at;
            }
          }
        }
        startChar = anchor;
        endChar = anchor + rawTokenText.length;
      }
    }

    if (startChar < 0 || endChar <= startChar || endChar > text.length) {
      noteDropped('range', rawToken, { startChar, endChar });
      continue;
    }

    // Models sometimes stop a token mid-word (e.g. "self-cont" of "self-control"); snap the span
    // out to full word boundaries so Latin words never get cut apart. Deliberately Latin-only:
    // extending across CJK characters (all \p{L}) would fuse whole lines into one token.
    const WORD_CHARS = /[A-Za-z0-9'’-]/;
    let fixedStart = startChar;
    let fixedEnd = endChar;
    while (
      fixedStart > 0 &&
      WORD_CHARS.test(text[fixedStart - 1] ?? '') &&
      WORD_CHARS.test(text[fixedStart] ?? '')
    ) {
      fixedStart -= 1;
    }
    while (
      fixedEnd < text.length &&
      WORD_CHARS.test(text[fixedEnd] ?? '') &&
      WORD_CHARS.test(text[fixedEnd - 1] ?? '')
    ) {
      fixedEnd += 1;
    }

    // Trim whitespace the model swept into the span so underlines never cover stray spaces.
    while (fixedStart < fixedEnd && /\s/.test(text[fixedStart] ?? '')) fixedStart += 1;
    while (fixedEnd > fixedStart && /\s/.test(text[fixedEnd - 1] ?? '')) fixedEnd -= 1;

    const tokenText = text.slice(fixedStart, fixedEnd);
    if (tokenText.trim().length === 0) {
      noteDropped('empty', rawToken, { startChar: fixedStart, endChar: fixedEnd });
      continue;
    }

    const spanKey = `${fixedStart}-${fixedEnd}`;
    if (seenSpans.has(spanKey)) {
      noteDropped('duplicate', rawToken, { startChar: fixedStart, endChar: fixedEnd });
      continue;
    }

    // Reject overlaps: keep whichever token was emitted first for the overlapping region.
    const overlaps = validated.some(
      (token) => fixedStart < token.endChar && fixedEnd > token.startChar
    );
    if (overlaps) {
      noteDropped('overlap', rawToken, { startChar: fixedStart, endChar: fixedEnd });
      continue;
    }

    seenSpans.add(spanKey);

    const rawLanguage = asTrimmedString(rawToken?.language) as LyricsAnalysisLanguage | undefined;
    const language =
      rawLanguage && LANGUAGES.includes(rawLanguage) ? rawLanguage : inferTokenLanguage(tokenText);

    const card = rawToken?.card;
    // Models often emit pronunciation as a plain string ("きみ / kimi") instead of the structured
    // object; keep it as the display value instead of discarding it. The transport schema accepts
    // unknown, so narrow it manually before reading the structured fields.
    const rawPronunciation: unknown = card?.pronunciation;
    const pronunciation =
      typeof rawPronunciation === 'string'
        ? { value: rawPronunciation }
        : (rawPronunciation as
            | {
                value?: string;
                kana?: string;
                romaji?: string;
                ipa?: string;
                us?: string;
                uk?: string;
                hangul?: string;
                romanized?: string;
                pinyin?: string;
              }
            | undefined);

    validated.push({
      tokenId: buildTokenId(lineId, fixedStart, fixedEnd),
      text: tokenText,
      startChar: fixedStart,
      endChar: fixedEnd,
      language,
      card: {
        term: asTrimmedString(card?.term) ?? tokenText,
        pronunciation: {
          value: asTrimmedString(pronunciation?.value) ?? tokenText,
          kana: asTrimmedString(pronunciation?.kana),
          romaji: asTrimmedString(pronunciation?.romaji),
          ipa: asTrimmedString(pronunciation?.ipa),
          us: asTrimmedString(pronunciation?.us),
          uk: asTrimmedString(pronunciation?.uk),
          hangul: asTrimmedString(pronunciation?.hangul),
          romanized: asTrimmedString(pronunciation?.romanized),
          pinyin: asTrimmedString(pronunciation?.pinyin)
        },
        meaning: asTrimmedString(card?.meaning) ?? getFallbackMeaning(text, tokenText),
        grammarFunction: asTrimmedString(card?.grammarFunction) ?? getFallbackGrammarFunction()
      }
    });
  }

  if (validated.length === 0) return { kind: 'failed', lineId, reason: 'no-valid-tokens' };

  validated.sort((a, b) => a.startChar - b.startChar);

  // A line the model annotated only partially (typically its final word missing) passes every
  // span check above and would otherwise be reported "ready". Flag it so telemetry can measure the
  // gap; the tokens themselves are left alone — the repair pass owns re-asking for content.
  const uncoveredWords = findUncoveredLineWords(text, validated);

  // Degenerate granularity: a lone token spanning essentially the whole line (weak models emit
  // this for quote-wrapped lines like "Oh my God, who is she?"). Spans are legal and coverage is
  // perfect, so nothing else flags it — but a one-token line is useless for study. Only lines
  // with more than one word atom count: a genuinely single-word line ("Ayy") is fine as one
  // token. Mark degraded so the first pass re-asks the line; keeping it 'ready' would hide the
  // failure behind a perfect-looking coverage score.
  const isWholeLineSingleToken =
    validated.length === 1 &&
    validated[0].startChar === 0 &&
    validated[0].endChar >= text.length &&
    findUncoveredLineWords(text, []).length > 1;

  return {
    kind: 'ok',
    line: {
      lineId,
      text,
      translation: asTrimmedString(draft.translation),
      tokens: validated,
      status:
        validated.length < rawTokens.length || uncoveredWords.length > 0 || isWholeLineSingleToken
          ? 'degraded'
          : 'ready'
    },
    // Telemetry input: how many raw tokens validation rejected for this line.
    droppedTokenCount: rawTokens.length - validated.length,
    droppedTokens
  };
};

/** Converts the authoritative line text plus token spans into renderable segments. */
export const splitLineIntoTokens = (
  text: string,
  tokens: LyricsAnalysisToken[]
): Array<{ text: string; token?: LyricsAnalysisToken }> => {
  const segments: Array<{ text: string; token?: LyricsAnalysisToken }> = [];
  let cursor = 0;

  for (const token of [...tokens].sort((a, b) => a.startChar - b.startChar)) {
    if (token.startChar < cursor || token.endChar > text.length) continue;
    if (token.startChar > cursor) segments.push({ text: text.slice(cursor, token.startChar) });
    segments.push({ text: text.slice(token.startChar, token.endChar), token });
    cursor = token.endChar;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  return segments;
};

/**
 * Share of the line's non-whitespace characters covered by accepted token spans (0..1). Used by
 * telemetry as the cheapest proxy for analysis quality: a low value means the model skipped or
 * dropped chunks of the line.
 */
export const getLineTokenCoverage = (text: string, tokens: LyricsAnalysisToken[]): number => {
  let relevantCount = 0;
  let coveredCount = 0;

  const isCovered = new Set<number>();
  for (const token of tokens) {
    for (
      let index = Math.max(0, token.startChar);
      index < Math.min(text.length, token.endChar);
      index += 1
    )
      isCovered.add(index);
  }

  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index] ?? '')) continue;
    relevantCount += 1;
    if (isCovered.has(index)) coveredCount += 1;
  }

  if (relevantCount === 0) return 1;
  return Math.round((coveredCount / relevantCount) * 1000) / 1000;
};
