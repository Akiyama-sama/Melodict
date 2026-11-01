/** Song details. `ids` accepts one id or a comma-separated list. */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const songDetail: NeteaseModule = async (query, request) => {
  const ids = String(query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const data = {
    c: `[${ids.map((id) => `{"id":${id}}`).join(',')}]`
  };
  return request('/api/v3/song/detail', data, createOption(query));
};

export default songDetail;
