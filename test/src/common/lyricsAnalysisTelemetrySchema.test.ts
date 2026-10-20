import { describe, expect, test } from 'vitest';

import {
  LYRICS_ANALYSIS_TELEMETRY_VERSION,
  analysisPassEventSchema,
  firstLineEventSchema,
  lineResultEventSchema,
  lyricsAnalysisTelemetryEventSchema,
  sessionEndEventSchema,
  sessionStartEventSchema
} from '../../../src/common/lyricsAnalysisTelemetry';

/**
 * Contract tests for the telemetry zod union: every event kind round-trips a legal sample, the
 * version field is required (v1-only readers reject later shapes), unknown kinds are rejected,
 * and nullish fields accept both explicit null and absence. The producers (main process +
 * worker via telemetryEmitter / providerGateway) and the evaluation scripts all parse through
 * these schemas, so the union is the single cross-process contract.
 */

const base = {
  v: LYRICS_ANALYSIS_TELEMETRY_VERSION,
  sessionId: 'sess-abc123',
  ts: 1760000000000
};

describe('session-start events', () => {
  const valid = {
    ...base,
    kind: 'session-start',
    totalLines: 42,
    preCachedLines: 12,
    requestedLines: 30
  };

  test('accepts a legal sample (round-trip)', () => {
    const parsed = sessionStartEventSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  test('rejects a missing v', () => {
    const { v: _v, ...withoutV } = valid;
    expect(sessionStartEventSchema.safeParse(withoutV).success).toBe(false);
  });
});

describe('first-line events', () => {
  const valid = {
    ...base,
    kind: 'first-line',
    latencyMs: 830,
    source: 'first'
  };

  test('accepts a legal sample (round-trip)', () => {
    const parsed = firstLineEventSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  test('rejects a source outside the enum', () => {
    expect(firstLineEventSchema.safeParse({ ...valid, source: 'retry' }).success).toBe(false);
  });
});

describe('analysis-pass events', () => {
  const valid = {
    ...base,
    kind: 'analysis-pass',
    batchIndex: 2,
    passKind: 'repair',
    targetLines: 4,
    okLines: 3,
    failedLines: 1,
    durationMs: 2190,
    finishReason: 'stop',
    outputTokens: 812,
    inputTokens: 2210,
    repairedLines: 1
  };

  test('accepts a legal sample (round-trip)', () => {
    const parsed = analysisPassEventSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  test('accepts nullish token/finish fields both as null and as absent', () => {
    const asNull = {
      ...base,
      kind: 'analysis-pass',
      batchIndex: 0,
      passKind: 'first',
      targetLines: 1,
      okLines: 0,
      failedLines: 1,
      durationMs: 5,
      finishReason: null,
      outputTokens: null,
      inputTokens: null
    };
    expect(analysisPassEventSchema.parse(asNull)).toEqual(asNull);

    const { finishReason, outputTokens, inputTokens, ...absent } = asNull;
    expect(analysisPassEventSchema.parse(absent)).toEqual(absent);
  });

  test('accepts a repairedLines-absent first pass', () => {
    const { repairedLines, ...withoutRepaired } = valid;
    expect(analysisPassEventSchema.parse(withoutRepaired)).toEqual(withoutRepaired);
  });

  test('rejects negative counters', () => {
    expect(analysisPassEventSchema.safeParse({ ...valid, okLines: -1 }).success).toBe(false);
  });
});

describe('line-result events', () => {
  const valid = {
    ...base,
    kind: 'line-result',
    lineId: 'line-17',
    source: 'repair',
    textLength: 12,
    tokenCount: 3,
    droppedTokenCount: 1,
    coverage: 0.986,
    status: 'degraded'
  };

  test('accepts a legal sample (round-trip)', () => {
    const parsed = lineResultEventSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  test('rejects coverage outside 0..1', () => {
    expect(lineResultEventSchema.safeParse({ ...valid, coverage: 1.2 }).success).toBe(false);
    expect(lineResultEventSchema.safeParse({ ...valid, coverage: -0.1 }).success).toBe(false);
  });
});

describe('session-end events', () => {
  const valid = {
    ...base,
    kind: 'session-end',
    outcome: 'partial',
    durationMs: 41000,
    totalLines: 42,
    okLines: 41,
    failedLines: 1,
    passCount: 12,
    outputTokens: 9999,
    modelId: 'glm-5.3-flash',
    concurrencyWindowMax: 8,
    concurrencyWindowMean: 4.62,
    rateLimitedCount: 2
  };

  test('accepts a legal sample (round-trip)', () => {
    const parsed = sessionEndEventSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  test('accepts the error variant with an optional errorCode', () => {
    const errorEvent = {
      ...valid,
      outcome: 'error',
      outputTokens: null,
      concurrencyWindowMax: null,
      concurrencyWindowMean: null,
      rateLimitedCount: null,
      errorCode: 'authFailed'
    };
    expect(sessionEndEventSchema.parse(errorEvent)).toEqual(errorEvent);
  });

  test('accepts pre-concurrency events without the window fields (v1 backward compatibility)', () => {
    const legacy = {
      ...base,
      kind: 'session-end',
      outcome: 'ready',
      durationMs: 1200,
      totalLines: 3,
      okLines: 3,
      failedLines: 0,
      passCount: 1,
      outputTokens: 120,
      modelId: 'test-model'
    };
    expect(sessionEndEventSchema.parse(legacy)).toEqual(legacy);
  });

  test('rejects an outcome outside the enum', () => {
    expect(sessionEndEventSchema.safeParse({ ...valid, outcome: 'aborted' }).success).toBe(false);
  });
});

describe('the discriminated union', () => {
  test('every kind has a legal sample that round-trips through the union', () => {
    const samples = [
      {
        ...base,
        kind: 'session-start',
        totalLines: 1,
        preCachedLines: 0,
        requestedLines: 1
      },
      { ...base, kind: 'first-line', latencyMs: 1, source: 'first' },
      {
        ...base,
        kind: 'analysis-pass',
        batchIndex: 0,
        passKind: 'first',
        targetLines: 1,
        okLines: 1,
        failedLines: 0,
        durationMs: 10,
        finishReason: null,
        outputTokens: null,
        inputTokens: null
      },
      {
        ...base,
        kind: 'line-result',
        lineId: 'line-0',
        source: 'first',
        textLength: 3,
        tokenCount: 1,
        droppedTokenCount: 0,
        coverage: 1,
        status: 'ready'
      },
      {
        ...base,
        kind: 'session-end',
        outcome: 'ready',
        durationMs: 100,
        totalLines: 1,
        okLines: 1,
        failedLines: 0,
        passCount: 1,
        outputTokens: 10,
        modelId: 'test-model'
      }
    ];

    for (const sample of samples) {
      expect(lyricsAnalysisTelemetryEventSchema.parse(sample)).toEqual(sample);
    }
  });

  test('rejects an unknown kind', () => {
    expect(
      lyricsAnalysisTelemetryEventSchema.safeParse({
        ...base,
        kind: 'analysis-crash'
      }).success
    ).toBe(false);
  });

  test('rejects an event missing its kind', () => {
    const { kind: _kind, ...withoutKind } = {
      ...base,
      kind: 'first-line',
      latencyMs: 1,
      source: 'first'
    };
    expect(lyricsAnalysisTelemetryEventSchema.safeParse(withoutKind).success).toBe(false);
  });

  test('rejects every kind when v is missing', () => {
    for (const kind of [
      'session-start',
      'first-line',
      'analysis-pass',
      'line-result',
      'session-end'
    ]) {
      const sample = { ...base, kind };
      const { v: _v, ...withoutV } = sample;
      expect(lyricsAnalysisTelemetryEventSchema.safeParse(withoutV).success).toBe(false);
    }
  });

  test('rejects a session-id-less event (base requires min(1))', () => {
    expect(
      lyricsAnalysisTelemetryEventSchema.safeParse({
        ...base,
        sessionId: '',
        kind: 'first-line',
        latencyMs: 1,
        source: 'first'
      }).success
    ).toBe(false);
  });
});
