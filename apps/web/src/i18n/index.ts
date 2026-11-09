import { createFormatter, type MessageParams } from './format.ts';
import en, { type Catalog, type MessageKey } from './locales/en.ts';

export type { MessageKey, MessageParams };

export interface LocaleInfo {
  code: string;
  dir: 'ltr' | 'rtl';
  catalog: Catalog;
}

/** Registered locales. Add a catalog here to ship a translation. */
export const locales = {
  en: { code: 'en', dir: 'ltr', catalog: en },
} satisfies Record<string, LocaleInfo>;

export type LocaleCode = keyof typeof locales;
export const defaultLocale: LocaleCode = 'en';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export function useTranslations(code: LocaleCode = defaultLocale): Translate {
  const { catalog } = locales[code];
  const formatter = createFormatter(code);
  return (key, params) => formatter.format(catalog[key] ?? en[key], params);
}

export function localeInfo(code: LocaleCode = defaultLocale): LocaleInfo {
  return locales[code];
}
