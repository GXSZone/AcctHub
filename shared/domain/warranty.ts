import { WARRANTY_TYPES, type WarrantyStatus, type WarrantyType } from '../constants/enums';
import { BUSINESS_LIMITS } from '../constants/limits';

export interface ProductWarrantyMeta {
  warranty_type: WarrantyType;
  warranty_days: number;
  warranty_summary: string;
}

export interface OrderWarrantyStatus {
  warranty_type: WarrantyType;
  warranty_days: number;
  warranty_summary: string;
  in_warranty: boolean;
  status: WarrantyStatus;
  badge_label: string;
  expires_at: string | null;
  remaining_days: number | null;
}

const VALID_TYPES = new Set<string>(WARRANTY_TYPES);

export function normalizeWarrantyType(raw: unknown): WarrantyType {
  const s = String(raw ?? '').trim();
  return VALID_TYPES.has(s) ? (s as WarrantyType) : 'full_period';
}

export function defaultWarrantyValue(type: WarrantyType): number {
  if (type === 'none') return 0;
  if (type === 'first_login') return BUSINESS_LIMITS.DEFAULT_FIRST_LOGIN_HOURS;
  if (type === 'days') return 7;
  return BUSINESS_LIMITS.DEFAULT_WARRANTY_DAYS;
}

/**
 * 归一化质保时长数值：当传入值非正有限数（如 0、负数、NaN、Infinity）时统一回退到该类型的标准默认值
 */
function normalizePositiveWarrantyValue(type: WarrantyType, value: unknown): number {
  if (type === 'none') return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return defaultWarrantyValue(type);
  }
  return Math.min(BUSINESS_LIMITS.MAX_WARRANTY_UNITS, Math.max(1, Math.floor(num)));
}

export function buildWarrantySummaryTemplate(type: WarrantyType, value: number): string {
  const n = normalizePositiveWarrantyValue(type, value);
  if (type === 'none') return '无售后质保 · 虚拟数字商品售出不退不换，请核对需求后再下单';
  if (type === 'first_login') return `首登质保 · 交付 ${n} 小时内首次登录失败包换`;
  if (type === 'days') return `${n} 天质保 · 质保期内非人为异常免费补发或换新`;
  return `${n} 天全周期质保 · 掉订阅或非人为封号按质保规则换新/补发`;
}

export function formatWarrantyTypeShort(type?: WarrantyType | string | null, value?: number | null): string {
  const normalized = normalizeWarrantyType(type ?? 'full_period');
  if (normalized === 'none') return '无售后质保';
  const n = normalizePositiveWarrantyValue(normalized, value);
  if (normalized === 'first_login') {
    return `首登质保 (${n}h)`;
  }
  if (normalized === 'days') {
    return `${n} 天质保`;
  }
  return `${n} 天全周期质保`;
}

function parseSqlDate(raw: string): Date {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return new Date(`${s.replace(' ', 'T')}Z`);
  }
  return new Date(s);
}

function formatUtcDateTime(d: Date): string {
  const t = d.getTime();
  if (!Number.isFinite(t)) return '';
  try {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  } catch {
    return '';
  }
}

export function evaluateOrderWarranty(
  warrantyStartAt: string | null | undefined,
  meta?: { warranty_type?: unknown; warranty_days?: unknown; warranty_summary?: unknown } | null,
  nowMs = Date.now()
): OrderWarrantyStatus {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const warrantyType = normalizeWarrantyType(meta?.warranty_type ?? 'full_period');
  const effectiveUnits = normalizePositiveWarrantyValue(warrantyType, meta?.warranty_days);
  const warrantySummary =
    String(meta?.warranty_summary || '').trim() || buildWarrantySummaryTemplate(warrantyType, effectiveUnits);

  if (warrantyType === 'none') {
    return {
      warranty_type: 'none',
      warranty_days: 0,
      warranty_summary: warrantySummary,
      in_warranty: false,
      status: 'none',
      badge_label: '无售后质保',
      expires_at: null,
      remaining_days: null,
    };
  }

  const start = parseSqlDate(warrantyStartAt || '');

  if (warrantyType === 'first_login') {
    const windowHours = effectiveUnits;
    if (!Number.isFinite(start.getTime())) {
      return {
        warranty_type: 'first_login',
        warranty_days: windowHours,
        warranty_summary: warrantySummary,
        in_warranty: false,
        status: 'not_started',
        badge_label: '尚无可核验的交付时间',
        expires_at: null,
        remaining_days: null,
      };
    }
    const expiresMs = start.getTime() + windowHours * 3600 * 1000;
    const diffMs = expiresMs - safeNowMs;
    const inWindow = diffMs > 0;
    const remMins = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
    const remHours = Math.max(1, Math.ceil(diffMs / (3600 * 1000)));
    return {
      warranty_type: 'first_login',
      warranty_days: windowHours,
      warranty_summary: warrantySummary,
      in_warranty: inWindow,
      status: inWindow ? 'first_login' : 'expired',
      badge_label: inWindow
        ? remMins < 60
          ? `首登质保（余 ${remMins} 分钟）`
          : `首登质保（余 ${remHours}h）`
        : '首登质保窗口已过',
      expires_at: formatUtcDateTime(new Date(expiresMs)),
      remaining_days: inWindow ? Math.max(0, Math.ceil(diffMs / (86400 * 1000))) : 0,
    };
  }

  const effectiveDays = effectiveUnits;
  const expiresMs =
    (Number.isFinite(start.getTime()) ? start.getTime() : safeNowMs) + effectiveDays * 86400 * 1000;
  const diffMs = expiresMs - safeNowMs;

  if (diffMs > 0) {
    const remDays = Math.ceil(diffMs / (86400 * 1000));
    const remHours = Math.ceil(diffMs / (3600 * 1000));
    return {
      warranty_type: warrantyType,
      warranty_days: effectiveDays,
      warranty_summary: warrantySummary,
      in_warranty: true,
      status: 'in_warranty',
      badge_label:
        remDays > 1 ? `在保质期 · 剩 ${remDays} 天` : `在保质期 · 剩 ${Math.max(1, remHours)} 小时`,
      expires_at: formatUtcDateTime(new Date(expiresMs)),
      remaining_days: remDays,
    };
  }

  const overdueDays = Math.max(1, Math.floor(Math.abs(diffMs) / (86400 * 1000)));
  return {
    warranty_type: warrantyType,
    warranty_days: effectiveDays,
    warranty_summary: warrantySummary,
    in_warranty: false,
    status: 'expired',
    badge_label: `已过保质期（超 ${overdueDays} 天）`,
    expires_at: formatUtcDateTime(new Date(expiresMs)),
    remaining_days: 0,
  };
}
