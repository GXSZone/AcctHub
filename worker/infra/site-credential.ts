import { and, eq } from 'drizzle-orm';
import { siteSettings } from '../db/schema/index';
import type { Env } from '../env';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto';
import { createDb } from './db';

type SiteCredentialKey = 'cf_saas_api_token' | 'notify_tg_bot_token';

export function sealSiteCredential(env: Env, name: SiteCredentialKey, value: string) {
  return encryptSecret(env, value, name);
}

/** 读取历史明文时原地加密，使用条件更新避免覆盖同时保存的新凭据。 */
export async function readSiteCredential(env: Env, name: SiteCredentialKey, value: string): Promise<string> {
  if (!value) return '';
  if (isEncryptedSecret(value)) return decryptSecret(env, value, name);
  const encrypted = await sealSiteCredential(env, name, value.trim());
  const result = await createDb(env.DB)
    .update(siteSettings)
    .set({ value: encrypted })
    .where(and(eq(siteSettings.key, name), eq(siteSettings.value, value)))
    .returning({ key: siteSettings.key });
  return result.length ? value.trim() : '';
}
