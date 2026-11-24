import { normalizeLocale } from '@shared/domain/i18n';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { zhCN } from './locales/zh-CN';
import { type I18nMessages, LOCALE_OPTIONS, type SupportedLocale } from './types';

export { type I18nMessages, LOCALE_OPTIONS, type SupportedLocale };

const LANG_STORAGE_KEY = 'accthub_lang';

const localeCache = new Map<SupportedLocale, I18nMessages>([['zh-CN', zhCN]]);

/**
 * 按需动态懒加载非默认语种资源包，确保首屏仅打包简体中文默认包
 */
async function loadLocaleMessages(locale: SupportedLocale): Promise<I18nMessages> {
  const cached = localeCache.get(locale);
  if (cached) return cached;

  let loaded: I18nMessages = zhCN;
  if (locale === 'zh-TW') {
    loaded = (await import('./locales/zh-TW')).zhTW;
  } else if (locale === 'en') {
    loaded = (await import('./locales/en')).en;
  } else if (locale === 'ja') {
    loaded = (await import('./locales/ja')).ja;
  } else if (locale === 'ko') {
    loaded = (await import('./locales/ko')).ko;
  }
  localeCache.set(locale, loaded);
  return loaded;
}

export function getStoredLocale(): SupportedLocale {
  try {
    return normalizeLocale(localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return 'zh-CN';
  }
}

function persistLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, locale);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  } catch {
    // 忽略无存储权限环境
  }
}

/** 轻量模板插值工具，支持 {key} 占位替换为真实动态参数 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

interface I18nContextValue {
  locale: SupportedLocale;
  messages: I18nMessages;
  setLocale: (next: SupportedLocale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-CN',
  messages: zhCN,
  setLocale: () => undefined,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => getStoredLocale());
  const [messages, setMessages] = useState<I18nMessages>(() => localeCache.get(getStoredLocale()) || zhCN);

  useEffect(() => {
    let active = true;
    persistLocale(locale);
    void loadLocaleMessages(locale).then((loaded) => {
      if (active) setMessages(loaded);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(normalizeLocale(next));
  }, []);

  return <I18nContext.Provider value={{ locale, messages, setLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * 按命名空间懒加载 5 语种字典 Hook：
 * 传入各语种动态 loader 映射，切换语种时按需加载并缓存，未就绪时自动回退至默认词典。
 */
export function useNamespace<T extends Record<string, string>>(
  defaultDict: T,
  loaders: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<T>>
): T {
  const { locale } = useI18n();
  const [dict, setDict] = useState<T>(defaultDict);

  useEffect(() => {
    if (locale === 'zh-CN') {
      setDict(defaultDict);
      return;
    }
    let active = true;
    void loaders[locale]().then((loaded) => {
      if (active) setDict(loaded);
    });
    return () => {
      active = false;
    };
  }, [locale, defaultDict, loaders]);

  return dict;
}
