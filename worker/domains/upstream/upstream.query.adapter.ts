import type { Env } from '../../env';
import { extractCardsArray } from './upstream.catalog.adapter';
import { hasCompleteUpstreamUnits } from './upstream.order.adapter';
import { runSandboxQueryOrder } from './upstream.sandbox';
import {
  applyAuthToRequest,
  getByPath,
  resolveSiblingUrl,
  safeParseJson,
  upstreamFetch,
  upstreamTransport,
} from './upstream.signer';
import type { ResponseMappingConfig, UpstreamPlaceOrderResult, UpstreamSourceRow } from './upstream.types';

/** 主动轮询查单（用于 Cron 定时查单及后台手动立即查单） */
export async function queryUpstreamOrder(
  env: Env,
  source: UpstreamSourceRow,
  params: { outTradeNo: string; upstreamOrderNo?: string; upstreamItemId?: string; quantity?: number }
): Promise<UpstreamPlaceOrderResult> {
  if (source.adapter_type === 'mock_sandbox') {
    return runSandboxQueryOrder(env, params);
  }

  const respMap = safeParseJson<ResponseMappingConfig>(source.response_mapping_json || '{}', {});
  let queryUrl = source.query_order_url || '';
  if (!queryUrl && source.adapter_type === 'accthub_v1') {
    queryUrl = resolveSiblingUrl(source.base_url, '', '/api/v1/reseller/order');
  } else if (!queryUrl && source.adapter_type === 'acgfaka') {
    queryUrl = resolveSiblingUrl(source.base_url, '', '/api/v1/supplier/order/query');
  } else if (!queryUrl && source.adapter_type === 'dujiaoka_like') {
    queryUrl = resolveSiblingUrl(source.base_url, '', '/api/order/query');
  }
  if (!queryUrl) {
    return {
      status: 'pending',
      upstreamOrderNo: params.upstreamOrderNo || '',
      cards: [],
      actualCost: 0,
      errorMessage: '该上游源未配置查单接口 URL，等待 Webhook 回调或人工处理',
      rawResponse: {},
    };
  }

  const qParams: Record<string, unknown> =
    source.adapter_type === 'accthub_v1'
      ? params.upstreamOrderNo
        ? { order_no: params.upstreamOrderNo }
        : { idempotency_key: params.outTradeNo }
      : {
          out_trade_no: params.outTradeNo,
          ...(params.upstreamOrderNo
            ? { trade_no: params.upstreamOrderNo, order_no: params.upstreamOrderNo }
            : {}),
        };
  const authReq = await applyAuthToRequest(env, source, queryUrl, qParams, {});
  const request = upstreamTransport(source, authReq, 'GET');

  try {
    const res = await upstreamFetch(env, source, request.url, {
      ...request,
      timeoutMs: 10_000,
    });
    const rawObj = (res.json && typeof res.json === 'object' ? res.json : { raw: res.rawText }) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      return {
        status: 'pending',
        upstreamOrderNo: params.upstreamOrderNo || '',
        cards: [],
        actualCost: 0,
        errorMessage: `查单 HTTP ${res.status}`,
        rawResponse: rawObj,
      };
    }

    const cardsRaw =
      (respMap.cards_path ? getByPath(rawObj, respMap.cards_path) : undefined) ??
      getByPath(rawObj, 'cards') ??
      getByPath(rawObj, 'data.cards') ??
      getByPath(rawObj, 'data.secret') ??
      getByPath(rawObj, 'card');
    const cards = extractCardsArray(cardsRaw);
    const upOrderNo = String(
      (respMap.order_no_path ? getByPath(rawObj, respMap.order_no_path) : undefined) ??
        getByPath(rawObj, 'order_no') ??
        getByPath(rawObj, 'data.trade_no') ??
        getByPath(rawObj, 'trade_no') ??
        params.upstreamOrderNo ??
        ''
    );
    const st = String(
      (respMap.status_path ? getByPath(rawObj, respMap.status_path) : undefined) ??
        getByPath(rawObj, 'data.status') ??
        getByPath(rawObj, 'status') ??
        ''
    ).toLowerCase();

    const terminalWithoutDelivery = [
      'refunded',
      'cancelled',
      'canceled',
      'rejected',
      'not_accepted',
    ].includes(st);
    if (
      hasCompleteUpstreamUnits(cards, params.quantity ?? 1) &&
      !terminalWithoutDelivery &&
      ![
        'pending',
        'upstream_pending',
        'processing',
        'waiting',
        'queued',
        'accepted',
        'paid',
        'failed',
        'error',
      ].includes(st)
    ) {
      return {
        status: 'succeeded',
        upstreamOrderNo: upOrderNo,
        cards,
        actualCost: 0,
        errorMessage: '',
        rawResponse: rawObj,
      };
    }
    if (cards.length === 0 && terminalWithoutDelivery) {
      return {
        status: 'failed',
        upstreamOrderNo: upOrderNo,
        cards: [],
        actualCost: 0,
        errorMessage: String(getByPath(rawObj, 'msg') ?? getByPath(rawObj, 'error') ?? `上游订单状态：${st}`),
        rawResponse: rawObj,
      };
    }
    return {
      status: 'pending',
      upstreamOrderNo: upOrderNo,
      cards: [],
      actualCost: 0,
      errorMessage: '',
      rawResponse: rawObj,
    };
  } catch (err) {
    return {
      status: 'pending',
      upstreamOrderNo: params.upstreamOrderNo || '',
      cards: [],
      actualCost: 0,
      errorMessage: err instanceof Error ? err.message : '查单网络失败',
      rawResponse: {},
    };
  }
}
