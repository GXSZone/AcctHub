import { eq } from 'drizzle-orm';
import { paymentIntents } from '../../worker/db/schema/index';
import { recoverExpiredBalanceOrders } from '../../worker/domains/orders/orders.balance-recovery.service';
import { recoverSinglePaidIntent } from '../../worker/domains/payment/payment.recovery';
import { completePaymentIntent } from '../../worker/domains/payment/payment.service';
import type { Env } from '../../worker/env';
import { app } from '../../worker/index';
import { createDb } from '../../worker/infra/db';

/** 在真实 D1 批次边界注入一次故障。SQL 与事务仍由 workerd 执行。 */
function observeWalletBatch(
  d1: D1Database,
  hook: { select?: (parameters: unknown[]) => boolean; before?: () => Promise<void>; after?: () => void }
) {
  const claims = new WeakSet<D1PreparedStatement>();
  let hits = 0;
  const DB = new Proxy(d1, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (query: string) => {
          const statement = target.prepare(query);
          if (!/^\s*insert\s+into\s+"wallet_events"\s*[(]/i.test(query)) return statement;
          return new Proxy(statement, {
            get(prepared, method, statementReceiver) {
              if (method === 'bind') {
                return (...parameters: unknown[]) => {
                  const bound = prepared.bind(...parameters);
                  if (!hook.select || hook.select(parameters)) claims.add(bound);
                  return bound;
                };
              }
              const value = Reflect.get(prepared, method, statementReceiver);
              return typeof value === 'function' ? value.bind(prepared) : value;
            },
          });
        };
      }
      if (property === 'batch') {
        return async <T>(statements: D1PreparedStatement[]) => {
          const selected = hits === 0 && statements.some((statement) => claims.has(statement));
          if (selected) {
            hits++;
            await hook.before?.();
          }
          const result = await target.batch<T>(statements);
          if (selected) hook.after?.();
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { DB, getHits: () => hits };
}

async function pauseLeaseOwner(env: Env, intentNo: string, owner: string) {
  const db = createDb(env.DB);
  const intent = await db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, intentNo)).get();
  if (!intent?.fulfillLeaseToken) throw new Error('D1 未记录当前履约任务的租约');
  await env.DB.prepare('INSERT INTO runtime_lease_checkpoints (owner, token) VALUES (?, ?)')
    .bind(owner, intent.fulfillLeaseToken)
    .run();
  const deadline = Date.now() + 15_000;
  const checkpoint = env.DB.prepare('SELECT resume FROM runtime_lease_checkpoints WHERE owner = ?').bind(
    owner
  );
  do {
    if ((await checkpoint.first<number>('resume')) === 1) return;
    await scheduler.wait(20);
  } while (Date.now() < deadline);
  throw new Error(`等待恢复履约任务 ${owner} 超时`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__test/recover-balance-orders') {
      await recoverExpiredBalanceOrders(env);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/__test/complete-payment') {
      const input = await request.json<Parameters<typeof completePaymentIntent>[1]>();
      const fault = request.headers.get('X-D1-Test-Fault');
      if (!fault) return Response.json(await completePaymentIntent(env, input));
      const faultDb = observeWalletBatch(env.DB, {
        before: fault === 'pause-lease-a' ? () => pauseLeaseOwner(env, input.intentNo, 'A') : undefined,
        after: () => {
          if (fault === 'lose-batch-response') throw new Error('D1 已提交，测试模拟丢失批次响应');
        },
      });
      const result = await completePaymentIntent({ ...env, DB: faultDb.DB }, input);
      return Response.json({ result, faultHits: faultDb.getHits() });
    }
    if (url.pathname === '/__test/recover-payment') {
      const input = await request.json<{ intentNo: string }>();
      if (request.headers.get('X-D1-Test-Fault') === 'pause-lease-b') {
        const faultDb = observeWalletBatch(env.DB, {
          before: () => pauseLeaseOwner(env, input.intentNo, 'B'),
        });
        const result = await recoverSinglePaidIntent({ ...env, DB: faultDb.DB }, input.intentNo, url.origin);
        return Response.json({ result, faultHits: faultDb.getHits() });
      }
      return Response.json(await recoverSinglePaidIntent(env, input.intentNo, url.origin));
    }
    if (
      request.method === 'POST' &&
      (url.pathname === '/api/orders' || url.pathname === '/api/v1/reseller/order') &&
      request.headers.get('X-D1-Test-Fault') === 'lose-order-debit-response'
    ) {
      let responseLost = false;
      const faultDb = observeWalletBatch(env.DB, {
        select: ([key]) => typeof key === 'string' && key.startsWith('["balance-order-debit",'),
        after: () => {
          responseLost = true;
          throw new Error('D1 已提交，测试模拟丢失订单扣款回执');
        },
      });
      const result = await app.fetch(request, { ...env, DB: faultDb.DB }, ctx);
      const response = new Response(result.body, result);
      response.headers.set('X-D1-Test-Fault-Hits', responseLost ? '1' : '0');
      return response;
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
