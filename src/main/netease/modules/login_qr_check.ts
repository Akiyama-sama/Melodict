/**
 * Polls the QR-code scan state.
 * - 801 waiting, 802 scanned, 800 expired, 803 confirmed (the cookie then carries MUSIC_U)
 */

import { createOption } from '../core/option';
import type { NeteaseModule } from '../core/types';

const loginQrCheck: NeteaseModule = async (query, request) => {
  const data = { key: query.key, type: 3 };
  try {
    const result = await request('/api/login/qrcode/client/login', data, createOption(query));
    return {
      status: 200,
      body: { ...result.body, cookie: result.cookie.join(';') },
      cookie: result.cookie
    };
  } catch (err) {
    // A failed poll returns an empty body; polling continues or times out on the renderer side.
    const fallback = err as { cookie?: string[] };
    return { status: 200, body: {}, cookie: fallback?.cookie ?? [] };
  }
};

export default loginQrCheck;
