# 歌词教学级解析引擎与渐进式流式渲染 — 需求与架构规格书（v4）

> 状态：Draft · 2026-10-17
> 基线：`v4`（= master `5c2b5ab3` + 全屏播放器重构 + 学习分支既有实现）
> 相关历史：`refactor/analyze-lyrics`、`pre-main` 的 `src/main/analyzeLyric`、`docs/specs/lyrics-analysis-and-learning.md`、`docs/rules/lyrics-analysis-and-learning.md`

---

## 一、我的诉求（逐条固定，作为验收依据）

| # | 诉求 | 现状 / 问题 |
|---|---|---|
| R1 | 对当前歌曲歌词做**教学级**解析：分词、假名/罗马音/IPA、词性、N5~N1 语法标签、语境义、行级意译 | 已有 `refactor/analyze-lyrics` 的 `LyricsLearningArtifact` 雏形，但只有 `meaning` + `grammarFunction`，缺语法等级、IPA、整句意译 |
| R2 | 解析**只发生一次**，之后 0ms 呈现 | 现有实现以 `hash(lyrics+uiLang+model+prompt+schema)` 为 key 落盘，已是 cache-first，但缓存读写与解析都跑在主进程 |
| R3 | 首次解析不能卡主进程、不能掉帧（全屏歌词拖动、音频播放、窗口动画） | 现有 `learningSessionManager` 与 `generateObject` 都在 **主进程**；长歌词全量解析是 20~40s 的连续 CPU/网络活动 |
| R4 | 用户进全屏歌词页 **10ms 内**看到原文歌词，逐行"翻转"成学习卡片，播放到某句时该句必然已就绪 | 现有实现是"整首解析完 → 一次性 `ready`"，用户要干等 20~40s |
| R5 | 链路要**可维护**：不要多任务状态机、退避重试、状态回滚这类分布式脚手架 | 需求方明确反对重型 Job/Task 队列；单用户桌面场景 |
| R6 | 坏数据不能污染 UI：字段缺失/层级错误必须被拦截，且能**自愈** | 现有 `validatorNormalizer` 是"丢弃坏 token"的静默降级，模型没有机会自我修正 |
| R7 | 歌词来源自动寻查：本地 `.lrc`/音频内嵌 → 命中即用；未命中联网拉取并持久化 | 已有 `getSongLyrics`（`src/main/core/getSongLyrics.ts:271`），覆盖 LRC/内嵌/LRCLIB，但没有作为"Agent 工具"暴露，也没有独立的 `cache/lyrics/` 概念 |
| R8 | 尽量少造轮子；用 Pi（`@earendil-works/pi-*`）这类现成 Agent Harness | —— |

> **关于 Pi 的说明（已核实）**：`@earendil-works/pi-mono` 这个包名在 npm 上 **不存在**；实际存在的是 `@earendil-works/pi-ai@1.3.0`、`@earendil-works/pi-agent-core@1.3.0`（以及 `pi-coding-agent`、`pi-web-ui`、`pi-session-backend-sqlite-node`）。旧的 `@mariozechner/pi-*@0.73.1` 已标记 deprecated 并指向新 scope。下文按真实包名设计。

---

## 二、对比：给定方案（Pi Agent + JSONL）vs 我的方案（Fenced 结构化流 + 分层校验）

### 2.1 逐维度对比

| 维度 | 给定方案（统一叫 A） | 我的方案（统一叫 B） | 胜者 |
|---|---|---|---|
| **输出协议** | 强约束 JSONL：一行一个完整行对象 | `streamText` + AI SDK `Output.array({element})`，由 SDK 把 token 流解析成"完整元素流"（`elementStream`）；协议细节交给 SDK | **B**：A 要自己实现"缓冲区切 `\n` + 处理模型偶发换行/尾逗号/包裹"；B 用的是官方 `elementStream`（`ai@6` 已提供），解析器是被测试覆盖的库代码 |
| **自纠错** | Tool `validate_lyric_analysis`：把校验错误回灌给 Agent，让 Agent 重写 | **两段式**：① 行级流式校验只做"截断丢弃 + 记账"，不打断流；② 整首结束后对失败行做**一次**批量 Repair 请求（只发失败行的原文，模型输出同样走 `elementStream`） | **B**：A 的 tool 回灌在流式场景里会造成"边流边回灌"的复杂循环；B 把自纠错收敛成一次有界补丁，失败行数、token 成本都可预期（实现机制见 §4.3.1） |
| **Agent 框架必要性** | 用 Pi `Agent` 承载整个解析（工具调用循环） | **不用 Agent 循环**。用 `pi-ai`（统一 provider/模型/流式）作为模型层，用 `ai` SDK 的结构化流式作为**解析器**层。Pi 的 `Agent` 只在"歌词寻查"这个真正需要工具循环的环节（本地→LRCLIB→备选源）可选启用 | **B**：全曲解析本质是 **一次** LLM 调用 + 确定性校验，不需要 ReAct 循环。引入 Agent loop 只会把"一次流式请求"变成"多轮 tool 往返"，反而拉长首字延迟 |
| **进程隔离** | `utilityProcess` 承载 Pi 运行时 + 插件 | 同样用 `utilityProcess`，但只承载 **解析流水线**（模型流式消费 + 行级校验 + 缓存写盘）。主进程只做 IPC 中继 | 平手（这点 A 是对的，B 照做） |
| **首屏体验** | 先原文 LRC，每行 `pending`；逐行激活 | 同左。额外：**按播放进度优先级调度**——当前播放行及其后 3 行先解析、先校验、先推送（细节见 §6.4） | **B** |
| **缓存 key** | `hash(title+artist)` | `hash(歌词原文 + uiLanguage + modelId + promptVersion + schemaVersion)`（沿用现有 `buildLyricsLearningFingerprint`），**另加** `audioHash` 作为"同一首歌"的辅助索引 | **B**：`title+artist` 会在同名翻唱/现场版之间串味，也会因为改一行歌词而命中脏缓存 |
| **主进程负担** | 主进程仅 IPC 中继 | 同左，且额外把 `getSongById`/`getSong` 的 DB 访问留在主进程（DB 是主进程单例），utility 进程通过 RPC 请求 | 平手 |
| **实现/依赖成本** | `pi-agent-core` + `pi-ai` + TypeBox schema + 自写 JSONL parser | `pi-ai`（provider 统一层，可选）+ `ai@6`（已有 `@ai-sdk/openai@3`）+ **Zod 4**（仓库已有 `zod@4.4.3`，自带 `toJSONSchema`） | **B**：不新增 schema 语言（TypeBox 与 Zod 二选一，仓库已有 Zod）；AI SDK 的 `Output.array` 直接消费 Zod schema |
| **可测试性** | 需要 mock Agent 循环 | 行级校验是纯函数；流式解析可用 `ai/test` 的 `MockLanguageModelV3` + `simulateReadableStream` 构造 token 流，测试"半行 / 坏行 / 迟到行" | **B** |
| **失败行为** | 单点异常易中断整体（A 自己也承认旧链路的痛点，但其方案在流式层同样脆弱） | 行级失败 → 该行回落为纯文本 + 标记 `unavailable`；整首失败 → 保留原文；永不整页报错 | **B** |

