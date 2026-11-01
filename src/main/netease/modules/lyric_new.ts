/** New-style lyrics (includes word-by-word yrc). */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const lyricNew: NeteaseModule = async (query, request) => {
  const data = {
    id: query.id,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0
  };
  return request('/api/song/lyric/v1', data, createOption(query));
};

export default lyricNew;
