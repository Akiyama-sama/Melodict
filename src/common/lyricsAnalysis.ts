import { z } from 'zod';

// Bumped to '2' when the normalizer gained word-boundary snapping + whitespace trimming: cached
// artifacts from v1 carry misaligned token spans that would render clipped words.
export const LYRICS_ANALYSIS_SCHEMA_VERSION = '2';
// Bumped to '3' with the language-profile directive and the romanized-reference rule: cached
// artifacts from v2 were produced without per-language guidance and without the human romaji
// reference, so their tokenization/pronunciation quality no longer matches what the prompt asks for.
export const LYRICS_ANALYSIS_PROMPT_VERSION = '3';
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
}

export interface LyricsAnalysisProviderTestResult {
  ok: boolean;
  message: string;
  statusCode?: number;
  latencyMs: number;
  errorCode?: LyricsAnalysisErrorCode;
}

/**
 * Schema attached to `Output.array` in the worker. It is intentionally lenient: every token field is
 * optional, so a semantically broken token survives transport and reaches app-side validation,
 * where we know *why* it failed. A strict schema here would make the SDK silently drop the whole
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

const KANA_REGEX = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_REGEX = /\p{Script=Han}/u;
const HANGUL_REGEX = /[가-힯]/u;

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
  if (KANA_REGEX.test(text)) return 'ja';
  if (HANGUL_REGEX.test(text)) return 'ko';
  if (HAN_REGEX.test(text)) return 'zh';
  if (/[A-Za-z]/.test(text)) return 'en';
  return 'unknown';
};

export const buildTokenId = (lineId: string, startChar: number, endChar: number) =>
  `${lineId}:${startChar}-${endChar}`;

export const getFallbackMeaning = (lineText: string, tokenText: string) =>
  `在这句歌词“${lineText}”里，更接近“${tokenText}”这层意思。`;

export const getFallbackGrammarFunction = () => '歌词中的表达成分';

export type LineValidationOutcome =
  | { kind: 'ok'; line: LyricsAnalysisLine; droppedTokenCount: number }
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

  for (const rawToken of rawTokens) {
    const startChar = asInteger(rawToken?.startChar);
    const endChar = asInteger(rawToken?.endChar);

    if (startChar === undefined || endChar === undefined) continue;
    if (startChar < 0 || endChar <= startChar || endChar > text.length) continue;

    // Models sometimes stop a token mid-word (e.g. "self-cont" of "self-control"); snap the span
    // out to full word boundaries so Latin words never get cut apart. Deliberately Latin-only:
    // extending across CJK characters (all \p{L}) would fuse whole lines into one token.
    const WORD_CHARS = /[A-Za-z0-9'’-]/;
    let fixedStart = startChar;
    let fixedEnd = endChar;
    while (fixedStart > 0 && WORD_CHARS.test(text[fixedStart - 1] ?? '') && WORD_CHARS.test(text[fixedStart] ?? '')) {
      fixedStart -= 1;
    }
    while (fixedEnd < text.length && WORD_CHARS.test(text[fixedEnd] ?? '') && WORD_CHARS.test(text[fixedEnd - 1] ?? '')) {
      fixedEnd += 1;
    }

    // Trim whitespace the model swept into the span so underlines never cover stray spaces.
    while (fixedStart < fixedEnd && /\s/.test(text[fixedStart] ?? '')) fixedStart += 1;
    while (fixedEnd > fixedStart && /\s/.test(text[fixedEnd - 1] ?? '')) fixedEnd -= 1;

    const tokenText = text.slice(fixedStart, fixedEnd);
    if (tokenText.trim().length === 0) continue;

    const spanKey = `${fixedStart}-${fixedEnd}`;
    if (seenSpans.has(spanKey)) continue;

    // Reject overlaps: keep whichever token was emitted first for the overlapping region.
    const overlaps = validated.some(
      (token) => fixedStart < token.endChar && fixedEnd > token.startChar
    );
    if (overlaps) continue;

    seenSpans.add(spanKey);

    const rawLanguage = asTrimmedString(rawToken?.language) as LyricsAnalysisLanguage | undefined;
    const language =
      rawLanguage && LANGUAGES.includes(rawLanguage)
        ? rawLanguage
        : inferTokenLanguage(tokenText);

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
          romanized: asTrimmedString(pronunciation?.romanized)
        },
        meaning:
          asTrimmedString(card?.meaning) ?? getFallbackMeaning(text, tokenText),
        grammarFunction:
          asTrimmedString(card?.grammarFunction) ?? getFallbackGrammarFunction()
      }
    });
  }

  if (validated.length === 0) return { kind: 'failed', lineId, reason: 'no-valid-tokens' };

  validated.sort((a, b) => a.startChar - b.startChar);

  return {
    kind: 'ok',
    line: {
      lineId,
      text,
      translation: asTrimmedString(draft.translation),
      tokens: validated,
      status: validated.length < rawTokens.length ? 'degraded' : 'ready'
    },
    // Telemetry input: how many raw tokens validation rejected for this line.
    droppedTokenCount: rawTokens.length - validated.length
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
    for (let index = Math.max(0, token.startChar); index < Math.min(text.length, token.endChar); index += 1)
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