### 2.2 结论

**采用 B，并吸收 A 的三个正确判断**：

1. **`utilityProcess` 隔离**（A 的核心洞见，完全采纳）；
2. **cache-first，全量解析只做一次**（采纳）；
3. **"先原文、后逐行激活"的前端呈现策略**（采纳）。

**不采纳 A 的部分**：

1. **JSONL 自定义协议** → 改为 AI SDK `Output.array` 的 `elementStream`。理由：`streamText(..., {output: Output.array({element})})` 已经实现了"按完整元素产出"的语义（`ai@6.0.134` 的 `StreamTextResult.elementStream`，类型 `AsyncIterableStream<InferElementOutput<OUTPUT>>`），并且自带 partial-JSON 容错。A 的 JSONL 方案要求模型严格遵守"每行一个 JSON"，实测里模型很容易在一行内部折行或把对象拆到多行——这是 **prompt 约束 vs 解析器约束** 的经典问题，B 用解析器解决。（注意：同族的 `streamObject(..., {output:'array'})` 行为不同且有坑，不要用，见 §4.3.1。）
2. **用 Pi Agent 循环做解析** → 改为一次流式请求 + 有界 Repair。理由：解析任务没有"需要根据中间结果决定下一步动作"的成分，Agent loop 只会增加延迟与不可预测性。
3. **`hash(title+artist)` 做缓存 key** → 改为内容指纹（见 §5.3）。

> 一句话：**A 把"可靠性"押在 Agent 的自我修正上，B 把可靠性押在"流式解析器 + 纯函数校验 + 有界修复"上。** 对单用户桌面应用，后者的延迟、成本、可测试性都更好，而 Agent 的优势（复杂工具编排）在这个任务里用不上。

---

## 三、目标数据契约（Schema v2）

### 3.1 设计原则

- **行是原子单位**：一行歌词 = 一个完整的 `LyricLineAnalysis`，流式元素天然与"一行"对齐。
- **字符偏移是唯一锚点**：token 用 `startChar`/`endChar`（0-based，end 独占）定位，渲染层据此把行切成 `pre + token + post`，不信任模型输出的 `pre`/`post`（模型经常算错）。
- **必填最小化**：只有"渲染必需"的字段必填；教学增强字段（IPA、JLPT、行意译）可选，缺失不阻塞渲染。
- **版本化**：`schemaVersion`、`promptVersion` 进入指纹与缓存 key。

### 3.2 Zod Schema（`src/common/lyricsAnalysis/schema.ts`）

```ts
import { z } from 'zod';

export const LYRICS_ANALYSIS_SCHEMA_VERSION = '2';

export const lyricTokenSchema = z.object({
  /** 行内 0-based 起始字符偏移（含） */
  startChar: z.number().int().nonnegative(),
  /** 行内 0-based 结束字符偏移（不含） */
  endChar: z.number().int().positive(),
  language: z.enum(['en', 'ja', 'ko', 'zh', 'unknown']),
  card: z.object({
    term: z.string().min(1),                     // 词条原形（可展开缩写）
    reading: z.object({
      kana: z.string().optional(),               // 日语假名
      romaji: z.string().optional(),             // 日语罗马音
      ipa: z.string().optional(),                // 英语 IPA
      us: z.string().optional(),                 // 美式读音
      uk: z.string().optional(),                 // 英式读音
      hangul: z.string().optional(),             // 韩语谚文
      romanized: z.string().optional()           // 韩语罗马字
    }).default({}),
    meaning: z.string().min(1),                  // 本句语境义（不是词典堆砌）
    grammarFunction: z.string().min(1),          // 本句中的语法功能
    pos: z.string().optional(),                  // 词性
    jlpt: z.enum(['N5', 'N4', 'N3', 'N2', 'N1']).optional() // 日语等级
  })
}).refine((t) => t.endChar > t.startChar, { message: 'endChar must be greater than startChar' });

export const lyricLineAnalysisSchema = z.object({
  /** 与输入行的稳定 id 对齐（由服务端下发，模型原样回传） */
  lineId: z.string().min(1),
  /** 行级意译（UI 语言） */
  translation: z.string().optional(),
  tokens: z.array(lyricTokenSchema).max(64)
});

export type LyricLineAnalysis = z.infer<typeof lyricLineAnalysisSchema>;
```

