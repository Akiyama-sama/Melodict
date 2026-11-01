/** Daily recommended songs (30 per day, requires login). */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const recommendSongs: NeteaseModule = async (query, request) => {
  // The official client tags this request with os=ios; the server rejects it otherwise.
  if (query.cookie && typeof query.cookie === 'object') {
    (query.cookie as Record<string, string>).os = 'ios';
  }
  return request('/api/v3/discovery/recommend/songs', {}, createOption(query, 'weapi'));
};

export default recommendSongs;
