import { tokenizeEnglishLyricLine } from '../src/main/analyzeLyric/tokenizer/englishTokenizer';
import { fillLyricEnglishToken } from '../src/main/analyzeLyric/fillToken/fillEnglishToken';
import nlp from 'compromise';
import utils from 'util';
import path from 'path';
import { getDbConnection } from '../src/main/analyzeLyric/mapper/englishWordMapper';

const englishPhrasesDbFilePath = path.resolve(process.cwd(), 'resources/phrases/englishPhrases.db');
const englishDictDbFilePath = path.resolve(process.cwd(), 'resources/dictionaries/english_dict_level8.db'); 
const textCases = [
  { input: 'The cats were sleeping.' },
  { input: "I'm used to taking the train." },
  { input: 'As long as you take off my clothes.' },
  { input: "Yes I will' I promise you." },
  { input: "There's Jack's home." },
];
/* describe('English Tokenizer Tests', () => {
  it('should correctly tokenize ', () => {
    textCases.forEach((textCase) => {
      const tokens = tokenizeEnglishLyricLine(textCase.input);
      const surfaceForms = tokens.map((t) => t.text);
      //console.log(utils.inspect(tokens, { depth: null, colors: true }));
      console.log(surfaceForms);
    });
  });
}); */
/* describe('easy tokenize', () => {
  it('should correctly tokenize "Hello, world!"', () => {
    const tokens = tokenizeEnglishLyricLine("I'm here to hold on you.");
    const surfaceForms = tokens.map(t => t.text);
    console.log(utils.inspect(tokens, { depth: null, colors: true }));
  });
}); */
/* describe('English Dictionary Lookup Tests', () => {
  it('lookup english word', () => {
    const word = "love";
    const result = getOneEnglishWord(word,englishDictDbFilePath);
    console.log(result);
  });
}); */
describe('fill english tokens',()=>{
  it('fill english word token',()=>{
    const tokens=tokenizeEnglishLyricLine("So as long as I love you.");
    tokens.forEach(token=>{
      const filledToken=fillLyricEnglishToken(token);
      console.log(utils.inspect(filledToken, { depth: null, colors: true }));
    })
  });
})  
/* describe('db connection',()=>{
  it('should connect to the database',()=>{
    const db=getDbConnection(englishPhrasesDbFilePath);
    console.log(db);
  })
}) */