#### 3.2.1 两套 schema：传输 schema vs 领域 schema（实测结论）

上面的 `lyricLineAnalysisSchema` 是**领域 schema**，用于应用侧校验。传给 `Output.array({ element })` 的必须是**另一套更宽松的传输 schema**：

```ts
// 只声明"我们靠什么把元素认回来"，不做任何语义约束
export const lyricLineTransportSchema = z.object({
  lineId: z.string(),
  translation: z.string().optional(),
  tokens: z.array(z.unknown()).optional()
});
```

原因（`ai@6.0.134` 实测，见 §4.3.1）：`Output.array` 在流式阶段对每个元素调用 `safeValidateTypes`，**校验失败的元素会被静默丢弃**——既不会出现在 `elementStream` 里，也不会让流停住。如果这里传入带 `.min(1)` / `.refine()` 的严格 schema，我们连"这一行为什么坏"都拿不到，只能靠"没收到"反推。用宽松传输 schema 后，坏行会正常流出，由 `validateLineAnalysis` 判 `invalid` 并记录具体原因（`tokens-empty`、`token-span-inverted` 等），Repair prompt 才能带上可操作的错误信息。

> `.refine()` 尤其危险：JSON Schema（draft-7）无法表达 refinement，模型侧看不到这条约束，而 SDK 的运行时校验会执行它。于是元素在"模型认为合法、SDK 认为非法"的夹缝里被丢掉。**所有 `.refine()` 只允许出现在领域 schema 里。**

### 3.3 行级校验（`validateLineAnalysis`，纯函数）

校验分三层，**每层失败的处理不同**：

| 层 | 检查 | 失败处理 |
|---|---|---|
| L1 结构 | **领域 schema**（含 `.min(1)` / `.refine()`）`safeParse` | 整行判 `invalid`，记录具体错误码，进入 Repair 候选。**注意：这一层绝不能下放给 `Output.array` 的传输 schema**，否则坏行会被 SDK 静默吞掉（§3.2.1、§4.3.1） |
| L2 锚点 | `endChar <= text.length`；token 按 `startChar` 排序后**不重叠**；`text.slice(startChar, endChar)` 非空 | 丢弃越界/重叠 token；若丢弃后 `tokens` 为空 → 判 `degraded`（仍渲染原文） |
| L3 语义 | 每个 token 的 `card.meaning`/`grammarFunction` 非空且长度 ≤ 200；`language` 与 token 文本字符集一致（正则推断） | 修正 `language`；`meaning` 为空 → 用模板兜底（见 §3.4），不阻塞 |

> **为什么不用"把错误回灌给 Agent"**：行级校验发生在**流式消费的中间态**，此时把错误回灌会让模型重写已经产出过的行，导致 token 成本翻倍且顺序错乱。B 的做法是：流式阶段**只记账**（`failedLineIds`），流结束后对失败集合做一次 Repair（§4.4）。

### 3.4 兜底模板（与现有 `providerShared.ts` 的 fallback 对齐）

```ts
// 与 refactor/analyze-lyrics 的 getFallbackMeaning / getFallbackGrammarFunction 保持同一风格
meaning: `在这句歌词“${lineText}”里，它更接近表达“${tokenText}”这一层意思。`
grammarFunction: '歌词中的表达成分'
```

---

## 四、运行时架构

### 4.1 进程拓扑

```
┌────────────────────────────── Electron Main ──────────────────────────────┐
│  DB (PGlite 单例) · 窗口 · 托盘 · 媒体键 · 全局快捷键 · 网络可达性         │
│                                                                            │
│  ipc.ts:  'app/lyricsAnalysis/prepare' | '.../getLine' | '.../getSnapshot' │
│           '.../reanalyze'             | '.../cancel'                       │
│                     │                                                      │
│                     ▼  (MessagePort / parentPort 中继，纯转发，不做计算)    │
└─────────────────────┼──────────────────────────────────────────────────────┘
                      │  utilityProcess.fork(analysisWorkerPath)
┌─────────────────────▼──────────────────────────────────────────────────────┐
│  utilityProcess: lyrics-analysis-worker                                    │
│                                                                            │
│  ┌────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌───────────┐  │
│  │ LyricsSource│──▶│ StreamingAnalyzer│──▶│ LineValidator│──▶│ CacheWriter│ │
│  │ Resolver    │   │ (ai streamText + │   │ (pure, Zod)  │   │ (atomic)  │ │
│  │ (R7)        │   │  Output.array)   │   │              │   │           │ │
│  └────────────┘   └──────────────────┘   └──────────────┘   └───────────┘  │
│         │                    │                    │                        │
│         │                    └──── failedLineIds ─┴──▶ RepairPass (一次)   │
│         ▼                                                                  │
│  本地 .lrc / 音频内嵌标签 ──(miss)──▶ LRCLIB ──(miss)──▶ 返回 undefined      │
└────────────────────────────────────────────────────────────────────────────┘
```

**构建方式**：`electron-vite` 原生支持 `import workerPath from './lyricsAnalysis/worker?modulePath'`（`node_modules/electron-vite/node.d.ts` 的 `*?modulePath` 声明，实现见 `lib-6EHSwoSb.js:864` 的 `modulePathPlugin`）。开发模式下它会以 `build()` 方式单独打包 worker 入口；生产模式下 worker 作为独立 chunk 随主包发布。**不需要**手工维护 rollup 多入口。

```ts
// src/main/lyricsAnalysis/host.ts（主进程侧）
import { utilityProcess, type UtilityProcess } from 'electron';
import workerPath from './worker?modulePath';

let proc: UtilityProcess | undefined;

export const getAnalysisWorker = () => {
  if (!proc) {
    proc = utilityProcess.fork(workerPath, [], { serviceName: 'lyrics-analysis' });
    proc.on('exit', () => { proc = undefined; });
  }
  return proc;
};
```

