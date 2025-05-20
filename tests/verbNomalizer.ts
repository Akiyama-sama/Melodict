import nlp from 'compromise';

/**
 * 将句子中的主动态词变为不定式，其余词保持不变。
 * 会完整保留原始的空格与标点。
 */
const params={
  // 删除连字符、换行符，并强制单词之间有一个空格
  whitespace: true,
  // 只保留第一个单词，并使用实体标题格式
  case: false,
  // 删除逗号、分号，但保留句子结束标点
  punctuation: false,
  // 可视化罗马化/英语化 'Björk' 为 'Bjork'
  unicode: true,
  // 将 "isn't" 转换为 "is not"
  contractions: false,
  // 删除缩写中的句号，如 'F.B.I.'
  acronyms:false,

  //---这些选项只有在需要时才运行---
  
  // 删除括号中的单词，如这些
  parentheses: false,
  // 将 "Google's tax return" 转换为 "Google tax return"
  possessives: false,
  // 将 "batmobiles" 转换为 "batmobile"
  plurals: false,
  // 将所有动词转换为不定式形式 - "I walked" → "I walk"
  verbs: false,
  // 将 "Vice Admiral John Smith" 转换为 "John Smith"
  honorifics: false,
}

export function normalizeVerbsInSentence(lyricLine: string): string {
  // 1. 基础校验
  if (typeof lyricLine !== 'string' || lyricLine === null || lyricLine === undefined) {
    return ''; // 返回空字符串，如果输入为 null/undefined 或非字符串
  }
  if (lyricLine.trim() === '') {
    return lyricLine; // 返回原句，如果全是空白
  }

  const doc = nlp(lyricLine);
  const terms = doc.terms();
  
  if (terms.length === 0 && lyricLine.length > 0) {
    // If nlp results in no terms but original string was not empty (e.g. just punctuation "!!!")
    return lyricLine;
  }


  const parts: string[] = [];
  terms.forEach((term: any) => {
    const originalTermText = term.text(); // Text from (potentially nlp-normalized) term
    let outText = originalTermText;
    // 3. 如果它是 “主动态词” —— 不是助动词/系动词/情态动词/缩写
    if (
      term.has('#Verb') &&
      !term.has('#Auxiliary') &&
      !term.has('#Copula') &&
      !term.has('#Modal') &&
      !term.has('#Contraction')
    ) {
      const infRaw = (term as any).verbs().toInfinitive().text();
      if (infRaw && infRaw.trim() !== '') {
        let infinitiveToUse = infRaw;
        if (infRaw.endsWith('.') && !originalTermText.endsWith('.')) {
          infinitiveToUse = infRaw.slice(0, -1);
        }
        
        if (infinitiveToUse !== originalTermText) {
          outText = infinitiveToUse;
        }
      }
    }

    // 4. 把 pre + 处理后的词 + post 三段顺序拼进结果
    let preText = '';
    const preView = term.pre();
    if (preView) {
      if (typeof (preView as any).text === 'function') {
        preText = (preView as any).text();
      } else if (typeof preView === 'string'&& term.has('#Verb')) {
        preText = '';
      }else if (typeof preView === 'string') {
        preText = preView;
      }
    }

    let postText = '';
    const postView = term.post();
    if (postView) {
      if (typeof (postView as any).text === 'function') {
        postText = (postView as any).text();
      } else if (typeof postView === 'string' && term.has('#Verb') && postView === '.') {
        postText = ' ';
      } else if (typeof postView === 'string') {
        postText = postView;
      }
    }
    console.log('pre:'+preView+outText+postView);
    console.log('out:'+preText+outText+postText);
    parts.push(preText, outText, postText);
  });
  if(!terms.text().endsWith('.')) {
    parts.push('.');
  }
  return parts.join('');
}

