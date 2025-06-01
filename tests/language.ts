import { franc } from 'franc-min';

export default function getLyricLineLanguage(lyricLine: string): 'en' | 'ja' | 'unknown' {
    if (!lyricLine || lyricLine.trim() === "") {
        return 'unknown';
    }
    const language = franc(lyricLine);
    if (language === 'jpn') {
      return 'ja';
    } else if (language === 'eng') {
      return 'en';
    } else {
      return 'unknown';
    }
  };