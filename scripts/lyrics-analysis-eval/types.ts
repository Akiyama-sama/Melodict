/**
 * Shared contracts for the lyrics-analysis evaluation harness (scripts/lyrics-analysis-eval/).
 *
 * The harness is invoked by the `lyrics-eval` user-level skill: it fetches a song's lyrics, runs
 * them through the production analysis pipeline (providerGateway), scores the output against a
 * gold standard with N independent LLM graders, and emits a self-contained HTML report.
 *
 * Nothing in this folder may import Electron modules — it runs under plain tsx.
 */

/** One annotated token, matching the production LyricsAnalysisToken shape (subset it scores). */
export interface EvalToken {
  text: string;
  startChar: number;
  endChar: number;
  language?: string;
  /** Dictionary form (card.term). */
  term?: string;
  /** Context meaning (card.meaning). */
  meaning?: string;
  /** Grammar role (card.grammarFunction). */
  grammarFunction?: string;
  pronunciation?: Record<string, string>;
}

/** One analyzed line, mirroring the production LyricsAnalysisLine. */
export interface EvalLine {
  lineId: string;
  text: string;
  translation?: string;
  tokens: EvalToken[];
  status: string;
  /** Validation rejects, if the pipeline reported them. */
  droppedTokenCount?: number;
}

/** A full analysis output for one song — what the pipeline + cache produce. */
export interface EvalAnalysisResult {
  songTitle: string;
  songArtists: string[];
  uiLanguage: string;
  modelId: string;
  generatedAt: number;
  lines: EvalLine[];
  /** Per-batch telemetry captured during a fresh pipeline run (absent for cached reads). */
  passes?: Array<{
    passKind: 'first' | 'repair';
    targetLines: number;
    okLines: number;
    failedLines: number;
    durationMs: number;
    outputTokens?: number | null;
  }>;
}

/**
 * One gold token transcribed from the human-annotated PDF (don't say lazy_Sheet1(1).pdf): each
 * token carries romaji, kana reading, dictionary form, part of speech, and the in-context gloss.
 */
export interface GoldToken {
  /** Surface text as it appears (reconstructed) in the lyric line. */
  text: string;
  romaji?: string;
  kana?: string;
  /** IPA (US) for English tokens; the equivalent of kana/romaji for Japanese. */
  ipa?: string;
  /** Pinyin for Chinese tokens. */
  pinyin?: string;
  /** Revised Romanization for Korean tokens. */
  romanized?: string;
  /** Dictionary form; the PDF color-codes it (e.g. 飛り切って for ふりきって). */
  term?: string;
  /** Part of speech from the PDF (名詞/助詞/動詞/形容詞/副詞/句型...). */
  pos?: string;
  /** In-context Chinese gloss from the PDF's bottom row of each token cell. */
  meaning?: string;
  /** Inflection note like 「て形」「[{て形]」 when the PDF marks one. */
  inflection?: string;
}

export interface GoldLine {
  text: string;
  tokens: GoldToken[];
  /** Whole-line translation from the PDF. */
  translation?: string;
}

export interface GoldStandard {
  songTitle: string;
  songArtists: string[];
  source: string;
  lines: GoldLine[];
}

export const EVAL_CATEGORIES = [
  'tokenization',
  'pronunciation',
  'termAccuracy',
  'meaningAccuracy',
  'grammarFunction',
  'translation',
  'posTagging'
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

/** One grader's score for one category on one line. */
export interface CategoryScore {
  category: EvalCategory;
  /** 0-10. */
  score: number;
  /** Short justification citing concrete tokens. */
  rationale: string;
  /** Example mismatches the grader saw, for the report. */
  examples?: string[];
}

export interface GraderVerdict {
  graderIndex: number;
  modelId: string;
  /** Overall 0-100 = mean of category scores × 10. */
  overall: number;
  categoryScores: CategoryScore[];
  lineScores?: Array<{ lineId: string; note: string }>;
  parsedAt: number;
}

/** Final aggregated result persisted as <runDir>/summary.json. */
export interface EvalRunSummary {
  runId: string;
  startedAt: number;
  finishedAt: number;
  songTitle: string;
  songArtists: string[];
  analysisSource: 'pipeline' | 'cache';
  modelId: string;
  graderModelId: string;
  graderCount: number;
  /** Mean of the graders' overall scores. */
  overallMean: number;
  /** Per-category mean across graders, 0-10. */
  categoryMeans: Record<EvalCategory, number>;
  verdicts: GraderVerdict[];
  reportPath: string;
}
