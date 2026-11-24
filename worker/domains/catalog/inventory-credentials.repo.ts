import { and, eq, isNull } from 'drizzle-orm';
import { productCards } from '../../db/schema/index';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import { encryptSecret, keyedDataDigest } from '../../infra/crypto';
import { createDb } from '../../infra/db';

function isSampleCredential(value: string): boolean {
  return (
    /^(?:vip|member)\.[^\s@]+@accthub\.mail----Pass![^\s]+----2FA:JBSWY3DPEHPK3PXP$/i.test(value) ||
    /^\[(?:上游直采|上游异步出卡) .+]\s+(?:acct|async)_[a-z0-9]+@pro-edge\.ai \| Pass: (?:Edge|Async)#/i.test(
      value
    )
  );
}

interface ParsedCardLine {
  plaintext: string;
  publicLabel: string;
  selectFee: number;
}

/** 解析单行导入卡密（支持「卡密正文」、「公开标签||卡密正文」、「公开标签||加价||卡密正文」） */
function parseCardImportLine(rawLine: string, defaultSelectFee: number): ParsedCardLine | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed.includes('||')) {
    const parts = trimmed.split('||').map((p) => p.trim());
    if (parts.length >= 3 && parts[0] && parts[2]) {
      const feeNum = Number(parts[1]);
      return {
        publicLabel: parts[0].slice(0, 80),
        selectFee: Number.isFinite(feeNum) && feeNum >= 0 ? Number(feeNum.toFixed(2)) : defaultSelectFee,
        plaintext: parts.slice(2).join('||').trim(),
      };
    }
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        publicLabel: parts[0].slice(0, 80),
        selectFee: defaultSelectFee,
        plaintext: parts[1],
      };
    }
  }
  return { plaintext: trimmed, publicLabel: '', selectFee: 0 };
}

export async function prepareInventoryCredentials(env: Env, productId: number, input: string[]) {
  const normalized = input.map((line) => line.trim()).filter(Boolean);
  const real = normalized.filter((line) => !isSampleCredential(line));
  const distinct = new Set(real);
  if (distinct.size > 0) {
    const legacy = await createDb(env.DB)
      .select({ content: productCards.cardContent })
      .from(productCards)
      .where(and(eq(productCards.productId, productId), isNull(productCards.credentialFingerprint)));
    for (const row of legacy) {
      const credential = await readStoredCredential(env, row.content, INVENTORY_CREDENTIAL_SCOPE);
      distinct.delete(credential.trim());
    }
  }
  const rows = await Promise.all(
    [...distinct].map(async (plaintext) => ({
      fingerprint: await keyedDataDigest(env, 'inventory', JSON.stringify([productId, plaintext])),
      content: await encryptSecret(env, plaintext, INVENTORY_CREDENTIAL_SCOPE),
    }))
  );
  return { rows, totalReal: real.length, rejectedSamples: normalized.length - real.length };
}

export async function importInventoryCredentials(
  env: Env,
  productId: number,
  specId: string,
  lines: string[],
  options?: { isLoop?: boolean; dedupe?: boolean; defaultSelectFee?: number }
) {
  const isLoop = options?.isLoop ? 1 : 0;
  const dedupe = options?.dedupe !== false;
  const defaultSelectFee = Math.max(0, Number(options?.defaultSelectFee || 0));
  const db = createDb(env.DB);

  const parsedLines = lines
    .map((l) => parseCardImportLine(l, defaultSelectFee))
    .filter((x): x is ParsedCardLine => x !== null && Boolean(x.plaintext));
  const realLines = parsedLines.filter((x) => !isSampleCredential(x.plaintext));
  const rejectedSamples = parsedLines.length - realLines.length;

  if (!dedupe) {
    const rows = await Promise.all(
      realLines.map(async (item, idx) => ({
        fingerprint: await keyedDataDigest(
          env,
          'inventory-raw',
          JSON.stringify([productId, item.plaintext, Date.now(), idx, Math.random()])
        ),
        content: await encryptSecret(env, item.plaintext, INVENTORY_CREDENTIAL_SCOPE),
        publicLabel: item.publicLabel,
        selectFee: item.selectFee,
      }))
    );
    let imported = 0;
    for (let i = 0; i < rows.length; i += 16) {
      const result = await db
        .insert(productCards)
        .values(
          rows.slice(i, i + 16).map((row) => ({
            productId,
            specId,
            cardContent: row.content,
            credentialFingerprint: row.fingerprint,
            isLoop,
            publicLabel: row.publicLabel,
            selectFee: row.selectFee,
          }))
        )
        .run();
      imported += Number(result.meta.changes || 0);
    }
    return { imported, duplicates: 0, rejected_samples: rejectedSamples };
  }

  const distinctMap = new Map<string, ParsedCardLine>();
  for (const item of realLines) {
    if (!distinctMap.has(item.plaintext)) distinctMap.set(item.plaintext, item);
  }
  if (distinctMap.size > 0) {
    const legacy = await db
      .select({ content: productCards.cardContent })
      .from(productCards)
      .where(and(eq(productCards.productId, productId), isNull(productCards.credentialFingerprint)));
    for (const row of legacy) {
      const credential = await readStoredCredential(env, row.content, INVENTORY_CREDENTIAL_SCOPE);
      distinctMap.delete(credential.trim());
    }
  }
  const rows = await Promise.all(
    [...distinctMap.values()].map(async (item) => ({
      fingerprint: await keyedDataDigest(env, 'inventory', JSON.stringify([productId, item.plaintext])),
      content: await encryptSecret(env, item.plaintext, INVENTORY_CREDENTIAL_SCOPE),
      publicLabel: item.publicLabel,
      selectFee: item.selectFee,
    }))
  );

  let imported = 0;
  for (let i = 0; i < rows.length; i += 16) {
    const result = await db
      .insert(productCards)
      .values(
        rows.slice(i, i + 16).map((row) => ({
          productId,
          specId,
          cardContent: row.content,
          credentialFingerprint: row.fingerprint,
          isLoop,
          publicLabel: row.publicLabel,
          selectFee: row.selectFee,
        }))
      )
      .onConflictDoNothing({ target: [productCards.productId, productCards.credentialFingerprint] })
      .run();
    imported += Number(result.meta.changes || 0);
  }
  return { imported, duplicates: realLines.length - imported, rejected_samples: rejectedSamples };
}
