import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  LyricsAnalysisInputLine,
  LyricsAnalysisLine
} from '../../../../src/common/lyricsAnalysis';

/**
 * Regression tests for SUPERSEDED sessions in `prepareLyricsAnalysisSession`.
 *
 * A session is superseded when another `prepareLyricsAnalysisSession` call bumps the generation
 * while its worker is still streaming. The contract being pinned here (see the comment above the
 * renderer fan-out in sessionManager.ts, where losing any of it once lost real lines):
 *
 * - Flush timing: a superseded run still performs its FINAL forced flush after its worker settles
 *   — lines that landed inside the throttle window would otherwise vanish from the song artifact.
 * - Flush content: every line the superseded run landed (order included) reaches the artifact.
 * - Renderer line events: still sent per landed line even after supersession (the renderer filters
 *   by songPath); only the SNAPSHOT stream and `activeSession` stay owned by the newest run.
 *
 * The worker is a controllable fake: each call is held open until the test releases it, so
 * supersession can happen strictly between worker start and worker completion.
 */

const userDataDir = path.join(
  os.tmpdir(),
  `knote-session-superseded-${process.pid}-${Math.random().toString(36).slice(2)}`
);

const { sendLine, sendSnapshot, fakeWindows } = vi.hoisted(() => {
  const sendLine = vi.fn();
  const sendSnapshot = vi.fn();
  const fakeWindows = [
    {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) =>
          channel.endsWith('/line')
            ? sendLine(channel, payload)
            : sendSnapshot(channel, payload)
      }
    }
  ];
  return { sendLine, sendSnapshot, fakeWindows };
});

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => userDataDir) },
    BrowserWindow: { getAllWindows: () => fakeWindows }
  };
});

const analyzeLyricsInWorker = vi.fn();

const cancelLyricsAnalysisRequest = vi.fn();
const inFlightAnalysisRequestIds = vi.fn(() => new Set<string>());

vi.mock('../../../../src/main/lyricsAnalysis/analysisWorkerClient', () => ({
  analyzeLyricsInWorker: (...args: unknown[]) => analyzeLyricsInWorker(...args),
  // Supersede fires these against whatever runs the mock's controlled worker holds.
  cancelLyricsAnalysisRequest: (...args: unknown[]) => cancelLyricsAnalysisRequest(...args),
  inFlightAnalysisRequestIds: (...args: unknown[]) => inFlightAnalysisRequestIds(...args)
}));

vi.mock('../../../../src/main/lyricsAnalysis/providerConfigRepository', () => ({
  getStoredProviderConfig: async () => ({
    baseURL: 'http://127.0.0.1:3425/v1',
    modelId: 'test-model',
    apiKey: 'test-key'
  })
}));

const telemetryEmitter = await import('../../../../src/main/lyricsAnalysis/telemetryEmitter');

vi.mock('../../../../src/main/lyricsAnalysis/telemetryEmitter', () => ({
  emitSessionStartTelemetry: vi.fn(),
  emitFirstLineTelemetry: vi.fn(),
  emitLineResultTelemetry: vi.fn(),
  emitAnalysisPassTelemetry: vi.fn(),
  emitSessionEndTelemetry: vi.fn()
}));

const sessionManager = await import('../../../../src/main/lyricsAnalysis/sessionManager');
const songCache = await import('../../../../src/main/lyricsAnalysis/cacheRepository');

const makeAnalysis = (line: LyricsAnalysisInputLine): LyricsAnalysisLine => ({
  lineId: line.lineId,
  text: line.text,
  translation: `译:${line.text}`,
  status: 'ready',
  tokens: [
    {
      tokenId: `${line.lineId}:0-1`,
      text: line.text.slice(0, 1),
      startChar: 0,
      endChar: 1,
      language: 'ja',
      card: {
        term: line.text.slice(0, 1),
        pronunciation: { kana: 'か', romaji: 'ka' },
        meaning: '意思',
        grammarFunction: '角色'
      }
    }
  ]
});

/** A worker call held open until the test emits its lines and finishes it. */
interface HeldWorker {
  input: {
    lines: LyricsAnalysisInputLine[];
    sessionId?: string;
    onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  };
  emit: (text: string, source?: 'first' | 'repair') => void;
  finish: () => void;
}

