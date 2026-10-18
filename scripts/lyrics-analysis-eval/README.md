# lyrics-analysis-eval

歌词解析质量评测 harness。以人类标注金标准（don't say lazy_Sheet1(1).pdf 转录）为锚，跑生产分析管线，N 个 LLM grader 按 7 维度打分取平均，产出自包含 HTML 报告。

```bash
# 完整循环（分析 + 3 grader + 报告，5-15 分钟）
source /tmp/eval-creds.env && npx tsx scripts/lyrics-analysis-eval/run.ts \
  --lyrics <song.lrc> --gold gold/dont-say-lazy.json \
  --title "…" --artist "…" --graders 3 --dir ../eval-runs/<name>
```

| 文件 | 作用 |
|---|---|
| `run.ts` | 一条命令的 orchestrator（分析→对齐→打分→报告） |
| `analyze.ts` | 仅分析：把生产 `providerGateway` CLI 化（同 prompt/分批/normalize） |
| `score.ts` | 仅打分：对已有 analysis.json 跑 N grader |
| `report.ts` | 仅报告：从 analysis.json/summary.json 生成 HTML |
| `gold/` | 金标准 JSON（人类标注转录，结构见 `types.ts` GoldStandard） |
| `types.ts` | 全部共享契约 |

细节与拉歌词方法见用户级 skill `~/.claude/skills/lyrics-eval/SKILL.md`。

运行产物在仓库根 `eval-runs/`（gitignored）：`analysis.json`（管线输出）、`summary.json`（分数）、`report.html`（双击打开，逐 token 对照 + 对齐度徽章）。
