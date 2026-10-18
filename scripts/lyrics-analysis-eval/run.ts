#!/usr/bin/env tsx
/**
 * run.ts — one-command evaluation loop used by the user-level `lyrics-eval` skill.
 *
 * Pipeline: lyrics file → production analysis pipeline (analyze.ts logic, in-process) →
 * N qwen graders (score.ts logic, in-process) → summary.json + self-contained report.html.
 * A cached analysis for the same fingerprint is reused unless --refresh is passed.
 *
 * Usage:
 *   tsx scripts/lyrics-analysis-eval/run.ts --lyrics <file.lrc> --gold <gold.json> \
 *     [--title …] [--artist …] [--graders 3] [--refresh] [--dir <runDir>] \
 *     [--base-url … --model … --api-key …] [--grader-model …]
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';

import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';
import { EVAL_CATEGORIES, type CategoryScore, type EvalAnalysisResult, type EvalCategory, type EvalLine, type GoldStandard, type GraderVerdict } from './types';

const graderVerdictSchema = z.object({
  categoryScores: z.array(
    z.object({
      category: z.enum(EVAL_CATEGORIES),
      score: z.number().min(0).max(10),
      rationale: z.string(),
      examples: z.array(z.string()).optional()
    })
  ),
  lineNotes: z.array(z.string()).optional()
});

const CATEGORY_LABELS: Record<EvalCategory, string> = {
  tokenization: '分词（tokenization）— 词元切分边界是否与金标准一致（该分的分、该合的合，句型/惯用成块）',
  pronunciation: '注音（pronunciation）— 假名/罗马音/音标是否正确',
  termAccuracy: '词典形（term）— card.term 是否为正确的词典形/原型',
  meaningAccuracy: '语境义（meaning）— 是否为该语境下的意思而非词典义堆砌',
  grammarFunction: '语法功能（grammarFunction）— 是否说明该词在句中的角色',
  translation: '整行翻译（translation）— 是否自然且忠实',
  posTagging: '词性（posTagging）— 词性标注是否与金标准一致'
};

const parseArgs = (argv: string[]) => {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const lyricsPath = get('--lyrics');
  const goldPath = get('--gold');
  if (!lyricsPath || !goldPath) {
    console.error('Usage: tsx scripts/lyrics-analysis-eval/run.ts --lyrics <file.lrc> --gold <gold.json> [--title …] [--artist …] [--graders 3] [--refresh] [--dir …] [--base-url … --model … --api-key …] [--grader-model …]');
    process.exit(1);
  }
  return {
    lyricsPath,
    goldPath,
    title: get('--title') ?? path.basename(lyricsPath, path.extname(lyricsPath)),
    artists: (get('--artist') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    graders: Number(get('--graders') ?? 3),
    refresh: argv.includes('--refresh'),
    dir: get('--dir'),
    baseURL: get('--base-url') ?? process.env.LYRICS_ANALYSIS_BASE_URL,
    modelId: get('--model') ?? process.env.LYRICS_ANALYSIS_MODEL,
    apiKey: get('--api-key') ?? process.env.LYRICS_ANALYSIS_API_KEY,
    graderModelId: get('--grader-model') ?? process.env.LYRICS_ANALYSIS_GRADER_MODEL ?? 'qwen-flash'
  };
};

const parseLrcLines = async (filePath: string) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*\[(\d+):(\d+)([.:]\d+)?\]\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^\[[a-z]+:/.test(line));
};

const readStoredCredentials = async () => {
  const configPath = path.join(
    process.env.HOME ?? '',
    'Library/Application Support/nora/lyrics-analysis-providers.json'
  );
  try {
    const state = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      activeProfileId?: string;
      profiles: Array<{ id: string; baseURL: string; modelId: string; apiKeyPlain?: string }>;
    };
    const active = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
    return active ? { baseURL: active.baseURL, modelId: active.modelId, apiKey: active.apiKeyPlain } : undefined;
  } catch {
    return undefined;
  }
};

/** Mirror of the app's fingerprint: hash(lines + uiLanguage + model + prompt/schema versions). */
const buildFingerprint = (input: { lines: Array<{ lineId: string; text: string }>; uiLanguage: string; modelId: string; promptVersion: string; schemaVersion: string }) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        lines: input.lines,
        uiLanguage: input.uiLanguage,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion
      })
    )
    .digest('hex');

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const stored = await readStoredCredentials();
  const baseURL = args.baseURL ?? stored?.baseURL;
  const modelId = args.modelId ?? stored?.modelId ?? 'qwen-flash';
  const apiKey = args.apiKey ?? stored?.apiKey;
  if (!baseURL || !apiKey) {
    console.error('No API credentials. Pass --base-url/--api-key or set LYRICS_ANALYSIS_BASE_URL / LYRICS_ANALYSIS_API_KEY.');
    process.exit(1);
  }

  const runDir =
    args.dir ??
    path.join(
      process.cwd(),
      'eval-runs',
      `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${crypto.randomBytes(2).toString('hex')}`
    );
  await fs.mkdir(runDir, { recursive: true });

  const lines = (await parseLrcLines(args.lyricsPath)).map((text, index) => ({
    lineId: `line-${index}`,
    text
  }));
  const gold = JSON.parse(await fs.readFile(args.goldPath, 'utf-8')) as GoldStandard;

  // ---- Stage 1: analysis (cached unless --refresh) ------------------------------------------
  const fingerprint = buildFingerprint({
    lines,
    uiLanguage: 'zh-CN',
    modelId,
    promptVersion: '2',
    schemaVersion: '2'
  });
  const cachePath = path.join(runDir, 'analysis.json');
  let analysis: EvalAnalysisResult;
  let analysisSource: 'pipeline' | 'cache' = 'cache';

  if (!args.refresh) {
    try {
      analysis = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as EvalAnalysisResult;
      console.error(`[run] reused cached analysis (${analysis.lines.length} lines)`);
    } catch {
      analysis = undefined as unknown as EvalAnalysisResult;
    }
  }

  if (!analysis) {
    analysisSource = 'pipeline';
    console.error(`[run] analyzing ${lines.length} lines with ${modelId} …`);
    const passes: NonNullable<EvalAnalysisResult['passes']> = [];
    const startedAt = Date.now();
    const outcome = await analyzeLyrics({
      config: { baseURL, modelId, apiKey },
      uiLanguage: 'zh-CN',
      songTitle: args.title,
      songArtists: args.artists,
      lines,
      onLine: (line, source) =>
        console.error(`  [run] ${source} ${line.lineId}: ${line.tokens.length} tokens`),
      onPassCompleted: (pass) =>
        passes.push({
          passKind: pass.passKind,
          targetLines: pass.targetLines,
          okLines: pass.okLines,
          failedLines: pass.failedLines,
          durationMs: pass.durationMs,
          outputTokens: pass.outputTokens
        })
    });
    analysis = {
      songTitle: args.title,
      songArtists: args.artists,
      uiLanguage: 'zh-CN',
      modelId,
      generatedAt: startedAt,
      lines: outcome.lines as EvalLine[],
      passes
    };
    await fs.writeFile(cachePath, JSON.stringify(analysis, null, 2), 'utf-8');
  }

  // ---- Stage 2: grading with N graders -------------------------------------------------------
  console.error(`[run] grading with ${args.graders}× ${args.graderModelId} …`);
  const provider = createOpenAI({ apiKey, baseURL });
  const graderModel = provider.chat(args.graderModelId);

  /**
   * The PDF's teaching units cut lines differently from any streaming lyrics source (e.g. the PDF
   * has 「だから たまに そう 惚れる」 where the LRC has 「だからたまに休憩しちゃうんです」), so exact text
   * matching pairs almost nothing. Align by character overlap instead: each gold line takes the
   * produced line with the highest normalized character-intersection ratio (≥0.5 to accept).
   */
  const normalize = (text: string) => text.replace(/[\s　()（）""]/g, '').replace(/は\(wa\)/g, 'は');
  const producedCandidates = analysis.lines.map((line) => ({
    line,
    norm: normalize(line.text),
    chars: new Set(normalize(line.text))
  }));

  const alignGoldToProduced = (goldLine: GoldLine): { line: EvalLine; overlap: number } | undefined => {
    const goldChars = new Set(normalize(goldLine.text));
    let best: { line: EvalLine; overlap: number } | undefined;
    for (const candidate of producedCandidates) {
      let hits = 0;
      for (const char of goldChars) if (candidate.chars.has(char)) hits += 1;
      const overlap = hits / Math.max(1, goldChars.size);
      if (!best || overlap > best.overlap) best = { line: candidate.line, overlap };
    }
    return best && best.overlap >= 0.5 ? best : undefined;
  };

  const verdicts: GraderVerdict[] = [];
  for (let graderIndex = 0; graderIndex < args.graders; graderIndex += 1) {
    const categoryScores: CategoryScore[] = [];
    const lineScores: Array<{ lineId: string; note: string }> = [];

    for (const goldLine of gold.lines) {
      const aligned = alignGoldToProduced(goldLine);
      const produced: EvalLine = aligned?.line ?? {
        lineId: `missing:${normalize(goldLine.text)}`,
        text: goldLine.text,
        tokens: [],
        status: 'unavailable'
      };

      const goldView = {
        text: goldLine.text,
        translation: goldLine.translation,
        tokens: goldLine.tokens.map((token) => ({
          text: token.text,
          term: token.term ?? token.kana,
          meaning: token.meaning,
          grammarFunction: token.pos,
          pronunciation: { kana: token.kana, romaji: token.romaji }
        }))
      };
      const producedView = {
        text: produced.text,
        translation: produced.translation,
        tokens: produced.tokens.map((token) => ({
          text: token.text,
          term: token.card?.term ?? token.term,
          meaning: token.card?.meaning ?? token.meaning,
          grammarFunction: token.card?.grammarFunction ?? token.grammarFunction,
          pronunciation: token.pronunciation
        }))
      };

      try {
        const result = await generateText({
          model: graderModel,
          temperature: 0,
          // The gateway clamps per-request output tokens (~1200 observed); stay well under it and
          // keep rationales terse so the verdict JSON never hits the cap.
          maxOutputTokens: 900,
          providerOptions: { openai: { strictJsonSchema: false } },
          prompt: [
            '为「歌词语言学习标注」评分。金标准（人类专家）vs 系统输出，按 7 维度各打 0-10。',
            '维度: ' + Object.entries(CATEGORY_LABELS).map(([key, label]) => `${key}=${label.split('—')[1] ?? label}`).join('; '),
            '基准: 10=等价或更优; 7-9=小瑕疵; 4-6=一半错误; 0-3=大面积错误/缺失。缺失信息按 0 分。',
            '每个维度 rationale ≤15 字，不给 examples。',
            '',
            `金标准: ${JSON.stringify(goldView)}`,
            `系统输出: ${JSON.stringify(producedView)}`,
            '',
            'Return ONLY compact JSON: {"categoryScores":[{"category","score","rationale"}]}'
          ].join('\n')
        });

        const text = result.text.trim().replace(/^```(json)?|```$/g, '');
        const parsed = graderVerdictSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          console.error(`  [run] grader ${graderIndex + 1} JSON invalid for one line, skipping line`);
          continue;
        }
        for (const score of parsed.data.categoryScores) categoryScores.push(score);
        if (!aligned) {
          categoryScores.push(
            ...EVAL_CATEGORIES.map((category) => ({ category, score: 0, rationale: '输出中缺少对齐的行' }))
          );
        }
        for (const note of parsed.data.lineNotes ?? []) lineScores.push({ lineId: goldLine.text, note });
      } catch (error) {
        console.error(`  [run] grader ${graderIndex + 1} line failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const perCategory = new Map<EvalCategory, number[]>();
    for (const score of categoryScores) {
      const bucket = perCategory.get(score.category) ?? [];
      bucket.push(score.score);
      perCategory.set(score.category, bucket);
    }
    const categoryMean = (category: EvalCategory) => {
      const bucket = perCategory.get(category);
      return bucket && bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 0;
    };
    const overall =
      (EVAL_CATEGORIES.reduce((sum, category) => sum + categoryMean(category), 0) / EVAL_CATEGORIES.length) * 10;

    verdicts.push({
      graderIndex,
      modelId: args.graderModelId,
      overall: Math.round(overall * 10) / 10,
      categoryScores,
      lineScores: lineScores.length > 0 ? lineScores : undefined,
      parsedAt: Date.now()
    });
    console.error(`  [run] grader ${graderIndex + 1} overall: ${verdicts[verdicts.length - 1]?.overall}/100`);
  }

  if (verdicts.length === 0) {
    console.error('[run] all graders failed');
    process.exit(1);
  }

  const categoryMeans = Object.fromEntries(
    EVAL_CATEGORIES.map((category) => {
      const values = verdicts.flatMap((verdict) =>
        verdict.categoryScores.filter((score) => score.category === category).map((score) => score.score)
      );
      return [category, values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0];
    })
  ) as Record<EvalCategory, number>;
  const overallMean =
    Math.round((verdicts.reduce((sum, verdict) => sum + verdict.overall, 0) / verdicts.length) * 10) / 10;

  const summary = {
    runId: path.basename(runDir),
    startedAt: analysis.generatedAt,
    finishedAt: Date.now(),
    songTitle: analysis.songTitle,
    songArtists: analysis.songArtists,
    analysisSource,
    modelId: analysis.modelId,
    graderModelId: args.graderModelId,
    graderCount: verdicts.length,
    overallMean,
    categoryMeans,
    verdicts,
    reportPath: path.join(runDir, 'report.html')
  };
  await fs.writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  // ---- Stage 3: HTML report (inline, self-contained) ------------------------------------------
  // Iterate gold lines (the evaluation anchor) and attach the aligned produced line, so unmatched
  // or partially matched teaching units are still visible instead of silently dropped.
  const goldToProduced = new Map<string, { produced: EvalLine; overlap: number }>();
  for (const goldLine of gold.lines) {
    const aligned = alignGoldToProduced(goldLine);
    if (aligned) goldToProduced.set(normalize(goldLine.text), { produced: aligned.line, overlap: aligned.overlap });
  }
  const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const renderTokens = (tokens: Array<Record<string, unknown>>, tone: string) =>
    `<table class="tokens ${tone}">${tokens
      .map(
        (token) =>
          `<tr><th>${escapeHtml(String(token.text ?? ''))}</th><td><span class="rowlabel">词典形</span>${escapeHtml(String(token.term ?? '—'))}</td><td><span class="rowlabel">语境义</span>${escapeHtml(String(token.meaning ?? '—'))}</td><td><span class="rowlabel">语法/词性</span>${escapeHtml(String(token.grammarFunction ?? '—'))}</td><td><span class="rowlabel">注音</span>${escapeHtml(String(token.pronunciation ?? '—'))}</td></tr>`
      )
      .join('')}</table>`;

  const lineBlocks = gold.lines
    .map((goldLine) => {
      const match = goldToProduced.get(normalize(goldLine.text));
      const produced = match?.produced;
      const overlapPct = match ? Math.round(match.overlap * 100) : 0;
      const producedView = (produced?.tokens ?? []).map((token) => ({
        text: token.text,
        term: token.card?.term ?? token.term,
        meaning: token.card?.meaning ?? token.meaning,
        grammarFunction: token.card?.grammarFunction ?? token.grammarFunction,
        pronunciation: token.pronunciation
          ? Object.entries(token.pronunciation)
              .filter(([, value]) => value && value !== token.text)
              .map(([k, v]) => `${k}:${v}`)
              .join(' · ') || '—'
          : '—'
      }));
      const goldView = goldLine.tokens.map((token) => ({
        text: token.text,
        term: token.term ?? token.kana,
        meaning: token.meaning,
        grammarFunction: token.pos,
        pronunciation: [token.kana, token.romaji].filter(Boolean).join(' · ')
      }));
      return `<div class="line-block ${produced ? '' : 'unmatched'}"><h3>${escapeHtml(goldLine.text)} <span class="badge">${produced ? `对齐 ${overlapPct}%` : '未对齐'}</span></h3><div class="pair"><div class="col"><div class="coltitle">系统输出${produced ? ` (${escapeHtml(produced.text)}) · 翻译: ${escapeHtml(produced.translation ?? '—')}` : '（无匹配行）'}</div>${produced ? renderTokens(producedView, 'produced') : '<p class="muted">管线未输出与该教学单元对齐的行。</p>'}</div><div class="col"><div class="coltitle gold">金标准 · 翻译: ${escapeHtml(goldLine.translation ?? '—')}</div>${renderTokens(goldView, 'gold')}</div></div></div>`;
    })
    .join('\n');

  const summaryCards = `<div class="cards"><div class="card"><div class="big">${overallMean}</div><div class="cap">综合分 /100（${verdicts.length}×${escapeHtml(args.graderModelId)} 平均）</div></div><div class="card">${EVAL_CATEGORIES.map((category) => `<div class="catrow"><span>${category}</span><b>${categoryMeans[category]}</b></div>`).join('')}</div><div class="card"><div class="big">${analysis.lines.length}</div><div class="cap">已析行 / 共 ${lines.length} 行</div></div></div>`;

  const telemetryNote = analysis.passes
    ? `<p class="muted">管线批次 ${analysis.passes.length} · 输出 tokens ${analysis.passes.reduce((sum, pass) => sum + (pass.outputTokens ?? 0), 0)} · 数据源 ${analysisSource}</p>`
    : `<p class="muted">数据源 ${analysisSource}（缓存）</p>`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>歌词解析评测 — ${escapeHtml(analysis.songTitle)}</title><style>
body { font-family: "PingFang SC", sans-serif; margin: 2rem auto; max-width: 75rem; color: #222; }
h1 { font-size: 1.4rem; } .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; } @media (max-width: 70rem) { .pair { grid-template-columns: 1fr; } }
table.tokens { border-collapse: collapse; font-size: .8rem; margin-bottom: .6rem; }
table.tokens th, table.tokens td { border: 1px solid #d9d4c8; padding: .22rem .45rem; text-align: left; vertical-align: top; }
table.tokens.gold th { color: #b98a2e; }
.rowlabel { display: block; font-size: .6rem; color: #aaa; }
.coltitle { font-size: .78rem; color: #777; margin-bottom: .3rem; } .coltitle.gold { color: #b98a2e; }
.badge { font-size: .68rem; background: #eee; padding: .1rem .4rem; border-radius: 3px; } .unmatched h3 { color: #a33; }
.cards { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; } .card { border: 1px solid #d9d4c8; border-radius: 8px; padding: .8rem 1.2rem; min-width: 12rem; }
.big { font-size: 2rem; font-weight: 700; } .cap { font-size: .72rem; color: #888; } .catrow { display: flex; justify-content: space-between; font-size: .78rem; gap: 1rem; }
.muted { color: #888; font-size: .78rem; }
</style></head><body><h1>歌词解析评测 — ${escapeHtml(analysis.songTitle)}</h1>${telemetryNote}${summaryCards}<h2>逐行对照</h2>${lineBlocks}</body></html>`;

  await fs.writeFile(path.join(runDir, 'report.html'), html, 'utf-8');

  console.error(`[run] done: overall ${overallMean}/100 → ${runDir}`);
  console.log(JSON.stringify({ overallMean, categoryMeans, runDir, reportPath: path.join(runDir, 'report.html') }, null, 2));
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const isLengthTruncation = message.includes('NoObjectGeneratedError') || String(error).includes("'length'");
  console.error(
    isLengthTruncation
      ? '[run] the gateway truncated a batch (finishReason=length). Re-run; if it recurs, lower ANALYSIS_BATCH_SIZE in src/main/lyricsAnalysis/providerGateway.ts.'
      : `[run] failed: ${message}`
  );
  process.exit(1);
});
