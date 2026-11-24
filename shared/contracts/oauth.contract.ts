import { z } from 'zod';

export const OAUTH_PROVIDERS = ['google', 'github', 'qq', 'wechat_open', 'wechat_mp'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

export const oauthStartInputSchema = z.object({
  provider: oauthProviderSchema,
  mode: z.enum(['login', 'bind']).optional().default('login'),
  redirect_path: z.string().trim().max(300).optional().default('/'),
  referral_code: z.string().trim().max(32).optional().default(''),
});

export const oauthExchangeInputSchema = z.object({
  ticket: z.string().trim().min(10, '无效的登录票据').max(256),
});

export const adminOAuthProviderUpdateSchema = z.object({
  enabled: z.boolean(),
  client_id: z.string().trim().max(200).optional().default(''),
  client_secret: z.string().trim().max(400).optional().default(''),
  clear_secret: z.boolean().optional().default(false),
});

export const adminOAuthConfigUpdateSchema = z.object({
  callback_base_url: z.string().trim().max(240).optional().default(''),
  providers: z.partialRecord(oauthProviderSchema, adminOAuthProviderUpdateSchema),
});

export interface PublicOAuthProviderDto {
  provider: OAuthProvider;
  enabled: boolean;
}

export interface AdminOAuthProviderConfigDto {
  provider: OAuthProvider;
  enabled: boolean;
  client_id: string;
  has_secret: boolean;
  secret_masked: string;
  callback_path: string;
}

export interface OAuthBindingItemDto {
  provider: OAuthProvider;
  nickname: string;
  email: string;
  avatar_url: string;
  created_at: string;
}
