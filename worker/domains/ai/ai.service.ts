import type { AiProvider, UpdateAiConfigInput } from '@shared/index';
import type { Env } from '../../env';
import { decryptSecret, encryptSecret, maskSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { assertSafeOutboundUrl } from '../../infra/http';
import { listAiSettingEntriesRepo, upsertAiSettingEntriesRepo } from './ai.repo';

export type { AiProvider };

type AiOptimizeScope = 'all' | 'titles' | 'detail' | 'faq';
type AiToneStyle = 'editorial' | 'conversion' | 'technical';

interface AiConfig {
  provider: AiProvider;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  system_prompt: string;
}

interface AiOptimizeInput {
  scope?: AiOptimizeScope;
  tone?: AiToneStyle;
  instruction?: string;
  product: {
    title: string;
    title_en?: string;
    subtitle?: string;
    subtitle_en?: string;
    category_name?: string;
    delivery_type?: string;
    base_price?: number;
    tags?: string[];
    summary_markdown?: string;
    detail_markdown?: string;
    risk_notice?: string;
    faq?: Array<{ q: string; a: string }>;
  };
}

export interface AiOptimizeSuggestion {
  title?: string;
  title_en?: string;
  subtitle?: string;
  subtitle_en?: string;
  tags?: string[];
  summary_markdown?: string;
  detail_markdown?: string;
  risk_notice?: string;
  faq?: Array<{ q: string; a: string }>;
  reasoning?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  '你是 AcctHub 的资深 AI 与数字订阅商品文案主编。你的风格克制、清晰、高信赖度（类似 Claude 官方文档与精品店风格），擅长把生硬的上游标题改写为结构清晰、信息透明、转化率高的中文与英文商品文案。严禁夸大虚假承诺，务必突出交付方式、合规使用与售后保障。';

function canonicalAiBaseUrl(raw: string): string {
  const url = assertSafeOutboundUrl(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw Errors.validation('AI 接口必须使用 HTTPS，地址不得包含用户凭据、查询参数或片段');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function defaultAiBaseUrl(provider: AiProvider): string {
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  return 'https://api.openai.com/v1';
}

export function aiCredentialScope(provider: AiProvider, baseUrl: string): string {
  return JSON.stringify(['ai_api_key', provider, canonicalAiBaseUrl(baseUrl)]);
}

export const UNBOUND_AI_CREDENTIAL_SCOPE = 'unbound-legacy-ai';

async function loadAiConfig(env: Env, readCredential = true): Promise<AiConfig> {
  const rows = await listAiSettingEntriesRepo(createDb(env.DB));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rawProvider = map.get('ai_provider') || 'openai_compatible';
  const provider: AiProvider =
    rawProvider === 'anthropic' || rawProvider === 'gemini' ? rawProvider : 'openai_compatible';
  const baseUrl = map.get('ai_base_url') || defaultAiBaseUrl(provider);
  const storedKey = map.get('ai_api_key') || '';
  // 历史明文密钥没有可信的目的地绑定，必须重新录入后才允许发送。
  const apiKey =
    readCredential && storedKey.startsWith('v3.')
      ? await decryptSecret(env, storedKey, aiCredentialScope(provider, baseUrl)).catch(() => '')
      : '';

  return {
    provider,
    base_url: baseUrl,
    api_key: apiKey,
    model: map.get('ai_model') || 'gpt-5-mini',
    temperature: Math.min(1.2, Math.max(0, Number(map.get('ai_temperature') ?? 0.6))),
    system_prompt: map.get('ai_system_prompt') || DEFAULT_SYSTEM_PROMPT,
  };
}

/** 历史 AI 明文缺少目的地绑定，仅重新加密留存供迁移核对。 */
export async function rekeyAiCredential(env: Env, value: string): Promise<string> {
  if (!value.startsWith('v3.')) return encryptSecret(env, value, UNBOUND_AI_CREDENTIAL_SCOPE);
  const config = await loadAiConfig(env, false);
  let scope = UNBOUND_AI_CREDENTIAL_SCOPE;
  let plaintext: string;
  try {
    plaintext = await decryptSecret(env, value, scope);
  } catch {
    scope = aiCredentialScope(config.provider, config.base_url);
    plaintext = await decryptSecret(env, value, scope);
  }
  return encryptSecret(env, plaintext, scope);
}

function toPublicAiConfig(cfg: AiConfig) {
  return {
    provider: cfg.provider,
    base_url: cfg.base_url,
    model: cfg.model,
    temperature: cfg.temperature,
    system_prompt: cfg.system_prompt,
    has_api_key: Boolean(cfg.api_key),
    api_key_masked: maskSecret(cfg.api_key),
  };
}

/** 读取脱敏后的 AI 引擎配置（供管理端回显） */
export async function getAiConfigPublic(env: Env) {
  return toPublicAiConfig(await loadAiConfig(env));
}

/** 保存 AI 引擎配置并返回脱敏后的最新配置 */
export async function saveAiConfigPublic(env: Env, body: UpdateAiConfigInput) {
  const current = await loadAiConfig(env, false);
  const provider = body.provider ?? current.provider;
  const baseUrl = canonicalAiBaseUrl(
    body.base_url ?? (provider !== current.provider ? defaultAiBaseUrl(provider) : current.base_url)
  );
  const changedTarget =
    provider !== current.provider ||
    baseUrl !==
      (() => {
        try {
          return canonicalAiBaseUrl(current.base_url);
        } catch {
          return '';
        }
      })();
  const entries: Array<[string, string]> = [];
  if (body.provider !== undefined) entries.push(['ai_provider', body.provider]);
  if (body.base_url !== undefined || changedTarget) entries.push(['ai_base_url', baseUrl]);
  if (body.model !== undefined) entries.push(['ai_model', body.model]);
  if (body.temperature !== undefined) entries.push(['ai_temperature', String(body.temperature)]);
  if (body.system_prompt !== undefined) entries.push(['ai_system_prompt', body.system_prompt]);

  if (body.api_key?.trim() && !body.clear_api_key) {
    entries.push([
      'ai_api_key',
      await encryptSecret(env, body.api_key.trim(), aiCredentialScope(provider, baseUrl)),
    ]);
  } else if (body.clear_api_key || changedTarget) {
    entries.push(['ai_api_key', '']);
  }

  if (entries.length > 0) {
    await upsertAiSettingEntriesRepo(createDb(env.DB), entries);
  }
  return toPublicAiConfig(await loadAiConfig(env));
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = rawText.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? (fenced[1] ?? '').trim() : cleaned;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw Errors.upstream('AI 返回内容未包含合法 JSON 对象，请检查模型配置或重试');
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
}

async function callRemoteLlm(config: AiConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!config.api_key.trim()) {
    throw Errors.validation('尚未配置 AI API Key，请先在「AI 文案引擎」中填入真实大模型密钥');
  }
  const base = canonicalAiBaseUrl(config.base_url);

  if (config.provider === 'anthropic') {
    const endpoint = base.endsWith('/v1/messages')
      ? base
      : `${base.endsWith('/v1') ? base : `${base}/v1`}/messages`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.api_key.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        max_tokens: 2048,
        temperature: config.temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!resp.ok) {
      throw Errors.upstream(`Anthropic 接口异常 (HTTP ${resp.status})`);
    }
    const data = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content || [])
      .map((c) => c.text || '')
      .join('\n')
      .trim();
    if (!text) throw Errors.upstream('Anthropic 返回内容为空');
    return text;
  }

  if (config.provider === 'gemini') {
    const model = config.model || 'gemini-2.5-flash';
    const endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.api_key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: config.temperature,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!resp.ok) {
      throw Errors.upstream(`Gemini 接口异常 (HTTP ${resp.status})`);
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('\n')
        .trim() || '';
    if (!text) throw Errors.upstream('Gemini 返回内容为空');
    return text;
  }

  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const modelName = config.model || 'gpt-5-mini';
  const omitTemperature = /(^|\/)(gpt-5($|[-.])|o[134]($|[-.]))/i.test(modelName) && !/chat/i.test(modelName);
  const payload: Record<string, unknown> = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (!omitTemperature) {
    payload.temperature = config.temperature;
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.api_key.trim()}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw Errors.upstream(`AI 接口返回异常 (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw Errors.upstream('AI 接口返回内容为空');
  return text;
}

export async function optimizeProductWithAi(
  env: Env,
  input: AiOptimizeInput
): Promise<{ provider: AiProvider; model: string; duration_ms: number; suggestion: AiOptimizeSuggestion }> {
  const start = Date.now();
  const config = await loadAiConfig(env);
  const scope = input.scope || 'all';
  const tone = input.tone || 'editorial';
  const toneGuide =
    tone === 'conversion'
      ? '高转化电商卖点风格：突出核心价值、省心体验与紧迫感，但仍保持真实克制。'
      : tone === 'technical'
        ? '极客开发者技术风格：准确使用技术术语，突出稳定性、上下文额度、接口/节点纯净度。'
        : 'Claude 官方编辑风格：温润、克制、专业、信息密度高、毫无浮夸营销感。';

  const wantedKeys =
    scope === 'titles'
      ? ['title', 'title_en', 'subtitle', 'subtitle_en', 'tags', 'reasoning']
      : scope === 'detail'
        ? ['summary_markdown', 'detail_markdown', 'risk_notice', 'reasoning']
        : scope === 'faq'
          ? ['faq', 'tags', 'reasoning']
          : [
              'title',
              'title_en',
              'subtitle',
              'subtitle_en',
              'tags',
              'summary_markdown',
              'detail_markdown',
              'risk_notice',
              'faq',
              'reasoning',
            ];

  const userPrompt = [
    '请帮我优化以下数字订阅 / AI 账号商品的文案，严格只返回一个合法 JSON 对象（不要附带额外解释文本）。',
    `文案风格要求：${toneGuide}`,
    input.instruction ? `总管理员额外要求：${input.instruction}` : '',
    `需要返回的 JSON 字段：${wantedKeys.join(', ')}`,
    '字段规范：',
    '- title: 中文主标题（20-34字，清晰突出产品名与核心优势）',
    '- title_en: 英文主标题（简洁地道）',
    '- subtitle: 一句话中文卖点副标题（25-55字）',
    '- subtitle_en: 英文副标题',
    '- tags: 字符串数组（3-4个短标签，每个2-5字）',
    '- summary_markdown: 一段 50-90 字的精炼商品摘要',
    '- detail_markdown: 干净语义化的 HTML 详情介绍（只用 <h3>、<p>、<ul>、<li>、<strong> 标签）',
    '- risk_notice: 购前防风控与使用须知（60-120字）',
    '- faq: 数组，包含 3 组 { "q": "问题", "a": "解答" }',
    '- reasoning: 一句话说明本次优化的核心改写思路（20-50字）',
    '',
    '当前商品原始信息：',
    JSON.stringify(input.product, null, 2),
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await callRemoteLlm(config, config.system_prompt, userPrompt);
  const parsed = extractJsonObject(rawText);

  const suggestion: AiOptimizeSuggestion = {
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '已完成 AI 文案优化',
  };

  if (typeof parsed.title === 'string' && parsed.title.trim()) suggestion.title = parsed.title.trim();
  if (typeof parsed.title_en === 'string' && parsed.title_en.trim())
    suggestion.title_en = parsed.title_en.trim();
  if (typeof parsed.subtitle === 'string' && parsed.subtitle.trim())
    suggestion.subtitle = parsed.subtitle.trim();
  if (typeof parsed.subtitle_en === 'string' && parsed.subtitle_en.trim()) {
    suggestion.subtitle_en = parsed.subtitle_en.trim();
  }
  if (Array.isArray(parsed.tags)) {
    suggestion.tags = parsed.tags
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  if (typeof parsed.summary_markdown === 'string' && parsed.summary_markdown.trim()) {
    suggestion.summary_markdown = parsed.summary_markdown.trim();
  }
  if (typeof parsed.detail_markdown === 'string' && parsed.detail_markdown.trim()) {
    suggestion.detail_markdown = parsed.detail_markdown.trim();
  }
  if (typeof parsed.risk_notice === 'string' && parsed.risk_notice.trim()) {
    suggestion.risk_notice = parsed.risk_notice.trim();
  }
  if (Array.isArray(parsed.faq)) {
    suggestion.faq = parsed.faq
      .map((item) => {
        const obj = item as Record<string, unknown>;
        return { q: String(obj.q || '').trim(), a: String(obj.a || '').trim() };
      })
      .filter((x) => x.q && x.a)
      .slice(0, 6);
  }

  return {
    provider: config.provider,
    model: config.model,
    duration_ms: Date.now() - start,
    suggestion,
  };
}

export async function testAiConnection(
  env: Env
): Promise<{ ok: boolean; provider: AiProvider; model: string; duration_ms: number; reply: string }> {
  const start = Date.now();
  const config = await loadAiConfig(env);
  const reply = await callRemoteLlm(
    config,
    '你是连接测试助手。',
    '请仅回复简短的 1 句话中文确认语，例如：AcctHub AI 接口连接正常。'
  );
  return {
    ok: true,
    provider: config.provider,
    model: config.model,
    duration_ms: Date.now() - start,
    reply: reply.slice(0, 200),
  };
}