### 4.2 IPC 协议

**渲染进程 ↔ 主进程**：沿用现有 `ipcRenderer.invoke` / `ipcRenderer.on` 风格（与 `app/lyricsLearning/sessionUpdated` 一致）。

| 通道 | 方向 | 载荷 |
|---|---|---|
| `app/lyricsAnalysis/prepare` | invoke | `LyricsAnalysisRequest` → `LyricsAnalysisSnapshot`（立即返回，含 `status`） |
| `app/lyricsAnalysis/lineReady` | main→renderer | `LyricsAnalysisLineEvent`（**流式推送**） |
| `app/lyricsAnalysis/snapshot` | main→renderer | `LyricsAnalysisSnapshot`（状态变更：ready / degraded / error） |
| `app/lyricsAnalysis/getSnapshot` | invoke | `songPath` → 当前快照（用于 HMR / 重新挂载） |
| `app/lyricsAnalysis/reanalyze` | invoke | `LyricsAnalysisRequest & { force: true }` |
| `app/lyricsAnalysis/cancel` | invoke | `{ songPath }`（切歌时中止） |

**主进程 ↔ utilityProcess**：用 `MessagePortMain` 双工；消息体就是上面几个 DTO 的超集（worker 额外发 `progress`、`usage`、`cacheHit`）。

```ts
type LyricsAnalysisRequest = {
  songTitle: string;
  songArtists: string[];
  songPath: string;
  duration: number;
  lyrics: SongLyrics;          // 主进程已解析好的结构化歌词（避免 worker 重复解析 LRC）
  uiLanguage: LanguageCodes;
  playbackPosition: number;    // 秒；用于优先级排序
  isLearningEnabled: boolean;
  forceRefresh?: boolean;
};

type LyricsAnalysisLineEvent = {
  songPath: string;
  lineId: string;
  index: number;
  status: 'ready' | 'degraded' | 'unavailable';
  analysis?: LyricLineAnalysis;
  /** 服务端回填的权威行文本与时间，渲染层不信任模型输出的 text */
  text: string;
  start?: number;
  end?: number;
};

type LyricsAnalysisSnapshot = {
  songPath: string;
  status: 'idle' | 'cacheHit' | 'streaming' | 'repairing' | 'ready' | 'degraded' | 'error';
  capability: 'disabled' | 'requiresSyncedLyrics' | 'available';
  fingerprint?: string;
  totalLines: number;
  readyLines: number;
  failedLines: number;
  errorCode?: 'providerNotConfigured' | 'networkFailed' | 'modelFailed' | 'aborted';
  updatedAt: number;
};
```

### 4.3 流式消费（worker 内部）

```ts
import { streamText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const elementSchema = lyricLineTransportSchema; // 宽松传输 schema；领域 schema 在 validateLineAnalysis 里用

const result = streamText({
  model: openAI(modelId),
  system: buildSystemPrompt(uiLanguage),
  prompt: buildUserPrompt(request, plannedLines),
  output: Output.array({
    element: elementSchema,
    name: 'lyric_line_analysis',
    description: 'One analyzed lyric line'
  }),
  temperature: 0,
  maxOutputTokens: 16000,
  abortSignal
});

const validated: LyricLineAnalysis[] = [];
for await (const line of result.elementStream) {
  const outcome = validateLineAnalysis(line, textByLineId.get(line.lineId));
  if (outcome.kind === 'ok' || outcome.kind === 'degraded') {
    validated.push(outcome.line);
    emitLine(line.lineId, outcome);     // → 主进程 → 渲染进程
  } else {
    failedLineIds.add(line.lineId);     // 只记账，不中断
  }
}
```

**关键点**：

- `elementStream` yield 的是**完整且通过传输 schema 校验**的元素（不是 partial），因此"一行一个元素"的语义成立，无需自定义 `\n` 切分。**但它有"一拍延迟"**：第 N 个元素要等第 N+1 个元素的文本开始出现才被确认（解析器在 `repaired-parse` 状态下会丢掉最后一个不完整元素），最后一个元素在流结束时才产出。实测见 §4.3.1。
- 模型若漏行/错 `lineId`，`textByLineId.get()` 查不到 → 记入 `failedLineIds`，由 Repair 补齐。
- 渲染层用**服务端权威 `text`**，不采用模型回传的行文本，从根上消除"模型改写歌词"的问题。

#### 4.3.1 `elementStream` 的真实语义（`ai@6.0.134` 实测）

这一节是 Repair 设计的事实基础，全部结论来自可复现的 mock 流实验。

**它是怎么工作的**（`ai` dist 的 `array` output strategy）：

1. 模型通过 JSON schema 被要求输出 `{"elements":[...]}`——SDK 在元素 schema 外面包了一层对象，不是裸数组。
2. 每收到一个文本增量，SDK 对**累计文本**跑 `parsePartialJson`：先 `safeParseJSON`，失败则 `fixJson` 补齐括号/引号后重试。
3. 解析成功但状态是 `repaired-parse`（说明是补出来的）时，**数组最后一个元素被视为"可能还没写完"，直接切掉**：`elements.slice(0, -1)`。这就是一拍延迟的来源。
4. 剩下的每个元素过 `safeValidateTypes(elementSchema)`，**失败的直接过滤掉**，不报错、不中断。
5. `createElementStreamTransform` 用一个 `publishedElements` 计数器，只把"新变为合法"的元素往下游 enqueue 一次。

**实测行为表**：

