import nlp from 'compromise';
import { AhoCorasick } from '@monyone/aho-corasick';
import { getAllPhrases } from './englishPhraseMapper';
import utils from 'util';
// 候选匹配词信息接口
interface CandidateMatchTermInfo {
  textToMatch: string; // 用于匹配的规范化文本
  originalTermIndex: number; // 该文本对应的原始 term 在 doc.terms() 中的索引
  originalTermText: string; // 原始 term 的文本，用于调试或最终构建 token
  isContractionComponent?: boolean; // 标记这是否是缩写词展开后的一个部分
}

export function getOriginalTermList(lyricLine: string) {
  const doc = nlp(lyricLine);
  const originalTerms = doc.termList();
  return originalTerms;
}

function generateCandidateMatchSequence(lyricLine: string): {
  candidates: CandidateMatchTermInfo[];
  originalTerms: any[] /* compromise Term[] */;
} {
  const doc = nlp(lyricLine);
  const originalTerms = doc.termList(); //这里就是屎山的部分了，本来是应该用getOriginalTermList来获取originalTerms的
  const candidates: CandidateMatchTermInfo[] = [];

  if (!lyricLine || typeof lyricLine !== 'string') {
    return { candidates: [], originalTerms: [] };
  }
  //console.log(
  //  '原始分词',
  //  originalTerms.map((t) => t.text)
  //);
  originalTerms.forEach((term, termIndex) => {
    const termView = doc.terms().eq(termIndex);
    if (!termView.found) {
      // 理论上，如果 termIndex 来自 originalTerms 的遍历，这里应该总能找到
      // 但作为健壮性检查，可以保留
      console.warn(`无法为原始词项 (全局索引 ${termIndex}) 创建 View: ${term.text}`);
      // 可以选择跳过，或者用 Term 对象的属性做一些基础处理（如果View方法不可用）
      candidates.push({
        textToMatch: term.normal || term.text, // Term 对象有 normal 和 text 属性
        originalTermIndex: termIndex,
        originalTermText: term.text
      });
      return; // 继续下一个 term
    }
    if (termView.text('normal').includes("'")) {
      if (termView.text('normal') == '') return;
      //console.log('缩写词', termView.text('normal'));
      //经过测试，It's ，Jack's等等示例的contractions()不能展开，但can't可以
      //但在这些缩写词的后面随便加上一个单词，就又能匹配上了，因此，compromise 的 contractions() 方法有的可以直接展开，有的需要通过后面单词的词性进行展开
      //每次匹配到缩略词后，直接在后面+' '+后面的单词，再进行匹配
      const isPostWordExist =
        doc
          .terms()
          .eq(termIndex + 1)
          .text().length > 0;
      const postWord = isPostWordExist
        ? doc
            .terms()
            .eq(termIndex + 1)
            .text('normal')
        : doc
            .terms()
            .eq(termIndex + 2)
            .text('normal');
      const termDoc = nlp(termView.text('normal') + ' ' + postWord);
      //console.log('termDoc', termDoc.terms().text());

      if (!termDoc.has('#Possessive')) {
        //缩略词后跟的不是所有格
        termDoc
          .contractions()
          .expand()
          .terms()
          .forEach((expandedTermPartView) => {
            //console.log('展开的词', expandedTermPartView.text('normal'));
            const expandedTermPartDoc = nlp(expandedTermPartView.text('normal'));
            candidates.push({
              textToMatch:
                expandedTermPartDoc.verbs().toInfinitive().text('normal') ||
                expandedTermPartDoc.text('normal'), // 使用 normal 形式进行匹配
              originalTermIndex: termIndex, // 多个候选词指向同一个原始缩写词 term
              originalTermText: term.text, // 对应的原始 Term 对象
              isContractionComponent: true
            });
          });
      } else {
        //缩略词后跟的是所有格,直接用缩略词进行匹配
        candidates.push({
          textToMatch: termView.text('normal'), // 使用 normal 形式进行匹配
          originalTermIndex: termIndex, // 多个候选词指向同一个原始缩写词 term
          originalTermText: term.text, // 对应的原始 Term 对象
          isContractionComponent: true
        });
      }
    } else if (termView.has('#Verb')) {
      //console.log('动词', termView.text('normal'), '.');
      const isAuxiliary = termView.has('#Auxiliary');
      const isModal = termView.has('#Modal');
      if (termView.text('normal') == '')
        return; //如果是缩略语后的空字符串识别为动词
      /* if (!isAuxiliary && !isModal) */
      else {
        const termVerbDoc = nlp(termView.text('normal'));
        // 主动态词，获取其不定式（词元）
        const infinitiveForm = termVerbDoc.verbs().toInfinitive().text('normal');
        candidates.push({
          textToMatch: infinitiveForm || termView.text('normal'), // 如果不定式为空，用 normal 形式
          originalTermIndex: termIndex,
          originalTermText: term.text
        });
      } /* else {
                // 助动词、情态动词，保持原样（或用 normal 形式）
                candidates.push({
                  textToMatch: termView.text('normal'),
                  originalTermIndex: termIndex,
                  originalTermText: term.text,
                });
              } */
    } else if (termView.has('#Noun') && !termView.has('#Pronoun')) {
      // 非代词的名词
      // 名词，获取其单数形式
      const singularForm = (termView as any).nouns().toSingular().text('normal');
      candidates.push({
        textToMatch: singularForm || termView.text('normal'), // 如果单数形式为空，用 normal 形式
        originalTermIndex: termIndex,
        originalTermText: term.text
      });
    } else {
      // 其他类型的词，保持原样（或用 normal 形式）
      candidates.push({
        textToMatch: termView.text('normal'),
        originalTermIndex: termIndex,
        originalTermText: term.text
      });
    }
  });
  return { candidates, originalTerms };
}

