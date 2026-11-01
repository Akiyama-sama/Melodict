/** Lyrics (legacy endpoint, kept as the fallback when lyric_new is unavailable). */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const lyric: NeteaseModule = async (query, request) => {
  const data = {
    id: query.id,
    tv: -1,
    lv: -1,
    rv: -1,
    kv: -1,
    _nmclfl: 1
  };
  return request('/api/song/lyric', data, createOption(query));
};

export default lyric;