| 场景 | `elementStream` | 最终 `result.output` |
|---|---|---|
| 全部合法 | `L0, L1, L2`（每个都滞后一个元素） | 正常 resolve |
| 中间元素结构非法（严格 schema） | `L0, L2`——**坏元素被静默跳过，流不停** | reject `NoObjectGeneratedError` |
| 中间元素缺失 | `L0, L2` | reject `NoObjectGeneratedError` |
| 宽松 schema + 语义坏元素 | `L0, L1, L2` 全部流出 | resolve（SDK 不管语义） |
| JSON 前有说明文字 | **一个都不流出** | reject `NoObjectGeneratedError`（"could not parse the response"） |
| 包在 markdown 代码块里 | **一个都不流出** | reject `NoObjectGeneratedError` |
| JSON 后有说明文字 | 流出部分元素（`L0`），`L1` 不流出 | reject `NoObjectGeneratedError` |
| JSON 后只有空白 | 全部流出 | 正常 resolve |

最后三行是重要边界：`parsePartialJson` 只做括号/引号修补，**不做"从散文里抠 JSON"**。前置文字会导致一个元素都解析不出来；后置文字更阴险——流式阶段可能已经推出了部分行（UI 看着像成功），但最终 `result.output` 仍然 reject，缓存也不能写。因此 system prompt 必须明确"只输出 JSON，不要解释、不要代码块"，**且最终结果的判定必须以 `result.output` 成功为准，不能以"收到了若干行"为准**。这不是可选的礼貌约束，是功能前提。

**"一次有界补丁"不是 SDK 能力**。SDK 只提供两样东西：一个"已确认合法的元素"异步迭代器，和一个"整体失败"的最终 Promise。Repair 完全是我们在这两者之上写的应用逻辑：

```
pass 1: for await (elementStream)  →  逐行校验  →  ready[] / failedLineIds[]
        （流结束后用"输入行集合 - 已就绪集合"补上模型压根没吐的行）
        ↓  failedLineIds 非空
pass 2: 只把失败行的 lineId + 原文发给模型，同一个 schema、同一条 elementStream
        ↓
        仍失败 → 模板降级，绝不再发第三次
```

有界性来自三个硬约束，与 SDK 无关：

1. **失败集合在 pass 1 结束时冻结**——Repair 的输入大小上限就是总行数，不可能扩散。
2. **pass 2 只发失败行**——token 成本与失败行数成正比，而不是与整首歌词成正比。
3. **循环上限写死为 1**——代码里没有 `while`，只有一次 `if`。

实测（`repair-final.mjs`，宽松传输 schema + 应用侧校验）：

```text
+195ms [pass1]  L0 -> ok
+321ms [pass1]  L2 -> ok
+384ms [pass1]  L3 -> tokens-empty
+492ms [pass1]  L4 -> token-span-inverted
+620ms [pass1]  L5 -> ok
+673ms [pass1]  done: ready=L0,L2,L5 failed=L1,L3,L4   ← L1 模型压根没吐
+193ms [repair] L1 -> ok
+321ms [repair] L3 -> ok
+424ms [repair] L4 -> ok
final: L0=ready L1=ready L2=ready L3=ready L4=ready L5=ready
```

注意 pass 1 里 `failed` 集合同时包含两类失败："吐了但语义坏"（L3/L4）和"没吐"（L1）。二者在应用侧被统一成同一种 bookkeeping，这正是 Repair 能用一次请求覆盖全部失败的原因。

**不要用 `streamObject(..., { output: 'array' })`**。同一 fixture 下实测：坏元素时它只流出 `L0` 就停住，但最终 `output` 却能 resolve（把坏元素悄悄丢了）；全部合法时它也只流出倒数第二个元素。它的容错策略与 `streamText + Output.array` 不一致且更隐蔽。统一用 `streamText + Output.array`。

### 4.4 Repair Pass（有界自纠错）

```ts
// 1. pass 1 结束后，用"输入行 - 已就绪行"补齐模型压根没吐的行
for (const id of plannedLines) {
  if (!received.has(id)) failedLineIds.add(id);
}

// 2. 失败集合就此冻结；下面这段没有 while，只有一次 if
if (failedLineIds.size > 0) {
  emitSnapshot({ status: 'repairing', failedLineIds: [...failedLineIds] });
  const repairPrompt = buildRepairPrompt(
    [...failedLineIds].map((id) => ({ id, text: textByLineId.get(id)! })),
    reasonsByLineId   // 带上 L3: tokens-empty 之类的具体原因，模型才知道要改什么
  );
  const repair = streamText({ ...sameConfig, prompt: repairPrompt });
  for await (const line of repair.elementStream) {
    // 防御：模型可能在 Repair 里返回未请求的行，直接忽略
    if (!failedLineIds.has(line.lineId)) continue;
    const outcome = validateLineAnalysis(line, textByLineId.get(line.lineId));
    if (outcome.kind === 'ok' || outcome.kind === 'degraded') emitLine(line.lineId, outcome);
    // 仍失败：什么都不做，落到下面的降级
  }
}

// 3. 终态：Repair 后仍未解决的行标记 unavailable（渲染原文 + 模板释义）
```

约束：

- **最多一次** Repair；仍失败的行标记 `unavailable`。代码结构上不存在第二次机会，避免"越修越久"。
- Repair 使用与主请求**相同的传输 schema 与 system prompt**（保证模型行为一致），prompt 版本号不变（保证缓存 key 一致）。
- Repair 的 token 预算上限为主请求的 30%（超出则中止，剩余行降级）。
- Repair 的输出同样走 `elementStream`，因此修复行也是**逐行**变得可用，而不是等整批结束才一起刷新。上方实测里三行分别在不同时刻就绪。
- 失败原因（`tokens-empty` / `token-span-inverted` / `missing`）必须进 Repair prompt。这是宽松传输 schema 的直接收益——如果让 SDK 用严格 schema 把坏元素丢掉，我们手上就只剩"missing"一种原因，修复质量会明显下降。

