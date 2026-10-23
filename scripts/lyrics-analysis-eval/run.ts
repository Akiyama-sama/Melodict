#!/usr/bin/env tsx
/**
 * run.ts — one-command evaluation loop used by the user-level `lyrics-eval` skill.
 *
 * Pipeline: lyrics file → production analysis pipeline (analyze.ts logic, in-process) →
 * qwen grader (score.ts logic, in-process) → summary.json + self-contained report.html.
 * A cached analysis for the same fingerprint is reused unless --refresh is passed.
 *
 * Usage:
 *   tsx scripts/lyrics-analysis-eval/run.ts --lyrics <file.lrc> --gold <gold.json> \
 *     [--title …] [--artist …] [--graders 1] [--refresh] [--dir <runDir>] \
 *     [--base-url … --model … --api-key …] [--grader-model …]
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import OpenAI from 'openai';

import { findUncoveredLineWords } from '../../src/common/lyricsAnalysis';
import { ROMALRC_MATCH_WINDOW_MS } from '../../src/common/lyricsTiming';
import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';
import { aggregateCategoryMeans, aggregateOverallMean, aggregatePerCategory } from './lib/aggregate';
import { readStoredCredentials } from './lib/creds';
import { graderVerdictSchema } from './lib/graderSchema';
import { escapeHtml } from './lib/html';
import { parseLrcFile } from './lib/lrc';
import { EVAL_CATEGORIES, readTokenCard, type CategoryScore, type EvalAnalysisResult, type EvalCategory, type EvalLine, type GoldLine, type GoldStandard, type GraderVerdict } from './types';

const CATEGORY_LABELS: Record<EvalCategory, string> = {
  tokenization: '分词（tokenization）— 词元切分边界是否与金标准一致（该分的分、该合的合，句型/惯用成块）',
  pronunciation: '注音（pronunciation）— 假名/罗马音/音标(IPA)/拼音/罗马字是否正确（按语言取对应字段）',
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
    console.error('Usage: tsx scripts/lyrics-analysis-eval/run.ts --lyrics <file.lrc> --gold <gold.json> [--romalrc <file.lrc>] [--title …] [--artist …] [--graders 1] [--refresh] [--dir …] [--base-url … --model … --api-key …] [--grader-model …]');
    process.exit(1);
  }
  return {
    lyricsPath,
    goldPath,
    romalrcPath: get('--romalrc'),
    title: get('--title') ?? path.basename(lyricsPath, path.extname(lyricsPath)),
    artists: (get('--artist') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    graders: Number(get('--graders') ?? 1),
    refresh: argv.includes('--refresh'),
    dir: get('--dir'),
    baseURL: get('--base-url') ?? process.env.LYRICS_ANALYSIS_BASE_URL,
    modelId: get('--model') ?? process.env.LYRICS_ANALYSIS_MODEL,
    apiKey: get('--api-key') ?? process.env.LYRICS_ANALYSIS_API_KEY,
    graderModelId: get('--grader-model') ?? process.env.LYRICS_ANALYSIS_GRADER_MODEL ?? 'qwen-flash'
  };
};

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

  const lyricEntries = await parseLrcFile(args.lyricsPath);
  const romalrcEntries = args.romalrcPath ? await parseLrcFile(args.romalrcPath) : [];

  /**
   * Aligns the human romanization onto the analysis lines by timestamp (the same nearest-match
   * window as the app's `attachRomanizedText`). Both files must be timestamped; a plain-text
   * lyrics file simply gets no reference.
   */
  const MATCH_WINDOW_MS = ROMALRC_MATCH_WINDOW_MS;
  const findRomanized = (index: number) => {
    const lyricEntry = lyricEntries[index];
    const lyricAtMs = lyricEntry?.atMs;
    if (lyricAtMs === undefined) return undefined;

    let best: { delta: number; text: string } | undefined;
    for (const entry of romalrcEntries) {
      // `?? NaN` mirrors the original `entry.atMs - atMs` arithmetic for untimed entries (NaN
      // compares false against everything), so the match outcome is byte-for-byte unchanged.
      const delta = Math.abs((entry.atMs ?? Number.NaN) - lyricAtMs);
      if (delta > MATCH_WINDOW_MS) continue;
      if (!best || delta < best.delta) best = { delta, text: entry.text };
    }
    return best?.text;
  };

  const lines = lyricEntries.map((entry, index) => {
    const romanizedText = findRomanized(index);
    return {
      lineId: `line-${index}`,
      text: entry.text,
      ...(romanizedText ? { romanizedText } : {})
    };
  });
  const gold = JSON.parse(await fs.readFile(args.goldPath, 'utf-8')) as GoldStandard;

  // ---- Stage 1: analysis (cached unless --refresh) ------------------------------------------
  // The eval harness always runs fresh within a run dir (analysis.json is the per-run cache), so
  // unlike the app it does not fingerprint the input — --refresh decides reuse.
  const cachePath = path.join(runDir, 'analysis.json');
  // `undefined` until a cache hit or a fresh pipeline run fills it (the falsy check below is the
  // "must run the pipeline" signal, exactly as before — the explicit undefined default only
  // satisfies the control-flow analyzer).
  let analysis: EvalAnalysisResult | undefined;
  let analysisSource: 'pipeline' | 'cache' = 'cache';

  if (!args.refresh) {
    try {
      analysis = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as EvalAnalysisResult;
      console.error(`[run] reused cached analysis (${analysis.lines.length} lines)`);
    } catch {
      analysis = undefined;
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
      // The pipeline shape is structurally compatible but its `card.pronunciation` is a closed
      // interface, not an index signature; the JSON artifact is what downstream stages read.
      lines: outcome.lines as unknown as EvalLine[],
      passes
    };
    await fs.writeFile(cachePath, JSON.stringify(analysis, null, 2), 'utf-8');
  }

  // ---- Stage 2: grading with N graders -------------------------------------------------------
  console.error(`[run] grading with ${args.graders}× ${args.graderModelId} …`);
  const provider = new OpenAI({ apiKey, baseURL, maxRetries: 0 });

  /**
   * The PDF's teaching units cut lines differently from any streaming lyrics source (e.g. the PDF
   * has 「だから たまに そう 惚れる」 where the LRC has 「だからたまに休憩しちゃうんです」), so exact text
   * matching pairs almost nothing. Align by overlap instead: each gold line takes the produced line
   * with the highest overlap (≥ threshold to accept).
   *
   * The overlap metric is language-dependent. Character-set overlap works for CJK (lines share few
   * characters, so an unrelated line scores near zero) but is useless for Latin script: any two
   * English lines share most of the alphabet, so unrelated lines score >0.5 and the alignment
   * happily pairs the wrong line. Latin lines therefore align on whole-word overlap, which is
   * discriminative for English and still tolerates punctuation/contraction differences.
   */
  const normalize = (text: string) => text.replace(/[\s　()（）""]/g, '').replace(/は\(wa\)/g, 'は');
  const LATIN_LINE = /^[\x20-\x7E\s]*$/;
  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/[’']/g, "'")
      .split(/[^a-z0-9']+/)
      .filter((word) => word.length > 0);

  const producedCandidates = analysis.lines.map((line) => ({
    line,
    norm: normalize(line.text),
    chars: new Set(normalize(line.text)),
    words: new Set(words(line.text))
  }));

  const alignGoldToProduced = (goldLine: GoldLine): { line: EvalLine; overlap: number } | undefined => {
    const latinGold = LATIN_LINE.test(goldLine.text);
    const goldChars = new Set(normalize(goldLine.text));
    const goldWords = new Set(words(goldLine.text));
    let best: { line: EvalLine; overlap: number } | undefined;
    for (const candidate of producedCandidates) {
      let overlap: number;
      if (latinGold) {
        let hits = 0;
        for (const word of goldWords) if (candidate.words.has(word)) hits += 1;
        overlap = hits / Math.max(1, goldWords.size);
      } else {
        let hits = 0;
        for (const char of goldChars) if (candidate.chars.has(char)) hits += 1;
        overlap = hits / Math.max(1, goldChars.size);
      }
      if (!best || overlap > best.overlap) best = { line: candidate.line, overlap };
    }
    // Latin alignment demands most of the words to match: the word-overlap metric is
    // discriminative enough that a lower threshold would admit paraphrase pairs.
    const threshold = latinGold ? 0.6 : 0.5;
    return best && best.overlap >= threshold ? best : undefined;
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
          term: token.term ?? token.kana ?? token.ipa,
          meaning: token.meaning,
          grammarFunction: token.pos,
          // Carry every pronunciation script the gold may carry: kana/romaji for Japanese, ipa
          // for English, pinyin for Chinese, romanized for Korean. A Japanese-only view made the
          // pronunciation dimension ungradable for every other language (always 0).
          pronunciation: {
            kana: token.kana,
            romaji: token.romaji,
            ipa: token.ipa,
            pinyin: token.pinyin,
            romanized: token.romanized
          }
        }))
      };
      const producedView = {
        text: produced.text,
        translation: produced.translation,
        tokens: produced.tokens.map((token) => ({
          text: token.text,
          ...readTokenCard(token)
        }))
      };

      try {
        const result = await provider.chat.completions.create({
          model: args.graderModelId,
          temperature: 0,
          // The gateway clamps per-request output tokens (~1200 observed); stay well under it and
          // keep rationales terse so the verdict JSON never hits the cap.
          max_tokens: 900,
          messages: [
            {
              role: 'user',
              content: [
                '为「歌词语言学习标注」评分。金标准（人类专家）vs 系统输出，按 7 维度各打 0-10。',
                '维度: ' +
                  Object.entries(CATEGORY_LABELS)
                    .map(([key, label]) => `${key}=${label.split('—')[1] ?? label}`)
                    .join('; '),
                '基准: 10=等价或更优; 7-9=小瑕疵; 4-6=一半错误; 0-3=大面积错误/缺失。缺失信息按 0 分。',
                '每个维度 rationale ≤15 字，不给 examples。',
                '',
                `金标准: ${JSON.stringify(goldView)}`,
                `系统输出: ${JSON.stringify(producedView)}`,
                '',
                'Return ONLY compact JSON: {"categoryScores":[{"category","score","rationale"}]}'
              ].join('\n')
            }
          ]
        });

        const text = (result.choices[0]?.message?.content ?? '')
          .trim()
          .replace(/^```(json)?/, '')
          .replace(/```$/, '');
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

    const { categoryMean, overall } = aggregatePerCategory(categoryScores);

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

  const categoryMeans = aggregateCategoryMeans(verdicts);
  const overallMean = aggregateOverallMean(verdicts);

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
      const producedView = (produced?.tokens ?? []).map((token) => {
        const card = readTokenCard(token);
        return {
          text: token.text,
          term: card.term,
          meaning: card.meaning,
          grammarFunction: card.grammarFunction,
          pronunciation: card.pronunciation
            ? Object.entries(card.pronunciation)
                .filter(([, value]) => value && value !== token.text)
                .map(([k, v]) => `${k}:${v}`)
                .join(' · ') || '—'
            : '—'
        };
      });
      const goldView = goldLine.tokens.map((token) => ({
        text: token.text,
        term: token.term ?? token.kana ?? token.ipa,
        meaning: token.meaning,
        grammarFunction: token.pos,
        pronunciation: [token.kana, token.romaji, token.ipa, token.pinyin, token.romanized]
          .filter(Boolean)
          .join(' · ')
      }));
      return `<div class="line-block ${produced ? '' : 'unmatched'}"><h3>${escapeHtml(goldLine.text)} <span class="badge">${produced ? `对齐 ${overlapPct}%` : '未对齐'}</span></h3><div class="pair"><div class="col"><div class="coltitle">系统输出${produced ? ` (${escapeHtml(produced.text)}) · 翻译: ${escapeHtml(produced.translation ?? '—')}` : '（无匹配行）'}</div>${produced ? renderTokens(producedView, 'produced') : '<p class="muted">管线未输出与该教学单元对齐的行。</p>'}</div><div class="col"><div class="coltitle gold">金标准 · 翻译: ${escapeHtml(goldLine.translation ?? '—')}</div>${renderTokens(goldView, 'gold')}</div></div></div>`;
    })
    .join('\n');

  // Coverage is scored separately from the LLM rubric: an annotation that silently stops before
  // the line's last word still looks fluent to a grader reading the token list, so the missing
  // word has to be counted mechanically.
  const coverage = (() => {
    let linesChecked = 0;
    let linesWithGap = 0;
    const gaps: Array<{ text: string; missing: string[] }> = [];
    for (const line of analysis.lines) {
      if (line.tokens.length === 0) continue;
      linesChecked += 1;
      const missing = findUncoveredLineWords(line.text, line.tokens as never);
      if (missing.length === 0) continue;
      linesWithGap += 1;
      gaps.push({ text: line.text, missing });
    }
    return { linesChecked, linesWithGap, gaps };
  })();

  const summaryCards = `<div class="cards"><div class="card"><div class="big">${overallMean}</div><div class="cap">综合分 /100（${verdicts.length}×${escapeHtml(args.graderModelId)} 平均）</div></div><div class="card">${EVAL_CATEGORIES.map((category) => `<div class="catrow"><span>${category}</span><b>${categoryMeans[category]}</b></div>`).join('')}</div><div class="card"><div class="big">${analysis.lines.length}</div><div class="cap">已析行 / 共 ${lines.length} 行</div></div><div class="card"><div class="big">${coverage.linesWithGap}</div><div class="cap">覆盖不全的行 / 已析 ${coverage.linesChecked} 行</div></div></div>${
    coverage.linesWithGap > 0
      ? `<details class="coverage"><summary>覆盖不全明细（${coverage.linesWithGap} 行）</summary><ul>${coverage.gaps
          .slice(0, 60)
          .map((gap) => `<li>${escapeHtml(gap.text)} — 缺 ${escapeHtml(gap.missing.join('、'))}</li>`)
          .join('')}</ul></details>`
      : ''
  }`;

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
.coverage { font-size: .78rem; margin: .4rem 0 1rem; } .coverage li { margin: .1rem 0; }
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
