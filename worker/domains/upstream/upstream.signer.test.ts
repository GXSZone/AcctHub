import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { fetchFromUpstreamAdapter } from './upstream.catalog.adapter';
import {
  buildSortedSignString,
  calculateLocalSellPrice,
  encryptOptionalSecret,
  getByPath,
  interpolateTemplate,
  signUpstreamParams,
} from './upstream.signer';
import type { UpstreamSourceRow } from './upstream.types';

describe('worker/domains/upstream/upstream.signer', () => {
  it('[S22] sends custom-body catalog authentication in a POST body', async () => {
    const env = { APP_ENV: 'test' } as Env;
    const source = {
      id: 1,
      base_url: 'https://supplier.example.test/catalog',
      auth_mode: 'custom_body',
      adapter_type: 'accthub_v1',
      api_key_enc: await encryptOptionalSecret(env, 'fixture-credential'),
    } as UpstreamSourceRow;
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ products: [] }));
    try {
      await fetchFromUpstreamAdapter(env, source);
      const [url, init] = transport.mock.calls[0];
      expect(new URL(String(url)).search).toBe('');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ api_key: 'fixture-credential' });
    } finally {
      transport.mockRestore();
    }
  });
  it('builds deterministic sorted signature payloads and signs MD5 / HMAC-SHA256', async () => {
    const base = buildSortedSignString({ b: '2', a: '1', sign: 'ignored', empty: '' }, 'mysecret');
    expect(base).toBe('a=1&b=2&key=mysecret');

    const md5Sig = await signUpstreamParams('acgfaka_sign', { b: '2', a: '1' }, 'mysecret');
    expect(md5Sig).toHaveLength(32);

    const hmacSig = await signUpstreamParams('hmac_sha256', { b: '2', a: '1' }, 'mysecret');
    expect(hmacSig).toHaveLength(64);
  });

  it('resolves deep dot-paths and interpolates typed template variables', () => {
    const obj = { data: { order: { cards: ['C1', 'C2'] } } };
    expect(getByPath(obj, 'data.order.cards')).toEqual(['C1', 'C2']);
    expect(getByPath(obj, 'data.missing')).toBeUndefined();

    const rendered = interpolateTemplate(
      { qty: '{{quantity}}', memo: 'Order {{out_trade_no}}' },
      { quantity: 3, out_trade_no: 'AH001' }
    );
    expect(rendered).toEqual({ qty: 3, memo: 'Order AH001' });
  });

  it('enforces anti-loss safe floor and point9 rounding rules', () => {
    expect(calculateLocalSellPrice(50, { markup_percent: 20, rounding: 'point9' })).toBe(60.9);
    // Floor higher than standard markup -> must lift to safe floor with point9 rounding
    expect(calculateLocalSellPrice(50, { markup_percent: 10, rounding: 'point9' }, 69.45)).toBe(69.9);
    expect(calculateLocalSellPrice(50, { markup_percent: 10, rounding: 'integer' }, 69.45)).toBe(70);
  });
});
