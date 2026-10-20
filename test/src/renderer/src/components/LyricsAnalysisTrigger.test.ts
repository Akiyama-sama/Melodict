import { describe, expect, test } from 'vitest';

import {
  canPiggybackOnSession
} from '../../../../../src/renderer/src/other/lyricsAnalysisSessionReuse';

/**
 * Unit tests for the app-level analysis trigger's session-reuse decision. The trigger mounts at
 * the app root and fires prepareSession when a song starts playing with synced lyrics; before
 * preparing it asks the main process for the active session and must NOT prepare (supersede) a
 * session that is already live or already finished for the same song. A live run superseded by a
 * redundant prepare would bump its generation and lose renderer-side line streaming continuity —
 * this helper is the guard.
 */

const snapshot = (
  songPath: string,
  status: LyricsAnalysisSnapshot['status']
): LyricsAnalysisSnapshot => ({
  songPath,
  status,
  updatedAt: 0
});

describe('canPiggybackOnSession', () => {
  test('piggybacks on a live (analyzing/repairing) session of the same song', () => {
    expect(canPiggybackOnSession(snapshot('/a.flac', 'analyzing'), '/a.flac')).toBe(true);
    expect(canPiggybackOnSession(snapshot('/a.flac', 'repairing'), '/a.flac')).toBe(true);
  });

  test('piggybacks on a finished (ready/cached) session of the same song', () => {
    expect(canPiggybackOnSession(snapshot('/a.flac', 'ready'), '/a.flac')).toBe(true);
    expect(canPiggybackOnSession(snapshot('/a.flac', 'cached'), '/a.flac')).toBe(true);
  });

  test('prepares fresh on an errored, not-configured, or other song session', () => {
    expect(canPiggybackOnSession(snapshot('/a.flac', 'error'), '/a.flac')).toBe(false);
    expect(canPiggybackOnSession(snapshot('/a.flac', 'notConfigured'), '/a.flac')).toBe(false);
    expect(canPiggybackOnSession(snapshot('/b.flac', 'analyzing'), '/a.flac')).toBe(false);
  });

  test('prepares fresh when there is no session at all', () => {
    expect(canPiggybackOnSession(undefined, '/a.flac')).toBe(false);
  });
});
