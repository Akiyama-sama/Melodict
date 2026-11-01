/**
 * Like / unlike a song (legacy weapi endpoint).
 *
 * params:
 * - id    song id
 * - like  true to like, false to unlike
 *
 * Response: `{ code, songs: [], playlistId }`
 * code !== 200 means failure (logged out, risk-controlled, etc.)
 */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const like: NeteaseModule = async (query, request) => {
  const isLike = query.like !== false && query.like !== 'false';
  const data = {
    alg: 'itembased',
    trackId: String(query.id),
    like: isLike,
    time: '3'
  };
  return request('/api/radio/like', data, createOption(query, 'weapi'));
};

export default like;
