import { describe, expect, it } from 'vitest';

import { LYRICS_LANGUAGE_PROFILES } from '../../../../src/common/lyricsLanguageProfiles';
import { SYSTEM_PROMPT_TEMPLATE } from '../../../../src/main/lyricsAnalysis/analysisPrompts';

/**
 * Guard against prompt drift when adding a language. The template hardcodes each language's
 * pronunciation field names as prose ("kana/romaji for Japanese, ipa/us/uk for English, …"), and
 * the model is graded against them — a profile whose pronunciation fields never reach the prompt
 * would silently get zero pronunciation data. When a new language profile is added and its fields
 * are missing from the template, these tests go red.
 *
 * src/common/lyricsLanguageProfiles.ts's header comment lists this file as one of the touching
 * points of "adding a language".
 */

const PRONUNCIATION_FIELD_IN_RULE = /card\.pronunciation\.([A-Za-z]+)/g;

/** Field names a profile's pronunciationRule names, e.g. kana/romaji for Japanese. */
const pronunciationFieldsOf = (pronunciationRule: string): string[] => {
  const fields = new Set<string>();
  for (const match of pronunciationRule.matchAll(PRONUNCIATION_FIELD_IN_RULE)) {
    const field = match[1];
    if (field) fields.add(field);
  }
  return [...fields];
};

describe('SYSTEM_PROMPT_TEMPLATE language coverage', () => {
  it('extracts the expected pronunciation fields from every non-unknown profile', () => {
    // Pins the extraction itself: if a rule is reworded away from card.pronunciation.<field>,
    // this fails before the template guard below could silently stop checking anything.
    const expected = {
      ja: ['kana', 'romaji'],
      en: ['ipa'],
      ko: ['hangul', 'romanized'],
      zh: ['pinyin']
    } as const;
    for (const [language, fields] of Object.entries(expected)) {
      expect(pronunciationFieldsOf(LYRICS_LANGUAGE_PROFILES[language as keyof typeof LYRICS_LANGUAGE_PROFILES].pronunciationRule)).toEqual(fields);
    }
  });

  it('mentions the pronunciation field names of every language the mix can resolve', () => {
    // Every language the script detector can produce must have its pronunciation fields spelled
    // out in the template prose; a brand-new language profile added without a prompt update
    // fails here. LYRICS_LANGUAGE_PROFILES is Record<LyricsAnalysisLanguage, …>, so its keys are
    // exactly the union — pinning them pins the resolvable set.
    const resolvable = Object.keys(LYRICS_LANGUAGE_PROFILES).filter((language) => language !== 'unknown');
    expect(resolvable.sort()).toEqual(['en', 'ja', 'ko', 'zh']);

    for (const [language, profile] of Object.entries(LYRICS_LANGUAGE_PROFILES)) {
      if (language === 'unknown') continue;
      const fields = pronunciationFieldsOf(profile.pronunciationRule);
      // A profile that names no concrete pronunciation field cannot be guarded — fail loudly so
      // the author wires the field into both the rule and the template prose.
      expect(fields.length, `${language} profile names no card.pronunciation.* field`).toBeGreaterThan(0);
      for (const field of fields) {
        expect(SYSTEM_PROMPT_TEMPLATE, `${language} field "${field}" missing from the prompt`).toContain(field);
      }
    }
  });
});