### 4.5 为什么不是 Pi Agent

```ts
// 反例：如果套用 A 的 Agent 方案，单曲解析会变成这样
agent.prompt('analyze this song')
  → turn 1: assistant 调用 validate_lyric_analysis(部分 JSONL)
  → turn 2: toolResult 返回校验错误
  → turn 3: assistant 重写
  → ...（每轮都是一次完整模型请求）
```

对 40 行歌词，这会产生 2~4 次模型往返，首字延迟从 ~2s 劣化到 ~6s+，且失败路径不可预测。**B 用一次流式请求 + 一次有界 Repair，往返次数恒为 1 或 2。**

> Pi 仍然有用武之地：`LyricsSourceResolver`（§5.2）天然是"本地 → LRCLIB → 备选源"的工具链，可以用 `pi-ai` 的 `Tool` + 轻量循环实现；但由于只有 2~3 个确定性步骤，B 建议**先用 30 行纯函数**实现，等真正需要"根据歌词语言决定源站"等判断时再引入 Pi。

---

## 五、歌词寻查与缓存

### 5.1 复用现有解析链，不重造

现有 `getSongLyrics`（`src/main/core/getSongLyrics.ts:271`）已经覆盖：

1. `.lrc` 文件（同名、去扩展名、自定义目录）—— `fetchLyricsFromLRCFile`
2. 音频内嵌标签（ID3 `lyrics`/`synchronisedLyrics`）—— `fetchLyricsFromAudioSource`
3. 联网 LRCLIB —— `getLyricsFromLrclib`
4. 非同步歌词兜底 —— `fetchUnsyncedLyrics`

**结论**：`find_or_fetch_lyrics` 工具**不新建网络层**，只是把上述链路按 R7 的语义包装：

```ts
// src/main/lyricsAnalysis/sourceResolver.ts
export const resolveLyricsSource = async (trackInfo: LyricsRequestTrackInfo) => {
  const lyrics = await getSongLyrics(trackInfo, 'ANY', 'ANY', 'NONE');
  if (!lyrics) return { kind: 'unavailable' as const };
  return {
    kind: 'ok' as const,
    lyrics,
    isSynced: lyrics.lyrics.isSynced,
    /** 仅当歌词来自网络时写独立缓存，供离线再次命中 */
    persistPath: lyrics.source === 'LRCLIB'
      ? await writeLyricsSourceCache(trackInfo, lyrics)
      : undefined
  };
};
```

### 5.2 与"Pi 工具"的对应关系

| A 中的工具 | B 中的实现 | 说明 |
|---|---|---|
| `find_or_fetch_lyrics` | `resolveLyricsSource()`（纯函数 + 现有 `getSongLyrics`） | 不引入 Agent；返回结构化结果 |
| `validate_lyric_analysis` | `validateLineAnalysis()`（Zod，纯函数） | 不做成 Tool，因为校验在 worker 内部同步调用，不需要模型参与 |

> 若未来需要"AI 判断该用哪个源"，再把这层包成 Pi `Tool` 并挂到 `Agent` 上；当前不需要。

### 5.3 缓存设计

**目录**：`app.getPath('userData')/lyrics-analysis/`（与现有 `lyrics-learning-cache/` 同级，便于迁移）。

**Key**：

```ts
fingerprint = sha256(JSON.stringify({
  lyricsTextHash,     // sha256(所有行原始文本以 \n 连接)
  uiLanguage,
  modelId,
  promptVersion,
  schemaVersion
}))
```

**文件布局**：

```
lyrics-analysis/
  <fingerprint>.json          # 完整 artifact（原子写：.tmp → rename）
  <fingerprint>.lines/        # 流式检查点（可选，用于崩溃恢复）
    <lineId>.json
```

**为什么不用 SQLite**：解析结果是"大 JSON blob + 一次性读取"，文件系统天然合适；PGlite 已经在主进程占用一个 WASM 实例，没必要让 worker 再开一个。若未来要做"跨歌曲检索"，再加索引表。

**原子写**：复用现有 `cacheRepository.ts` 的 `.tmp` → `rename` 模式（见 `refactor/analyze-lyrics:src/main/lyricsLearning/cacheRepository.ts`）。

**失效策略**：

| 触发 | 行为 |
|---|---|
| 歌词文本 hash 变化 | 新 fingerprint → miss → 重新解析 |
| UI 语言变化 | 同上（现有 `rules` 文档已要求） |
| model/prompt/schema 版本变化 | 同上 |
| 用户手动"重新分析" | `forceRefresh: true`，忽略缓存但不删除旧文件（留给回滚） |
| 应用启动 | 不扫描；按需读取 |

---

## 六、渐进式渲染

### 6.1 三阶段

```
T+0ms      原文歌词已上屏（LRC 解析在主进程完成，本来就是毫秒级）
          每行状态：pending（纯文本，无交互）
T+300ms    缓存命中 → 全部行一次性 ready（0 网络）
T+2s~40s   缓存未命中 → elementStream 逐行推送
          每行状态：pending → ready（原地翻转，带 200ms 淡入 + 轻微上移）
          失败行：pending → degraded（保留原文，右侧显示"i"提示）
```

### 6.2 行状态机（渲染层）

```
pending ──lineReady(ok)──────▶ ready
   │
   ├────lineReady(degraded)──▶ degraded
   ├────lineReady(unavailable)▶ unavailable
   └────snapshot(error)───────▶ unavailable（整首）
```

**不设 `analyzing` 中间态**：每行自身就是最小状态单元，避免"整页 loading"。

### 6.3 渲染优先级（B 相对 A 的增量）

