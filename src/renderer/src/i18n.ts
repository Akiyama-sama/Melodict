import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './assets/locales/en/en.json';
import tr from './assets/locales/tr/tr.json';
import vi from './assets/locales/vi/vi.json';
import zh from './assets/locales/zh-cn/zh-cn.json';
import type { DropdownOption } from './components/Dropdown';

export const resources = {
  en: { translation: en },
  tr: { translation: tr },
  vi: { translation: vi },
  zh: { translation: zh }
} as const;

// export type LanguageCodes = keyof typeof resources;

export const supportedLanguagesDropdownOptions: DropdownOption<LanguageCodes>[] = [
  { label: `English`, value: 'en' },
  { label: `Turkish`, value: 'tr' },
  { label: `Vietnamese`, value: 'vi' },
  { label: `Chinese`, value: 'zh' }
  // { label: `Francais`, value: 'fr' },
];

const userData = await window.api.userData.getUserData();

// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  resources,
  lng: userData.language ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false } // React is safe from xss attacks
});

export default i18n;
