/**
 * Guest registration (acquires MUSIC_A).
 *
 * - Generates a 52-char hex deviceId
 * - Base64 of `${deviceId} ${md5(deviceId ^ ID_XOR_KEY)}` as the username
 * - Registers via xeapi and caches the returned MUSIC_A as the device's anonymous token
 */

import { createHash } from 'node:crypto';
import { createOption } from '../core/option';
import { regenerateDeviceId, setAnonymousToken } from '../core/device';
import type { NeteaseModule } from '../core/types';

const ID_XOR_KEY = '3go8&$8*3*3h0k(2)2';

const encodeId = (deviceId: string): string => {
  let xored = '';
  for (let i = 0; i < deviceId.length; i++) {
    xored += String.fromCharCode(deviceId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length));
  }
  return createHash('md5').update(xored, 'utf8').digest('base64');
};

const registerAnonimous: NeteaseModule = async (query, request) => {
  const deviceId = regenerateDeviceId();
  const username = Buffer.from(`${deviceId} ${encodeId(deviceId)}`, 'utf8').toString('base64');
  const data = { username };

  const result = await request('/api/register/anonimous', data, createOption(query, 'xeapi'));
  const body = result.body as { code?: number; [key: string]: unknown };

  if (body.code === 200) {
    if (typeof body.token === 'string') setAnonymousToken(body.token);
    return {
      status: 200,
      body: { ...body, cookie: result.cookie.join(';') },
      cookie: result.cookie
    };
  }
  return result;
};

export default registerAnonimous;