B 在 `LyricsAnalysisRequest` 中携带 `playbackPosition`，worker 按以下顺序**规划输出**（不是重排请求，请求本身仍按歌词顺序，以保证模型上下文连贯）：

```ts
// 缓存命中时：全部 ready
// 缓存未命中时：worker 记录一个 priorityWindow
const priorityStart = indexOfLineAt(playbackPosition);   // 当前行
const priorityEnd = priorityStart + 3;                   // 后 3 行
```

当 `elementStream` 产出的行落在 `[priorityStart, priorityEnd]` 时，**立即推送、跳过 100ms 节流**；其余行按 100ms 合并批次推送。这样即使模型从第一行开始生成，用户切到全屏时"正在唱的那一句"也会第一时间就绪。

> **延迟的真实下限**：由于 §4.3.1 的"一拍延迟"，第 N 行的可见时刻 ≈ 模型写完第 N+1 行开头所需的 token 时间；最后一行要等整条流结束。对 40 行歌词，若当前播放到第 30 行，必须等前面 30 行全部生成完才能看到它——**节流优化救不了这个**。真正的缓解手段是把请求切成"优先窗口批 + 其余批"两次并发请求（窗口批只有 4 行，1~2s 内可完成），代价是模型失去整首歌词的上下文连贯性。本期先按顺序请求 + 节流，把这个作为 §十 的观测项：如果实测中"切到全屏后当前行仍长时间空白"是主要抱怨，再引入分批。

> 播放位置变化时（用户 seek），渲染层只更新 `priorityWindow` 的展示权重（当前行放大、其余缩小），不需要重新请求解析——这是纯 UI 行为。

### 6.4 IPC 节流

```ts
const FLUSH_INTERVAL_MS = 100;
let buffer: LyricsAnalysisLineEvent[] = [];

const emitLine = (event) => {
  if (isInPriorityWindow(event)) {
    flush([...buffer, event]);   // 立即
    buffer = [];
    return;
  }
  buffer.push(event);
  scheduleFlush();               // 100ms 后合并发送
};
```

**注意**：节流必须发生在 **worker 侧**（推送前），而不是渲染进程侧。现有实现中 `learningSessionManager.setListener` 每次 `emit` 都直接 `webContents.send`，长歌词场景下会产生几百次 IPC 往返。

### 6.5 前端组件改造

| 组件 | 改动 |
|---|---|
| `FullScreenPlayer/containers/LyricsContainer.tsx` | 复用现有 `LyricLine`（`src/renderer/src/components/LyricsPage/LyricLine.tsx`）；新增 `useLyricsAnalysis(songPath)` hook，返回 `Map<lineId, LineState>` |
| `useLyricsAnalysis` | 订阅 `app/lyricsAnalysis/lineReady`，用 `useSyncExternalStore` 或 TanStack Store 的 `useStore` 暴露；**不把整个分析结果放进全局 store**（避免 `cloneDeep` 深拷贝，见 §7.3） |
| `LyricLine` | 新增 `analysis?: LyricLineAnalysis` + `analysisStatus`；`ready` 时把 `pre/token/post` 渲染成可点击 span（沿用 `refactor/analyze-lyrics` 的 `LyricsLearningLine` 交互） |
| `LyricsLearningPanel` | 无改动（消费同一个 `LyricsLearningToken` 形状） |

---

## 七、历史痛点与反思（写进规格，作为工程约束）

### P1 主进程被计算阻塞 → 已由 §4.1 utilityProcess 解决

现有 `learningSessionManager.ts` 直接在主进程里 `await analyzeLyricsLearningWithProvider(request)`，其中包含 `generateObject`（网络 + 大量 JSON 解析）。长歌词时主进程事件循环被占满，窗口动画与音频 seek 都会抖。

### P2 内存泄漏的真实根因（`4ff25634` 的教训）

历史提交 `fix: fix the memory leak` 改动了 `AnalyzedGeneralToken.tsx`：移除了手动 `ReactDOM.createPortal` + `document.addEventListener('click', handleClickOutside)`，改用 Radix `Popover`。**教训**：

- 每个 token 挂一个全局 `click` 监听器 → N 个 token × M 次渲染 = 监听器泄漏；
- 现在 `refactor/analyze-lyrics` 的 `LyricsLearningLine` 用 `button` + 父级 `onClick`，没有全局监听器——**这条必须保持**。
- 新增约束：**任何逐行/逐 token 组件都不得注册 `document`/`window` 级监听器**；需要监听播放进度时，由 `LyricsContainer` 统一订阅一次，向下传 `currentLineIndex`。

### P3 Store 深拷贝（`store.ts:62`）

```ts
if (window.api.properties.isInDevelopment) {
  console.debug('store state changed:', cloneDeep(currentState));
}
```

开发模式下每次 `dispatch` 都会 `cloneDeep` 整个 state。把分析结果写进全局 store 会让每次播放进度更新都深拷贝几十 KB 的 JSON。**约束**：分析结果**不进全局 store**，由 `useLyricsAnalysis` 局部管理（§6.5）。

### P4 `dispatch` 频率

`useAudioPlayer.tsx:33` 每次 `timeupdate` 都会 `dispatch` 并派发 `player/positionChange`。行级组件已经按 `useEffect` 订阅该事件（`LyricLine.tsx:86`），但**每行一个监听器**在 100+ 行时仍是 O(N) 次回调/秒。**约束**：新增的分析渲染复用现有 `LyricLine` 的机制（不额外加监听器），后续可统一收敛为单一订阅 + context。

### P5 旧链路的"过度工程化"

需求方明确：不要 Job/Task 状态机、指数退避、状态回滚。B 的状态只有 `LyricsAnalysisSnapshot.status` 的 7 个值（§4.2），**没有** Job 实体、没有持久化队列、没有重试策略（除 HTTP 层由 `ai` SDK 的 `maxRetries` 默认值处理）。

