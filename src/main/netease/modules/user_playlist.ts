/** User playlist list. */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const userPlaylist: NeteaseModule = async (query, request) => {
  const data = {
    uid: query.uid,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    includeVideo: true
  };
  return request('/api/user/playlist', data, createOption(query, 'weapi'));
};

export default userPlaylist;
