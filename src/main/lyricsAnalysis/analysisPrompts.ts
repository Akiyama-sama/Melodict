import { type LyricsAnalysisInputLine } from '../../common/lyricsAnalysis';

export const SYSTEM_PROMPT_TEMPLATE = [
  'You annotate song lyrics for a language-learning music player.',
  'Return ONLY a JSON object. Do not wrap it in markdown fences and do not add any prose before or after it.',
  'The JSON must have this shape: {"elements":[{"lineId":"...","translation":"...","tokens":[...]}]}',
  'Rules:',
  '- Echo back the exact lineId you were given. Never invent lineIds and never rewrite the lyric text.',
  '- Split each line into 1-6 clickable learning tokens: words, particles, set phrases, or inflections worth studying.',
  // The surface text is the token\'s identity: offsets are the field models miscount, and a phrase
  // token ("settled down") whose span only covers its first word silently loses the rest of the
  // phrase. The validator re-anchors spans from this text, so it must be exact and present.
  '- Every token MUST include "text": the exact substring of the line that the token covers, copied verbatim (same spelling, punctuation and spacing). It must equal the line slice from startChar to endChar.',
  '- The tokens of a line must cover the whole line: every word of the lyric belongs to exactly one token, including the last word. Never drop a trailing word or particle.',
  '- startChar/endChar are 0-based character offsets into that exact line, endChar exclusive. They must be ordered, non-overlapping, and within the line length.',
  '- Every token needs card.meaning (what it means in this line, not a dictionary dump) and card.grammarFunction (its role in this sentence).',
  '- Include card.term (dictionary form) and card.pronunciation when useful: kana/romaji for Japanese, ipa/us/uk for English, hangul/romanized for Korean, pinyin for Chinese.',
  '- Set language to one of: en, ja, ko, zh, unknown.',
  '- translation is the natural meaning of the whole line.',
  '- Cover every line you are given, in the given order.',
  // Language discipline: without an explicit per-request instruction, models drift between
  // output languages mid-song (first lines English, later lines Chinese) because nothing in the
  // prompt pins the gloss language to the user's UI language.
  'OUTPUT LANGUAGE (critical): every value the user reads — card.meaning, card.grammarFunction, and translation — MUST be written in %OUTPUT_LANGUAGE%. Never switch languages between elements: the first element and the last element use the same language. Do not mix languages within one JSON object.',
  'The only exceptions are quoted source-language words inside a meaning (e.g. the lyric word itself) and the pronunciation fields, which stay in their script.',
  // Human romanization reference: when the source provides one, it outranks the model's own
  // romanization knowledge — copy it verbatim instead of re-deriving. Token granularity stays
  // word/particle level; the reference must never be read as a per-syllable tokenization cue
  // (observed: the model started emitting one token per mora and produced single-token lines).
  'ROMANIZED REFERENCE: some lines carry a "romanizedText" field — a HUMAN-AUTHORED romanization of that exact line. Use it as the ground truth for pronunciation: for each of your tokens, copy the matching segment(s) of the reference into card.pronunciation (keep the author\'s spacing). Do NOT change token granularity to match it — keep your normal word/particle-level tokens (1-6 per line); the reference is pronounced syllable-by-syllable but your tokens are not.'
].join('\n');

const OUTPUT_LANGUAGE_BY_UI_LANGUAGE: Record<string, string> = {
  zh: 'Simplified Chinese (简体中文)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)'
};

const getOutputLanguageDirective = (uiLanguage: string) => {
  const normalized = (uiLanguage || 'en').toLowerCase();
  return (
    OUTPUT_LANGUAGE_BY_UI_LANGUAGE[normalized] ??
    OUTPUT_LANGUAGE_BY_UI_LANGUAGE[normalized.split('-')[0] ?? ''] ??
    `English (the UI language code was ${uiLanguage}; default to English)`
  );
};

export const buildSystemPrompt = (uiLanguage: string, languageDirective?: string) =>
  SYSTEM_PROMPT_TEMPLATE.replace(
    '%OUTPUT_LANGUAGE%',
    getOutputLanguageDirective(uiLanguage)
  ) + (languageDirective ? `\n\n${languageDirective}` : '');

export const buildUserPrompt = (input: {
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
}) =>
  JSON.stringify(
    {
      uiLanguage: input.uiLanguage,
      outputLanguageRequirement: `All human-readable fields (meaning, grammarFunction, translation) must be in ${getOutputLanguageDirective(input.uiLanguage)}, consistently for every element.`,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      lines: input.lines
    },
    null,
    2
  );

export const buildRepairPrompt = (input: {
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: Array<LyricsAnalysisInputLine & { reason: string }>;
}) =>
  JSON.stringify(
    {
      uiLanguage: input.uiLanguage,
      outputLanguageRequirement: `All human-readable fields (meaning, grammarFunction, translation) must be in ${getOutputLanguageDirective(input.uiLanguage)}, consistently for every element.`,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      task:
        'A previous pass failed on these lines. Return corrected analysis for exactly these lineIds only. When reason is "incomplete-coverage", the previous output missed words of the line (usually the last one) — this time cover every word of the line, including the final one, and give every token its exact "text".',
      lines: input.lines
    },
    null,
    2
  );
