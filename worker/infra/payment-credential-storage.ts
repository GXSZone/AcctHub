import { paymentPluginSecretFields } from '@shared/domain/payment-plugin-settings';
import type { Env } from '../env';
import { readStoredCredential } from './credential-storage';
import { activeDataKeyVersion, encryptSecret } from './crypto';
import { safeJsonParse } from './http';

function credentialScope(pluginId: string, field: string) {
  return `payment-plugin:${pluginId}:${field}`;
}

function secretFields(pluginId: string) {
  const fields = paymentPluginSecretFields[pluginId];
  return Array.isArray(fields) ? fields : [];
}

export function parsePaymentPluginConfig(json: string): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(json, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function sealPaymentPluginCredential(env: Env, pluginId: string, field: string, value: string) {
  return encryptSecret(env, value, credentialScope(pluginId, field));
}

export async function readPaymentPluginCredentials(
  env: Env,
  pluginId: string,
  config: Record<string, unknown>
) {
  for (const field of secretFields(pluginId)) {
    const value = config[field];
    if (typeof value === 'string' && value.trim()) {
      config[field] = await readStoredCredential(env, value, credentialScope(pluginId, field));
    }
  }
  return config;
}

export async function rekeyPaymentPluginConfig(env: Env, pluginId: string, json: string) {
  const config = parsePaymentPluginConfig(json);
  const prefix = `v3.${activeDataKeyVersion(env)}.`;
  for (const field of secretFields(pluginId)) {
    const previous = config[field];
    if (typeof previous !== 'string' || !previous.trim() || previous.startsWith(prefix)) continue;
    const plaintext = await readStoredCredential(env, previous, credentialScope(pluginId, field));
    config[field] = await sealPaymentPluginCredential(env, pluginId, field, plaintext);
  }
  return JSON.stringify(config);
}
