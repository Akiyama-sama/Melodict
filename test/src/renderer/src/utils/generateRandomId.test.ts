import { describe, expect, test } from 'vitest';

import { generateRandomId } from '../../../../../src/main/utils/randomId';

describe('generateRandomId', () => {
  test('returns 10 letters from the documented alphabet', () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateRandomId()).toMatch(/^[a-zA-Z]{10}$/);
    }
  });

  test('does not repeat ids', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generateRandomId()));
    expect(ids.size).toBe(5000);
  });
});
