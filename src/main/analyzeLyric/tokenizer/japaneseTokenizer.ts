// 文件名: japaneseTokenizer.ts
import Kuromoji from '@sglkc/kuromoji';
import path from 'path';
import { toHiragana, toKatakana, toRomaji } from 'wanakana';
import { app } from 'electron';

// **重要**: 确保这个路径正确指向你项目中 kuromoji 库自带的字典目录
const dicPath = app.isPackaged
  ? path.join(process.resourcesPath, 'kuromoji-dict')
  : path.resolve(process.cwd(), 'node_modules', '@sglkc', 'kuromoji', 'dict');

// 模块级变量，用于存储同步初始化后的分词器实例
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
          resolve(builtTokenizer);
        }
      });
    });
  }
  return tokenizerPromise;
}

/**
 * 对日文文本进行分词 (同步方法)。
 * 必须在 initializeKuromojiTokenizerSync() 成功完成后调用。
 * @param {string} text - 需要分词的日文文本
 * @returns {LyricJapaneseToken[]} - 分词结果数组
 */
export async function tokenizeJapaneseLyricLine(text: string): Promise<LyricJapaneseToken[]> {
  try {
    const tokenizer = await getTokenizer(); // 同步获取分词器
    const rawTokens: Kuromoji.IpadicFeatures[] = tokenizer.tokenize(text);
    const finalOutputTokens: LyricJapaneseToken[] = [];
    let rawTokenIndex = 0;

    while (rawTokenIndex < rawTokens.length) {
      const currentRawToken = rawTokens[rawTokenIndex];

      if (currentRawToken.pos !== '記号' && currentRawToken.pos_detail_1 !== '空白') {
        const lyricToken: LyricJapaneseToken = {
          text: currentRawToken.surface_form,
          startChar: currentRawToken.word_position,
          endChar: currentRawToken.word_position + currentRawToken.surface_form.length,
          pre: '',
          post: '',
          language: 'ja',
          surface_form: currentRawToken.surface_form,
          pos: currentRawToken.pos,
          pos_detail_1: currentRawToken.pos_detail_1,
          pos_detail_2: currentRawToken.pos_detail_2,
          pos_detail_3: currentRawToken.pos_detail_3,
          conjugated_type: currentRawToken.conjugated_type,
          conjugated_form: currentRawToken.conjugated_form,
          basic_form: currentRawToken.basic_form,
          reading: currentRawToken.reading,
          pronunciation: currentRawToken.pronunciation,
          hiragana: toHiragana(currentRawToken.reading, { passRomaji: true }),
          katakana: toKatakana(currentRawToken.reading, { passRomaji: true }),
          romaji: toRomaji(currentRawToken.reading)
        };

        if (rawTokenIndex > 0) {
          const prevRawToken = rawTokens[rawTokenIndex - 1];
          if (prevRawToken.pos === '記号' && prevRawToken.pos_detail_1 === '括弧開') {
            lyricToken.pre = prevRawToken.surface_form;
          }
        }

        if (rawTokenIndex < rawTokens.length - 1) {
          const nextRawToken = rawTokens[rawTokenIndex + 1];
          if (nextRawToken.pos === '記号') {
            if (nextRawToken.pos_detail_1 === '括弧閉') {
              lyricToken.post = nextRawToken.surface_form;
              rawTokenIndex++;
            } else if (
              nextRawToken.pos_detail_1 !== '空白' &&
              nextRawToken.pos_detail_1 !== '括弧開'
            ) {
              lyricToken.post = nextRawToken.surface_form;
              rawTokenIndex++;
            }
          }
        }
        finalOutputTokens.push(lyricToken);
      }
      rawTokenIndex++;
    }
    return finalOutputTokens;
  } catch (error) {
    console.error(`Error during tokenization for text "${text}":`, error);
    if (
      error instanceof Error &&
      error.message.includes('Kuromoji tokenizer has not been initialized')
    ) {
      throw error;
    }
    return [];
  }
}
