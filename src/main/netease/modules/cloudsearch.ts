/** Cloud search (returns the fuller privileges fields). */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const cloudsearch: NeteaseModule = async (query, request) => {
  const data = {
    s: query.keywords,
    type: query.type ?? 1,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    total: true
  };
  return request('/api/cloudsearch/pc', data, createOption(query));
};

export default cloudsearch;
