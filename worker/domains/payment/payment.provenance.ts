import { and, sql } from 'drizzle-orm';
import { paymentIntents } from '../../db/schema/index';
import { type Env, isSandboxEnabled } from '../../env';
import { safeJsonParse } from '../../infra/http';
import type { PaymentIntentRow } from './payment.repo';

const simulatedTradePrefixes = ['SBX-MOCK-', 'EPAY-SBX-', 'ALIPAY-SBX-', 'cs_test_'];

export function isSimulatedTrade(tradeNo: string) {
  return simulatedTradePrefixes.some((prefix) => tradeNo.startsWith(prefix));
}

export function isInternalSandboxIntent(intent: PaymentIntentRow) {
  const payload = safeJsonParse<Record<string, unknown> | null>(intent.payload_json, null);
  return payload?.sandbox_simulated === true;
}

export function mayFulfillPayment(env: Env, intent: PaymentIntentRow) {
  if (isSandboxEnabled(env)) return true;
  const payload = safeJsonParse<Record<string, unknown> | null>(intent.payload_json, null);
  return (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload.sandbox_simulated === undefined || payload.sandbox_simulated === false) &&
    !isSimulatedTrade(intent.provider_trade_no)
  );
}

/** 在领取租约和扫描候选时排除历史模拟单，避免它们占满每批补偿名额。 */
export function livePaymentIntentCondition() {
  const { payloadJson, providerTradeNo } = paymentIntents;
  return and(
    sql`CASE WHEN json_valid(${payloadJson}) THEN json_type(${payloadJson}) = 'object'
        AND COALESCE(json_type(${payloadJson}, '$.sandbox_simulated'), 'false') = 'false' ELSE 0 END`,
    ...simulatedTradePrefixes.map(
      (prefix) => sql`substr(${providerTradeNo}, 1, ${prefix.length}) <> ${prefix}`
    )
  );
}
