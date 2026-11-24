import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { placeUpstreamOrder } from './upstream.order.adapter';
import type { UpstreamSourceRow } from './upstream.types';

const source = {
  id: 1,
  name: 'test supplier',
  adapter_type: 'accthub_v1',
  auth_mode: 'header_bearer',
  base_url: 'https://supplier.example',
  order_url: 'https://supplier.example/api/v1/reseller/order',
} as UpstreamSourceRow;

const request = {
  upstreamItemId: '42',
  upstreamSpecId: 'annual',
  quantity: 2,
  outTradeNo: 'TEST-A1',
};
const env = { APP_ENV: 'test', SANDBOX_MODE: 'true' } as Env;

afterEach(() => vi.unstubAllGlobals());

describe('供应商下单回执', () => {
  it('[B05][B29] 发送稳定幂等键且仅映射模板指定字段', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ order_no: 'U1', status: 'delivered', cards: ['A', 'B'] })
    );
    vi.stubGlobal('fetch', transport);
    await placeUpstreamOrder(env, source, request);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({
      customer_ref: 'TEST-A1',
      idempotency_key: 'TEST-A1',
    });

    await placeUpstreamOrder(
      env,
      {
        ...source,
        order_template_json: JSON.stringify({
          body_template: { target: '{{custom_inputs.target}}' },
        }),
      },
      { ...request, customInputs: { target: 'allowed-value', unused: 'not-for-supplier' } }
    );
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({
      target: 'allowed-value',
      idempotency_key: 'TEST-A1',
    });
  });

  it('[B03] 逐件供应合同中只返回一份凭证时保持待交付', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ order_no: 'U1', cards: ['A'] }));
    const result = await placeUpstreamOrder(env, source, request);
    expect(result.status).toBe('pending');
    expect(result.cards).toEqual([]);
  });

  it('[S45] 供应商服务失败时保留原采购供查单', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ message: 'server error' }, { status: 500 }));
    const result = await placeUpstreamOrder(env, source, request);
    expect(result.status).toBe('timeout_unknown');
  });
});
