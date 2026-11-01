/**
 * Process-level device state.
 * - deviceId: 52-char uppercase hex, generated once per process and persisted in the session so
 *   every request presents the same stable device fingerprint.
 * - anonymous token: the MUSIC_A injected into headers when logged out (returned by the
 *   register_anonimous endpoint and refreshed there).
 */

import { randomBytes } from 'node:crypto';

const generate = (): string => randomBytes(26).toString('hex').toUpperCase();

let deviceId = generate();
let anonymousToken = '';

export const getDeviceId = (): string => deviceId;

export const setDeviceId = (id: string): void => {
  deviceId = id;
};

export const regenerateDeviceId = (): string => {
  deviceId = generate();
  return deviceId;
};

export const getAnonymousToken = (): string => anonymousToken;

export const setAnonymousToken = (token: string): void => {
  anonymousToken = token;
};
