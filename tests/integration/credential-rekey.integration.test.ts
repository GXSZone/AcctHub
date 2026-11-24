import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { mailOutbox, orders, productCards, siteSettings, userTotpVault } from '../../worker/db/schema/index';
import { getAiConfigPublic } from '../../worker/domains/ai/ai.service';
import { rekeyStoredCredentials } from '../../worker/infra/credential-rekey';
import { readDeliveryPayload } from '../../worker/infra/credential-storage';
import { decryptSecret, encryptSecret } from '../../worker/infra/crypto';
import { createTestApp } from './helpers/test-app';

describe('数据密钥迁移', () => {
  it('[S40][S44] 重加密历史凭据并允许退休旧数据密钥', async () => {
    const first = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
    const second = 'YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8=';
    const legacySecret = 'former-signing-key-rotation-fixture';
    const legacyCiphertexts = [
      'v1.AQEBAQEBAQEBAQEB.aSW4vKs4beCEqNCFD2+a1BIlibyKLIHgQ4uHPlbTHsAScpI=',
      'v2.AgICAgICAgICAgIC.6pTq6GQfQQE6ZxSYb3CXNp00UMz1KjOoKWcXZrvydQKgrkU=',
    ];
    const ctx = createTestApp({ DATA_ENCRYPTION_KEYS: JSON.stringify({ active: 'first', keys: { first } }) });
    try {
      await ctx.db
        .insert(userTotpVault)
        .values([
          { userId: 1, encryptedSecret: await encryptSecret(ctx.env, 'OLD-SYNTHETIC-SEED') },
          ...legacyCiphertexts.map((encryptedSecret) => ({ userId: 1, encryptedSecret })),
        ]);
      await ctx.db
        .insert(productCards)
        .values({ productId: 1, specId: 'default', cardContent: 'CARD-FIXTURE' });
      await ctx.db.insert(orders).values({
        orderNo: 'ROTATE-ORDER',
        productId: 1,
        productTitle: '测试',
        unitPrice: 1,
        totalAmount: 1,
        contactEmail: 'buyer@example.test',
        deliveredPayload: 'DELIVERY-FIXTURE',
        status: 'delivered',
      });
      await ctx.db.insert(siteSettings).values({ key: 'ai_api_key', value: 'UNBOUND-HISTORICAL-KEY' });
      const mailPayload = JSON.stringify({ to: 'buyer@example.test', text: '测试邮件' });
      const mailScope = 'mail-outbox:0:rotation-fixture';
      await ctx.db.insert(mailOutbox).values({
        ownerAgentId: 0,
        eventKey: 'rotation-fixture',
        scene: 'order_delivery',
        payload: await encryptSecret(ctx.env, mailPayload, mailScope),
      });
      const migrated = {
        ...ctx.env,
        DATA_ENCRYPTION_KEYS: JSON.stringify({ active: 'second', keys: { first, second } }),
      };
      expect(await rekeyStoredCredentials({ ...migrated, LEGACY_VAULT_SECRET: legacySecret })).toMatchObject({
        updated: 7,
        failed: 0,
      });
      expect(await rekeyStoredCredentials(migrated)).toMatchObject({ updated: 0, failed: 0, pending: 0 });
      const activeOnly = {
        ...migrated,
        DATA_ENCRYPTION_KEYS: JSON.stringify({ active: 'second', keys: { second } }),
      };
      const vault = await ctx.db.select().from(userTotpVault).orderBy(userTotpVault.id);
      expect(
        await Promise.all(vault.map(({ encryptedSecret }) => decryptSecret(activeOnly, encryptedSecret)))
      ).toEqual(['OLD-SYNTHETIC-SEED', 'v1-ROTATION-FIXTURE', 'v2-ROTATION-FIXTURE']);
      const [card] = await ctx.db.select().from(productCards);
      expect(card.cardContent).toMatch(/^v3\.second\./);
      expect(card.credentialFingerprint).toMatch(/^[a-f0-9]{64}$/);
      const [order] = await ctx.db.select().from(orders);
      expect(await readDeliveryPayload(activeOnly, order.orderNo, order.deliveredPayload)).toBe(
        'DELIVERY-FIXTURE'
      );
      const [key] = await ctx.db.select().from(siteSettings).where(eq(siteSettings.key, 'ai_api_key'));
      expect(key.value).toMatch(/^v3\.second\./);
      expect((await getAiConfigPublic(activeOnly)).has_api_key).toBe(false);
      const [mail] = await ctx.db.select().from(mailOutbox);
      expect(await decryptSecret(activeOnly, mail.payload, mailScope)).toBe(mailPayload);
    } finally {
      ctx.close();
    }
  });
});