const held: HeldWorker[] = [];

const installHeldWorker = () => {
  held.length = 0;
  analyzeLyricsInWorker.mockImplementation(
    (input: HeldWorker['input']) =>
      new Promise<{
        lines: LyricsAnalysisLine[];
        failedLineIds: string[];
        passStats: { outputTokens: number | undefined; inputTokens: number | undefined };
      }>((resolve) => {
        held.push({
          input,
          emit: (text, source = 'first') => {
            const target = input.lines.find((line) => line.text === text);
            if (!target) throw new Error(`worker asked to emit unknown text: ${text}`);
            input.onLine(makeAnalysis(target), source);
          },
          finish: () =>
            resolve({
              lines: input.lines.map(makeAnalysis),
              failedLineIds: [],
              passStats: { outputTokens: 1, inputTokens: 1 }
            })
        });
      })
  );
};

const request = (overrides: {
  songPath?: string;
  songTitle?: string;
  lines: LyricsAnalysisInputLine[];
}) => ({
  songPath: overrides.songPath ?? '/music/a.flac',
  songTitle: overrides.songTitle ?? 'Song A',
  songArtists: ['Artist'],
  uiLanguage: 'zh-CN',
  lines: overrides.lines,
  forceRefresh: undefined
});

const lines = (...texts: string[]): LyricsAnalysisInputLine[] =>
  texts.map((text, index) => ({ lineId: `line-${index}`, text }));

const lineEventsFor = (songPath: string) =>
  sendLine.mock.calls
    .filter(([, payload]) => (payload as { songPath: string }).songPath === songPath)
    .map(([, payload]) => (payload as { line: { lineId: string } }).line.lineId);

const snapshotEvents = () =>
  sendSnapshot.mock.calls.map(([, payload]) => {
    const p = payload as { songPath: string; status: string };
    return `${p.songPath}:${p.status}`;
  });

