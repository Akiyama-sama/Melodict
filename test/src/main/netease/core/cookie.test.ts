import { describe, expect, test } from 'vitest';

import { cookieObjToString, cookieToJson, parseSetCookie } from '@main/netease/core/cookie';

describe('cookieToJson', () => {
  test('splits pairs and keeps values containing "="', () => {
    expect(cookieToJson('MUSIC_U=abc; __csrf=to=ken; NMTID=00Oabc')).toEqual({
      MUSIC_U: 'abc',
      __csrf: 'to=ken',
      NMTID: '00Oabc'
    });
  });

  test('returns an empty object for undefined / empty input', () => {
    expect(cookieToJson(undefined)).toEqual({});
    expect(cookieToJson('')).toEqual({});
  });

  test('skips malformed segments', () => {
    expect(cookieToJson('novalue; a=1')).toEqual({ a: '1' });
  });
});

describe('cookieObjToString', () => {
  test('URL-encodes keys and values', () => {
    expect(cookieObjToString({ 'a b': 'c d' })).toBe('a%20b=c%20d');
  });
});

describe('parseSetCookie', () => {
  test('drops attributes and keeps name=value', () => {
    expect(
      parseSetCookie([
        'MUSIC_U=xyz; Path=/; Max-Age=31536000; Domain=music.163.com',
        '__csrf=fresh; Path=/; HttpOnly'
      ])
    ).toEqual({ MUSIC_U: 'xyz', __csrf: 'fresh' });
  });

  test('ignores entries without an "=" in the first segment', () => {
    expect(parseSetCookie(['deleted', 'a=1'])).toEqual({ a: '1' });
  });
});
