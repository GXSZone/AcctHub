import { type Env, isSandboxEnabled } from '../env';
import { Errors } from './errors';

export interface PaymentRequest {
  method: string;
  amount: number;
  orderNo: string;
  userBalance?: number;
}

export interface PaymentResult {
  paid: boolean;
  transactionRef: string;
  message: string;
}

export async function executePayment(env: Env, params: PaymentRequest): Promise<PaymentResult> {
  const { method, amount, orderNo, userBalance } = params;

  if (method === 'balance') {
    if (userBalance === undefined || userBalance < amount) {
      return {
        paid: false,
        transactionRef: '',
        message: '站内钱包余额不足，请先充值或切换其他支付方式',
      };
    }
    return {
      paid: true,
      transactionRef: `BAL-${orderNo}`,
      message: '已通过站内钱包余额即时扣款',
    };
  }

  if (method === 'demo_instant' || method === 'alipay_demo' || method === 'wechat_demo') {
    if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(env)) {
      return {
        paid: true,
        transactionRef: `SANDBOX-${orderNo}`,
        message: '沙盒测试收银台即时到账（仅开发/测试环境有效）',
      };
    }
    throw Errors.sandboxDisabled('当前生产环境已关闭内置演示收银台，请启用真实支付插件或使用站内余额支付');
  }

  return {
    paid: false,
    transactionRef: '',
    message: `支付通道「${method}」尚未完成商户密钥配置`,
  };
}
