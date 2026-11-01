/** Registers the business modules routed by name through the request entry point. */

import type { NeteaseModule } from '../core/types';

import login_qr_key from './login_qr_key';
import login_qr_create from './login_qr_create';
import login_qr_check from './login_qr_check';
import login_status from './login_status';
import login_refresh from './login_refresh';
import logout from './logout';
import register_anonimous from './register_anonimous';

import song_detail from './song_detail';
import playlist_detail from './playlist_detail';
import user_playlist from './user_playlist';
import album from './album';
import artists from './artists';

import cloudsearch from './cloudsearch';
import search_suggest from './search_suggest';

import song_url_v1 from './song_url_v1';
import lyric from './lyric';
import lyric_new from './lyric_new';

import recommend_songs from './recommend_songs';
import personalized from './personalized';
import toplist from './toplist';
import like from './like';

export const modules: Record<string, NeteaseModule> = {
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  login_refresh,
  logout,
  register_anonimous,

  song_detail,
  playlist_detail,
  user_playlist,
  album,
  artists,

  cloudsearch,
  search_suggest,

  song_url_v1,
  lyric,
  lyric_new,

  recommend_songs,
  personalized,
  toplist,
  like
};
