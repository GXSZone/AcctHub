import { cleanSecret } from '../../../lib/totp';
import { fmt } from '../..';
import type { AccountDict } from './zh-CN';

export interface ParsedCredentialField {
  label: string;
  value: string;
  is2fa?: boolean;
}

export interface ParsedCredentialEntry {
  raw: string;
  fields: ParsedCredentialField[];
}

/**
 * 将交付的卡密文本智能拆解为字段列表（所有显示标签均来自多语种字典）
 */
export function parseDeliveredCredentials(payload: string, a: AccountDict): ParsedCredentialEntry[] {
  const lines = (payload || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const isKeyValueBlock =
    lines.length > 1 && lines.every((l) => /^[A-Za-z0-9\u4e00-\u9fa5 /_-]{2,24}[:：]\s*.+/.test(l));
  if (isKeyValueBlock) {
    const fields: ParsedCredentialField[] = lines.map((l) => {
      const m = l.match(/^([^:：]+)[:：]\s*(.+)$/);
      const label = m ? m[1].trim() : a.credDefaultLabel;
      const val = m ? m[2].trim() : l;
      const is2fa =
        /2fa|totp|otp|密钥|金鑰/i.test(label) && cleanSecret(val).length >= 16 && !val.startsWith('sk-');
      return { label, value: val, is2fa };
    });
    return [{ raw: payload, fields }];
  }

  return lines.map((line) => {
    const fields: ParsedCredentialField[] = [];
    const delim = line.includes('----') ? '----' : line.includes(' | ') ? ' | ' : null;
    if (delim) {
      const parts = line
        .split(delim)
        .map((p) => p.trim())
        .filter(Boolean);
      parts.forEach((part, idx) => {
        const kv = part.match(/^([^:：]+)[:：]\s*(.+)$/);
        if (kv) {
          const k = kv[1].trim();
          const v = kv[2].trim();
          const is2fa = /2fa|totp|otp/i.test(k) && cleanSecret(v).length >= 8;
          fields.push({ label: k, value: v, is2fa });
        } else if (idx === 0 && part.includes('@')) {
          fields.push({ label: a.credEmailLabel, value: part });
        } else if (idx === 1) {
          fields.push({ label: a.credPassLabel, value: part });
        } else if (/^[A-Z2-7]{16,}$/i.test(part.replace(/\s+/g, ''))) {
          fields.push({ label: a.cred2faLabel, value: part, is2fa: true });
        } else {
          fields.push({
            label: idx === 2 ? a.credAuxLabel : fmt(a.credFieldIndex, { index: idx + 1 }),
            value: part,
          });
        }
      });
    } else {
      const m2fa = line.match(/2FA[:：]\s*([A-Z2-7]{8,})/i);
      if (m2fa) {
        fields.push({ label: a.credFullCard, value: line });
        fields.push({ label: a.cred2faLabel, value: m2fa[1], is2fa: true });
      }
    }
    return { raw: line, fields };
  });
}