describe('superseded lyrics analysis sessions', () => {
  beforeEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
    analyzeLyricsInWorker.mockReset();
    cancelLyricsAnalysisRequest.mockReset();
    inFlightAnalysisRequestIds.mockReset();
    inFlightAnalysisRequestIds.mockImplementation(() => new Set<string>());
    sendLine.mockClear();
    sendSnapshot.mockClear();
    vi.mocked(telemetryEmitter.emitSessionEndTelemetry).mockClear();
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('a superseded run still flushes all its lines (final forced flush) and still emits them to the renderer, while the snapshot stays with the new run', async () => {
    installHeldWorker();

    const linesA = lines('夢ならば', 'どれほど');
    const prepareA = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: linesA })
    );
    await vi.waitFor(() => expect(held).toHaveLength(1));

    // Starting run B supersedes A mid-flight.
    const prepareB = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/b.flac', songTitle: 'Song B', lines: lines('新しい歌詞') })
    );
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1].emit('新しい歌詞');
    held[1].finish();
    const snapshotB = await prepareB;
    expect(snapshotB.status).toBe('ready');

    // A is now superseded. Land its two lines anyway: the first schedules a mid-run flush, the
    // second lands inside the throttle window — only the superseded branch's FINAL forced flush
    // can persist it. Removing that flush is exactly the historical line-loss bug.
    held[0].emit('夢ならば');
    held[0].emit('どれほど');
    held[0].finish();
    await prepareA;

    // Flush content: both lines, in landing order, under A's own fingerprint.
    const fingerprintA = songCache.buildLyricsAnalysisFingerprint({
      lines: linesA,
      uiLanguage: 'zh-CN',
      modelId: 'test-model'
    });
    const artifact = await songCache.readLyricsAnalysisPartialCache(fingerprintA);
    expect(artifact?.lines.map((line) => line.lineId)).toEqual(['line-0', 'line-1']);

    // Renderer line events: both of A's lines were still fanned out after supersession.
    expect(lineEventsFor('/music/a.flac')).toEqual(['line-0', 'line-1']);
    expect(lineEventsFor('/music/b.flac')).toEqual(['line-0']);

    // Snapshot stream: A announced itself once at start, then never took the state back after
    // being superseded — the snapshot sequence is owned by B from B's start onward.
    expect(snapshotEvents()).toEqual([
      '/music/a.flac:analyzing',
      '/music/b.flac:analyzing',
      '/music/b.flac:ready'
    ]);
    expect(sessionManager.getLyricsAnalysisSession()?.songPath).toBe('/music/b.flac');

    // The superseded run still closes its own telemetry, and its two landed lines make it 'ready'.
    const fingerprintAPrefix = fingerprintA.slice(0, 12);
    const endCalls = vi.mocked(telemetryEmitter.emitSessionEndTelemetry).mock.calls;
    const aEnd = endCalls.find(([{ session }]) =>
      session.sessionId.startsWith(fingerprintAPrefix)
    );
    expect(aEnd?.[0].outcome).toBe('ready');
  });

  test('a superseded run that lands nothing writes no artifact but still closes its telemetry as partial', async () => {
    installHeldWorker();

    const linesA = lines('夢ならば');
    const prepareA = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: linesA })
    );
    await vi.waitFor(() => expect(held).toHaveLength(1));

    const prepareB = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/b.flac', songTitle: 'Song B', lines: lines('新しい歌詞') })
    );
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1].emit('新しい歌詞');
    held[1].finish();
    await prepareB;

    // A resolves without ever landing a line.
    held[0].finish();
    await prepareA;

    const fingerprintA = songCache.buildLyricsAnalysisFingerprint({
      lines: linesA,
      uiLanguage: 'zh-CN',
      modelId: 'test-model'
    });
    expect(await songCache.readLyricsAnalysisPartialCache(fingerprintA)).toBeUndefined();

    const aEnd = vi
      .mocked(telemetryEmitter.emitSessionEndTelemetry)
      .mock.calls.find(([{ session }]) => session.sessionId.startsWith(fingerprintA.slice(0, 12)));
    // Its one request line never landed, superseded or not — the telemetry says 'partial'.
    expect(aEnd?.[0].outcome).toBe('partial');
    expect(sessionManager.getLyricsAnalysisSession()?.songPath).toBe('/music/b.flac');
  });
  test('superseding a run cancels its stale worker request so it stops consuming gateway capacity', async () => {
    installHeldWorker();

    // Nothing is in flight when the first song's prepare starts, so nothing gets cancelled.
    const prepareA = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: lines('夢ならば') })
    );
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(cancelLyricsAnalysisRequest).not.toHaveBeenCalled();

    // A's request is now the one live worker call (the fake client's ids are simulated).
    inFlightAnalysisRequestIds.mockImplementation(() => new Set(['req-a']));

    // Run B supersedes A mid-flight: A's worker request must be cancelled immediately.
    const prepareB = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/b.flac', songTitle: 'Song B', lines: lines('新しい歌詞') })
    );
    expect(cancelLyricsAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(cancelLyricsAnalysisRequest).toHaveBeenCalledWith('req-a');

    // B still completes normally after the cut.
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1].emit('新しい歌詞');
    held[1].finish();
    const snapshotB = await prepareB;
    expect(snapshotB.status).toBe('ready');

    held[0].finish();
    await prepareA;
  });
  test('an empty-line prepare is refused: it must not supersede or cancel a healthy in-flight run', async () => {
    installHeldWorker();

    // A healthy run for song A is in flight.
    const prepareA = sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: lines('夢ならば') })
    );
    await vi.waitFor(() => expect(held).toHaveLength(1));

    // A ghost prepare with zero lines (stale-ref race) arrives. It must be refused before
    // bumping the generation — A stays current and its worker request is never cancelled.
    // The refusal returns the current session unchanged (no snapshot of its own).
    const ghostSnapshot = await sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/ghost.flac', songTitle: 'Ghost', lines: [] })
    );
    expect(ghostSnapshot?.songPath).toBe('/music/a.flac');

    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(cancelLyricsAnalysisRequest).not.toHaveBeenCalled();

    // A still completes as the current session.
    held[0].emit('夢ならば');
    held[0].finish();
    const snapshotA = await prepareA;
    expect(snapshotA.status).toBe('ready');
    expect(sessionManager.getLyricsAnalysisSession()?.songPath).toBe('/music/a.flac');
  });
});
