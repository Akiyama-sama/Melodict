// 文件名: englishTokenizer.ts
import nlp from 'compromise';
import { getOriginalTermList,findMatchPhrasesTermIndexRange } from './englishPhrasesMatch';
import {getAllPhrases} from '../mapper/englishPhraseMapper';
import path from 'path';

const dbFilePath = path.resolve(process.cwd(), 'resources/phrases/englishPhrases.db');

export  async function tokenizeEnglishLyricLine(lyricLine:string): Promise<LyricEnglishToken[]>{
  //1.获取初始的englishTerms
  const englishTerms=getOriginalTermList(lyricLine);
  //2.获取匹配的短语在englishTerms中的索引范围
  const allPhrases=getAllPhrases(dbFilePath);
  const matchedPhrasesInfo=findMatchPhrasesTermIndexRange(allPhrases,lyricLine);
  /* interface MatchedPhraseCandidateInfo 示例{
    keyword: string;                      // AC 返回的匹配到的短语字符串 (例如 "be used to")
    phraseTokens: string[];               // 该短语分解后的词元数组 (例如 ["be", "used", "to"])
    candidateStartIndex: number;          // 在原始 candidates 数组中的起始索引
    candidateEndIndex: number;            // 在原始 candidates 数组中的结束索引 (不包含)
    // 以下字段用于连接回原始歌词信息
    originalTermStartIndex: number;       // 对应的第一个原始 Term 在 originalTerms 数组中的索引
    originalTermEndIndex: number;         // 对应的最后一个原始 Term 在 originalTerms 数组中的索引（不包含）      // 在原始歌词中实际匹配的文本片段 (需要原始歌词行和 originalTerms 才能精确获取)
  } */
  //3.将短语转换为LyricEnglishToken，其type为EnglishPhrase
  const englishTokens:LyricEnglishToken[]=[];
  const originalPhraseTermsArray:any[]=[]; //[[Term1,Term2,Term3],[Term4,Term5,Term6],...]
  matchedPhrasesInfo.forEach(matchedPhraseInfo=>{
    /* 匹配上短语的Term[] ，这里的Term[]并没有考虑到短语匹配策略，例如be used to 和 usd to 都会呗识别，应该在matchedPhrasesInfo这一步解决匹配策略*/
    const originalPhraseTerms=englishTerms.slice(matchedPhraseInfo.originalTermStartIndex,matchedPhraseInfo.originalTermEndIndex);
    originalPhraseTermsArray.push(originalPhraseTerms);
    const originalPhraseText:string=joinTerms(originalPhraseTerms);
    const englishPhrase:EnglishPhrase={
      kind:"phrase",
      englishPhrase:matchedPhraseInfo.keyword  //真正的短语内容
    }//先为空对象，填满信息需查询数据库
    const englishToken:LyricEnglishToken={
      text:originalPhraseText,
      startChar:matchedPhraseInfo.originalTermStartIndex,
      endChar:matchedPhraseInfo.originalTermEndIndex,
      pre:originalPhraseTerms[0].pre, //短语中第一个Term的pre
      post:originalPhraseTerms[originalPhraseTerms.length-1].post, //短语中最后一个Term的post
      language:'en',
      details:englishPhrase,
    }
    englishTokens.push(englishToken);
  })
  //4.短语匹配完毕，开始匹配未被任何短语 token覆盖的 Term 对象
  const filteredTerms=filterPhrasesTerms(englishTerms,originalPhraseTermsArray);
  filteredTerms.forEach(filteredTerm=>{
    let englishToken:LyricEnglishToken={
      text:filteredTerm.text,
      startChar:filteredTerm.index[1],
      endChar:filteredTerm.index[1]+1,
      pre:filteredTerm.pre,
      post:filteredTerm.post,
      language:'en',
      details:undefined,
    }
    //判断是否是缩略词
    if(filteredTerm.text.includes("'")){
      //console.log('缩略词',filteredTerm.text);
      const filteredDoc=nlp(filteredTerm.text);//根据之前的经验，应该需要后一个词才能让nlp识别出来所有的缩略词
      const englishAbbreviation:EnglishAbbreviation={
        kind:"abbreviation",
        abbreviationTokens:filteredDoc.contractions().expand().out('text')
      }
      englishToken={
        ...englishToken,
        details:englishAbbreviation,
      }
      englishTokens.push(englishToken);
    }else{ //不是缩略词，认为是单词
      //console.log('单词',filteredTerm.text);
      const englishWord:EnglishWord={
        kind:"word",
        englishWord:filteredTerm.text,
        englishRootWord:getEnglishRootWord(filteredTerm.text),
        posInSentence:filteredTerm.chunk,
        //其他字段属于查询范围
      }
      englishToken={
        ...englishToken,
        details:englishWord,
      }
      englishTokens.push(englishToken);
    }
  })
  //5.所有Term对象都放在了englishTokens中，但是乱序存放，需根据startChar,endChar排序
  //例如[{As long as},{take off},{you},{my},{clothes}]
  const sortedEnglishTokens=sortEnglishTokens(englishTokens);
  return sortedEnglishTokens;
}
/**
*@param terms:Term[]对象
*@returns result:string  Term[]拼接过后的字符串
*/
function joinTerms(terms:any[]):string{
  const result = terms.map(term => {
    // 确保 pre, text, post 都是字符串，以防它们在某些 Term 对象中缺失或为 null/undefined
    const pre = term.pre || '';
    const text = term.text || '';
    const post = term.post || '';
    return pre + text + post;
  }).join(''); // 使用空字符串作为分隔符，因为 pre/post 已经包含了空格
  return result;
}
/**
 * 过滤掉被短语覆盖的Term
 * @param originalTerms 
 * @param filterTermsArray 
 * @returns filteredTerms Term[]
 */
