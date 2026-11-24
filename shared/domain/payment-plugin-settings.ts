const chainPublicFields = ['wallet_address', 'usdt_cny_rate', 'rate_markup', 'auto_fx', 'fee_rate_pct'];

export const DEFAULT_MIN_TOPUP_AMOUNT = 10;
export const MIN_ALLOWED_TOPUP_AMOUNT = 0.01;
export const MAX_TOPUP_AMOUNT = 50000;
export const MAX_PAYMENT_FEE_RATE_PCT = 30;

/** 安全解析余额支付插件 config_json 中的最低充值金额（非法值回退默认值） */
export function parseMinTopupAmount(configJson?: string | null): number {
  if (!configJson) return DEFAULT_MIN_TOPUP_AMOUNT;
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const raw = Number(parsed?.min_topup);
    if (!Number.isFinite(raw) || raw < MIN_ALLOWED_TOPUP_AMOUNT || raw > MAX_TOPUP_AMOUNT) {
      return DEFAULT_MIN_TOPUP_AMOUNT;
    }
    return Number(raw.toFixed(2));
  } catch {
    return DEFAULT_MIN_TOPUP_AMOUNT;
  }
}

/** 安全解析支付通道买家附加费率（0 ~ 30%，默认 0%；余额/演示通道恒为 0） */
export function parsePaymentFeeRatePct(configJson?: string | null): number {
  if (!configJson) return 0;
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const raw = Number(parsed?.fee_rate_pct);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Number(Math.min(MAX_PAYMENT_FEE_RATE_PCT, raw).toFixed(2));
  } catch {
    return 0;
  }
}

/** 根据商品折后应付金额与支付通道附加费率计算通道附加费（精确到分，绝不计入代理分润基数） */
export function computePaymentFee(goodsPayableAmount: number, feeRatePct: number): number {
  if (!Number.isFinite(goodsPayableAmount) || goodsPayableAmount <= 0) return 0;
  if (!Number.isFinite(feeRatePct) || feeRatePct <= 0) return 0;
  const clamped = Math.min(MAX_PAYMENT_FEE_RATE_PCT, feeRatePct);
  return Number(((goodsPayableAmount * clamped) / 100).toFixed(2));
}

/** 安全解析外部发卡平台充值卡密购买链接（仅允许 http/https 协议，防止注入非法协议） */
export function parseCdkPurchaseConfig(configJson?: string | null): { url: string; label: string } {
  if (!configJson) return { url: '', label: '' };
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const rawUrl = typeof parsed?.cdk_purchase_url === 'string' ? parsed.cdk_purchase_url.trim() : '';
    const safeUrl = /^https?:\/\/[^\s<>"']{3,500}$/i.test(rawUrl) ? rawUrl : '';
    const rawLabel = typeof parsed?.cdk_purchase_label === 'string' ? parsed.cdk_purchase_label.trim() : '';
    return { url: safeUrl, label: rawLabel.slice(0, 40) };
  } catch {
    return { url: '', label: '' };
  }
}

export const paymentPluginPublicFields: Record<string, readonly string[]> = {
  demo_instant: ['mode', 'channels'],
  balance: ['min_topup', 'cdk_purchase_url', 'cdk_purchase_label'],
  epay: ['api_url', 'pid', 'pay_type', 'fee_rate_pct'],
  stripe: ['publishable_key', 'currency', 'usd_cny_rate', 'hkd_cny_rate', 'auto_fx', 'fee_rate_pct'],
  alipay_f2f: ['app_id', 'alipay_public_key', 'gateway_url', 'fee_rate_pct'],
  usdt_trc20: chainPublicFields,
  usdt_bep20: chainPublicFields,
  usdt_erc20: chainPublicFields,
};

export const paymentPluginSecretFields: Record<string, readonly string[]> = {
  epay: ['key'],
  stripe: ['secret_key', 'webhook_secret'],
  alipay_f2f: ['private_key'],
  usdt_trc20: ['trongrid_api_key'],
  usdt_bep20: ['explorer_api_key'],
  usdt_erc20: ['explorer_api_key'],
};
