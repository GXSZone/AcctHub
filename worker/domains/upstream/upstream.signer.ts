import { roundUpCurrency } from '@shared/domain/money';
import { asc, desc, eq } from 'drizzle-orm';
import { agentTiers } from '../../db/schema/index';
import type { Env } from '../../env';
import {
  decryptSecret,
  encryptSecret,
  generateRandomCode,
  hmacSha256Hex,
  maskSecret,
  md5Hex,
} from '../../infra/crypto';
import { createDb } from '../../infra/db';
import type { DecryptedSourceSecrets, PricingRulesConfig, UpstreamSourceRow } from './upstream.types';

export function buildSortedSignString(
  params: Record<string, unknown>,
  secretKey: string,
  keyParam = 'key'
): string {
  const entries = Object.entries(params)
    .filter(
      ([k, v]) => k !== 'sign' && k !== 'signature' && v !== undefined && v !== null && String(v) !== ''
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = entries
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('&');
  return secretKey ? `${qs}${qs ? '&' : ''}${keyParam}=${secretKey}` : qs;
}

export async function signUpstreamParams(
  authMode: string,
  params: Record<string, unknown>,
  secret: string
): Promise<string> {
  if (authMode === 'hmac_sha256') {
    const base = buildSortedSignString(params, '', 'key');
    return hmacSha256Hex(secret, base);
  }
  const base = buildSortedSignString(params, secret, 'key');
  return md5Hex(base);
}

export async function decryptSourceSecrets(
  env: Env,
  source: UpstreamSourceRow
): Promise<DecryptedSourceSecrets> {
  const apiKey = source.api_key_enc
    ? await decryptSecret(env, source.api_key_enc)
    : String(source.api_key || '');
  const apiSecret = source.api_secret_enc ? await decryptSecret(env, source.api_secret_enc) : '';
  const webhookSecret = source.webhook_secret_enc ? await decryptSecret(env, source.webhook_secret_enc) : '';
  const proxyRelayToken = source.proxy_relay_token_enc
    ? await decryptSecret(env, source.proxy_relay_token_enc)
    : '';
  return { apiKey, apiSecret, webhookSecret, proxyRelayToken };
}

export async function encryptOptionalSecret(env: Env, plaintext?: string | null): Promise<string | null> {
  if (plaintext === undefined) return null;
  const trimmed = String(plaintext || '').trim();
  if (!trimmed) return '';
  return encryptSecret(env, trimmed);
}

export async function sanitizeUpstreamSourceForAdmin(
  env: Env,
  raw: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const row = raw as unknown as UpstreamSourceRow;
  const sec = await decryptSourceSecrets(env, row);
  const {
    api_key: _dropLegacy,
    api_key_enc: _dropKey,
    api_secret_enc: _dropSecret,
    webhook_secret_enc: _dropWh,
    proxy_relay_token_enc: _dropRelay,
    ...rest
  } = raw;
  void _dropLegacy;
  void _dropKey;
  void _dropSecret;
  void _dropWh;
  void _dropRelay;

  return {
    ...rest,
    has_api_key: Boolean(sec.apiKey),
    api_key_masked: maskSecret(sec.apiKey),
    has_api_secret: Boolean(sec.apiSecret),
    api_secret_masked: maskSecret(sec.apiSecret),
    has_webhook_secret: Boolean(sec.webhookSecret),
    webhook_secret_masked: maskSecret(sec.webhookSecret),
    has_proxy_relay_token: Boolean(sec.proxyRelayToken),
    field_mapping: safeParseJson(String(raw.field_mapping_json || '{}'), {}),
    filter_rules: safeParseJson(String(raw.filter_rules_json || '{}'), {}),
    pricing_rules: safeParseJson(String(raw.pricing_rules_json || '{}'), {}),
    order_template: safeParseJson(String(raw.order_template_json || '{}'), {}),
    response_mapping: safeParseJson(String(raw.response_mapping_json || '{}'), {}),
  };
}

export function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw || '') as T;
  } catch {
    return fallback;
  }
}

export function getByPath(obj: unknown, path?: string): unknown {
  if (!path || !obj || typeof obj !== 'object') return obj;
  let cur: unknown = obj;
  for (const seg of path.split('.').filter(Boolean)) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function calculateLocalSellPrice(
  costPrice: number,
  rules: PricingRulesConfig,
  minSafeFloor = 0
): number {
  const pct = Number(rules.markup_percent ?? 20);
  const fixed = Number(rules.markup_fixed ?? 0);
  let sell = costPrice * (1 + pct / 100) + fixed;
  if (rules.rounding === 'integer') {
    sell = Math.ceil(sell);
  } else if (rules.rounding === 'point9') {
    sell = Math.floor(sell) + 0.9;
    if (sell < costPrice) sell = Math.ceil(costPrice) + 0.9;
  }
  sell = Math.max(costPrice, sell);
  if (minSafeFloor > 0 && sell < minSafeFloor) {
    sell =
      rules.rounding === 'integer'
        ? Math.ceil(minSafeFloor)
        : rules.rounding === 'point9'
          ? Math.ceil(minSafeFloor) - 0.1 >= minSafeFloor
            ? Math.ceil(minSafeFloor) - 0.1
            : Math.ceil(minSafeFloor) + 0.9
          : roundUpCurrency(minSafeFloor);
  }
  return Number(sell.toFixed(2));
}

export async function getLowestPlatformAgentDiscount(
  env: Env
): Promise<{ name: string; discount_rate: number }> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ name: agentTiers.name, discountRate: agentTiers.discountRate })
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, 0))
    .orderBy(asc(agentTiers.discountRate), desc(agentTiers.levelRank))
    .limit(1);
  const row = rows[0];
  if (!row || Number(row.discountRate) <= 0) {
    return { name: 'V4 战略合伙人', discount_rate: 0.72 };
  }
  return { name: String(row.name), discount_rate: Number(row.discountRate) };
}