function filterPhrasesTerms(originalTerms:any[],filterTermsArray:any[]):any[]/* 返回Term[] */{ 
  const filterTerms=filterTermsArray.flat();
  const filteredTerms=originalTerms.filter(term=>!filterTerms.includes(term));
  return filteredTerms;
}

/**
 * 获取英文单词的词根 (lemma or base form)。
 *
 * @param word 输入的单词字符串。
 * @returns string 单词的词根形式。如果输入为空或无效，则返回空字符串。
 */
export function getEnglishRootWord(word: string): string {
  if (!word || typeof word !== 'string' || word.trim() === '') {
    return "";
  }

  const trimmedWord = word.trim();
  // 为单词创建一个 compromise 文档对象
  // compromise 通常会自动处理大小写，但 text('normal') 会确保输出规范化
  const doc = nlp(trimmedWord);
  // 1. 处理动词 (Verb)
  // 例如: "taking" -> "take", "went" -> "go", "is" -> "be"
  if (doc.has('#Verb')) {
    const infinitiveForm = doc.verbs().toInfinitive().text('normal');
    // 如果找到了不定式 (即使它和原词一样，说明原词就是不定式)
    if (infinitiveForm) {
      return infinitiveForm;
    }
  }

  // 2. 处理名词 (Noun)
  // 例如: "apples" -> "apple", "children" -> "child"
  if (doc.has('#Noun')) {
    const singularForm = doc.nouns().toSingular().text('normal');
    // 如果找到了单数形式 (即使它和原词一样)
    if (singularForm) {
      return singularForm;
    }
  }

  // 3. 处理形容词 (Adjective)
  // 例如: "happier" -> "happy", "biggest" -> "big"
  if (doc.has('#Adjective')) {
    const positiveForm = doc.adjectives().text('normal');
    if (positiveForm) {
      return positiveForm;
    }
  }

  // 4. 处理副词 (Adverb)
  // 例如: "quickly" -> "quick" (通常返回其对应的形容词词根)
  // "faster" (adv.) -> "fast"
  if (doc.has('#Adverb')) {
    const positiveForm = doc.adverbs().text('normal');
    if (positiveForm) {
      return positiveForm;
    }
  }

  // 5. 对于其他词性 (如介词、连词、代词、感叹词等)

  const normalizedText = doc.text('normal');
  return normalizedText || trimmedWord.toLowerCase();
}
/**
 * 根据startChar,endChar排序
 * @param englishTokens 
 * @returns sortedEnglishTokens LyricEnglishToken[]
 */
function sortEnglishTokens(unSortedEnglishTokens:LyricEnglishToken[]):LyricEnglishToken[]{
  const sortedEnglishTokens:LyricEnglishToken[]=[...unSortedEnglishTokens];
  sortedEnglishTokens.sort((a, b) => {
    // 首先按 start 值升序排序
    if (a.startChar < b.startChar) {
        return -1; // a排在b前面
    }
    if (a.startChar > b.startChar) {
        return 1; // b排在a前面
    }
    // 如果 start 值相同，则按 end 值升序排序
    if (a.endChar < b.endChar) {
        return -1;
    }
    if (a.endChar > b.endChar) {
        return 1;
    }
    // 如果 start 和 end 值都相同，则保持原始顺序
    return 0;
  });
  return sortedEnglishTokens;
}

