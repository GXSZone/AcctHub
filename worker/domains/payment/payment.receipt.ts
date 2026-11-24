import type { PaymentIntentRow } from './payment.repo';

export type PaymentReceipt =
  | {
      provider: 'epay' | 'stripe' | 'alipay_f2f';
      currency: string;
      amountMinor: number;
      tradeNo: string;
      sandbox?: boolean;
    }
  | {
      provider: 'usdt_trc20' | 'usdt_bep20' | 'usdt_erc20';
      currency: 'USDT';
      amountMinor: number;
      tradeNo: string;
      sandbox?: boolean;
    };

/** 金额必须能精确表示成指定最小单位，拒绝非十进制、超精度和整数溢出。 */
export function parsePaymentMinorUnits(value: unknown, decimals: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(String(value));
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  const amount = Number(`${match[1]}${(match[2] ?? '').padEnd(decimals, '0')}`);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function parsePaymentTradeNo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

export function validatePaymentReceipt(intent: PaymentIntentRow, receipt: PaymentReceipt): string | null {
  if (intent.provider !== receipt.provider) return '支付渠道与收据不一致';
  if (intent.currency !== receipt.currency) return '支付币种与收据不一致';
  if (!parsePaymentTradeNo(receipt.tradeNo)) return '缺少有效的外部交易流水号';
  const expectedMinor = parsePaymentMinorUnits(intent.pay_amount, intent.currency === 'USDT' ? 4 : 2);
  if (expectedMinor === null || expectedMinor !== receipt.amountMinor) return '实付金额与应付金额不一致';

  if (intent.status === 'paid' && intent.provider_trade_no !== receipt.tradeNo) {
    return '支付单已核销其他流水';
  }
  if (!receipt.sandbox && receipt.provider === 'stripe' && intent.provider_trade_no !== receipt.tradeNo) {
    return 'Stripe 收据与原 Checkout 会话不一致';
  }
  return null;
}
