import { describe, expect, test, vi } from 'vitest';

// lyrics.ts imports its netease client/session for the fetching half; the converters under test
// are pure, so stub the electron-flavoured dependencies out.
vi.mock('../../../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../../src/main/netease/client', () => ({ callNeteaseForBody: vi.fn() }));
vi.mock('../../../../src/main/netease/session', () => ({ readNeteaseSession: vi.fn() }));
vi.mock('../../../../src/common/parseLyrics', () => ({ default: vi.fn() }));

import { convertJsonLrcToLrc, convertYrcToEnhancedLrc, millisecondsToLrcTime } from '../../../../src/main/netease/lyrics';

describe('millisecondsToLrcTime', () => {
  test('formats milliseconds as mm:ss.mmm', () => {
    expect(millisecondsToLrcTime(0)).toBe('00:00.000');
    expect(millisecondsToLrcTime(16226)).toBe('00:16.226');
    expect(millisecondsToLrcTime(61234)).toBe('01:01.234');
  });

  test('clamps negative values to zero', () => {
    expect(millisecondsToLrcTime(-500)).toBe('00:00.000');
  });
});

describe('convertJsonLrcToLrc', () => {
  test('flattens JSON karaoke lines into bracketed LRC, dropping non-text chunks', () => {
    const input = [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"姚若龙","li":"http://p1.music.126.net/x.jpg"}]}',
      '{"t":16226,"c":[{"tx":"我怀念的是无话不说"}]}'
    ].join('\n');

    expect(convertJsonLrcToLrc(input)).toBe(
      ['[00:00.000]作词: 姚若龙', '[00:16.226]我怀念的是无话不说'].join('\n')
    );
  });

  test('passes plain bracketed LRC through untouched', () => {
    const plain = '[00:01.000]hello world\n[00:05.000]second line';
    expect(convertJsonLrcToLrc(plain)).toBe(plain);
  });

  test('keeps plain LRC lines in mixed JSON + LRC payloads', () => {
    const input = [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"澤野弘之"}]}',
      '[00:22.590]君を繋ぐ空の星が1つ音を立てても',
      '[00:33.680]どれも同じ雨に濡れた夢ばかり'
    ].join('\n');

    expect(convertJsonLrcToLrc(input)).toBe(
      ['[00:00.000]作词: 澤野弘之', '[00:22.590]君を繋ぐ空の星が1つ音を立てても', '[00:33.680]どれも同じ雨に濡れた夢ばかり'].join('\n')
    );
  });

  test('skips malformed and empty lines instead of throwing', () => {
    const input = '{"t":1000,"c":[{"tx":"ok"}]}\n{"t":2000,"c":[]}\n{"broken":true}';
    expect(convertJsonLrcToLrc(input)).toBe('[00:01.000]ok');
  });
});

describe('convertYrcToEnhancedLrc', () => {
  test('converts yrc word timings into enhanced LRC', () => {
    const input = '[16226,3000](16226,500,0)我怀(16726,500,0)念(17226,2000,0)的';
    expect(convertYrcToEnhancedLrc(input)).toBe(
      '[00:16.226]我怀<00:16.726>念<00:17.226>的<00:19.226>'
    );
  });

  test('keeps lines without word payload as plain synced lines', () => {
    expect(convertYrcToEnhancedLrc('[1000,2000]纯文本行')).toBe('[00:01.000]纯文本行');
  });
});
