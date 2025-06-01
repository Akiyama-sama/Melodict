// 文件名: japaneseTokenizer.test.ts
import { describe, it, expect, beforeAll } from '@jest/globals'; // 从 @jest/globals 导入 Jest 的全局函数
import { tokenizeJapaneseText, getTokenizer } from './japaneseTokenizer'; // 导入我们封装的函数
import { lyricLineTokenizer } from '../src/main/analyzeLyric/tokenizer/lyricLineTokenizer';
import type Kuromoji from '@sglkc/kuromoji'; // 导入类型
import { franc } from 'franc-min';
import getLyricLineLanguage from './language';
// 定义一个变量来存储初始化后的 tokenizer (可选，如果测试需要直接访问 tokenizer)
// let tokenizer: Kuromoji.Tokenizer<Kuromoji.IpadicFeatures>;

// 使用 describe 来组织相关的测试
describe('Japanese Tokenizer Tests', () => {


/*   it('should correctly tokenize "ちいさな一瞬  （あつめ）たい', async () => {
    const text = "ちいさな一瞬,（あつめ）たい 「街のすみで」";
    const tokens = await tokenizeJapaneseText(text);
    tokens.forEach(t => {
      console.log(t);
    });
    const surfaceForms = tokens.map(t => t.surface_form);
    console.log(surfaceForms);
  }); */
/*   it('should correctly tokenize "ちいさな一瞬  （あつめ）たい', async () => {
    const text = "ちいさな一瞬  （あつめ）たい hello this is me";
    const tokens = await lyricLineTokenizer(text,'ja');
    tokens.forEach(t => {
      console.log(t);
    });
  }); */
  it('should correctly tokenize "ちいさな一瞬  （あつめ）たい', async () => {
    const text = "ちいさな一瞬  （あつめ）たい hello this is me";
    const language = getLyricLineLanguage(text);
    console.log(language);
  });
});

