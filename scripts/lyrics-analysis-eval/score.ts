#!/usr/bin/env tsx
/**
 * score.ts — grade an analysis result against a gold standard with N independent LLM graders.
 *
 * The rubric's categories mirror what the human-annotated sheet (don't say lazy_Sheet1(1).pdf)
 * records for every token: segmentation, reading/pronunciation, dictionary form, part of speech,
 * in-context meaning, and the whole-line translation. Each grader is an independent LLM call that
 * receives the gold line and the produced line and returns strict JSON; the run score is the mean
 * across graders.
 *
 * Usage:
 *   tsx scripts/lyrics-analysis-eval/score.ts --analysis <analysis.json> \
 *     --gold <gold.json> [--graders 3] [--out <summary.json>] \
 *     [--base-url … --model … --api-key …]
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type LanguageModel } from 'ai';

import { aggregateCategoryMeans, aggregateOverallMean, aggregatePerCategory } from './lib/aggregate';
import { graderVerdictSchema } from './lib/graderSchema';
import {
  EVAL_CATEGORIES,
  type CategoryScore,
  type EvalAnalysisResult,
  type EvalCategory,
  type EvalLine,
  type GoldLine,
  type GoldStandard,
  type GraderVerdict
} from './types';

const CATEGORY_LABELS: Record<EvalCategory, string> = {
  tokenization: '分词（tokenization）— 词元的切分边界是否与金标准一致：该分开的分开（如「だから/たまに/そう/惚れる」）、该合并的合并（如「なんです」「already enough」这类句型/惯用是否成块）',
  pronunciation: '注音（pronunciation）— 假名/罗马音/音标是否正确（金标准的 kana/romaji 字段）',
  termAccuracy: '词典形（term）— card.term 是否给出正确的词典形/原型（如「見定めて」→「見定める」、「われた」→「割れる」）',
  meaningAccuracy: '语境义（meaning）— card.meaning 是否是这个语境下的意思，而非词典义堆砌（金标准的 meaning 字段）',
  grammarFunction: '语法功能（grammarFunction）— 是否正确说明该词在句中的角色（提示主语/提示宾语/连接词/表强调等，金标准的 pos 字段）',
  translation: '整行翻译（translation）— line.translation 是否自然且忠实于原句（金标准的 translation 字段）',
  posTagging: '词性（posTagging）— token.language 及 grammarFunction 里的词性标注是否与金标准的词性一致（名词/动词/助词/形容动词/接续词/句型…）'
};

const parseArgs = (argv: string[]) => {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const analysisPath = get('--analysis');
  const goldPath = get('--gold');
  if (!analysisPath || !goldPath) {
    console.error('Usage: tsx scripts/lyrics-analysis-eval/score.ts --analysis <analysis.json> --gold <gold.json> [--graders 3] [--out …] [--base-url … --model … --api-key …]');
    process.exit(1);
  }

  return {
    analysisPath,
    goldPath,
    graders: Number(get('--graders') ?? 3),
    out: get('--out'),
    baseURL: get('--base-url') ?? process.env.LYRICS_ANALYSIS_BASE_URL,
    modelId: get('--model') ?? process.env.LYRICS_ANALYSIS_GRADER_MODEL ?? 'qwen-flash',
    apiKey: get('--api-key') ?? process.env.LYRICS_ANALYSIS_API_KEY
  };
};

const readJson = async <T,>(filePath: string) =>
  JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;

/** Tokens rendered compactly so the grader sees both sides without drowning in JSON. */
const formatLine = (line: {
  text: string;
  translation?: string;
  tokens?: Array<{ text: string; term?: string; meaning?: string; grammarFunction?: string; pronunciation?: unknown }>;
}) => {
  const tokenRows = (line.tokens ?? []).map((token, index) => {
    const pron = token.pronunciation
      ? ` 注音=${JSON.stringify(token.pronunciation).slice(0, 60)}`
      : '';
    return `    ${index + 1}. "${token.text}" 词典形=${token.term ?? '—'} 语境义=${token.meaning ?? '—'} 语法=${token.grammarFunction ?? '—'}${pron}`;
  });
  return `  原文: ${line.text}\n  整行翻译: ${line.translation ?? '（无）'}\n${tokenRows.join('\n') || '    （无词元）'}`;
};

