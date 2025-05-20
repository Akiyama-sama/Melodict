import {findMatchPhrasesTermIndexRange,getOriginalTermList } from "./englishPhrasesMatch";
import { getAllPhrases } from "./englishPhraseMapper";

import utils from 'util';
const testCases = [
  // { input: "I'm a boy." },
  { input: "The cats were sleeping."},
  { input: "I'm used to taking the train(Oh)."},
  { input: "As long as you take off my clothes." },
  { input: "Yes I will' I promise you."},
  // { input: "I've been singing loudly."},
  // { input: "Don't stop believing."},
  // { input: "We're gonna make it."},
  // { input: "I had been used to taking the train."},
  // { input: "They weren't able to understand you."},
  // { input: "It's fine."},
  // { input: "Jack's car."},
  // { input: "he's going to be fine."},
  // { input: "I'm here,You will be fine"},
  // { input: "As long as you take off my clothes."},
];

const testCasesForPhraseMatch = [
  { input: "I'm used to taking the train." },
  { input: "As long as you take off my clothes." },
  { input: "I had been used to taking the train." },
  { input: "He is looking forward to the vacation." },
  { input: "She is about to leave for the airport." },
  { input: "They are going to visit their grandparents." },
  { input: "I'm looking for a new job opportunity." },
  { input: "We are supposed to finish the project by Friday." },
  { input: "He is getting ready to go to the party." },
  { input: "She is fed up with his constant complaining." },
  { input: "I am sick and tired of your excuses."}
];

/* describe('generateCandidateMatchSequence', () => {
  it('should generate candidate match sequence', () => {
    const {candidatesResults,originalTermsResults} = phraseTest(testCases);
    console.log(candidatesResults);
    console.log(originalTermsResults);
    
  });
}); */

describe('lookupPhrase', () => {
  /* it('should lookup phrase', () => {
    const phrase = "take off";
    const result = lookupPhrase(phrase);
    console.log(utils.inspect(result, { depth: 3, colors: true }));
  }) */
  /* test('get 10 phrases', () => {
    const phrases = getAllPhrases();
    const result:string[] = [];
    for (let i = 0; i < 10; i++) {
       result.push(phrases[i]);
    }
    console.log(result);
  }); */
  test('generateCandidateMatchSequence', () => {
    const input=testCases[2].input;
    const terms=getOriginalTermList(input);
    const allPhrases = getAllPhrases();
    const originalLyricLine = input;
    const result = findMatchPhrasesTermIndexRange(allPhrases,originalLyricLine);
    console.log(terms.map(t=>t.text).join('+'));
    console.log(result);

  });
  /* test('print originalTerms', () => {
    const {originalTerms} = generateCandidateMatchSequence(testCases[2].input);
    originalTerms.forEach(term => {
      console.log(utils.inspect(term, { depth: null, colors: true }));
    });
  }); */
});





