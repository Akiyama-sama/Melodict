import type { LyricsAnalysisLanguage } from './lyricsAnalysis';

/**
 * Per-language prompt profiles for the lyrics-analysis pipeline.
 *
 * The gateways expose no reliable per-song language metadata (NCM exposes none), so language is
 * decided from the lyrics text itself: the caller counts the script families actually present in
 * the lyric lines and the matching profiles' guidance is injected into the prompt. A song mixing
 * Japanese and English lines gets both profiles — generalization is per language, not per song.
 *
 * Adding a language = adding one entry to LYRICS_LANGUAGE_PROFILES plus one script test in
 * SCRIPT_TESTS. Nothing else in the pipeline needs touching.
 */

export interface LyricsLanguageProfile {
  /** Human name used inside the prompt directive. */
  label: string;
  /** Pronunciation requirements, e.g. which script the pronunciation fields must carry. */
  pronunciationRule: string;
  /** Concrete tokenization guidance with examples from this language. */
  tokenizationRule: string;
  /** The closed POS vocabulary the prompt asks the model to use for this language. */
  posVocabulary: string[];
  /** Optional grammar-function examples that anchor the model's phrasing. */
  grammarExamples?: string[];
}

const JA_PROFILE: LyricsLanguageProfile = {
  label: 'Japanese',
  pronunciationRule:
    'card.pronunciation.kana = the full-word kana spelling (long vowels as ー) and card.pronunciation.romaji = the wapuro romaji of that kana, split exactly as the kana (しっかり → "shi kka ri"). Never omit pronunciation for a kana-bearing token.',
  tokenizationRule:
    'Split at particle boundaries and do not merge across them: 助詞 (は/が/を/に/で/も/と/から/まで/だけ/など) is always its own token. Keep one inflected verb/adjective together with its conjugation (見定めて = one token); never split an活用 stem from its ending. Sino-Japanese compounds (一致, 現実) are single tokens.',
  posVocabulary: [
    '名詞',
    '動詞',
    '形容詞',
    '形容動詞',
    '助詞',
    '助動詞',
    '副詞',
    '接続詞',
    '接尾語',
    '連体詞',
    '代名詞',
    '感動詞',
    '句型'
  ],
  grammarExamples: [
    'は/が → 提示主语',
    'を → 提示宾语',
    'に → 着落点/表对象',
    'で → 手段/场所',
    'か → 疑问',
    '〜のです/んです → 表强调'
  ]
};

const EN_PROFILE: LyricsLanguageProfile = {
  label: 'English',
  pronunciationRule:
    'card.pronunciation.ipa = the token\'s IPA in the US variety only: use ɑ/oʊ/ɚ/ɝ and flap-free r-colored vowels, never the British-only ɒ/əʊ/ɜː (gonna → /ˈɡɑnə/, not /ˈɡɒnə/; forever → /fərˈɛvər/). Contractions keep their apostrophe (don\'t → /doʊnt/). For a multi-word token give the IPA of the whole phrase.',
  tokenizationRule: [
    'One token per word. Default boundary = every space-separated word is its own token; only the rules below may join words.',
    'Never join: determiner + noun (the pain, a long list), adjective + noun, subject + predicate (we are reckless), preposition + pronoun (for me), or a word with its conjunction/adverb neighbour (you too).',
    'Join ONLY when the joined string is a lexical unit whose meaning is not derivable from its parts: phrasal verbs (go down, turn up, settle down, hold back), inseparable idioms (out of the blue, nothing but, came true), greetings (nice to meet you), and fused spellings (gonna, wanna, gotta).',
    'A phrasal verb stays whole across its particle: turn up is ONE token, never "to turn" + "up", and never "up out of the blue" — the particle belongs to its verb, the idiom starts fresh.',
    'Keep contractions and hyphenated compounds whole (don\'t, ex-lovers).'
  ].join(' '),
  posVocabulary: [
    'noun',
    'verb',
    'adjective',
    'adverb',
    'pronoun',
    'preposition',
    'conjunction',
    'auxiliary',
    'interjection',
    'article',
    'phrase'
  ],
  grammarExamples: [
    'be + past participle → passive voice',
    'to + verb → infinitive of purpose',
    'card.term for ANY verb/auxiliary form is the dictionary form: finite forms → base (was/were/been/is/are → be; could → can; gave → give), and every negative contraction → its expanded base (didn\'t → do not, isn\'t → be not, ain\'t → be not, couldn\'t → can not). Never echo the inflected or contracted surface as card.term.',
    'phrasal verb → the phrase itself as card.term (go down → go down)',
    'grammarFunction → start with the POS label itself (noun/verb/adjective/adverb/pronoun/preposition/conjunction/auxiliary/interjection/article/phrase), then the role (e.g. "verb, past tense predicate")'
  ]
};

