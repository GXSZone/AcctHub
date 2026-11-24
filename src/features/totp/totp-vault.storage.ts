/**
 * 2FA 密钥箱本机浏览器持久化工具与批量解析函数
 */

import { cleanSecret, parseOtpAuthUri } from '../../lib/totp';
import type { TotpVaultItem } from '../../types';

const LOCAL_VAULT_KEY = 'accthub_saved_2fa_v2';
export const TOTP_VAULT_LIMIT = 50;

type ParsedTotpItem = Omit<TotpVaultItem, 'id' | 'created_at'>;

export function loadLocalTotpVault(): TotpVaultItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_VAULT_KEY);
    if (raw) return JSON.parse(raw) as TotpVaultItem[];
  } catch (err) {
    console.warn('[AcctHub] Failed to read local 2FA vault:', err);
  }
  return [];
}

export function saveLocalTotpVault(items: TotpVaultItem[]): void {
  if (items.length > TOTP_VAULT_LIMIT) throw new RangeError('TOTP_VAULT_LIMIT');
  localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(items));
}

export function formatOtpDisplay(val: string): string {
  if (val.length === 6) return `${val.slice(0, 3)} ${val.slice(3)}`;
  if (val.length === 8) return `${val.slice(0, 4)} ${val.slice(4)}`;
  return val;
}

export function parseBatchTotpLines(
  batchText: string,
  fallbackSingleIssuer = 'Imported',
  fallbackBatchIssuer = 'Batch'
): ParsedTotpItem[] {
  const lines = batchText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const parsedItems: ParsedTotpItem[] = [];
  for (const line of lines) {
    if (line.toLowerCase().startsWith('otpauth://')) {
      const p = parseOtpAuthUri(line);
      if (p.secret.length >= 8) {
        parsedItems.push({
          issuer: p.issuer || fallbackSingleIssuer,
          account_name: p.account,
          secret: p.secret,
          digits: p.digits,
          period: p.period,
        });
      }
      continue;
    }
    const parts = line.includes('----') ? line.split('----') : line.split(/[\s,|]+/);
    let foundSecret = '';
    let foundAccount = '';
    let foundIssuer = '';
    for (const part of parts.map((s) => s.trim()).filter(Boolean)) {
      if (!foundAccount && part.includes('@')) foundAccount = part;
      else if (!foundSecret && cleanSecret(part).length >= 16) foundSecret = cleanSecret(part);
      else if (!foundIssuer && part.length <= 24) foundIssuer = part;
    }
    if (!foundSecret && cleanSecret(line).length >= 8) {
      foundSecret = cleanSecret(line);
    }
    if (foundSecret.length >= 8) {
      parsedItems.push({
        issuer: foundIssuer || fallbackBatchIssuer,
        account_name: foundAccount || `${foundSecret.slice(0, 6)}...`,
        secret: foundSecret,
        digits: 6,
        period: 30,
      });
    }
  }
  return parsedItems;
}
