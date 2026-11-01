/** Logout. */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const logout: NeteaseModule = async (query, request) =>
  request('/api/logout', {}, createOption(query));

export default logout;