const KO_PROFILE: LyricsLanguageProfile = {
  label: 'Korean',
  pronunciationRule:
    'card.pronunciation.hangul = the token text itself when it is already hangul; card.pronunciation.romanized = the RR (Revised Romanization) of the token.',
  tokenizationRule:
    'Split at 조사 (은/는/이/가/을/를/에/에서/도/만/부터/까지) boundaries: the particle is its own token. Keep verb/adjective stems together with their endings (같아 = one token). Sino-Korean compounds stay whole.',
  posVocabulary: ['명사', '동사', '형용사', '부사', '조사', '대명사', '감탄사', '관형사', '어미', '구문'],
  grammarExamples: ['은/는 → 提示主题', '이/가 → 提示主语', '을/를 → 提示宾语']
};

const ZH_PROFILE: LyricsLanguageProfile = {
  label: 'Chinese',
  pronunciationRule:
    'card.pronunciation.pinyin = the pinyin with tone marks for the token, at word level (温柔 → wēn róu).',
  tokenizationRule:
    'Split at word boundaries (词语), not per character: 双音节词 (世界, 温柔) are single tokens. 成语 and fixed phrases stay whole. 虚词 (的/了/吗/呢) are their own tokens when they carry grammar worth studying.',
  posVocabulary: ['名词', '动词', '形容词', '副词', '代词', '介词', '连词', '助词', '数词', '量词', '叹词'],
  grammarExamples: ['的 → 定语标记', '了 → 完成体', '吗 → 疑问语气']
};

const UNKNOWN_PROFILE: LyricsLanguageProfile = {
  label: 'the lyric language',
  pronunciationRule:
    'Include card.pronunciation only when the token has a standard romanization or phonetic transcription; otherwise omit the field.',
  tokenizationRule:
    'Split at natural word boundaries of the lyric language; keep inflected affixes together with their stem.',
  posVocabulary: [],
  grammarExamples: []
};

/**
 * Script detection, ordered by specificity: kana and hangul identify their language outright;
 * Han script alone is ambiguous (Japanese kanji / Korean hanja / Chinese hanzi) and is resolved
 * at the song level by analyzeLyricsLanguageMix below.
 */
type ScriptFamily = 'kana' | 'hangul' | 'han' | 'latin' | 'other';

const SCRIPT_TESTS: Array<{ family: ScriptFamily; test: RegExp }> = [
  { family: 'kana', test: /[\p{Script=Hiragana}\p{Script=Katakana}]/u },
  { family: 'hangul', test: /[가-힯]/u },
  { family: 'han', test: /\p{Script=Han}/u },
  { family: 'latin', test: /[A-Za-z]/u }
];

const detectLineScript = (text: string): ScriptFamily => {
  for (const { family, test } of SCRIPT_TESTS) {
    if (test.test(text)) return family;
  }
  return 'other';
};

/**
 * Dominant script language of one line. Note a Han-only line ('現実', '温柔') is ambiguous — the
 * song-level resolution in `analyzeLyricsLanguageMix` decides it; this returns 'zh' as the Han
 * default for standalone use (evaluation tooling, line attribution).
 */
export const detectLineLanguage = (text: string): LyricsAnalysisLanguage => {
  const script = detectLineScript(text);
  if (script === 'han') return 'zh';
  return FAMILY_TO_LANGUAGE[script];
};

