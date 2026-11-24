/**
 * 认证与租户隔离会话（Auth）领域 API 客户端
 */

import type { UserProfile } from '../types';
import { apiRequest } from './http';

export const authApi = {
  me: (signal?: AbortSignal) => apiRequest<{ user: UserProfile | null }>('/api/auth/me', { signal }),

  logout: (token: string) =>
    apiRequest<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  login: (email: string, password: string, turnstile_token?: string, totp_code?: string) =>
    apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        turnstile_token,
        ...(totp_code?.trim() ? { totp_code: totp_code.trim() } : {}),
      }),
    }),

  register: (
    email: string,
    password: string,
    display_name: string,
    turnstile_token?: string,
    referral_code?: string
  ) =>
    apiRequest<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        display_name,
        turnstile_token,
        referral_code: referral_code?.trim() || undefined,
      }),
    }),

  issueSso: (redirect_path = '/agent') =>
    apiRequest<{
      ok: boolean;
      ticket: string;
      target_origin: string;
      redirect_url: string;
      expires_in_sec: number;
    }>('/api/auth/sso/issue', {
      method: 'POST',
      body: JSON.stringify({ redirect_path }),
    }),

  exchangeSso: (ticket: string) =>
    apiRequest<{
      ok: boolean;
      token: string;
      redirect_path: string;
      user: UserProfile;
    }>('/api/auth/sso/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    }),

  forgotPassword: (email: string) =>
    apiRequest<{ ok: boolean; mail_sent?: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (email: string, code: string, new_password: string) =>
    apiRequest<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password }),
    }),

  changePassword: (current_password: string, new_password: string) =>
    apiRequest<{ ok: boolean; token: string; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
};
