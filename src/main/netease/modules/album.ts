/** Album detail (metadata + tracks). */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const album: NeteaseModule = async (query, request) =>
  request(`/api/v1/album/${query.id}`, {}, createOption(query, 'weapi'));

export default album;
