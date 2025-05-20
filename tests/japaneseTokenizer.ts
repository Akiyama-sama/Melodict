// 文件名: japaneseTokenizer.ts
import Kuromoji from '@sglkc/kuromoji';
import path from 'path';

// **重要**: 确保这个路径正确指向你项目中 kuromoji 库自带的字典目录
const dicPath = path.resolve(process.cwd(), 'node_modules', '@sglkc', 'kuromoji', 'dict');

// 使用一个 Promise 来确保 tokenizer 只被初始化一次
let tokenizerPromise: Promise<Kuromoji.Tokenizer<Kuromoji.IpadicFeatures>> | null = null;

/**
 * 初始化 Kuromoji 分词器 (如果尚未初始化)
 * @returns {Promise<Kuromoji.Tokenizer<Kuromoji.IpadicFeatures>>}
 */
export function getTokenizer(): Promise<Kuromoji.Tokenizer<Kuromoji.IpadicFeatures>> {
  if (!tokenizerPromise) {
    console.log(`Initializing Kuromoji tokenizer with dictionary from: ${dicPath}`);
    const builder = Kuromoji.builder({ dicPath: dicPath });
    tokenizerPromise = new Promise((resolve, reject) => {
      builder.build((err, builtTokenizer) => {
        if (err) {
          console.error(`Error building tokenizer. Check if dicPath is correct: ${dicPath}`, err);
          tokenizerPromise = null; // 重置 Promise 以便下次重试
          reject(err);
        } else {
          console.log('Tokenizer built successfully using built-in dictionary.');
          resolve(builtTokenizer);
        }
      });
    });
  }
  return tokenizerPromise;
}

/**
 * 对日文文本进行分词
 * @param {string} text - 需要分词的日文文本
 * @returns {Promise<Kuromoji.IpadicFeatures[]>} - 分词结果数组
 */
export async function tokenizeJapaneseText(text: string): Promise<Kuromoji.IpadicFeatures[]> {
  try {
    const tokenizer = await getTokenizer(); // 等待初始化完成
    const tokens = tokenizer.tokenize(text);
    return tokens;
  } catch (error) {
    console.error(`Error during tokenization for text "${text}":`, error);
    throw error; // 将错误抛出，以便 Jest 测试可以捕获
  }
}