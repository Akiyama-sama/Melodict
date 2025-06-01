//english_analyzed_lyrics.d.ts

interface LyricEnglishToken extends LyricToken {
  language: 'en';
  details?: EnglishTokenDetails;
}
type EnglishTokenDetails = EnglishPhrase | EnglishWord | EnglishAbbreviation;

interface EnglishPhrase {
  kind: 'phrase';
  englishPhrase: string;
  //在句子中的意思,由LLM提供
  meaningInSentence?: string;
  //完整短语信息由数据库提供
  englishDictionaryPhrase?: EnglishDictinaryPhrase;
  //短语中的每个单词，由compromise提供
  phraseTokens?: string[];
}

interface EnglishWord {
  kind: 'word';
  englishWord: string;
  englishRootWord: string;
  //在句子中的意思,可以根据compromise中term.chunk判断词性过后，
  // 填上englishDictionaryWord.translations中和某个pos相同的tranCn
  meaningInSentence?: string;
  //可以由compromise中Term.chunk提供，但如果有LLM提供，则优先使用LLM提供
  posInSentence?: string;
  //完整单词信息由数据库提供
  englishDictionaryWord?: EnglishDictionaryWord;
  englishDictionaryRootWord?: EnglishDictionaryWord; //如果有词根，就查询词根
}
interface EnglishAbbreviation {
  kind: 'abbreviation';
  abbreviationTokens: string;
}
interface EnglishDictionaryWord {
  word: string;
  usphone: string;
  ukphone: string;
  translations: Translation[];
  sentences: Sentence[];
  phrases: Phrase[];
  synonyms: Synonyms[];
  antonyms: Antonyms[];
  relatedWords: RelatedWord[];
  bookId: string;
}
interface EnglishDictinaryPhrase {
  phrase: string;
  translations: [
    {
      tran?: string; //英文例句释义
      sentence?: string; //英文例句
      sCN?: string; //短语的中文释义
    }
  ];
}
interface Translation {
  tranCn: string; //中文释义
  descCn?: string;
  pos: string; //此释义的词性

  tranOther?: string; //英文释义
  descOther?: string; // 英文描述
}
interface Sentence {
  sContent: string; //例句内容
  sCn: string; //例句中文释义
}
interface Phrase {
  pContent: string; //短语内容
  pCn: string; //短语中文释义
}
interface Synonyms {
  pos: string;
  tran: string;
  hwds: [
    {
      w: string;
    }
  ];
}
interface Antonyms {
  hwd: string;
}
interface RelatedWord {
  pos: string;
  words: [
    {
      hwd: string;
      tran: string;
    }
  ];
}
