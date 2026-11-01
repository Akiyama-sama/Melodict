/**
 * Cookie parsing/serialization helpers: cookieToJson / cookieObjToString.
 */

/** Parses a `k=v; k2=v2` cookie string into an object. */
export const cookieToJson = (cookie: string | undefined): Record<string, string> => {
  if (!cookie) return {};
  const obj: Record<string, string> = {};
  for (const item of cookie.split(';')) {
    const eq = item.indexOf('=');
    if (eq <= 0) continue;
    obj[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return obj;
};

/** Serializes a cookie object back into a header string. */
export const cookieObjToString = (cookie: Record<string, string | number | boolean>): string =>
  Object.keys(cookie)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(cookie[key]))}`)
    .join('; ');

/**
 * Flattens a set-cookie array into `{ name: value }`, dropping attributes (Path/Domain/Max-Age).
 * Mirrors what the server actually asked us to store.
 */
export const parseSetCookie = (arr: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const raw of arr) {
    const first = raw.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const key = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
};
