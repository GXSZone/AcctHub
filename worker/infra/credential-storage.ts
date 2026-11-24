import type { Env } from '../env';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto';

export const INVENTORY_CREDENTIAL_SCOPE = 'product-card';

/** 读取升级前的历史原值。已识别的密文始终验证认证标签。 */
export function readStoredCredential(env: Env, value: string, scope: string): Promise<string> {
  return isEncryptedSecret(value) ? decryptSecret(env, value, scope) : Promise.resolve(value);
}

export function sealDeliveryPayload(env: Env, orderNo: string, value: string) {
  return encryptSecret(env, value, `order-delivery:${orderNo}`);
}

export function readDeliveryPayload(env: Env, orderNo: string, value: string) {
  return readStoredCredential(env, value, `order-delivery:${orderNo}`);
}
