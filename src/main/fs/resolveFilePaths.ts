// import path from 'path';
import { join as joinPath } from 'node:path/posix';

import { platform } from 'process';

import { DEFAULT_ARTWORK_SAVE_LOCATION, DEFAULT_FILE_URL } from '../filesystem';

import albumCoverImage from '../../renderer/src/assets/images/webp/album_cover_default.webp?asset';
import songCoverImage from '../../renderer/src/assets/images/webp/song_cover_default.webp?asset';
import artistCoverImage from '../../renderer/src/assets/images/webp/artist_cover_default.webp?asset';
import playlistCoverImage from '../../renderer/src/assets/images/webp/playlist_cover_default.webp?asset';
import favoritesPlaylistCoverImage from '../../renderer/src/assets/images/webp/favorites-playlist-icon.webp?asset';
import historyPlaylistCoverImage from '../../renderer/src/assets/images/webp/history-playlist-icon.webp?asset';

let timestamps = {
  songs: Date.now(),
  songArtworks: Date.now(),
  artistArtworks: Date.now(),
  albumArtworks: Date.now(),
  playlistArtworks: Date.now(),
  genreArtworks: Date.now()
};

export const resetArtworkCache = (type: keyof typeof timestamps | 'all') => {
  const now = Date.now();
  if (type === 'all') {
    timestamps = {
      songs: now,
      songArtworks: now,
      artistArtworks: now,
      albumArtworks: now,
      playlistArtworks: now,
      genreArtworks: now
    };
  } else timestamps[type] = now;
  return now;
};

export const resolveSongFilePath = (songPath: string, resetCache = true, sendRealPath = false) => {
  if (resetCache) resetArtworkCache('songs');

  const FILE_URL = sendRealPath ? '' : DEFAULT_FILE_URL;
  const timestampStr = sendRealPath ? '' : `?ts=${timestamps.songs}`;

  const resolvedFilePath = joinPath(FILE_URL, songPath) + timestampStr;
  return resolvedFilePath;
};

export const getSongArtworkPath = (
  id: string,
  isArtworkAvailable = true,
  resetCache = false,
  sendRealPath = false
): ArtworkPaths => {
  if (resetCache) resetArtworkCache('songArtworks');

  const FILE_URL = sendRealPath ? '' : DEFAULT_FILE_URL;
  const timestampStr = sendRealPath ? '' : `?ts=${timestamps.songArtworks}`;

  if (isArtworkAvailable) {
    return {
      isDefaultArtwork: !isArtworkAvailable,
      artworkPath: joinPath(FILE_URL, DEFAULT_ARTWORK_SAVE_LOCATION, `${id}.webp`) + timestampStr,
      optimizedArtworkPath:
        joinPath(FILE_URL, DEFAULT_ARTWORK_SAVE_LOCATION, `${id}-optimized.webp`) + timestampStr
    };
  }
  const defaultPath = joinPath(FILE_URL, songCoverImage) + timestampStr;
  return {
    isDefaultArtwork: isArtworkAvailable,
    artworkPath: defaultPath,
    optimizedArtworkPath: defaultPath
  };
};

export const getArtistArtworkPath = (artworkName?: string, resetCache = false): ArtworkPaths => {
  if (resetCache) resetArtworkCache('artistArtworks');

  const timestampStr = `?ts=${timestamps.artistArtworks}`;

  if (artworkName) {
    return {
      isDefaultArtwork: !artworkName,
      artworkPath:
        joinPath(DEFAULT_FILE_URL, DEFAULT_ARTWORK_SAVE_LOCATION, `${artworkName}`) + timestampStr,
      optimizedArtworkPath:
        joinPath(
          DEFAULT_FILE_URL,
          DEFAULT_ARTWORK_SAVE_LOCATION,
          `${artworkName.replace(/\.webp^/, '-optimized.webp')}`
        ) + timestampStr
    };
  }
  const defaultPath = joinPath(DEFAULT_FILE_URL, artistCoverImage);
  return {
    isDefaultArtwork: !artworkName,
    artworkPath: defaultPath,
    optimizedArtworkPath: defaultPath
  };
};

export const getAlbumArtworkPath = (artworkName?: string, resetCache = false): ArtworkPaths => {
  if (resetCache) resetArtworkCache('albumArtworks');

  const timestampStr = `?ts=${timestamps.albumArtworks}`;

  if (artworkName) {
    return {
      isDefaultArtwork: !artworkName,
      artworkPath:
        joinPath(DEFAULT_FILE_URL, DEFAULT_ARTWORK_SAVE_LOCATION, `${artworkName}`) + timestampStr,
      optimizedArtworkPath:
        joinPath(
          DEFAULT_FILE_URL,
          DEFAULT_ARTWORK_SAVE_LOCATION,
          `${artworkName.replace(/\.webp^/, '-optimized.webp')}`
        ) + timestampStr
    };
  }
  const defaultPath = joinPath(DEFAULT_FILE_URL, albumCoverImage);
  return {
    isDefaultArtwork: !artworkName,
    artworkPath: defaultPath,
    optimizedArtworkPath: defaultPath
  };
};

export const getGenreArtworkPath = (artworkName?: string, resetCache = false): ArtworkPaths => {
  if (resetCache) resetArtworkCache('genreArtworks');

  const timestampStr = `?ts=${timestamps.genreArtworks}`;

  if (artworkName) {
    return {
      isDefaultArtwork: !artworkName,
      artworkPath:
        joinPath(DEFAULT_FILE_URL, DEFAULT_ARTWORK_SAVE_LOCATION, `${artworkName}`) + timestampStr,
      optimizedArtworkPath:
        joinPath(
          DEFAULT_FILE_URL,
          DEFAULT_ARTWORK_SAVE_LOCATION,
          `${artworkName.replace(/\.webp^/, '-optimized.webp')}`
        ) + timestampStr
    };
  }
  const defaultPath = joinPath(DEFAULT_FILE_URL, songCoverImage);
  return {
    isDefaultArtwork: !artworkName,
    artworkPath: defaultPath,
    optimizedArtworkPath: defaultPath
  };
};

export const getPlaylistArtworkPath = (
  playlistId: string,
  isArtworkAvailable: boolean,
  resetCache = false
): ArtworkPaths => {
  if (resetCache) resetArtworkCache('playlistArtworks');

  const timestampStr = `?ts=${timestamps.playlistArtworks}`;

  const artworkPath =
    playlistId === 'History'
      ? joinPath(DEFAULT_FILE_URL, historyPlaylistCoverImage) + timestampStr
      : playlistId === 'Favorites'
        ? joinPath(DEFAULT_FILE_URL, favoritesPlaylistCoverImage) + timestampStr
        : isArtworkAvailable
          ? joinPath(DEFAULT_FILE_URL, DEFAULT_ARTWORK_SAVE_LOCATION, `${playlistId}.webp`) +
            timestampStr
          : joinPath(DEFAULT_FILE_URL, playlistCoverImage) + timestampStr;
  return {
    isDefaultArtwork: !isArtworkAvailable,
    artworkPath,
    optimizedArtworkPath: artworkPath
  };
};

export const removeDefaultAppProtocolFromFilePath = (filePath: string) => {
  const strippedPath = filePath.replaceAll(
    /melodict:[/\\]{1,2}localfiles[/\\]{1,2}|\?[\w+=\w+&?]+$/gm,
    ''
  );

  if (platform === 'linux') return `/${strippedPath}`;
  return strippedPath;
};
