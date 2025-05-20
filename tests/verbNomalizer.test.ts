// --- Jest 测试用例 ---
import { normalizeVerbsInSentence } from './verbNomalizer';

describe('normalizeVerbsInSentence', () => {
  const testCases = [
    { input: "I've been singing loudly.", expected: "I've been sing loudly." },
    { input: "  He was looking for it.  ", expected: "He was look for it." },
    { input: "She has gone home.", expected: "She has go home." },
    { input: "They are running fast.", expected: "They are run fast." },
    { input: "It's done.", expected: "It's do." }, // done. -> do
    { input: "I'm here.", expected: "I'm here." },
    { input: "He can swim.", expected: "He can swim." },
    { input: "This was developed by them.", expected: "This was develop by them." },
    { input: "This was developed. by them.", expected: "This was develop. by them." }, // 原词带点，转换后也应保留（或不错误移除）
    { input: "The cats were sleeping.", expected: "The cats were sleep." },
    { input: "He wants to play.", expected: "He want to play." },
    { input: "She likes apples.", expected: "She like apples." },
    { input: "It worked!", expected: "It work!" },
    { input: "Don't stop believing.", expected: "Don't stop believe." },
    { input: "We're gonna make it.", expected: "We're gonna make it." },
    { input: "What is love?", expected: "What is love?"},
    { input: "Baby don't hurt me.", expected: "Baby don't hurt me."},
    { input: "They have cars.", expected: "They have cars."},
    { input: "She had had enough.", expected: "She had have enough."},
    { input: "No verbs here.", expected: "No verbs here." },
    { input: "  leading and trailing spaces  ", expected: "leading and trailing spaces" },
    { input: "It's true,the shape of your body(Oh)", expected: "It's true,the shape of your body(Oh)" },
    { input: "...", expected: "..." },
    { input: "    ", expected: "    " },
    { input: "developed", expected: "develop"}, // 单独的词
    { input: "developed.", expected: "develop."} // 单独的词带点
  ];

  testCases.forEach(tc => {
    test(`should convert "${tc.input}" to "${tc.expected}"`, () => {
      expect(normalizeVerbsInSentence(tc.input)).toBe(tc.expected);
    });
  });

  test('should return an empty string for empty input', () => {
    expect(normalizeVerbsInSentence('')).toBe('');
  });

  test('should handle null or undefined input gracefully', () => {
    expect(normalizeVerbsInSentence(null as any)).toBe('');
    expect(normalizeVerbsInSentence(undefined as any)).toBe('');
  });


  /* test('normalizeVerbsInSentence one sentence', () => {
    const input = "  He was looking for it.  ";
    const expected = "  He was look for it.  ";
    expect(normalizeVerbsInSentence(input)).toBe(expected);
  }); */
  /* test('normalizeVerbsInSentenceFunction one sentence', () => {
    const input = "He was looking for it.";
    const expected = "He was look for it.";
    expect(normalizeVerbsInSentenceFunction(input)).toBe(expected);
  }); */
});