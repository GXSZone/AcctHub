import { SUPPORTED_LOCALES, type SupportedLocale } from '../constants/enums';

export type LocaleInput = SupportedLocale | 'zh' | string | null | undefined;

export interface TranslationEntry {
  title?: string;
  subtitle?: string;
  content?: string;
  summary_markdown?: string;
  detail_markdown?: string;
  risk_notice?: string;
}

export type TranslationsMap = Partial<Record<SupportedLocale, TranslationEntry>>;

/**
 * 将各种语言代码（如 zh, zh-cn, zh-TW, zh-HK, en-US, ja-JP, ko-KR）归一化为标准 SupportedLocale
 */
export function normalizeLocale(raw?: LocaleInput): SupportedLocale {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return 'zh-CN';
  if (s === 'zh-tw' || s === 'zh-hk' || s === 'zh-mo' || s === 'zh-hant') return 'zh-TW';
  if (s === 'zh' || s.startsWith('zh-')) return 'zh-CN';
  if (s === 'en' || s.startsWith('en-')) return 'en';
  if (s === 'ja' || s.startsWith('ja-')) return 'ja';
  if (s === 'ko' || s.startsWith('ko-')) return 'ko';
  return (SUPPORTED_LOCALES as readonly string[]).includes(s) ? (s as SupportedLocale) : 'zh-CN';
}

function parseTranslationsJson(raw?: string | null): TranslationsMap {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj as TranslationsMap;
  } catch {
    return {};
  }
}

/**
 * 按「目标语种 -> 英文 (en / legacyEn) -> 简体中文基准值」三级自动回退解析动态多语种字段
 */
export function resolveLocalizedField(params: {
  locale: LocaleInput;
  baseZh: string;
  legacyEn?: string;
  translationsJson?: string | TranslationsMap | null;
  field: keyof TranslationEntry;
}): string {
  const locale = normalizeLocale(params.locale);
  if (locale === 'zh-CN') return params.baseZh;

  const map =
    typeof params.translationsJson === 'string'
      ? parseTranslationsJson(params.translationsJson)
      : params.translationsJson || {};

  const direct = map[locale]?.[params.field];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  // 若目标为英文或非中文语种未填独立译文，优先回退英文译文，最后回退简体中文
  const enVal = map.en?.[params.field] || params.legacyEn;
  if (locale !== 'zh-TW' && typeof enVal === 'string' && enVal.trim()) {
    return enVal.trim();
  }

  return params.baseZh;
}
