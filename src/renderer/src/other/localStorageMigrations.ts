import type { MigrationData } from '../utils/localStorage';
import { LOCAL_STORAGE_DEFAULT_TEMPLATE } from './appReducer';

const localStorageMigrationData: MigrationData = {
  '4.0.0-alpha.3': (_) => {
    return LOCAL_STORAGE_DEFAULT_TEMPLATE;
  },
  // The NetEase quality default moved from `standard` to `lossless` (the stream resolver now
  // falls back on its own), but instances that had never touched the dropdown still carried the
  // stored `standard`. Only the untouched value is lifted; an explicit user choice survives.
  // Keyed above 4.0.0 on purpose: `isLatestVersion` ignores prerelease numbers, so an
  // `alpha.N` key would never fire for instances already on a 4.0.0-alpha.
  '4.0.1': (localStorage) => {
    if (localStorage.preferences.neteaseSongQuality === 'standard') {
      return {
        ...localStorage,
        preferences: { ...localStorage.preferences, neteaseSongQuality: 'lossless' }
      };
    }
    return localStorage;
  }
};

export default localStorageMigrationData;
