import { isNeteaseSongId, tryDecodeNeteaseSongId } from '@common/netease';
import { neteaseQuery } from '@renderer/queries/netease';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import {
  ensureNeteaseLikes,
  isNeteaseSongLiked,
  resetNeteaseLikes,
  toggleNeteaseSongFavorite
} from '../other/neteaseLikes';
import toggleSongIsFavorite from '../other/toggleSongIsFavorite';
import { dispatch, store } from '../store/store';
import storage from '../utils/localStorage';
import { useUserPreferences } from './useUserPreferences';

/**
 * Hook for managing playback settings (repeat, volume, mute, position, favorites, equalizer).
 *
 * This hook provides functions to control various playback settings including repeat modes, volume
 * control, mute state, song position seeking, favorite song toggling, and equalizer presets. All
 * settings are persisted to localStorage where appropriate.
 *
 * @example
 *   ```tsx
 *   const {
 *   toggleRepeat,
 *   toggleMutedState,
 *   updateVolume,
 *   updateSongPosition,
 *   toggleIsFavorite,
 *   updateEqualizerOptions
 *   } = usePlaybackSettings(player);
 *
 *   // Use in UI controls
 *   <button onClick={() => toggleRepeat()}>Repeat</button>
 *   <input onChange={(e) => updateVolume(e.target.value)} />
 *   updateEqualizerOptions({ preset: 'rock', bands: [...] });
 *   ```;
 *
 * @param player - The HTMLAudioElement instance
 * @returns Object containing playback setting functions
 */
export function usePlaybackSettings(player: HTMLAudioElement) {
  const { saveEqualizerPreset } = useUserPreferences();

  // Keep the NetEase likes cache warm and account-scoped: every session change (login, logout,
  // account switch — broadcast from the main process) drops the old likes and loads the new
  // user's, so heart states on player surfaces reflect reality without per-song round-trips.
  // Once loaded, also corrects the playing song's heart — `buildNeteasePlayerSongData` defaults
  // to unliked and the cache may finish loading after playback already started.
  const { data: neteaseProfile } = useQuery(neteaseQuery.session);
  useEffect(() => {
    if (!neteaseProfile?.userId) {
      resetNeteaseLikes();
      return undefined;
    }
    ensureNeteaseLikes(neteaseProfile.userId)
      .then(() => {
        const { songId } = store.state.currentSongData;
        if (tryDecodeNeteaseSongId(songId) !== null) {
          const isLiked = isNeteaseSongLiked(songId);
          if (isLiked !== store.state.currentSongData.isAFavorite) {
            store.state.currentSongData.isAFavorite = isLiked;
            dispatch({ type: 'TOGGLE_IS_FAVORITE_STATE', data: isLiked });
          }
        }
        return undefined;
      })
      .catch((err) => console.error(err));
    return undefined;
  }, [neteaseProfile?.userId]);

  const toggleRepeat = useCallback((newState?: RepeatTypes) => {
    const repeatState =
      newState ||
      (store.state.player.isRepeating === 'false'
        ? 'repeat'
        : store.state.player.isRepeating === 'repeat'
          ? 'repeat-1'
          : 'false');

    dispatch({
      type: 'UPDATE_IS_REPEATING_STATE',
      data: repeatState
    });
  }, []);

  const toggleMutedState = useCallback((isMute?: boolean) => {
    if (isMute !== undefined) {
      if (isMute !== store.state.player.volume.isMuted) {
        dispatch({ type: 'UPDATE_MUTED_STATE', data: isMute });
      }
    } else {
      dispatch({ type: 'UPDATE_MUTED_STATE' });
    }
  }, []);

  const updateVolume = useCallback((volume: number) => {
    storage.playback.setVolumeOptions('value', volume);

    dispatch({
      type: 'UPDATE_VOLUME_VALUE',
      data: volume
    });
  }, []);

  const updateSongPosition = useCallback(
    (position: number) => {
      if (position >= 0 && position <= player.duration) player.currentTime = position;
    },
    [player]
  );

  const toggleIsFavorite = useCallback(
    (isFavorite?: boolean, onlyChangeCurrentSongData = false) => {
      // NetEase songs live in the negative id space and like through the NetEase API; the local
      // toggle would try to flip them in the library DB, which has no such rows.
      if (isNeteaseSongId(store.state.currentSongData.songId)) {
        void toggleNeteaseSongFavorite(store.state.currentSongData, isFavorite)
          .then((newFavorite) => {
            if (typeof newFavorite === 'boolean') {
              store.state.currentSongData.isAFavorite = newFavorite;
              return dispatch({
                type: 'TOGGLE_IS_FAVORITE_STATE',
                data: newFavorite
              });
            }
            return undefined;
          })
          .catch((err) => console.error(err));
        return;
      }

      toggleSongIsFavorite(
        store.state.currentSongData.songId,
        store.state.currentSongData.isAFavorite,
        isFavorite,
        onlyChangeCurrentSongData
      )
        .then((newFavorite) => {
          if (typeof newFavorite === 'boolean') {
            return dispatch({
              type: 'TOGGLE_IS_FAVORITE_STATE',
              data: newFavorite
            });
          }
          return undefined;
        })
        .catch((err) => console.error(err));
    },
    []
  );

  const updateEqualizerOptions = useCallback(
    (options: Equalizer) => {
      saveEqualizerPreset(options);
    },
    [saveEqualizerPreset]
  );

  return {
    toggleRepeat,
    toggleMutedState,
    updateVolume,
    updateSongPosition,
    toggleIsFavorite,
    updateEqualizerOptions
  };
}
