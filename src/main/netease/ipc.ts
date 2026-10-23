import { ipcMain } from 'electron';

import type { NeteaseSearchTypes } from '../../common/netease';
import logger from '../logger';
import { checkNeteaseQrLogin, getNeteaseMe, neteaseLogout, startNeteaseQrLogin } from './auth';
import {
  getNeteaseAlbum,
  getNeteaseArtist,
  getNeteaseLikedSongIds,
  getNeteasePersonalizedPlaylists,
  getNeteasePlaylist,
  getNeteaseRecommendSongs,
  getNeteaseSongSummaries,
  getNeteaseSongSummary,
  getNeteaseStream,
  getNeteaseToplists,
  getNeteaseUserPlaylists,
  likeUnlikeNeteaseSong,
  searchNetease,
  searchNeteaseSuggestions
} from './catalog';
import { NeteaseApiError } from './client';
import { getNeteaseLyrics } from './lyrics';
import { getNeteaseSongPalette } from './paletteCache';

/** Normalizes errors thrown inside handlers into renderer-friendly strings. */
const withNeteaseErrorHandling = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    const knownErrorCodes = ['NETEASE_AUTH_REQUIRED', 'NETEASE_NETWORK_ERROR'];

    // Known domain errors surface as-is; the renderer does not switch on these codes yet, so they
    // currently surface through react-query's generic failure states.
    if (error instanceof Error && knownErrorCodes.includes(error.message)) throw error;

    if (error instanceof NeteaseApiError) {
      logger.warn(`NetEase request failed with code ${error.code}.`, { error });
      throw new Error(`NETEASE_REQUEST_FAILED:${error.code ?? 'unknown'}`);
    }

    logger.warn('NetEase request failed unexpectedly.', { error });
    throw new Error('NETEASE_REQUEST_FAILED:unknown');
  }
};

export const registerNeteaseIpc = () => {
  ipcMain.handle('app/netease/startQrLogin', () =>
    withNeteaseErrorHandling(() => startNeteaseQrLogin())
  );

  ipcMain.handle('app/netease/checkQrLogin', (_, key: string) =>
    withNeteaseErrorHandling(() => checkNeteaseQrLogin(key))
  );

  ipcMain.handle('app/netease/getMe', () => withNeteaseErrorHandling(() => getNeteaseMe()));

  ipcMain.handle('app/netease/logOut', () => withNeteaseErrorHandling(() => neteaseLogout()));

  ipcMain.handle(
    'app/netease/search',
    (_, keywords: string, type: NeteaseSearchTypes) =>
      withNeteaseErrorHandling(() => searchNetease(keywords, type))
  );

  ipcMain.handle('app/netease/searchSuggest', (_, keywords: string) =>
    withNeteaseErrorHandling(() => searchNeteaseSuggestions(keywords))
  );

  ipcMain.handle('app/netease/getPlaylist', (_, playlistId: string) =>
    withNeteaseErrorHandling(() => getNeteasePlaylist(playlistId))
  );

  ipcMain.handle('app/netease/getAlbum', (_, albumId: string | number) =>
    withNeteaseErrorHandling(() => getNeteaseAlbum(albumId))
  );

  ipcMain.handle('app/netease/getArtist', (_, artistId: string | number) =>
    withNeteaseErrorHandling(() => getNeteaseArtist(artistId))
  );

  ipcMain.handle('app/netease/getSongSummary', (_, neteaseId: number) =>
    withNeteaseErrorHandling(() => getNeteaseSongSummary(neteaseId))
  );

  ipcMain.handle('app/netease/getSongSummaries', (_, neteaseIds: number[]) =>
    withNeteaseErrorHandling(() => getNeteaseSongSummaries(neteaseIds))
  );

  ipcMain.handle('app/netease/getStream', (_, neteaseId: number, quality: string) =>
    withNeteaseErrorHandling(() => getNeteaseStream(neteaseId, quality as never))
  );

  ipcMain.handle('app/netease/getUserPlaylists', (_, userId: number) =>
    withNeteaseErrorHandling(() => getNeteaseUserPlaylists(userId))
  );

  ipcMain.handle('app/netease/getLikedSongIds', (_, userId: number) =>
    withNeteaseErrorHandling(() => getNeteaseLikedSongIds(userId))
  );

  ipcMain.handle(
    'app/netease/likeUnlikeSong',
    (_, neteaseId: number, isLike: boolean) =>
      withNeteaseErrorHandling(() => likeUnlikeNeteaseSong(neteaseId, isLike))
  );

  ipcMain.handle('app/netease/getRecommendations', () =>
    withNeteaseErrorHandling(() => getNeteaseRecommendSongs())
  );

  ipcMain.handle('app/netease/getPersonalizedPlaylists', () =>
    withNeteaseErrorHandling(() => getNeteasePersonalizedPlaylists())
  );

  ipcMain.handle('app/netease/getToplists', () =>
    withNeteaseErrorHandling(() => getNeteaseToplists())
  );

  ipcMain.handle('app/netease/getLyrics', (_, neteaseId: number) =>
    withNeteaseErrorHandling(() => getNeteaseLyrics(neteaseId))
  );

  ipcMain.handle('app/netease/getSongPalette', (_, neteaseId: number, coverUrl?: string) =>
    withNeteaseErrorHandling(() => getNeteaseSongPalette(neteaseId, coverUrl))
  );
};
