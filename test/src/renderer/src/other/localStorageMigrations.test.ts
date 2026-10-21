import { describe, expect, test, vi } from 'vitest';

// appReducer's module graph reaches i18n.ts, which awaits `window.api.settings.getUserSettings()`
// at import time; the node test environment has no window, so stub the calls the import chain
// touches. The stub must exist before the first import below — vitest hoists vi.mock instead,
// but a plain global assignment inside the same module executes after hoisted imports, so mock
// the i18n module itself to a callable t().
vi.mock('../../../../../src/renderer/src/i18n', () => ({
  default: { t: (key: string) => key, use: () => ({ init: () => undefined }) }
}));

import localStorageMigrationData from '../../../../../src/renderer/src/other/localStorageMigrations';
import { LOCAL_STORAGE_DEFAULT_TEMPLATE } from '../../../../../src/renderer/src/other/appReducer';
import isLatestVersion from '../../../../../src/renderer/src/utils/isLatestVersion';
import type { LocalStorage } from '../../../../../src/renderer/src/other/localStorageTemplate';

/**
 * The NetEase quality default moved `standard` → `lossless`. The migration must fire for
 * instances already on a 4.0.0-alpha (whose stored version carries a prerelease suffix), and it
 * must only lift the untouched `standard` value, not an explicit user choice.
 */
describe('localStorage migration 4.0.1 (netease quality default)', () => {
  const migration = localStorageMigrationData['4.0.1'];
  const appVersion = '4.0.0-alpha.5';

  test('the migration key is newer than every 4.0.0-alpha stored version', () => {
    // isLatestVersion ignores prerelease numbers, so an `alpha.N` key would never fire here.
    expect(isLatestVersion('4.0.1', appVersion)).toBe(false);
  });

  test('lifts an untouched `standard` preference to `lossless`', () => {
    expect(migration).toBeDefined();
    const stored = {
      ...LOCAL_STORAGE_DEFAULT_TEMPLATE,
      preferences: { ...LOCAL_STORAGE_DEFAULT_TEMPLATE.preferences, neteaseSongQuality: 'standard' as const }
    } as LocalStorage;

    const migrated = migration!(stored);
    expect(migrated.preferences.neteaseSongQuality).toBe('lossless');
  });

  test('keeps an explicit non-standard user choice', () => {
    for (const choice of ['exhigh', 'lossless'] as const) {
      const stored = {
        ...LOCAL_STORAGE_DEFAULT_TEMPLATE,
        preferences: { ...LOCAL_STORAGE_DEFAULT_TEMPLATE.preferences, neteaseSongQuality: choice }
      } as LocalStorage;

      expect(migration!(stored).preferences.neteaseSongQuality).toBe(choice);
    }
  });

  test('leaves everything else in the store untouched', () => {
    const stored = {
      ...LOCAL_STORAGE_DEFAULT_TEMPLATE,
      preferences: { ...LOCAL_STORAGE_DEFAULT_TEMPLATE.preferences, neteaseSongQuality: 'standard' as const }
    } as LocalStorage;

    const migrated = migration!(stored);
    expect(migrated.preferences.allowNeteaseTrialPlay).toBe(
      stored.preferences.allowNeteaseTrialPlay
    );
    expect(migrated.playback).toBe(stored.playback);
  });
});
