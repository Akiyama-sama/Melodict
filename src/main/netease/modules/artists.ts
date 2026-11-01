/** Artist info and hot songs. */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const artists: NeteaseModule = async (query, request) =>
  request(`/api/v1/artist/${query.id}`, {}, createOption(query, 'weapi'));

export default artists;
