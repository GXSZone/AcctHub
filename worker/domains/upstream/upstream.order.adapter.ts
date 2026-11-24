import { type Env, isSandboxEnabled } from '../../env';
import { createDb } from '../../infra/db';
import { extractCardsArray } from './upstream.catalog.adapter';
import { updateSourceCachedBalanceRepo } from './upstream.repo';
import { runSandboxPlaceOrder } from './upstream.sandbox';
import {
  applyAuthToRequest,
  getByPath,
  interpolateTemplate,
  resolveSiblingUrl,
  safeParseJson,
  upstreamFetch,
  upstreamTransport,
} from './upstream.signer';
import type {
  OrderTemplateConfig,
  ResponseMappingConfig,
  UpstreamPlaceOrderRequest,
  UpstreamPlaceOrderResult,
  UpstreamSourceRow,
} from './upstream.types';

export function isSupplierProcurementEnabled(
  env: Env,
  source: Pick<UpstreamSourceRow, 'id' | 'adapter_type'>
): boolean {
  return source.adapter_type !== 'mock_sandbox' || isSandboxEnabled(env);
}

/** 实时向上游渠道发起幂等采购下单（支持模板插值、多协议兼容与超时锁定） */
export async function placeUpstreamOrder(
  env: Env,
  source: UpstreamSourceRow,
  req: UpstreamPlaceOrderRequest
): Promise<UpstreamPlaceOrderResult> {
  if (!isSupplierProcurementEnabled(env, source)) {
    return {
      status: 'failed',
      upstreamOrderNo: '',
      cards: [],
      actualCost: 0,
      errorMessage: '该上游货源尚未启用新采购',
      rawResponse: {},
    };
  }
  if (source.adapter_type === 'mock_sandbox') {
    return runSandboxPlaceOrder(env, source, req);
  }

  const respMap = safeParseJson<ResponseMappingConfig>(source.response_mapping_json || '{}', {});
  const orderTpl = safeParseJson<OrderTemplateConfig>(source.order_template_json || '{}', {});

  let orderUrl = source.order_url || '';
  if (!orderUrl) {
    if (source.adapter_type === 'accthub_v1') {
      orderUrl = resolveSiblingUrl(source.base_url, '', '/api/v1/reseller/order');
    } else if (source.adapter_type === 'acgfaka') {
      orderUrl = resolveSiblingUrl(source.base_url, '', '/api/v1/supplier/order/create');
    } else if (source.adapter_type === 'dujiaoka_like') {
      orderUrl = resolveSiblingUrl(source.base_url, '', '/api/order/create');
    }
  }
  if (!orderUrl) {
    return {
      status: 'failed',
      upstreamOrderNo: '',
      cards: [],
      actualCost: 0,
      errorMessage: `上游源「${source.name}」未配置下单 API 地址 (order_url)`,
      rawResponse: {},
    };
  }

  const vars: Record<string, string | number> = {
    upstream_item_id: req.upstreamItemId,
    upstream_spec_id: req.upstreamSpecId || '',
    quantity: req.quantity,
    out_trade_no: req.outTradeNo,
    contact_email: req.contactEmail || '',
    webhook_url: req.webhookUrl || '',
  };
  if (orderTpl.method !== 'GET') {
    for (const [key, value] of Object.entries(req.customInputs || {})) {
      if (/^[\w-]+$/.test(key)) vars[`custom_inputs.${key}`] = value;
    }
  }

  let payloadParams: Record<string, unknown>;
  if (orderTpl.body_template && Object.keys(orderTpl.body_template).length > 0) {
    payloadParams = interpolateTemplate(orderTpl.body_template, vars) as Record<string, unknown>;
  } else if (source.adapter_type === 'accthub_v1') {
    payloadParams = {
      product_id: /^\d+$/.test(req.upstreamItemId) ? Number(req.upstreamItemId) : req.upstreamItemId,
      spec_id: req.upstreamSpecId || 'default',
      quantity: req.quantity,
      customer_ref: req.outTradeNo,
    };
  } else if (source.adapter_type === 'acgfaka') {
    payloadParams = {
      commodity_id: req.upstreamItemId,
      race: req.upstreamSpecId || '',
      num: req.quantity,
      out_trade_no: req.outTradeNo,
      contact: req.contactEmail || req.outTradeNo,
      notify_url: req.webhookUrl || '',
    };
  } else if (source.adapter_type === 'dujiaoka_like') {
    payloadParams = {
      goods_id: req.upstreamItemId,
      spec_id: req.upstreamSpecId || '',
      amount: req.quantity,
      out_trade_no: req.outTradeNo,
      email: req.contactEmail || '',
      notify_url: req.webhookUrl || '',
    };
  } else {
    payloadParams = {
      product_id: req.upstreamItemId,
      spec_id: req.upstreamSpecId || '',
      quantity: req.quantity,
      out_trade_no: req.outTradeNo,
      contact_email: req.contactEmail || '',
      notify_url: req.webhookUrl || '',
    };
  }

  const method = orderTpl.method || 'POST';
  if (source.adapter_type === 'accthub_v1') {
    payloadParams.idempotency_key = req.outTradeNo;
  }
  const authReq = await applyAuthToRequest(
    env,
    source,
    orderUrl,
    payloadParams,
    orderTpl.extra_headers || {}
  );
  const request = upstreamTransport(source, authReq, method, orderTpl.content_type === 'form');

  try {
    const res = await upstreamFetch(env, source, request.url, { ...request, timeoutMs: 12_000 });
    const rawObj = (res.json && typeof res.json === 'object' ? res.json : { raw: res.rawText }) as Record<
      string,
      unknown
    >;

    if (!res.ok) {
      // 传输状态本身不能证明供应商未受理采购。
      return {
        status: 'timeout_unknown',
        upstreamOrderNo: String(getByPath(rawObj, respMap.order_no_path || 'data.trade_no') || ''),
        cards: [],
        actualCost: Number(((req.unitCostHint || 0) * req.quantity).toFixed(2)),
        errorMessage: `上游下单 HTTP ${res.status}，是否受理待确认`,
        rawResponse: rawObj,
      };
    }

    const upOrderNo = String(
      (respMap.order_no_path ? getByPath(rawObj, respMap.order_no_path) : undefined) ??
        getByPath(rawObj, 'order_no') ??
        getByPath(rawObj, 'data.trade_no') ??
        getByPath(rawObj, 'data.order_no') ??
        getByPath(rawObj, 'trade_no') ??
        ''
    );
    const cardsRaw =
      (respMap.cards_path ? getByPath(rawObj, respMap.cards_path) : undefined) ??
      getByPath(rawObj, 'cards') ??
      getByPath(rawObj, 'data.cards') ??
      getByPath(rawObj, 'data.secret') ??
      getByPath(rawObj, 'data.card_info') ??
      getByPath(rawObj, 'card');
    const cards = extractCardsArray(cardsRaw);

    const costRaw =
      (respMap.cost_path ? getByPath(rawObj, respMap.cost_path) : undefined) ??
      getByPath(rawObj, 'total_deducted') ??
      getByPath(rawObj, 'data.amount') ??
      getByPath(rawObj, 'data.cost') ??
      getByPath(rawObj, 'amount');
    const actualCost =
      Number.isFinite(Number(costRaw)) && Number(costRaw) > 0
        ? Number(Number(costRaw).toFixed(2))
        : Number(((req.unitCostHint || 0) * req.quantity).toFixed(2));

    const remBal = getByPath(rawObj, 'remaining_balance') ?? getByPath(rawObj, 'data.balance');
    if (remBal !== undefined && Number.isFinite(Number(remBal))) {
      await updateSourceCachedBalanceRepo(createDb(env.DB), source.id, Number(Number(remBal).toFixed(2)));
    }

    const statusVal = String(
      (respMap.status_path ? getByPath(rawObj, respMap.status_path) : undefined) ??
        getByPath(rawObj, 'status') ??
        getByPath(rawObj, 'data.status') ??
        ''
    ).toLowerCase();
    const pendingSet = new Set(
      [
        'pending',
        'upstream_pending',
        'processing',
        'waiting',
        'queued',
        'accepted',
        ...(respMap.pending_values || []),
      ].map((v) => v.toLowerCase())
    );
    const rejected =
      !upOrderNo &&
      cards.length === 0 &&
      Boolean(
        respMap.not_accepted_path &&
          (respMap.not_accepted_values || []).includes(String(getByPath(rawObj, respMap.not_accepted_path)))
      );

    if (respMap.success_path) {
      const sv = String(getByPath(rawObj, respMap.success_path) ?? '');
      const allowedOk = (respMap.success_values || ['200', '0', 'true', 'ok', 'success']).map((v) =>
        v.toLowerCase()
      );
      if (pendingSet.has(statusVal) || pendingSet.has(sv.toLowerCase())) {
        return {
          status: 'pending',
          upstreamOrderNo: upOrderNo,
          cards: [],
          actualCost,
          errorMessage: '',
          rawResponse: rawObj,
        };
      }
      if (!allowedOk.includes(sv.toLowerCase())) {
        const errMsg = String(
          (respMap.error_path ? getByPath(rawObj, respMap.error_path) : undefined) ??
            getByPath(rawObj, 'msg') ??
            getByPath(rawObj, 'message') ??
            `上游业务返回失败 (${sv})`
        );
        return {
          status: rejected ? 'failed' : 'timeout_unknown',
          upstreamOrderNo: upOrderNo,
          cards: [],
          actualCost: 0,
          errorMessage: errMsg,
          rawResponse: rawObj,
        };
      }
    } else if (
      rawObj.code !== undefined &&
      ![200, 0, '200', '0', 1, '1'].includes(rawObj.code as string | number)
    ) {
      if (rawObj.code === 202 || pendingSet.has(statusVal)) {
        return {
          status: 'pending',
          upstreamOrderNo: upOrderNo,
          cards: [],
          actualCost,
          errorMessage: '',
          rawResponse: rawObj,
        };
      }
      return {
        status: rejected ? 'failed' : 'timeout_unknown',
        upstreamOrderNo: upOrderNo,
        cards: [],
        actualCost: 0,
        errorMessage: String(
          rawObj.msg ?? rawObj.message ?? rawObj.error ?? `上游业务拒绝 code=${rawObj.code}`
        ),
        rawResponse: rawObj,
      };
    }

    if (hasCompleteUpstreamUnits(cards, req.quantity) && !pendingSet.has(statusVal) && res.status !== 202) {
      return {
        status: 'succeeded',
        upstreamOrderNo: upOrderNo,
        cards,
        actualCost,
        errorMessage: '',
        rawResponse: rawObj,
      };
    }
    if (pendingSet.has(statusVal) || upOrderNo || cards.length > 0 || res.status === 202) {
      return {
        status: 'pending',
        upstreamOrderNo: upOrderNo,
        cards: [],
        actualCost,
        errorMessage: cards.length > 0 ? '上游凭证数量与采购数量不一致，等待完整回执' : '',
        rawResponse: rawObj,
      };
    }
    return {
      status: rejected ? 'failed' : 'timeout_unknown',
      upstreamOrderNo: upOrderNo,
      cards: [],
      actualCost: 0,
      errorMessage: '上游返回成功但未包含卡密且无上游单号，请检查响应路径配置',
      rawResponse: rawObj,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络请求超时';
    return {
      status: 'timeout_unknown',
      upstreamOrderNo: '',
      cards: [],
      actualCost: Number(((req.unitCostHint || 0) * req.quantity).toFixed(2)),
      errorMessage: `上游网络超时或中断（状态待查单确认）：${msg}`,
      rawResponse: { error: msg },
    };
  }
}

/** 当前供应接口约定每件必须对应一份不同的、非空的凭证。 */
export function hasCompleteUpstreamUnits(cards: readonly string[], quantity: number): boolean {
  return (
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    cards.length === quantity &&
    cards.every((card) => Boolean(card.trim())) &&
    new Set(cards.map((card) => card.trim())).size === quantity
  );
}
