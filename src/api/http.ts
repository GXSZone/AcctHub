/**
 * 统一 HTTP 请求与认证凭据管理底座（纯 Host 多租户 Origin 原生隔离）
 * 自动注入当前语种请求头（X-Lang / Accept-Language）与当前源 JWT，并将后端错误码映射为 5 语种提示。
 */

import { translateApiErrorMessage } from '@shared/constants/error-codes';
import { getStoredLocale } from '../i18n';

const AUTH_TOKEN_KEY = 'accthub_token';

// 启动时清理历史遗留的旧版管理员本地口令，确保后台仅通过正式会话鉴权
try {
  localStorage.removeItem('accthub_admin_secret');
} catch {
  // 无浏览器环境或隐私模式忽略
}

let authRevision = 0;
const authListeners = new Set<() => void>();

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

function announceAuthChange(): void {
  authRevision += 1;
  for (const listener of authListeners) listener();
}

export function getAuthRevision(): number {
  return authRevision;
}

/** 获取当前浏览器 Host 作为租户缓存作用域（每个租户独立域名，天然物理隔离） */
export function getCurrentHostScope(): string {
  try {
    return (window.location.host || 'localhost').toLowerCase();
  } catch {
    return 'localhost';
  }
}

function onAuthStorage(event: StorageEvent): void {
  if (!event.key || event.key === AUTH_TOKEN_KEY) announceAuthChange();
}

export function subscribeAuthChanges(listener: () => void): () => void {
  authListeners.add(listener);
  if (authListeners.size === 1) window.addEventListener('storage', onAuthStorage);
  return () => {
    authListeners.delete(listener);
    if (authListeners.size === 0) window.removeEventListener('storage', onAuthStorage);
  };
}

export function getAuthScope(): string {
  return `${getCurrentHostScope()}:${authRevision}`;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  const previous = getAuthToken();
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (err) {
    console.warn('[AcctHub] localStorage unavailable when saving auth token:', err);
  }
  if (getAuthToken() !== previous) announceAuthChange();
}

/** 发起强类型 JSON API 请求 */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  _opts?: { admin?: boolean }
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const currentLocale = getStoredLocale();
  headers.set('X-Lang', currentLocale);
  headers.set('Accept-Language', `${currentLocale},en;q=0.5`);

  const token = getAuthToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiRequestError(
      translateApiErrorMessage(data.error, data.code, currentLocale, res.status),
      res.status,
      data.code
    );
  }
  return data as T;
}

/** 发起带鉴权头的二进制文件下载请求 */
export async function apiDownloadBlob(path: string, _opts?: { admin?: boolean }): Promise<Blob> {
  const headers = new Headers();
  const currentLocale = getStoredLocale();
  headers.set('X-Lang', currentLocale);
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { headers });
  if (!res.ok) {
    throw new ApiRequestError(
      translateApiErrorMessage(undefined, undefined, currentLocale, res.status),
      res.status
    );
  }
  return res.blob();
}

/** API 文档沙盒调试专用原始请求方法，返回状态码、耗时与边缘响应头 */
export async function apiRawRequest(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string }
): Promise<{
  status: number;
  durationMs: number;
  edgeCache: string | null;
  rateRemaining: string | null;
  json: unknown;
}> {
  const start = performance.now();
  const res = await fetch(path, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  const json = await res.json().catch(() => ({}));
  return {
    status: res.status,
    durationMs: Math.round(performance.now() - start),
    edgeCache: res.headers.get('X-Edge-Cache'),
    rateRemaining: res.headers.get('X-RateLimit-Remaining'),
    json,
  };
}