export function inferIconFromTitle(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
  if (lower.includes('gemini') || lower.includes('google')) return 'gemini';
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('midjourney')) return 'midjourney';
  if (lower.includes('grok')) return 'grok';
  if (lower.includes('perplexity')) return 'perplexity';
  if (lower.includes('netflix')) return 'netflix';
  if (lower.includes('spotify')) return 'spotify';
  if (lower.includes('youtube')) return 'youtube';
  if (lower.includes('gmail')) return 'gmail';
  if (lower.includes('api') || lower.includes('token')) return 'cpu';
  return 'puzzle';
}

export function resolveSiblingUrl(baseUrl: string, explicitUrl: string, fallbackPath: string): string {
  if (explicitUrl?.trim()) return explicitUrl.trim();
  if (!baseUrl) return '';
  try {
    const u = new URL(baseUrl);
    return `${u.origin}${fallbackPath}`;
  } catch {
    return baseUrl;
  }
}

export function interpolateTemplate(tpl: unknown, vars: Record<string, string | number>): unknown {
  if (typeof tpl === 'string') {
    const exactMatch = tpl.match(/^\{\{([\w.-]+)\}\}$/);
    if (exactMatch?.[1] && Object.hasOwn(vars, exactMatch[1])) {
      return vars[exactMatch[1]];
    }
    return tpl.replace(/\{\{([\w.-]+)\}\}/g, (_, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : ''));
  }
  if (Array.isArray(tpl)) return tpl.map((x) => interpolateTemplate(x, vars));
  if (tpl && typeof tpl === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tpl as Record<string, unknown>)) {
      out[k] = interpolateTemplate(v, vars);
    }
    return out;
  }
  return tpl;
}

export async function upstreamFetch(
  env: Env,
  source: UpstreamSourceRow,
  targetUrl: string,
  opts: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {}
): Promise<{ status: number; ok: boolean; json: unknown; rawText: string }> {
  const sec = await decryptSourceSecrets(env, source);
  const method = opts.method || 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers || {}),
  };
  const timeoutMs = opts.timeoutMs ?? 12_000;

  let resp: Response;
  if (source.proxy_relay_url && /^https?:\/\//i.test(source.proxy_relay_url.trim())) {
    const relayHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (sec.proxyRelayToken) {
      relayHeaders['X-Relay-Token'] = sec.proxyRelayToken;
    }
    resp = await fetch(source.proxy_relay_url.trim(), {
      method: 'POST',
      redirect: 'error',
      headers: relayHeaders,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        url: targetUrl,
        method,
        headers,
        body: opts.body,
      }),
    });
  } else {
    resp = await fetch(targetUrl, {
      method,
      redirect: 'error',
      headers,
      body: method === 'POST' ? opts.body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  const rawText = await resp.text();
  let json: unknown = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    json = { raw: rawText };
  }
  return { status: resp.status, ok: resp.ok, json, rawText };
}

export async function applyAuthToRequest(
  env: Env,
  source: UpstreamSourceRow,
  url: string,
  params: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ url: string; params: Record<string, unknown>; headers: Record<string, string> }> {
  const sec = await decryptSourceSecrets(env, source);
  const mode = source.auth_mode || 'header_bearer';
  const nextParams: Record<string, unknown> = { ...params };
  const nextHeaders: Record<string, string> = { ...headers };

  if (mode === 'header_bearer') {
    if (sec.apiKey) {
      const hName = source.auth_header || 'Authorization';
      const prefix = source.auth_prefix ?? 'Bearer ';
      nextHeaders[hName] = `${prefix}${sec.apiKey}`;
    }
  } else if (mode === 'query_key') {
    throw new Error('上游 URL 查询参数认证已停用，请改用请求头、正文或签名认证');
  } else if (mode === 'acgfaka_sign' || mode === 'hmac_sha256') {
    const ts = Math.floor(Date.now() / 1000);
    const nonce = generateRandomCode('', 10).toLowerCase();
    if (source.app_id) nextParams.app_id = source.app_id;
    nextParams.timestamp = ts;
    nextParams.nonce = nonce;
    const signSecret = sec.apiSecret || sec.apiKey;
    const signature = await signUpstreamParams(mode, nextParams, signSecret);
    nextParams.sign = signature;
    nextParams.signature = signature;
    if (sec.apiKey && source.auth_header) {
      nextHeaders[source.auth_header] = `${source.auth_prefix ?? ''}${sec.apiKey}`;
    }
  } else if (mode === 'custom_body') {
    if (source.app_id) nextParams.app_id = source.app_id;
    if (sec.apiKey) nextParams.api_key = sec.apiKey;
    if (sec.apiSecret) nextParams.api_secret = sec.apiSecret;
  }

  return { url, params: nextParams, headers: nextHeaders };
}

export function upstreamTransport(
  source: UpstreamSourceRow,
  auth: Awaited<ReturnType<typeof applyAuthToRequest>>,
  requestedMethod: 'GET' | 'POST',
  form = false
) {
  const method = source.auth_mode === 'custom_body' ? 'POST' : requestedMethod;
  const url = new URL(auth.url);
  const headers = { ...auth.headers };
  let body: string | undefined;
  if (method === 'GET') {
    for (const [key, value] of Object.entries(auth.params)) url.searchParams.set(key, String(value));
  } else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(
      Object.entries(auth.params).map(([key, value]) => [key, String(value)])
    ).toString();
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(auth.params);
  }
  return { url: url.href, method, headers, body };
}
