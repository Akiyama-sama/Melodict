import { version, repository } from '../../../package.json';
import logger from '../logger';

interface LrclibTrackInfoStructure {
  track_name: string;
  artist_name: string;
  album_name?: string;
  duration: string;
}

interface LrclibLyrics {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
}

type LrclibLyricsAPI =
  | LrclibLyrics
  | {
      statusCode: number;
      name: string;
      message: string;
    };

type ParsedLrclibLyrics = {
  lrclibId: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  lyrics: string;
  lyricsType: LyricsTypes;
};
const LRCLIB_BASE_URL = 'https://lrclib.net/';

const parseLrclibResponseData = (
  data: LrclibLyricsAPI,
  lyricsType: LyricsTypes
): ParsedLrclibLyrics | undefined => {
  if ('statusCode' in data) return undefined;

  const lyricsArr: string[] = [];
  lyricsArr.push(`[re:Melodict (https://github.com/Akiyama-sama/Melodict)]`);
  lyricsArr.push(`[ve:${version}]`);
  lyricsArr.push(`[ti:${data.trackName}]`);
  lyricsArr.push(`[ar:${data.artistName}]`);
  lyricsArr.push(`[al:${data.albumName}]`);
  lyricsArr.push(`[length:${Math.floor(data.duration / 60)}:${data.duration % 60}]`);
  lyricsArr.push(`[offset:0]`);
  // lyricsArr.push(`[lang:en]`);
  lyricsArr.push(`[copyright:Lyrics by Lrclib (${LRCLIB_BASE_URL})]`);
  lyricsArr.push(data.syncedLyrics || data.plainLyrics);

  const output: ParsedLrclibLyrics = {
    lrclibId: data.id,
    trackName: data.trackName,
    artistName: data.artistName,
    albumName: data.albumName,
    duration: data.duration,
    lyrics: lyricsArr.join('\n'),
    lyricsType: 'syncedLyrics' in data ? 'SYNCED' : 'UN_SYNCED'
  };

  if (lyricsType === 'SYNCED') {
    if ('syncedLyrics' in data) {
      output.lyrics = data.syncedLyrics;
    }
    return undefined;
  }

  return output;
};

const fetchLyricsFromLrclib = async (
  trackInfo: LrclibTrackInfoStructure,
  lyricsType: LyricsTypes = 'ANY',
  abortSignal?: AbortSignal
): Promise<ParsedLrclibLyrics | undefined> => {
  const headers = new Headers();
  headers.append('User-Agent', `Melodict ${version} (${repository.url})`);

  const url = new URL('/api/get', LRCLIB_BASE_URL);

  for (const [key, value] of Object.entries(trackInfo)) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }

  try {
    const res = await fetch(url, { headers, signal: abortSignal });
    if (res.ok) {
      const data = (await res.json()) as LrclibLyricsAPI;
      const lyrics = parseLrclibResponseData(data, lyricsType);

      return lyrics;
    }
    throw new Error(`Error occurred when fetching lyrics from Lrclib.`);
  } catch (error) {
    logger.error('Failed to fetch lyrics from Lrclib', { error });
    return undefined;
  }
};

export default fetchLyricsFromLrclib;
