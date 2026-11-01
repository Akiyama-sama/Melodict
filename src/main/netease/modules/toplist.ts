/** All toplists. */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const toplist: NeteaseModule = async (query, request) =>
  request('/api/toplist', {}, createOption(query));

export default toplist;
