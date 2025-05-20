// 文件名: japaneseTokenizer.test.ts
import { describe, it, expect, beforeAll } from '@jest/globals'; // 从 @jest/globals 导入 Jest 的全局函数
import { tokenizeJapaneseText, getTokenizer } from './japaneseTokenizer'; // 导入我们封装的函数
import type Kuromoji from '@sglkc/kuromoji'; // 导入类型

// 定义一个变量来存储初始化后的 tokenizer (可选，如果测试需要直接访问 tokenizer)
// let tokenizer: Kuromoji.Tokenizer<Kuromoji.IpadicFeatures>;

// 使用 describe 来组织相关的测试
describe('Japanese Tokenizer Tests', () => {

  // 使用 beforeAll 确保 tokenizer 在所有测试运行之前只初始化一次
  // 因为初始化是异步的，所以 beforeAll 也需要是 async
  beforeAll(async () => {
    try {
      // 调用 getTokenizer 来确保初始化完成
      // 可以选择将 tokenizer 存储起来，如果后续测试需要直接用它
      /* tokenizer = */ await getTokenizer();
      console.log('Tokenizer initialized for tests.');
    } catch (error) {
      console.error('Failed to initialize tokenizer before tests:', error);
      // 如果初始化失败，后续测试可能会因为 tokenizer 未定义而出错
      // 可以考虑在此处抛出错误，让整个测试套件失败
      throw new Error('Tokenizer initialization failed in beforeAll.');
    }
    // Jest 会自动处理 beforeAll 中的 Promise
  }, 30000); // 增加超时时间 (例如 30 秒)，因为字典加载可能需要时间

  // 使用 it 或 test 来定义单个测试用例
  it('should correctly tokenize "初めての感情知ってしまった"', async () => {
    const text = "初めての感情知ってしまった";
    const tokens = await tokenizeJapaneseText(text);
   
    // 使用 expect 和匹配器 (matchers) 来进行断言
    expect(Array.isArray(tokens)).toBe(true); // 验证结果是数组
    expect(tokens.length).toBeGreaterThan(3); // 验证分词数量（具体数量取决于字典）

    // 更具体的断言：验证分词结果和某些属性
    // 注意：精确的分词结果取决于 kuromoji 的字典和算法，以下为示例断言
    const surfaceForms = tokens.map(t => t.surface_form);
    // 预期分词结果 (可能需要根据实际运行调整)
    const expectedSurfaceForms = ["初めて", "の", "感情", "知っ", "て", "しまっ", "た"];
    expect(surfaceForms).toEqual(expectedSurfaceForms);

    // 验证第一个词的基本型和读音
    expect(tokens[0].basic_form).toBe('初めて'); // 或者 '初める' 取决于字典版本和分析
    expect(tokens[0].reading).toBe('ハジメテ'); // 读音是片假名

    // 验证最后一个词是助动词 'た'
    expect(tokens[tokens.length - 1].pos).toBe('助動詞');
    expect(tokens[tokens.length - 1].basic_form).toBe('た');

  });

  it('should correctly tokenize "明日の夜空哨戒班"', async () => {
    const text = "明日の夜空哨戒班";
    const tokens = await tokenizeJapaneseText(text);

    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(2); // 至少应分为 "明日", "の", "夜空", "哨戒", "班"

    const surfaceForms = tokens.map(t => t.surface_form);

  });

  it('should return an empty array for an empty string', async () => {
    const text = "";
    const tokens = await tokenizeJapaneseText(text);
    expect(tokens).toEqual([]); // 空字符串应返回空数组
  });
  it('should correctly tokenize "君のために It\'s forever"', async () => {
    const text = "君のために It's forever";
    const tokens = await tokenizeJapaneseText(text);

    const surfaceForms = tokens.map(t => t.surface_form);
    console.log(surfaceForms);

  });

  it('should correctly tokenize "忘れたくても no time to leave"', async () => {
    const text = "忘れたくても no time to leave";
    const tokens = await tokenizeJapaneseText(text);
    console.log(tokens);
    const surfaceForms = tokens.map(t => t.surface_form);
   
  });
});