{
  //策略注释：
  /* 输入与初始化:

接收一个原始歌词行（lyricLine）作为输入。
使用 compromise 库的 nlp(lyricLine) 对歌词行进行初步的自然语言处理，得到一个 doc 对象。
通过 doc.termList() 获取歌词行中所有原始词项（Term 对象）的扁平化列表（originalTerms）。
初始化一个空数组 candidates 用于存储生成的 CandidateMatchTermInfo 对象。
遍历原始词项:

对 originalTerms列表中的每一个 term 对象及其全局索引 termIndex 进行遍历。
为当前的 term 对象创建一个对应的 View 对象（termView = doc.terms().eq(termIndex)），以便使用 compromise 提供的各种词性判断和转换方法。
特殊处理：缩写词 (Contractions):

识别: 通过 termView.text('normal').includes("'") 判断当前词项是否包含撇号 '，作为识别缩写词的初步手段（例如 "I've", "Jack's", "it's", "don't"）。
上下文辅助展开: 你发现 compromise 的 contractions().expand() 方法有时需要后续词的上下文才能正确展开某些缩写词（如 "It's"）。因此，你尝试将当前缩写词与它后面一个（或两个，如果第一个为空）词的 normal 形式拼接起来，形成一个新的 termDoc (nlp(termView.text('normal')+' '+postWord))。
区分所有格: 通过 termDoc.has('#Possessive') 判断这个拼接后的 termDoc 是否表示所有格（如 "Jack's car"）。
如果不是所有格: 则对这个 termDoc 调用 contractions().expand().terms() 来获取展开后的各个部分。对于每个展开的部分，将其动词转为不定式（或保持原样），然后作为 CandidateMatchTermInfo 对象（标记为 isContractionComponent: true）添加到 candidates 序列中。这些候选词都指向原始的缩写词 term。
如果是所有格: 则不进行展开，直接将原始缩写词的 normal 形式（例如 "jack's"）作为 textToMatch 添加到 candidates 序列中，并标记为 isContractionComponent: true（或者可以考虑不标记，视后续处理逻辑而定）。
处理：动词 (Verbs):

识别: 通过 termView.has('#Verb') 判断当前词项是否为动词。
规范化:
你之前的代码注释掉了对助动词 (#Auxiliary) 和情态动词 (#Modal) 的区分处理，当前逻辑是对所有识别为 #Verb 的词项（如果非空）都尝试获取其不定式 (termVerbDoc.verbs().toInfinitive().text('normal'))。
将获取到的不定式（如果为空，则使用原始词的 normal 形式）作为 textToMatch 添加到 candidates 序列中。
处理：名词 (Nouns):

识别: 通过 termView.has('#Noun') && !termView.has('#Pronoun') 判断当前词项是否为名词（且非代词）。
规范化: 获取名词的单数形式 (termView.nouns().toSingular().text('normal'))。
将获取到的单数形式（如果为空，则使用原始词的 normal 形式）作为 textToMatch 添加到 candidates 序列中。
处理：其他词类:

对于不属于上述特殊情况的其他词项，直接使用其 normal 形式 (termView.text('normal')) 作为 textToMatch 添加到 candidates 序列中。
输出:

最终返回一个包含两个属性的对象：
candidates: CandidateMatchTermInfo 对象数组，每个对象包含了用于匹配的规范化文本、其对应的原始词项在 originalTerms 中的索引、原始词项的文本以及一个可选的是否为缩写词展开部分的标记。
originalTerms: 原始的 Term 对象数组 */
}

