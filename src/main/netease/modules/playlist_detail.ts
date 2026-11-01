/** Playlist detail. The server may truncate `tracks`; `trackIds` is always the full list. */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const playlistDetail: NeteaseModule = async (query, request) => {
  const data = {
    id: query.id,
    n: 100000,
    s: query.s ?? 8
  };
  return request('/api/v6/playlist/detail', data, createOption(query));
};

export default playlistDetail;
