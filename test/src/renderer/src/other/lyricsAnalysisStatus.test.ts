import { describe, expect, test } from 'vitest';

import {
  deriveLyricsAnalysisUiStatus,
  IDLE_LYRICS_ANALYSIS_STATUS
} from '../../../../../src/renderer/src/other/lyricsAnalysisStatus';

const snapshot = (status: LyricsAnalysisSnapshot['status']): LyricsAnalysisSnapshot => ({
  songPath: '/music/song.mp3',
  status,
  updatedAt: 0
});

describe('deriveLyricsAnalysisUiStatus', () => {
  test('stays idle when analysis is disabled or there is nothing to analyze', () => {
    expect(
      deriveLyricsAnalysisUiStatus({
        isEnabled: false,
        totalLines: 10,
        completedLines: 0,
        snapshot: snapshot('analyzing')
      })
    ).toEqual({ ...IDLE_LYRICS_ANALYSIS_STATUS, totalLines: 10 });

    expect(
      deriveLyricsAnalysisUiStatus({ isEnabled: true, totalLines: 0, completedLines: 0 })
    ).toEqual(IDLE_LYRICS_ANALYSIS_STATUS);
  });

  test('reports preparing until the first snapshot arrives', () => {
    expect(
      deriveLyricsAnalysisUiStatus({ isEnabled: true, totalLines: 10, completedLines: 0 }).phase
    ).toBe('preparing');
  });

  test('maps each snapshot status to its phase', () => {
    const phases = (['notConfigured', 'cached', 'analyzing', 'repairing'] as const).map(
      (status) =>
        deriveLyricsAnalysisUiStatus({
          isEnabled: true,
          totalLines: 10,
          completedLines: 3,
          snapshot: snapshot(status)
        }).phase
    );

    expect(phases).toEqual(['notConfigured', 'cached', 'analyzing', 'repairing']);
  });

  test('splits a finished run into ready and partial using the completed line count', () => {
    const ready = deriveLyricsAnalysisUiStatus({
      isEnabled: true,
      totalLines: 10,
      completedLines: 10,
      snapshot: snapshot('ready')
    });
    expect(ready).toMatchObject({ phase: 'ready', completedLines: 10, totalLines: 10 });

    const partial = deriveLyricsAnalysisUiStatus({
      isEnabled: true,
      totalLines: 10,
      completedLines: 7,
      snapshot: snapshot('ready')
    });
    expect(partial).toMatchObject({ phase: 'partial', completedLines: 7, totalLines: 10 });
  });

  test('carries the error code and status code into the error phase', () => {
    const error = deriveLyricsAnalysisUiStatus({
      isEnabled: true,
      totalLines: 10,
      completedLines: 0,
      snapshot: {
        ...snapshot('error'),
        error: { code: 'authFailed', message: 'rejected', statusCode: 401 }
      }
    });

    expect(error).toMatchObject({
      phase: 'error',
      errorCode: 'authFailed',
      errorStatusCode: 401
    });
  });
});
