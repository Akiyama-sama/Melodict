import Kuromoji from '@sglkc/kuromoji';
declare global {
    interface LyricJapaneseToken extends LyricToken {
        language: 'ja';
        hiragana?: string;
        katakana?: string;
        romaji?: string;
        surface_form: string;
        pos: string;
        pos_detail_1: string;
        pos_detail_2: string;
        pos_detail_3: string;
        conjugated_type: string;
        conjugated_form: string;
        basic_form: string;
        reading?: string ;
        pronunciation?: string ;
      }
}