const FAMILY_TO_LANGUAGE: Record<Exclude<ScriptFamily, 'han'>, LyricsAnalysisLanguage> = {
  kana: 'ja',
  hangul: 'ko',
  latin: 'en',
  other: 'unknown'
};

export interface LyricsLanguageMix {
  /** Resolved per-line languages, in input order. */
  lineLanguages: LyricsAnalysisLanguage[];
  /** Line counts per resolved language, non-zero entries only. */
  counts: Partial<Record<LyricsAnalysisLanguage, number>>;
  /** The most common resolved language of the song. */
  dominantLanguage: LyricsAnalysisLanguage;
  /** Languages actually present, most-used first; drives which profiles get injected. */
  activeLanguages: LyricsAnalysisLanguage[];
}

/**
 * Tallies the per-line language mix for a song. Han-script lines inherit the song's dominant
 * kana/hangul language (a Japanese song's kanji-only lines are Japanese, not Chinese); only a song
 * with no kana and no hangul treats Han script as Chinese. Pure function over text so both the
 * gateway (before dispatching to the worker) and evaluation tooling can use it.
 */
export const analyzeLyricsLanguageMix = (lines: Array<{ text: string }>): LyricsLanguageMix => {
  const lineScripts = lines.map((line) => detectLineScript(line.text));

  let kanaLines = 0;
  let hangulLines = 0;
  for (const script of lineScripts) {
    if (script === 'kana') kanaLines += 1;
    else if (script === 'hangul') hangulLines += 1;
  }

  // Song-level disambiguation for Han script: kanji rides with kana, hanja with hangul.
  const hanLanguage: LyricsAnalysisLanguage = kanaLines > 0 ? 'ja' : hangulLines > 0 ? 'ko' : 'zh';

  const lineLanguages = lineScripts.map((script) =>
    script === 'han' ? hanLanguage : FAMILY_TO_LANGUAGE[script]
  );

  const counts: Partial<Record<LyricsAnalysisLanguage, number>> = {};
  for (const language of lineLanguages) {
    counts[language] = (counts[language] ?? 0) + 1;
  }

  const activeLanguages = (Object.entries(counts) as Array<[LyricsAnalysisLanguage, number]>)
    .filter(([language]) => language !== 'unknown')
    .sort(([, a], [, b]) => b - a)
    .map(([language]) => language);

  return {
    lineLanguages,
    counts,
    dominantLanguage: activeLanguages[0] ?? 'unknown',
    activeLanguages
  };
};

export const LYRICS_LANGUAGE_PROFILES: Record<LyricsAnalysisLanguage, LyricsLanguageProfile> = {
  ja: JA_PROFILE,
  en: EN_PROFILE,
  ko: KO_PROFILE,
  zh: ZH_PROFILE,
  unknown: UNKNOWN_PROFILE
};

/**
 * Builds the per-song language directive block injected into the analysis prompt. Lists every
 * language actually present, dominant first, so a bilingual song gets both rule sets; lines
 * without any recognizable script fall back to the generic profile only when nothing else matched.
 */
export const buildLanguageDirective = (lines: Array<{ text: string }>): string => {
  const mix = analyzeLyricsLanguageMix(lines);
  if (mix.activeLanguages.length === 0) return '';

  const sections = mix.activeLanguages.map((language) => {
    const profile = LYRICS_LANGUAGE_PROFILES[language];
    const share = mix.counts[language] ?? 0;
    const posLine =
      profile.posVocabulary.length > 0
        ? ` Use only these POS labels for ${profile.label}: ${profile.posVocabulary.join('/')}.`
        : '';
    const grammarLine =
      profile.grammarExamples && profile.grammarExamples.length > 0
        ? ` Grammar-function phrasing examples: ${profile.grammarExamples.join('; ')}.`
        : '';
    return [
      `${profile.label} lines (${share} in this batch):`,
      `- Pronunciation: ${profile.pronunciationRule}`,
      `- Tokenization: ${profile.tokenizationRule.replace(/\.\s*$/, '')}.${posLine}${grammarLine}`
    ].join('\n');
  });

  return [
    'LANGUAGE-SPECIFIC RULES: each line follows only the rules of its own language (identified by its script).',
    ...sections
  ].join('\n\n');
};