export interface MatchedPhraseCandidateInfo {
  keyword: string; // AC 返回的匹配到的短语字符串 (例如 "be used to")
  phraseTokens: string[]; // 该短语分解后的词元数组 (例如 ["be", "used", "to"])
  candidateStartIndex: number; // 在原始 candidates 数组中的起始索引
  candidateEndIndex: number; // 在原始 candidates 数组中的结束索引 (不包含)
  // 以下字段用于连接回原始歌词信息
  originalTermStartIndex: number; // 对应的第一个原始 Term 在 originalTerms 数组中的索引
  originalTermEndIndex: number; // 对应的最后一个原始 Term 在 originalTerms 数组中的索引（不包含）      // 在原始歌词中实际匹配的文本片段 (需要原始歌词行和 originalTerms 才能精确获取)
}

/** 用于从候选词数组中匹配出所有可能的短语
 * @param allPhrases: string[] 短语数据库，每个短语是已经用空格连接的字符串
 * @param originalLyricLine: string 传入原始歌词行，用于提取最终的文本片段
 * @return MatchedPhraseCandidateInfo[] 匹配到的短语信息数组
 **/

export function findMatchPhrasesTermIndexRange(
  allPhrases: string[], // 你的短语数据库，每个短语是已经用空格连接的字符串
  originalLyricLine: string // 传入原始歌词行，用于提取最终的文本片段
): MatchedPhraseCandidateInfo[] {
  const candidates = generateCandidateMatchSequence(originalLyricLine).candidates;
  if (!candidates || candidates.length === 0 || !allPhrases || allPhrases.length === 0) {
    return [];
  }
  const candidateTexts = candidates.map((c) => c.textToMatch);

  // 1. 构建用于 Aho-Corasick 的长文本 (matchText)
  //    同时记录每个 candidate 在 matchText 中的字符起止位置
  interface CandidateCharPosition {
    text: string; // candidate.textToMatch
    originalCandidateIndex: number; // 在 candidates 数组中的索引
    charStart: number; // 在 matchText 中的起始字符索引
    charEnd: number; // 在 matchText 中的结束字符索引 (不包含)
  }

  const candidatePositions: CandidateCharPosition[] = [];
  let currentCharIndex = 0;
  const matchTextParts: string[] = [];

  candidateTexts.forEach((text, index) => {
    const charStart = currentCharIndex;
    matchTextParts.push(text);
    currentCharIndex += text.length;
    candidatePositions.push({
      text: text,
      originalCandidateIndex: index,
      charStart: charStart,
      charEnd: currentCharIndex
    });
    // 在每个词元后添加一个空格作为分隔符（除了最后一个）
    if (index < candidateTexts.length - 1) {
      matchTextParts.push(' ');
      currentCharIndex += 1; // 空格占一个字符
    }
  });
  const matchText = matchTextParts.join('');
  //console.log('matchText', matchText);
  // 2. 构建 Aho-Corasick 自动机
  // @monyone/aho-corasick 期望的 keywords 是 string[]
  // 你的 allPhrases 已经是这种格式了
  const aho = new AhoCorasick(allPhrases);

  // 3. 在 matchText 中执行搜索
  const acResults = aho.matchInText(matchText);

  const finalMatches: MatchedPhraseCandidateInfo[] = [];

  // 4. 将 Aho-Corasick 的字符索引匹配结果转换回基于 candidate 序列的索引
  acResults.forEach((result) => {
    // result: { begin: number (字符起始), end: number (字符结束), keyword: string }
    const matchedCharStart = result.begin;
    const matchedCharEnd = result.end; // AC 返回的 end 是开区间

    let firstCandidateIndex = -1;
    let lastCandidateIndex = -1;

    // 找到覆盖这个字符范围的 candidate
    for (let i = 0; i < candidatePositions.length; i++) {
      const pos = candidatePositions[i];
      // 如果匹配的字符范围的起始点落在当前 candidate 的字符范围内
      if (
        firstCandidateIndex === -1 &&
        matchedCharStart >= pos.charStart &&
        matchedCharStart < pos.charEnd
      ) {
        firstCandidateIndex = pos.originalCandidateIndex;
      }
      // 如果匹配的字符范围的结束点（的前一个字符）落在当前 candidate 的字符范围内
      // 注意：AC的end是开区间，所以匹配的最后一个字符是 matchedCharEnd - 1
      if (matchedCharEnd - 1 >= pos.charStart && matchedCharEnd - 1 < pos.charEnd) {
        lastCandidateIndex = pos.originalCandidateIndex;
        // 找到了覆盖结束点的 candidate，通常可以停止查找这个匹配的结束 candidate
        // 但为了确保，我们可以继续，但通常这个就是
      }
    }

    // 另一种查找方式：找到第一个 charStart >= matchedCharStart 的 candidate
    // 和第一个 charEnd > matchedCharEnd-1 的 candidate
    // (需要更仔细的逻辑来确保精确)

    // 简化的查找：第一个完全包含 matchedCharStart 的 candidate，和第一个完全包含 matchedCharEnd-1 的 candidate
    const firstCandInfo = candidatePositions.find(
      (p) => p.charStart <= matchedCharStart && p.charEnd > matchedCharStart
    );
    // 对于结束，AC的end是开区间，所以匹配的最后一个字符是matchedCharEnd - 1
    const lastCandInfo = candidatePositions.find(
      (p) => p.charStart <= matchedCharEnd - 1 && p.charEnd > matchedCharEnd - 1
    );

    if (firstCandInfo && lastCandInfo) {
      firstCandidateIndex = firstCandInfo.originalCandidateIndex;
      lastCandidateIndex = lastCandInfo.originalCandidateIndex;

      if (
        firstCandidateIndex !== -1 &&
        lastCandidateIndex !== -1 &&
        firstCandidateIndex <= lastCandidateIndex
      ) {
        // 从原始 candidates 数组中获取对应的 CandidateMatchTermInfo 对象
        const firstMatchedCandidate = candidates[firstCandidateIndex];
        const lastMatchedCandidate = candidates[lastCandidateIndex];

        // 获取对应的原始 Term 对象的索引范围
        const originalTermStartIndex = firstMatchedCandidate.originalTermIndex;
        let originalTermEndIndex = lastMatchedCandidate.originalTermIndex + 1; // 默认为最后一个匹配词元的下一个

        // 特殊处理：如果匹配到的所有 candidate 都来自同一个原始缩写词的展开
        let allFromSameOriginalContraction = true;
        if (lastCandidateIndex > firstCandidateIndex) {
          // 仅当匹配跨越多个 candidate 时检查
          for (let k = firstCandidateIndex; k <= lastCandidateIndex; k++) {
            if (
              candidates[k].originalTermIndex !== originalTermStartIndex ||
              !candidates[k].isContractionComponent
            ) {
              allFromSameOriginalContraction = false;
              break;
            }
          }
        } else if (!candidates[firstCandidateIndex].isContractionComponent) {
          // 单个candidate匹配，但它本身不是缩写展开
          allFromSameOriginalContraction = false;
        }

        if (
          allFromSameOriginalContraction &&
          candidates[firstCandidateIndex].isContractionComponent
        ) {
          originalTermEndIndex = originalTermStartIndex + 1;
        }
        finalMatches.push({
          keyword: result.keyword,
          phraseTokens: result.keyword.split(' '),
          candidateStartIndex: firstCandidateIndex,
          candidateEndIndex: lastCandidateIndex + 1, // 转换为开区间
          originalTermStartIndex: originalTermStartIndex,
          originalTermEndIndex: originalTermEndIndex
        });
      } else {
        console.warn('无法将AC匹配结果映射回candidate索引:', result);
      }
    } else {
      console.warn('无法定位AC匹配结果的candidate边界:', result, firstCandInfo, lastCandInfo);
    }
  });

  {
    /*5.处理重叠匹配。Aho-Corasick 会找出所有匹配。*/
  }

  // 如果一个匹配完全包含在另一个匹配中，则只保留较长的那个。
  // 或者，如果它们共享起始点，保留较长的。如果共享结束点，保留较长的。
  // 初步的 finalMatches 可能包含重叠
  const initialMatches: MatchedPhraseCandidateInfo[] = [];
  acResults.forEach((result) => {
    // ... (之前你写的从 acResults 映射到 initialMatches 中单个元素的逻辑)
    // ... 我将你之前 forEach 内部的逻辑提取出来，并假设它填充了 initialMatches
    // 示例填充（你需要用你已有的完整映射逻辑替换这里）：
    const matchedCharStart = result.begin;
    const matchedCharEnd = result.end;

    const firstCandInfo = candidatePositions.find(
      (p) => p.charStart <= matchedCharStart && p.charEnd > matchedCharStart
    );
    const lastCandInfo = candidatePositions.find(
      (p) => p.charStart <= matchedCharEnd - 1 && p.charEnd > matchedCharEnd - 1
    );

    if (firstCandInfo && lastCandInfo) {
      const firstCandidateIndex = firstCandInfo.originalCandidateIndex;
      const lastCandidateIndex = lastCandInfo.originalCandidateIndex;

      if (
        firstCandidateIndex !== -1 &&
        lastCandidateIndex !== -1 &&
        firstCandidateIndex <= lastCandidateIndex
      ) {
        const firstMatchedCandidate = candidates[firstCandidateIndex];
        const lastMatchedCandidate = candidates[lastCandidateIndex];

        const originalTermStartIndex = firstMatchedCandidate.originalTermIndex;
        let originalTermEndIndex = lastMatchedCandidate.originalTermIndex + 1;

        let allFromSameOriginalContraction = true;
        if (lastCandidateIndex > firstCandidateIndex) {
          for (let k = firstCandidateIndex; k <= lastCandidateIndex; k++) {
            if (
              candidates[k].originalTermIndex !== originalTermStartIndex ||
              !candidates[k].isContractionComponent
            ) {
              allFromSameOriginalContraction = false;
              break;
            }
          }
        } else if (!candidates[firstCandidateIndex].isContractionComponent) {
          allFromSameOriginalContraction = false;
        }

        if (
          allFromSameOriginalContraction &&
          candidates[firstCandidateIndex].isContractionComponent
        ) {
          originalTermEndIndex = originalTermStartIndex + 1;
        }

        // originalTextSegment 的填充逻辑（你需要提供）
        // const originalTextSegment = ... ;

        initialMatches.push({
          keyword: result.keyword,
          phraseTokens: result.keyword.split(' '),
          candidateStartIndex: firstCandidateIndex,
          candidateEndIndex: lastCandidateIndex + 1,
          originalTermStartIndex: originalTermStartIndex,
          originalTermEndIndex: originalTermEndIndex
          // originalTextSegment: originalTextSegment, // 确保填充
        });
      } else {
        console.warn('无法将AC匹配结果映射回candidate索引:', result);
      }
    } else {
      console.warn('无法定位AC匹配结果的candidate边界:', result, firstCandInfo, lastCandInfo);
    }
  });

  // --- 重叠解决逻辑开始 ---
  if (initialMatches.length === 0) {
    return [];
  }

  // 1. 按短语长度（词元数量）降序排序，长度相同则按 candidateStartIndex 升序排序
  initialMatches.sort((a, b) => {
    const lenA = a.phraseTokens.length;
    const lenB = b.phraseTokens.length;
    if (lenA !== lenB) {
      return lenB - lenA; // 长在前
    }
    return a.candidateStartIndex - b.candidateStartIndex; // 起始早的在前
  });

  const resolvedMatches: MatchedPhraseCandidateInfo[] = [];
  // 用于标记 candidate 序列中的哪些索引已经被选中的短语所覆盖
  const isCandidateIndexCovered = new Array(candidates.length).fill(false);

  for (const currentMatch of initialMatches) {
    let isOverlappingWithSelected = false;
    // 检查当前匹配的 candidate 范围是否与已选中的更长（或同样长但更早）的匹配重叠
    for (let i = currentMatch.candidateStartIndex; i < currentMatch.candidateEndIndex; i++) {
      if (isCandidateIndexCovered[i]) {
        isOverlappingWithSelected = true;
        break;
      }
    }

    if (!isOverlappingWithSelected) {
      // 如果没有重叠，则接受这个匹配
      resolvedMatches.push(currentMatch);
      // 并标记其覆盖的 candidate 索引
      for (let i = currentMatch.candidateStartIndex; i < currentMatch.candidateEndIndex; i++) {
        isCandidateIndexCovered[i] = true;
      }
    }
  }
  // --- 重叠解决逻辑结束 ---

  // 最后，可能需要将 resolvedMatches 按原始出现顺序（candidateStartIndex）重新排序，
  // 因为我们之前的排序是为了解决重叠。
  resolvedMatches.sort((a, b) => a.candidateStartIndex - b.candidateStartIndex);

  return resolvedMatches;
  return finalMatches;
}
