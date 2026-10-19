import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useEffect, useState } from 'react';

import i18n from '../i18n';

type Options = {
  /**
   * When false, the effect body is skipped entirely: no reset, no request, lyrics stay `null`.
   * The effect re-runs when this flips, so callers gate loading on their own visibility flags.
   */
  enabled?: boolean;
  /**
   * Called with the freshly fetched (not yet translated/romanized) response, before the lyrics
   * state itself is set. The fullscreen container uses it to report synced availability to the
   * control bar ahead of the (possibly multi-await) enhancement sequence. Must be a stable
   * callback — it is a dependency of the loading effect.
   */
  onLyricsLoaded?: (res: SongLyrics | undefined) => void;
};

/**
 * Loads the current song's lyrics and applies the auto-translate / auto-convert (pinyin, romaji,
 * romaja) preferences on top of them, mirroring the pipeline both the fullscreen and the mini
 * lyrics containers ran inline. The state sequence — reset to `null` on song/preference change,
 * set the raw response, then each awaited enhancement — is kept beat-for-beat from the original
 * implementations, including the absence of stale-response guarding: the last `setLyrics` to
 * settle wins, exactly as before.
 */
const useSongLyrics = ({ enabled = true, onLyricsLoaded }: Options = {}) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const [lyrics, setLyrics] = useState<SongLyrics | null | undefined>(null);

  useEffect(() => {
    if (enabled) {
      setLyrics(null);
      window.api.lyrics
        .getSongLyrics({
          songTitle: currentSongData.title,
          songArtists: Array.isArray(currentSongData.artists)
            ? currentSongData.artists.map((artist) => artist.name)
            : [],
          album: currentSongData.album?.name,
          songPath: currentSongData.path,
          duration: currentSongData.duration
        })
        .then(async (res) => {
          onLyricsLoaded?.(res);
          setLyrics(res);

          if (
            preferences.autoTranslateLyrics &&
            !res?.lyrics.isReset &&
            !res?.lyrics.isTranslated
          ) {
            setLyrics(await window.api.lyrics.getTranslatedLyrics(i18n.language as LanguageCodes));
          }
          if (preferences.autoConvertLyrics && !res?.lyrics.isReset && !res?.lyrics.isRomanized) {
            if (res?.lyrics.originalLanguage == 'zh')
              setLyrics(await window.api.lyrics.convertLyricsToPinyin());
            else if (res?.lyrics.originalLanguage == 'ja')
              setLyrics(await window.api.lyrics.romanizeLyrics());
            else if (res?.lyrics.originalLanguage == 'ko')
              setLyrics(await window.api.lyrics.convertLyricsToRomaja());
          }
        })
        .catch((err) => console.error(err));
    }
  }, [
    enabled,
    currentSongData.album?.name,
    currentSongData.artists,
    currentSongData.duration,
    currentSongData.path,
    currentSongData.songId,
    currentSongData.title,
    preferences.autoTranslateLyrics,
    preferences.autoConvertLyrics,
    onLyricsLoaded
  ]);

  return { lyrics };
};

export default useSongLyrics;