### P6 Pi 包名与 scope 变更

`@earendil-works/pi-mono` 不存在；旧 `@mariozechner/*` 已 deprecated。**约束**：若引入 Pi，只用 `@earendil-works/pi-ai` / `pi-agent-core`，并在 `package.json` 锁定版本（当前 `1.3.0`）。

### P7 双 schema 语言的维护成本

`refactor/analyze-lyrics` 用 `ai` 的 `jsonSchema()` + 手写 `JSONSchema7`（`PROVIDER_OUTPUT_SCHEMA`），同时 `validatorNormalizer.ts` 又用手写类型守卫。两套定义容易漂移。**约束**：v4 只保留 **Zod 单一事实来源**，用 `z.toJSONSchema()`（Zod 4 内置）喂给 `ai` SDK，运行时校验与类型推导共用同一 schema。

---

## 八、迁移与落地计划

### 8.1 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 抽出 `src/common/lyricsAnalysis/{schema,validate}.ts`；把现有 `LyricsLearningToken` 扩展为 v2 schema | 单测覆盖 L1/L2/L3 三层校验；`npm test` 全绿 |
| M2 | `lyrics-analysis-worker` + `?modulePath` 构建；主进程 `host.ts` 中继 | dev 下 `utilityProcess` 正常启动；主进程不再 import `ai`/provider |
| M3 | `streamText + Output.array` 流式实现 + 缓存读写 | 40 行歌词：首行 < 3s；全量 < 25s；缓存命中 < 50ms |
| M4 | 渲染层 `useLyricsAnalysis` + `LyricLine` 状态翻转 | 全屏页 10ms 内出原文；逐行翻转无掉帧（Performance 面板 60fps） |
| M5 | Repair Pass + 降级 UI | 注入坏行（mock 流）后，坏行显示 `degraded`，其余行不受影响 |
| M6 | 旧 `lyricsLearning/*` 下线（保留 settings 读取 provider 配置） | 删除 `learningSessionManager`，无残留 import |

### 8.2 非目标（本期不做）

- 生词本 / 复习 / 跟读打分 / 对话式问答（沿用 `docs/specs/lyrics-analysis-and-learning.md` 的非目标）
- 跨歌曲的分析结果检索
- 多窗口同时分析（主进程单窗口模型不变）
- 把分析结果写回 ID3/LRC

---

## 九、验收基线（可测量）

| 指标 | 目标 |
|---|---|
| 全屏页原文首屏 | ≤ 50ms（LRC 已在主进程缓存） |
| 缓存命中到全部行 ready | ≤ 100ms |
| 缓存未命中首行 ready | ≤ 3s（网络正常，模型支持流式） |
| 40 行全量解析 | ≤ 25s；Repair 追加 ≤ 8s |
| 主进程在解析期间的长任务 | 无 > 50ms 的同步阻塞（DevTools Performance 验证） |
| 坏行隔离 | 单行失败不影响其余行渲染；坏行数 ≤ 10% 时整体仍判 `ready` |
| IPC 消息数 | 40 行 ≤ 12 次（100ms 合批） |
| 触发重新解析的条件 | 仅歌词文本/UI 语言/model/prompt/schema 变化或手动触发 |

---

## 十、开放问题

1. **Pi 是否真的需要**：当前设计里 Pi 没有不可替代的位置。若后续要"根据歌词语言自动选择源站/模型"，再引入 `pi-agent-core` 做工具编排；否则建议直接用 `ai@6` + provider，减少一个依赖族。
2. **`elementStream` 的模型兼容性**（部分已验证）：SDK 侧行为已在 `ai@6.0.134` 上实测完毕（§4.3.1），结论是传输 schema 必须宽松、`streamObject(output:'array')` 不可用、输出不能带任何散文/代码块包裹。仍未验证的是**真实 provider 的漏行率**——需要在目标 provider（当前默认 OpenAI Responses API）上跑一首 40 行歌词，统计"未吐出"与"语义非法"的比例。这个数字直接决定 Repair 阈值与是否需要在 system prompt 里追加输出格式示例。
3. **全屏页与普通歌词页是否共用分析结果**：当前设计以 `songPath` 为会话键，两处可共享；需要确认普通歌词页是否也要展示学习卡片（现有 `docs` 说"仅全屏页启用"）。
4. **歌词来源缓存目录**：A 提议 `cache/lyrics/`；B 建议复用 `userData`（Electron 规范路径），不引入项目根目录下的 `cache/`。

---

## 附录 A：与给定方案的差异清单（速查）

| 给定方案 | 本方案 | 原因 |
|---|---|---|
| 自写 JSONL 协议 + `\n` 切分 | `ai` SDK `Output.array` + `elementStream` | 解析器由库维护，抗模型折行 |
| `validate_lyric_analysis` 作为 Tool 回灌 | 行级纯函数校验 + 一次有界 Repair | 避免流式中间态的多轮往返 |
| Pi `Agent` 承载解析循环 | `streamText` 单次请求；Pi 仅预留于歌词寻查 | 解析无 ReAct 需求；首字延迟低 |
| `hash(title+artist)` 缓存 key | 内容指纹（歌词/语言/model/prompt/schema） | 防串味、防脏命中 |
| TypeBox schema | Zod 4（仓库已有）+ `toJSONSchema()` | 与现有校验层统一；类型推导同源 |
| 缓存目录 `cache/lyrics/` | `userData/lyrics-analysis/` | 平台规范路径，随卸载清理 |
| 未提优先级调度 | 按 `playbackPosition` 优先推送当前行 ±3 | 用户切全屏时"正在唱的那句"必须先就绪 |
| 未提行状态降级 | `ready / degraded / unavailable` 三态 | 单行失败不拖垮整首 |