const buildGraderPrompt = (input: {
  goldLine: GoldLine;
  producedLine: EvalLine;
}) => {
  const gold = formatLine({
    text: input.goldLine.text,
    translation: input.goldLine.translation,
    tokens: input.goldLine.tokens.map((token) => ({
      text: token.text,
      term: token.term ?? token.kana ?? token.ipa,
      meaning: token.meaning,
      grammarFunction: token.pos,
      pronunciation: {
        kana: token.kana,
        romaji: token.romaji,
        ipa: token.ipa,
        pinyin: token.pinyin,
        romanized: token.romanized
      }
    }))
  });
  const produced = formatLine(input.producedLine);

  return [
    '你在为「歌词语言学习标注」的质量评分。给定同一句歌词的金标准标注（人类专家）与系统输出，按 7 个维度各打 0-10 分。',
    '',
    '维度定义:',
    ...Object.entries(CATEGORY_LABELS).map(([key, label]) => `- ${key}: ${label}`),
    '',
    '评分基准: 10=与金标准等价或更优; 7-9=大体正确有小瑕疵; 4-6=明显缺失或一半错误; 0-3=大面积错误或完全缺失。维度间独立打分。',
    '对每个维度: score 是数字, rationale 一句话引用具体 token 作为证据, examples 列出最多 3 个具体错例（无则省略）。',
    '缺失的维度按 0 分处理并在 rationale 里写明「输出未提供该信息」。',
    '',
    '金标准:',
    gold,
    '',
    '系统输出:',
    produced,
    '',
    'Return ONLY JSON: {"categoryScores":[{"category","score","rationale","examples"?}],"lineNotes"?:[…]}'
  ].join('\n');
};

const gradeOneLine = async (input: {
  model: LanguageModel;
  goldLine: GoldLine;
  producedLine: EvalLine;
}) => {
  try {
    const result = await generateText({
      model: input.model,
      prompt: buildGraderPrompt({ goldLine: input.goldLine, producedLine: input.producedLine }),
      temperature: 0,
      maxOutputTokens: 2000,
      providerOptions: { openai: { strictJsonSchema: false } }
    });

    const text = result.text.trim().replace(/^```(json)?|```$/g, '');
    const parsed = graderVerdictSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error(`  [score] grader JSON invalid: ${parsed.error.message.slice(0, 120)}`);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    console.error(`  [score] grader call failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.baseURL || !args.apiKey) {
    console.error('No grader credentials. Pass --base-url/--api-key or set LYRICS_ANALYSIS_BASE_URL / LYRICS_ANALYSIS_API_KEY.');
    process.exit(1);
  }

  const analysis = await readJson<EvalAnalysisResult>(args.analysisPath);
  const gold = await readJson<GoldStandard>(args.goldPath);

  const provider = createOpenAI({ apiKey: args.apiKey, baseURL: args.baseURL });
  const model = provider.chat(args.modelId);

  // For every gold line, find the produced line with the same normalized text (or by index order
  // as fallback), then grade the pair. Unmatched gold lines score 0 across categories.
  const producedByNorm = new Map(
    analysis.lines.map((line) => [line.text.replace(/\s+/g, ''), line])
  );

  const verdicts: GraderVerdict[] = [];

  for (let graderIndex = 0; graderIndex < args.graders; graderIndex += 1) {
    console.error(`[score] grader ${graderIndex + 1}/${args.graders} (${args.modelId})`);
    const categoryScores: CategoryScore[] = [];
    const lineScores: Array<{ lineId: string; note: string }> = [];

    for (const goldLine of gold.lines) {
      const key = goldLine.text.replace(/\s+/g, '');
      const produced = producedByNorm.get(key);
      const effectiveProduced: EvalLine = produced ?? {
        lineId: `missing:${key}`,
        text: goldLine.text,
        tokens: [],
        status: 'unavailable'
      };

      const verdict = await gradeOneLine({ model, goldLine, producedLine: effectiveProduced });
      if (!verdict) continue;

      for (const score of verdict.categoryScores) categoryScores.push(score);
      if (verdict.lineNotes) {
        for (const note of verdict.lineNotes) lineScores.push({ lineId: goldLine.text, note });
      }

      if (!produced) {
        categoryScores.push(
          ...EVAL_CATEGORIES.map((category) => ({
            category,
            score: 0,
            rationale: '输出中缺少该行'
          }))
        );
      }
    }

    const { categoryMean, overall } = aggregatePerCategory(categoryScores);

    verdicts.push({
      graderIndex,
      modelId: args.modelId,
      overall: Math.round(overall * 10) / 10,
      categoryScores,
      lineScores: lineScores.length > 0 ? lineScores : undefined,
      parsedAt: Date.now()
    });

    console.error(`  [score] grader ${graderIndex + 1} overall: ${verdicts[verdicts.length - 1]?.overall}/100`);
  }

  if (verdicts.length === 0) {
    console.error('[score] all graders failed');
    process.exit(1);
  }

  const categoryMeans = aggregateCategoryMeans(verdicts);
  const overallMean = aggregateOverallMean(verdicts);

  const runId = `${crypto.randomBytes(4).toString('hex')}`;
  const outPath =
    args.out ?? path.join(path.dirname(args.analysisPath), `eval-${runId}-summary.json`);

  const summary = {
    runId,
    startedAt: analysis.generatedAt,
    finishedAt: Date.now(),
    songTitle: analysis.songTitle,
    songArtists: analysis.songArtists,
    analysisSource: 'pipeline' as const,
    modelId: analysis.modelId,
    graderModelId: args.modelId,
    graderCount: verdicts.length,
    overallMean,
    categoryMeans,
    verdicts,
    reportPath: outPath.replace(/summary\.json$/, 'report.html')
  };

  await fs.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.error(`[score] wrote ${outPath}`);
  console.log(JSON.stringify({ overallMean, categoryMeans }, null, 2));
};

void main();
