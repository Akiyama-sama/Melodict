#!/usr/bin/env tsx
/**
 * report.ts — emit a self-contained HTML report visualizing an analysis run.
 *
 * Everything inline (CSS + data): open the file directly in a browser. The token grid mirrors the
 * human study sheet's layout — surface / reading / dictionary form / grammar / meaning rows — so
 * gold vs. produced can be compared side by side, with the eval summary and pipeline telemetry on
 * top.
 *
 * Usage:
 *   tsx scripts/lyrics-analysis-eval/report.ts --analysis <analysis.json> [--gold <gold.json>] \
 *     [--summary <eval-summary.json>] [--out <report.html>] [--telemetry]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { escapeHtml } from './lib/html';
import {
  type EvalAnalysisResult,
  type EvalLine,
  type GoldLine,
  type GoldStandard,
  type EvalRunSummary,
  readTokenCard
} from './types';

const parseArgs = (argv: string[]) => {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const analysisPath = get('--analysis');
  if (!analysisPath) {
    console.error('Usage: tsx scripts/lyrics-analysis-eval/report.ts --analysis <analysis.json> [--gold …] [--summary …] [--out …] [--telemetry]');
    process.exit(1);
  }
  return {
    analysisPath,
    goldPath: get('--gold'),
    summaryPath: get('--summary'),
    out: get('--out'),
    telemetry: argv.includes('--telemetry')
  };
};

interface TokenCell {
  surface: string;
  rows: Array<{ label: string; value: string }>;
  highlight?: 'missing' | 'extra';
}

const tokenCellsFromAnalysis = (line: EvalLine): TokenCell[] =>
  line.tokens.map((token) => {
    const card = readTokenCard(token);
    return {
      surface: token.text,
      rows: [
        { label: '词典形', value: card.term ?? '—' },
        { label: '语境义', value: card.meaning ?? '—' },
        { label: '语法', value: card.grammarFunction ?? '—' },
        // Reads token.pronunciation flat-only (not card.pronunciation) — kept as-is intentionally.
        {
          label: '注音',
          value: token.pronunciation
            ? Object.entries(token.pronunciation)
                .filter(([, value]) => value && value !== token.text)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' · ') || '—'
            : '—'
        }
      ]
    };
  });

const tokenCellsFromGold = (line: GoldLine): TokenCell[] =>
  line.tokens.map((token) => ({
    surface: token.text,
    rows: [
      { label: '词典形', value: token.term ?? token.kana ?? '—' },
      { label: '语境义', value: token.meaning ?? '—' },
      { label: '词性', value: token.pos ?? '—' },
      { label: '注音', value: [token.kana, token.romaji].filter(Boolean).join(' · ') || '—' }
    ]
  }));

const renderTokenTable = (cells: TokenCell[], tone: 'gold' | 'produced') =>
  `<table class="tokens ${tone}">${cells
    .map(
      (cell) => `<tr><th>${escapeHtml(cell.surface)}</th>${cell.rows
        .map((row) => `<td><span class="rowlabel">${row.label}</span>${escapeHtml(row.value)}</td>`)
        .join('')}</tr>`
    )
    .join('')}</table>`;

const renderSection = (title: string, body: string) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;

const buildReport = (input: {
  analysis: EvalAnalysisResult;
  gold?: GoldStandard;
  summary?: EvalRunSummary;
  telemetryRows?: Array<Record<string, unknown>>;
}) => {
  const { analysis, gold, summary, telemetryRows } = input;

  const goldByNorm = new Map((gold?.lines ?? []).map((line) => [line.text.replace(/\s+/g, ''), line]));

  const lineSections = analysis.lines
    .map((producedLine) => {
      const goldLine = goldByNorm.get(producedLine.text.replace(/\s+/g, ''));
      const producedTable = renderTokenTable(tokenCellsFromAnalysis(producedLine), 'produced');
      const goldTable = goldLine ? renderTokenTable(tokenCellsFromGold(goldLine), 'gold') : '';
      const translation = producedLine.translation ?? '—';
      const goldTranslation = goldLine?.translation ?? '';

      return `<div class="line-block ${goldLine ? '' : 'unmatched'}">
  <h3>${escapeHtml(producedLine.text)}${goldLine ? '' : ' <span class="badge">无金标准对照</span>'}</h3>
  <div class="pair">
    <div class="col"><div class="coltitle">系统输出 (model: ${escapeHtml(analysis.modelId)}) · 翻译: ${escapeHtml(translation)}</div>${producedTable}</div>
    ${goldTable ? `<div class="col"><div class="coltitle gold">金标准 (人类) · 翻译: ${escapeHtml(goldTranslation)}</div>${goldTable}</div>` : ''}
  </div>
</div>`;
    })
    .join('\n');

  const summaryHtml = summary
    ? `<div class="cards">
  <div class="card"><div class="big">${summary.overallMean}</div><div class="cap">综合分 /100（${summary.graderCount}×${escapeHtml(summary.graderModelId)} 平均）</div></div>
  <div class="card"><div class="big">${Object.entries(summary.categoryMeans).map(([key, value]) => `<div class="catrow"><span>${escapeHtml(key)}</span><b>${value}</b></div>`).join('')}</div><div class="cap">分维度均值 /10</div></div>
  <div class="card"><div class="big">${analysis.lines.length}</div><div class="cap">已析行数</div></div>
</div>`
    : '';

  const telemetryHtml =
    telemetryRows && telemetryRows.length > 0
      ? `<table class="telemetry"><tr><th>kind</th><th>细节</th></tr>${telemetryRows
          .map(
            (row) =>
              `<tr><td>${escapeHtml(String(row.kind ?? ''))}</td><td><code>${escapeHtml(
                JSON.stringify(row)
              )}</code></td></tr>`
          )
          .join('')}</table>`
      : '';

  const passStats = analysis.passes
    ? `<p class="muted">管线批次: ${analysis.passes.length} 个 batch, 输出 tokens ${analysis.passes.reduce((sum, pass) => sum + (pass.outputTokens ?? 0), 0)}</p>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>歌词解析评测 — ${escapeHtml(analysis.songTitle)}</title>
<style>
  :root { --gold: #b98a2e; --line: #d9d4c8; }
  body { font-family: "PingFang SC", "Hiragino Sans GB", sans-serif; margin: 2rem auto; max-width: 75rem; color: #222; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 2px solid var(--line); padding-bottom: .3rem; }
  h3 { font-size: 1rem; margin: 1.2rem 0 .4rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 70rem) { .pair { grid-template-columns: 1fr; } }
  .coltitle { font-size: .8rem; color: #777; margin-bottom: .3rem; }
  .coltitle.gold { color: var(--gold); }
  table.tokens { border-collapse: collapse; font-size: .82rem; }
  table.tokens th, table.tokens td { border: 1px solid var(--line); padding: .25rem .5rem; text-align: left; vertical-align: top; }
  table.tokens th { font-weight: 600; }
  table.tokens.gold th { color: var(--gold); }
  .rowlabel { display: block; font-size: .62rem; color: #aaa; }
  .badge { font-size: .7rem; background: #eee; padding: .1rem .4rem; border-radius: 3px; }
  .unmatched h3 { color: #a33; }
  .cards { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: .8rem 1.2rem; min-width: 12rem; }
  .big { font-size: 2rem; font-weight: 700; }
  .cap { font-size: .75rem; color: #888; }
  .catrow { display: flex; justify-content: space-between; font-size: .8rem; gap: 1rem; }
  table.telemetry { border-collapse: collapse; font-size: .72rem; width: 100%; }
  table.telemetry th, table.telemetry td { border: 1px solid var(--line); padding: .2rem .4rem; text-align: left; }
  code { font-size: .68rem; word-break: break-all; }
  .muted { color: #888; font-size: .8rem; }
</style>
</head>
<body>
<h1>歌词解析评测 — ${escapeHtml(analysis.songTitle)}</h1>
<p class="muted">模型 ${escapeHtml(analysis.modelId)} · ${new Date(analysis.generatedAt).toLocaleString('zh-CN')}${gold ? ` · 金标准 ${escapeHtml(gold.source.slice(0, 60))}…` : ''}</p>
${summaryHtml}
${passStats}
${renderSection('逐行对照（系统输出 vs 金标准）', lineSections)}
${telemetryHtml ? renderSection('埋点数据', telemetryHtml) : ''}
</body>
</html>`;
};

const readTelemetryRows = async (): Promise<Array<Record<string, unknown>>> => {
  const telemetryPath = path.join(
    process.env.HOME ?? '',
    'Library/Application Support/nora/lyrics-analysis-telemetry'
  );
  try {
    const shards = (await fs.readdir(telemetryPath)).filter((f) => f.endsWith('.jsonl')).sort().slice(-2);
    const rows: Array<Record<string, unknown>> = [];
    for (const shard of shards) {
      const raw = await fs.readFile(path.join(telemetryPath, shard), 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); } catch { /* torn tail */ }
      }
    }
    return rows.slice(-200);
  } catch {
    return [];
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const analysis = JSON.parse(await fs.readFile(args.analysisPath, 'utf-8')) as EvalAnalysisResult;
  const gold = args.goldPath
    ? (JSON.parse(await fs.readFile(args.goldPath, 'utf-8')) as GoldStandard)
    : undefined;
  const summary = args.summaryPath
    ? (JSON.parse(await fs.readFile(args.summaryPath, 'utf-8')) as EvalRunSummary)
    : undefined;
  const telemetryRows = args.telemetry ? await readTelemetryRows() : undefined;

  const html = buildReport({ analysis, gold, summary, telemetryRows });
  const outPath =
    args.out ?? path.join(path.dirname(args.analysisPath), 'report.html');
  await fs.writeFile(outPath, html, 'utf-8');
  console.error(`[report] wrote ${outPath}`);
};

void main();
