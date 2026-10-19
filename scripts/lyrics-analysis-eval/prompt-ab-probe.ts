/**
 * A/B probe: which v3 prompt addition degrades qwen-flash's element coverage?
 * Variants on the same 8 lines: (a) full v3, (b) directive only, (c) romanizedText only,
 * (d) plain v2. Prints element counts + tokens per line for each.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';
import {
  LYRICS_ANALYSIS_SCHEMA_VERSION,
  LYRICS_ANALYSIS_PROMPT_VERSION,
  type LyricsAnalysisInputLine
} from '../../src/common/lyricsAnalysis';

// Keep a private copy so variants can strip fields without touching the module under test.
const buildVariantSystemPrompt = (
  uiLanguage: string,
  variant: 'full' | 'directive-only' | 'roma-only' | 'v2'
) => {
  // Mirror of the gateway template; variant-gated additions are marked below.
  const base = [
    'You annotate song lyrics for a language-learning music player.',
    'Return ONLY a JSON object. Do not wrap it in markdown fences and do not add any prose before or after it.',
    'The JSON must have this shape: {"elements":[{"lineId":"...","translation":"...","tokens":[...]}]}',
    'Rules:',
    '- Echo back the exact lineId you were given. Never invent lineIds and never rewrite the lyric text.',
    '- Split each line into 1-6 clickable learning tokens: words, particles, set phrases, or inflections worth studying.',
    '- startChar/endChar are 0-based character offsets into that exact line, endChar exclusive. They must be ordered, non-overlapping, and within the line length.',
    '- Every token needs card.meaning (what it means in this line, not a dictionary dump) and card.grammarFunction (its role in this sentence).',
    '- Include card.term (dictionary form) and card.pronunciation when useful: kana/romaji for Japanese, ipa/us/uk for English, hangul/romanized for Korean, pinyin for Chinese.',
    '- Set language to one of: en, ja, ko, zh, unknown.',
    '- translation is the natural meaning of the whole line.',
    '- Cover every line you are given, in the given order.',
    'OUTPUT LANGUAGE (critical): every value the user reads — card.meaning, card.grammarFunction, and translation — MUST be written in Simplified Chinese (简体中文). Never switch languages between elements: the first element and the last element use the same language. Do not mix languages within one JSON object.',
    'The only exceptions are quoted source-language words inside a meaning (e.g. the lyric word itself) and the pronunciation fields, which stay in their script.'
  ];

  if (variant === 'roma-only' || variant === 'full') {
    base.push(
      'ROMANIZED REFERENCE: some lines carry a "romanizedText" field — a HUMAN-AUTHORED romanization of that exact line. Use it as the ground truth for pronunciation: for each of your tokens, copy the matching segment(s) of the reference into card.pronunciation (keep the author\'s spacing). Do NOT change token granularity to match it — keep your normal word/particle-level tokens (1-6 per line); the reference is pronounced syllable-by-syllable but your tokens are not.'
    );
  }

  let directive = '';
  if (variant === 'directive-only' || variant === 'full') {
    // Import lazily to keep the probe self-contained.
    const { buildLanguageDirective } = require('../../src/common/lyricsLanguageProfiles') as {
      buildLanguageDirective: (lines: Array<{ text: string }>) => string;
    };
    directive = buildLanguageDirective(probeLines);
  }

  return `${base.join('\n')}${directive ? `\n\n${directive}` : ''}`;
};

const TIMED = fs
  .readFileSync('/tmp/dont-say-lazy-timed-clean.lrc', 'utf-8')
  .split('\n')
  .filter((line) => line.trim().length > 0);
const ROMA = fs
  .readFileSync('/tmp/dont-say-lazy-romalrc.lrc', 'utf-8')
  .split('\n')
  .map((line) => line.replace(/^\s*\[(\d+):(\d+)(?:\.(\d+))?\]\s*/, '').trim())
  .filter((line) => line.length > 0 && !/^\[[a-z]+:/.test(line));

const TS = /^\[(\d+):(\d+)(?:\.(\d+))?\]/;
const probeLines: LyricsAnalysisInputLine[] = TIMED.slice(0, 8).map((line, index) => {
  const text = line.replace(TS, '').trim();
  return {
    lineId: `line-${index}`,
    text,
    romanizedText: ROMA[index]
  };
});

const readCreds = () => {
  const env = fs.readFileSync('/tmp/eval-creds.env', 'utf-8');
  const get = (key: string) =>
    new RegExp(`^(?:export\\s+)?${key}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';
  return {
    baseURL: get('LYRICS_ANALYSIS_BASE_URL') ?? '',
    apiKey: get('LYRICS_ANALYSIS_API_KEY') ?? ''
  };
};

const runVariant = async (variant: 'full' | 'directive-only' | 'roma-only' | 'v2') => {
  const { baseURL, apiKey } = readCreds();
  const { buildLanguageDirective: directiveFor } = await import('../../src/common/lyricsLanguageProfiles');

  const directive = variant === 'directive-only' || variant === 'full' ? directiveFor(probeLines) : '';
  const withRomaRule = variant === 'roma-only' || variant === 'full';

  const base = [
    'You annotate song lyrics for a language-learning music player.',
    'Return ONLY a JSON object. Do not wrap it in markdown fences and do not add any prose before or after it.',
    'The JSON must have this shape: {"elements":[{"lineId":"...","translation":"...","tokens":[...]}]}',
    'Rules:',
    '- Echo back the exact lineId you were given. Never invent lineIds and never rewrite the lyric text.',
    '- Split each line into 1-6 clickable learning tokens: words, particles, set phrases, or inflections worth studying.',
    '- startChar/endChar are 0-based character offsets into that exact line, endChar exclusive. They must be ordered, non-overlapping, and within the line length.',
    '- Every token needs card.meaning (what it means in this line, not a dictionary dump) and card.grammarFunction (its role in this sentence).',
    '- Include card.term (dictionary form) and card.pronunciation when useful: kana/romaji for Japanese, ipa/us/uk for English, hangul/romanized for Korean, pinyin for Chinese.',
    '- Set language to one of: en, ja, ko, zh, unknown.',
    '- translation is the natural meaning of the whole line.',
    '- Cover every line you are given, in the given order.',
    'OUTPUT LANGUAGE (critical): every value the user reads — card.meaning, card.grammarFunction, and translation — MUST be written in Simplified Chinese (简体中文). Never switch languages between elements: the first element and the last element use the same language. Do not mix languages within one JSON object.',
    'The only exceptions are quoted source-language words inside a meaning (e.g. the lyric word itself) and the pronunciation fields, which stay in their script.'
  ];
  if (withRomaRule) {
    base.push(
      'ROMANIZED REFERENCE: some lines carry a "romanizedText" field — a HUMAN-AUTHORED romanization of that exact line. Use it as the ground truth for pronunciation: for each of your tokens, copy the matching segment(s) of the reference into card.pronunciation (keep the author\'s spacing). Do NOT change token granularity to match it — keep your normal word/particle-level tokens (1-6 per line); the reference is pronounced syllable-by-syllable but your tokens are not.'
    );
  }

  const { createOpenAI } = await import('@ai-sdk/openai');
  const { streamText, Output } = await import('ai');
  const { lyricsAnalysisTransportSchema } = await import('../../src/common/lyricsAnalysis');

  const provider = createOpenAI({ apiKey, baseURL: baseURL.replace(/\/+$/, '') });
  const model = provider.chat('qwen-flash');

  // A true v2 baseline sends no romanizedText at all — the unexplained field itself is a variable.
  const linesToSend =
    variant === 'directive-only' || variant === 'v2'
      ? probeLines.map(({ romanizedText: _r, ...rest }) => rest)
      : probeLines;

  const result = streamText({
    model,
    system: `${base.join('\n')}${directive ? `\n\n${directive}` : ''}`,
    prompt: JSON.stringify(
      {
        uiLanguage: 'zh-CN',
        songTitle: "Don't say lazy",
        songArtists: ['放課後ティータイム'],
        lines: linesToSend
      },
      null,
      2
    ),
    temperature: 0,
    maxOutputTokens: 5000,
    providerOptions: { openai: { strictJsonSchema: false } },
    output: Output.array({ element: lyricsAnalysisTransportSchema, name: 'lyric_lines', description: 'One annotated lyric line' })
  });

  const counts = new Map<string, number>();
  let elementCount = 0;
  for await (const element of result.elementStream) {
    elementCount += 1;
    const id = String(element.lineId ?? '?');
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const summary = [...counts.entries()].map(([id, n]) => `${id}:${n}`).join(' ');
  console.log(
    `[${variant}] elements=${elementCount} (targets=8) linesCovered=${counts.size} perLine=[${summary}]`
  );
};

const main = async () => {
  for (const variant of ['v2', 'directive-only', 'roma-only', 'full'] as const) {
    try {
      await runVariant(variant);
    } catch (error) {
      console.log(`[${variant}] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
