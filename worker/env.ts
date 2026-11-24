import type { AuthUserDto, TenantCapabilitiesDto, TenantResolutionMode } from '@shared/index';
import type { AppDatabase } from './infra/db';
import { AppError } from './infra/errors';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ENV?: string;
  MAIN_HOSTNAMES?: string;
  ACCTHUB_RELEASE_SHA?: string;
  ACCTHUB_RELEASE_DIGEST?: string;
  SANDBOX_MODE?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_SECRET?: string;
  JWT_SECRET?: string;
  DATA_ENCRYPTION_KEYS?: string;
  DATA_FINGERPRINT_KEY?: string;
  LEGACY_VAULT_SECRET?: string;
  DATA_REKEY_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
}

export interface TenantContext {
  isSubAgent: boolean;
  isSuspended?: boolean;
  agentId: number | null;
  ownerUserId: number | null;
  slug: string | null;
  brandName: string | null;
  brandTagline: string | null;
  supportLabel: string | null;
  supportUrl: string | null;
  supportNote: string | null;
  supportMediaJson?: string | null;
  supportLinksJson?: string | null;
  announcementBanner: string | null;
  tickerEnabled?: boolean;
  tickerMode?: string;
  tickerIncludeNotices?: boolean;
  popupEnabled?: boolean;
  popupTitle?: string | null;
  popupContent?: string | null;
  popupFrequency?: string | null;
  popupVersion?: string | null;
  markupPercent: number;
  commissionRate: number;
  themeAccent?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  footerText?: string | null;
  resolvedVia: TenantResolutionMode;
  matchedHostname?: string;
  primaryHostname?: string | null;
  isBlockedCnameHost?: boolean;
  isUnauthorizedDomain?: boolean;
  unauthorizedReason?: string;
  capabilities?: TenantCapabilitiesDto;
}

export interface AppVariables {
  requestId: string;
  db: AppDatabase;
  tenant: TenantContext;
  user: AuthUserDto | null;
}

export interface AppBindings {
  Bindings: Env;
  Variables: AppVariables;
}

const DEFAULT_DEV_JWT_SECRET = 'accthub-edge-hmac-secret-change-in-prod';
const DEFAULT_DEV_ADMIN_SECRET = 'accthub-admin';

/** 正式构建在绑定被误设为 development 时仍使用正式环境的安全策略。 */
export function isDevOrTestEnv(env: Pick<Env, 'APP_ENV'>): boolean {
  if (typeof __ACCTHUB_SANDBOX__ === 'undefined' || !__ACCTHUB_SANDBOX__) return false;
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  return appEnv === 'development' || appEnv === 'test';
}

export function isProductionEnv(env: Env): boolean {
  return env.APP_ENV?.trim().toLowerCase() === 'production';
}

export function isSandboxEnabled(env: Pick<Env, 'APP_ENV' | 'SANDBOX_MODE'>): boolean {
  return isDevOrTestEnv(env) && env.SANDBOX_MODE?.trim().toLowerCase() !== 'false';
}

export function getRegistrationWelcomeCredit(env: Env): number {
  return isSandboxEnabled(env) ? 50 : 0;
}

/** 统一解析总控管理员秘钥：非 dev/test（含 staging 与 production）严禁回退或接受默认弱口令 */
export function resolveAdminExpectedSecret(env: Env): string {
  const configured = String(env.ADMIN_SECRET || '').trim();
  if (isDevOrTestEnv(env)) {
    return configured || DEFAULT_DEV_ADMIN_SECRET;
  }
  return configured && configured !== DEFAULT_DEV_ADMIN_SECRET ? configured : '';
}

export function getRequiredJwtSecret(env: Env): string {
  const secret = String(env.JWT_SECRET || '').trim();
  if (!isDevOrTestEnv(env)) {
    if (!secret || secret === DEFAULT_DEV_JWT_SECRET || secret.length < 24) {
      const label = isProductionEnv(env) ? 'Production' : 'Non-dev';
      throw new AppError(
        'CONFIGURATION_ERROR',
        `${label} JWT_SECRET must be explicitly configured with at least 24 characters`,
        { expose: false }
      );
    }
    return secret;
  }
  return secret || DEFAULT_DEV_JWT_SECRET;
}
