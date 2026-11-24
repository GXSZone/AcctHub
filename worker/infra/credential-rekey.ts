import { paymentPluginSecretFields } from '@shared/domain/payment-plugin-settings';
import { and, eq, getTableColumns, ne, or, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  agents,
  mailOutbox,
  orders,
  paymentPlugins,
  productCards,
  siteMailConfigs,
  siteSettings,
  upstreamOrders,
  upstreamSources,
  userTotpVault,
} from '../db/schema/index';
import { rekeyAiCredential } from '../domains/ai/ai.service';
import type { Env } from '../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from './credential-storage';
import { activeDataKeyVersion, encryptSecret, keyedDataDigest } from './crypto';
import { createDb } from './db';
import { rekeyPaymentPluginConfig } from './payment-credential-storage';

type Row = { row_key: string | number; owner: string | number; previous: string };
type Target = {
  table: SQLiteTable;
  field: string;
  key: AnySQLiteColumn;
  owner: AnySQLiteColumn | SQL;
  filter?: SQL;
  needsRekey?: (activePrefix: string) => SQL | undefined;
  seal: (env: Env, row: Row) => Promise<string>;
};

const scope =
  (purpose: string, withOwner = false): Target['seal'] =>
  async (env, row) => {
    const purposeScope = withOwner ? `${purpose}:${row.owner}` : purpose;
    return encryptSecret(env, await readStoredCredential(env, row.previous, purposeScope), purposeScope);
  };

function paymentPluginsNeedRekey(activePrefix: string) {
  const config = sql`CASE WHEN json_valid(${paymentPlugins.configJson}) THEN ${paymentPlugins.configJson} ELSE '{}' END`;
  return or(
    ...Object.entries(paymentPluginSecretFields).map(([id, fields]) =>
      and(
        eq(paymentPlugins.id, id),
        or(
          ...fields.map((field) => {
            const path = `$.${field}`;
            const value = sql`json_extract(${config}, ${path})`;
            return sql`json_type(${config}, ${path}) = 'text' AND trim(${value}) <> '' AND substr(${value}, 1, ${activePrefix.length}) <> ${activePrefix}`;
          })
        )
      )
    )
  );
}

const targets: Target[] = [
  { table: agents, field: 'apiKeyEnc', key: agents.id, owner: agents.id, seal: scope('vault') },
  {
    table: userTotpVault,
    field: 'encryptedSecret',
    key: userTotpVault.id,
    owner: userTotpVault.id,
    seal: scope('vault'),
  },
  {
    table: siteMailConfigs,
    field: 'apiKeyEncrypted',
    key: siteMailConfigs.ownerAgentId,
    owner: siteMailConfigs.ownerAgentId,
    seal: scope('vault'),
  },
  ...['apiKeyEnc', 'apiSecretEnc', 'webhookSecretEnc', 'proxyRelayTokenEnc'].map((field) => ({
    table: upstreamSources,
    field,
    key: upstreamSources.id,
    owner: upstreamSources.id,
    seal: scope('vault'),
  })),
  {
    table: orders,
    field: 'deliveredPayload',
    key: orders.id,
    owner: orders.orderNo,
    seal: scope('order-delivery', true),
  },
  {
    table: productCards,
    field: 'cardContent',
    key: productCards.id,
    owner: productCards.productId,
    seal: scope(INVENTORY_CREDENTIAL_SCOPE),
  },
  {
    table: upstreamOrders,
    field: 'cardsJson',
    key: upstreamOrders.id,
    owner: upstreamOrders.id,
    filter: ne(upstreamOrders.cardsJson, '[]'),
    seal: scope('upstream-cards', true),
  },
  {
    table: upstreamOrders,
    field: 'rawResponseJson',
    key: upstreamOrders.id,
    owner: upstreamOrders.id,
    filter: ne(upstreamOrders.rawResponseJson, '{}'),
    seal: scope('upstream-response', true),
  },
  {
    table: mailOutbox,
    field: 'payload',
    key: mailOutbox.id,
    owner: sql`${mailOutbox.ownerAgentId} || ':' || ${mailOutbox.eventKey}`,
    seal: scope('mail-outbox', true),
  },
  ...(['cf_saas_api_token', 'notify_tg_bot_token'] as const).map((name) => ({
    table: siteSettings,
    field: 'value',
    key: siteSettings.key,
    owner: siteSettings.key,
    filter: eq(siteSettings.key, name),
    seal: scope(name),
  })),
  {
    table: siteSettings,
    field: 'value',
    key: siteSettings.key,
    owner: siteSettings.key,
    filter: eq(siteSettings.key, 'ai_api_key'),
    seal: (env, row) => rekeyAiCredential(env, row.previous),
  },
  {
    table: paymentPlugins,
    field: 'configJson',
    key: paymentPlugins.id,
    owner: paymentPlugins.id,
    needsRekey: paymentPluginsNeedRekey,
    seal: (env, row) => rekeyPaymentPluginConfig(env, String(row.owner), row.previous),
  },
];

/** 有界重加密任务。共用线上密钥绑定，逐行检查原值，日志只报告统计。 */
export async function rekeyStoredCredentials(env: Env, rowsPerTarget = 12) {
  const activePrefix = `v3.${activeDataKeyVersion(env)}.`;
  const db = createDb(env.DB);
  let updated = 0;
  let failed = 0;
  let pending = 0;

  for (const target of targets) {
    const { table, field, key, owner, filter, needsRekey, seal } = target;
    const column = getTableColumns(table)[field];
    const found = await db
      .select({
        row_key: sql<string | number>`${key}`,
        owner: sql<string | number>`${owner}`,
        previous: sql<string>`${column}`,
      })
      .from(table)
      .where(
        and(
          needsRekey?.(activePrefix) ??
            sql`${column} <> '' AND substr(${column}, 1, ${activePrefix.length}) <> ${activePrefix}`,
          filter
        )
      )
      .orderBy(key)
      .limit(rowsPerTarget);
    pending += found.length;
    for (const row of found) {
      try {
        const ciphertext = await seal(env, row);
        const beforeFingerprint =
          table === productCards
            ? await keyedDataDigest(
                env,
                'inventory',
                JSON.stringify([
                  row.owner,
                  (await readStoredCredential(env, row.previous, INVENTORY_CREDENTIAL_SCOPE)).trim(),
                ])
              )
            : null;
        const result = beforeFingerprint
          ? await db
              .update(productCards)
              .set({
                cardContent: ciphertext,
                credentialFingerprint: sql`COALESCE(${productCards.credentialFingerprint}, CASE WHEN NOT EXISTS(
                  SELECT 1 FROM ${productCards} WHERE ${productCards.productId} = ${row.owner}
                    AND ${productCards.credentialFingerprint} = ${beforeFingerprint}
                ) THEN ${beforeFingerprint} ELSE NULL END)`,
              })
              .where(and(eq(key, row.row_key), eq(column, row.previous)))
              .run()
          : await db
              .update(table)
              .set({ [field]: ciphertext })
              .where(and(eq(key, row.row_key), eq(column, row.previous)))
              .run();
        updated += Number(result.meta.changes || 0);
      } catch {
        failed++;
      }
    }
  }
  return { updated, failed, pending };
}
