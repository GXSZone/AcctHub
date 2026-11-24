import type { Env } from '../../env';
import { timingSafeEqual } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { dispatchOpsNotification } from '../../infra/notify';
import { updateSourceCachedBalanceRepo } from './upstream.repo';
import { assertUpstreamSandboxEnabled, buildMockUpstreamRawPayload } from './upstream.sandbox';
import {
  applyAuthToRequest,
  decryptSourceSecrets,
  getByPath,
  resolveSiblingUrl,
  safeParseJson,
  signUpstreamParams,
  upstreamFetch,
  upstreamTransport,
} from './upstream.signer';
import type {
  FieldMappingConfig,
  NormalizedUpstreamItem,
  NormalizedUpstreamSpec,
  ResponseMappingConfig,
  UpstreamSourceRow,
} from './upstream.types';

/** 提取多种上游返回格式中的卡密数组 */
export function extractCardsArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (typeof x === 'string') return x.trim();
        if (x && typeof x === 'object') {
          const r = x as Record<string, unknown>;
          const value = r.card ?? r.secret ?? r.content ?? r.code ?? r.key;
          return typeof value === 'string' ? value.trim() : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseNormalizedSpecs(rawSpecs: unknown, fallbackStock: number): NormalizedUpstreamSpec[] {
  if (!Array.isArray(rawSpecs)) return [];
  return rawSpecs
    .filter((s) => s && typeof s === 'object')
    .map((s, idx) => {
      const rec = s as Record<string, unknown>;
      return {
        id: String(rec.id ?? rec.spec_id ?? rec.sku_id ?? `spec_${idx + 1}`),
        name: String(rec.name ?? rec.title ?? rec.spec_name ?? `规格 ${idx + 1}`),
        price: Number(rec.wholesale_price ?? rec.price ?? rec.cost ?? 0),
        stock:
          rec.available_stock !== undefined
            ? Number(rec.available_stock)
            : rec.stock !== undefined
              ? Number(rec.stock)
              : fallbackStock,
      };
    })
    .filter((s) => s.price >= 0);
}

/** 多协议上游目录拉取适配器（支持 AcctHub v1 / 异次元 / 独角数卡 / 通用 JSON / 沙盒） */
export async function fetchFromUpstreamAdapter(
  env: Env,
  source: UpstreamSourceRow
): Promise<NormalizedUpstreamItem[]> {
  let rawJson: unknown;

  if (source.adapter_type === 'mock_sandbox') {
    assertUpstreamSandboxEnabled(env);
    rawJson = buildMockUpstreamRawPayload();
  } else {
    if (!source.base_url) throw new Error('上游商品目录 API 地址不能为空');
    const isSignedPost =
      source.auth_mode === 'acgfaka_sign' ||
      source.auth_mode === 'hmac_sha256' ||
      source.auth_mode === 'custom_body';
    const authReq = await applyAuthToRequest(env, source, source.base_url, {}, {});

    const method: 'GET' | 'POST' = isSignedPost && source.adapter_type === 'acgfaka' ? 'POST' : 'GET';
    const request = upstreamTransport(source, authReq, method);
    const res = await upstreamFetch(env, source, request.url, request);
    if (!res.ok) throw new Error(`上游目录接口返回异常 HTTP ${res.status}`);
    rawJson = res.json;
  }

  if (source.adapter_type === 'accthub_v1') {
    const arr = (getByPath(rawJson, 'products') || getByPath(rawJson, 'data.goods') || []) as Record<
      string,
      unknown
    >[];
    return arr.map((item) => {
      const stock = Number(item.available_stock ?? item.stock ?? 0);
      return {
        upstream_item_id: String(item.id ?? item.goods_id ?? item.slug),
        raw_title: String(item.title ?? item.name ?? '未命名商品'),
        raw_category: String(item.delivery_type || 'accthub'),
        raw_price: Number(item.wholesale_price ?? item.price ?? item.retail_price ?? 0),
        raw_stock: stock,
        raw_status: stock > 0 ? 'active' : 'sold_out',
        raw_specs: parseNormalizedSpecs(item.specs, stock),
        raw_description: String(item.subtitle ?? ''),
        raw_payload: item,
      };
    });
  }

  if (source.adapter_type === 'acgfaka') {
    const listCandidate =
      getByPath(rawJson, 'data.commodities') ??
      getByPath(rawJson, 'data.list') ??
      getByPath(rawJson, 'data') ??
      (Array.isArray(rawJson) ? rawJson : []);
    const list = (Array.isArray(listCandidate) ? listCandidate : []) as Record<string, unknown>[];
    return list.map((item) => {
      const stock = Number(item.card_count ?? item.stock ?? item.inventory ?? 0);
      const statusNum = item.status === undefined ? 1 : Number(item.status);
      return {
        upstream_item_id: String(item.id ?? item.commodity_id ?? item.product_id),
        raw_title: String(item.name ?? item.title ?? '异次元上游商品'),
        raw_category: String(item.category_name ?? item.category_id ?? '异次元分组'),
        raw_price: Number(item.price ?? item.user_price ?? item.factory_price ?? 0),
        raw_stock: Math.max(0, Math.floor(stock)),
        raw_status: statusNum === 0 ? 'inactive' : stock > 0 ? 'active' : 'sold_out',
        raw_specs: parseNormalizedSpecs(item.race ?? item.specs ?? item.skus, stock),
        raw_description: String(item.description ?? item.desc ?? ''),
        raw_payload: item,
      };
    });
  }

  if (source.adapter_type === 'dujiaoka_like') {
    const listCandidate =
      getByPath(rawJson, 'data.goods') ??
      getByPath(rawJson, 'data') ??
      (Array.isArray(rawJson) ? rawJson : []);
    const list = (Array.isArray(listCandidate) ? listCandidate : []) as Record<string, unknown>[];
    return list.map((item) => {
      const stock = Number(item.in_stock ?? item.stock ?? 0);
      const isOpen = item.is_open === undefined ? true : Boolean(Number(item.is_open));
      return {
        upstream_item_id: String(item.id ?? item.goods_id),
        raw_title: String(item.gd_name ?? item.name ?? '上游商品'),
        raw_category: String(item.group_name ?? item.group_id ?? '默认分组'),
        raw_price: Number(item.actual_price ?? item.price ?? 0),
        raw_stock: Math.max(0, Math.floor(stock)),
        raw_status: !isOpen ? 'inactive' : stock > 0 ? 'active' : 'sold_out',
        raw_specs: parseNormalizedSpecs(item.specs, stock),
        raw_description: String(item.gd_description ?? item.description ?? ''),
        raw_payload: item,
      };
    });
  }

  const rawMapping: FieldMappingConfig = safeParseJson(source.field_mapping_json || '{}', {});
  const mapping: FieldMappingConfig =
    source.adapter_type === 'mock_sandbox' && Object.keys(rawMapping).length === 0
      ? {
          list_path: 'data.items',
          id_field: 'sku_code',
          title_field: 'item_name',
          category_field: 'group_name',
          price_field: 'wholesale_cny',
          stock_field: 'qty_left',
          status_field: 'sale_state',
          desc_field: 'intro',
          specs_field: 'specs',
        }
      : rawMapping;
  const listCandidate = mapping.list_path ? getByPath(rawJson, mapping.list_path) : rawJson;
  const list = (Array.isArray(listCandidate) ? listCandidate : []) as Record<string, unknown>[];

  return list.map((item, idx) => {
    const idVal = getByPath(item, mapping.id_field || 'id') ?? `item_${idx}`;
    const titleVal = getByPath(item, mapping.title_field || 'title') ?? '上游未命名商品';
    const catVal = getByPath(item, mapping.category_field || 'category') ?? '上游默认';
    const priceVal = Number(getByPath(item, mapping.price_field || 'price') ?? 0);
    const stockVal = Number(getByPath(item, mapping.stock_field || 'stock') ?? 0);
    const statusRaw = String(getByPath(item, mapping.status_field || 'status') ?? 'online').toLowerCase();
    const descVal = String(getByPath(item, mapping.desc_field || 'intro') ?? '');
    const rawSpecsCandidate = getByPath(item, mapping.specs_field || 'specs');
    const inactive = ['offline', 'disabled', 'inactive', '0', 'false', 'down'].includes(statusRaw);

    return {
      upstream_item_id: String(idVal),
      raw_title: String(titleVal),
      raw_category: String(catVal),
      raw_price: Number.isFinite(priceVal) ? priceVal : 0,
      raw_stock: Number.isFinite(stockVal) ? Math.max(0, Math.floor(stockVal)) : 0,
      raw_status: inactive ? 'inactive' : stockVal > 0 ? 'active' : 'sold_out',
      raw_specs: parseNormalizedSpecs(rawSpecsCandidate, Math.max(0, Math.floor(stockVal))),
      raw_description: descVal,
      raw_payload: item,
    };
  });
}

/** 查询上游账户余额并触发低余额运维告警 */
export async function fetchUpstreamBalance(
  env: Env,
  source: UpstreamSourceRow
): Promise<{ balance: number | null; low_balance: boolean; currency: string; error?: string }> {
  let balance: number | null = null;
  const threshold = Number(source.low_balance_threshold ?? 100);

  if (source.adapter_type === 'mock_sandbox') {
    balance =
      source.cached_balance !== null && source.cached_balance !== undefined
        ? Number(source.cached_balance)
        : 1280;
  } else {
    const respMap = safeParseJson<ResponseMappingConfig>(source.response_mapping_json || '{}', {});
    let targetUrl = source.balance_url || '';
    if (!targetUrl && source.adapter_type === 'accthub_v1') {
      targetUrl = resolveSiblingUrl(source.base_url, '', '/api/v1/reseller/balance');
    } else if (!targetUrl && source.adapter_type === 'acgfaka') {
      targetUrl = resolveSiblingUrl(source.base_url, '', '/api/v1/supplier/balance');
    }
    if (!targetUrl) return { balance: source.cached_balance, low_balance: false, currency: 'CNY' };

    try {
      const authReq = await applyAuthToRequest(env, source, targetUrl, {}, {});
      const request = upstreamTransport(source, authReq, 'GET');
      const res = await upstreamFetch(env, source, request.url, request);
      if (!res.ok) {
        return {
          balance: source.cached_balance,
          low_balance: false,
          currency: 'CNY',
          error: `HTTP ${res.status}`,
        };
      }
      const candidate =
        (respMap.balance_path ? getByPath(res.json, respMap.balance_path) : undefined) ??
        getByPath(res.json, 'balance') ??
        getByPath(res.json, 'data.balance') ??
        getByPath(res.json, 'data.money') ??
        getByPath(res.json, 'money');
      const num = Number(candidate);
      if (Number.isFinite(num)) balance = Number(num.toFixed(2));
    } catch (err) {
      return {
        balance: source.cached_balance,
        low_balance: false,
        currency: 'CNY',
        error: err instanceof Error ? err.message : '余额查询失败',
      };
    }
  }

  if (balance !== null) {
    await updateSourceCachedBalanceRepo(createDb(env.DB), source.id, balance);
    const low = threshold > 0 && balance < threshold;
    if (low) {
      void dispatchOpsNotification(env, 'upstream_alert', '上游货源余额低位预警', [
        `货源名称：${source.name}`,
        `当前余额：¥${balance.toFixed(2)}（预警线 ¥${threshold.toFixed(2)}）`,
        '提示：当余额低于商品进价时，系统将自动跳过该源或切换备用货源，请尽快充值。',
      ]);
    }
    return { balance, low_balance: low, currency: 'CNY' };
  }

  return { balance: source.cached_balance, low_balance: false, currency: 'CNY' };
}

/** 强制验签并解析上游异步 Webhook 回调（隔离回调密钥、禁止降级弱 MD5 与支持时间戳防重放） */
export async function verifyAndParseUpstreamWebhook(
  env: Env,
  source: UpstreamSourceRow,
  body: Record<string, unknown>,
  headers: Headers
): Promise<{
  verified: boolean;
  error?: string;
  outTradeNo: string;
  upstreamOrderNo: string;
  status: 'succeeded' | 'failed' | 'pending';
  cards: string[];
  actualCost: number;
}> {
  const sec = await decryptSourceSecrets(env, source);
  // S9：回调签名严禁回退使用出站批采 apiKey，必须使用独立的 webhookSecret 或 apiSecret
  const whSecret = (sec.webhookSecret || sec.apiSecret || '').trim();
  const respMap = safeParseJson<ResponseMappingConfig>(source.response_mapping_json || '{}', {});

  if (!whSecret) {
    return {
      verified: false,
      error: '该上游货源未配置独立 Webhook/API Secret 签名密钥，已拒绝异步回调',
      outTradeNo: '',
      upstreamOrderNo: '',
      status: 'pending',
      cards: [],
      actualCost: 0,
    };
  }

  // 防重放时间戳窗口校验（若回调携带 timestamp / ts / X-Webhook-Timestamp，允许 ±5 分钟漂移）
  const rawTs = body.timestamp ?? body.ts ?? headers.get('x-webhook-timestamp');
  if (rawTs !== undefined && rawTs !== null && String(rawTs).trim() !== '') {
    const numTs = Number(rawTs);
    const tsMs = Number.isFinite(numTs) ? (numTs < 1e12 ? numTs * 1000 : numTs) : Date.parse(String(rawTs));
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60_000) {
      return {
        verified: false,
        error: '回调时间戳已过期或格式非法（防重放拦截）',
        outTradeNo: '',
        upstreamOrderNo: '',
        status: 'pending',
        cards: [],
        actualCost: 0,
      };
    }
  }

  const providedSign = String(
    body.sign ?? body.signature ?? headers.get('x-webhook-signature') ?? headers.get('x-signature') ?? ''
  )
    .trim()
    .toLowerCase();

  if (!providedSign) {
    return {
      verified: false,
      error: '缺少回调签名 (sign / X-Webhook-Signature)',
      outTradeNo: '',
      upstreamOrderNo: '',
      status: 'pending',
      cards: [],
      actualCost: 0,
    };
  }

  // S9 防算法降级：仅明确配置为 acgfaka_sign 的货源允许 MD5 验签，其余模式强制校验 HMAC-SHA256
  const expectedSig =
    source.auth_mode === 'acgfaka_sign'
      ? (await signUpstreamParams('acgfaka_sign', body, whSecret)).toLowerCase()
      : (await signUpstreamParams('hmac_sha256', body, whSecret)).toLowerCase();
  if (!timingSafeEqual(providedSign, expectedSig)) {
    return {
      verified: false,
      error: '回调签名校验失败',
      outTradeNo: '',
      upstreamOrderNo: '',
      status: 'pending',
      cards: [],
      actualCost: 0,
    };
  }

  const outTradeNo = String(
    body.out_trade_no ?? getByPath(body, 'data.out_trade_no') ?? body.customer_ref ?? ''
  ).trim();
  const upstreamOrderNo = String(
    (respMap.order_no_path ? getByPath(body, respMap.order_no_path) : undefined) ??
      body.trade_no ??
      getByPath(body, 'data.trade_no') ??
      body.order_no ??
      ''
  ).trim();
  const cardsRaw =
    (respMap.cards_path ? getByPath(body, respMap.cards_path) : undefined) ??
    body.cards ??
    getByPath(body, 'data.cards') ??
    body.secret ??
    getByPath(body, 'data.secret') ??
    body.card;
  const cards = extractCardsArray(cardsRaw);
  const rawSt = String(body.status ?? getByPath(body, 'data.status') ?? '').toLowerCase();
  const costVal = Number(body.cost ?? body.amount ?? getByPath(body, 'data.cost') ?? 0);

  let status: 'succeeded' | 'failed' | 'pending' = 'pending';
  const terminalWithoutDelivery = ['refunded', 'cancelled', 'canceled', 'rejected', 'not_accepted'].includes(
    rawSt
  );
  if (terminalWithoutDelivery) {
    if (cards.length === 0) status = 'failed';
  } else if (
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
    ].includes(rawSt) &&
    cards.length > 0
  ) {
    status = 'succeeded';
  }

  return {
    verified: true,
    outTradeNo,
    upstreamOrderNo,
    status,
    cards,
    actualCost: Number.isFinite(costVal) && costVal > 0 ? Number(costVal.toFixed(2)) : 0,
  };
}
