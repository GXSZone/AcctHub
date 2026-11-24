import type { Env, TenantContext } from '../../env';
import { generateRandomCode, normalizeSubdomainSlug, RESERVED_SUBDOMAINS } from '../../infra/auth-crypto';
import { encryptSecret, sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { sanitizeHexColor, sanitizeSafeMediaUrl } from '../../infra/seo';
import { findAgentByUserId } from '../auth/auth.repo';
import { getAuthUser } from '../auth/auth.service';
import { type ActiveAgentContext, sanitizeSupportLinksJson, sanitizeSupportMediaJson } from './agent.guard';
import { existsOtherAgentWithSlug, findAgentByIdMapped, updateAgentBrandRecord } from './agent.repo';

/** 面向 HTTP 请求的二级域名前缀查重入口（支持未开通代理的普通会员在支付前实时查重） */
export async function checkAgentSlugForRequest(
  req: Request,
  env: Env,
  tenant: TenantContext,
  rawSlug: string
) {
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized('请先登录账号');
  const existing = await findAgentByUserId(createDb(env.DB), user.id);
  return checkAgentSlugAvailability(env, rawSlug, existing ? { id: existing.id, slug: existing.slug } : null);
}

/** 实时检测二级域名前缀是否可用并生成备选推荐（允许开通前普通会员调用） */
export async function checkAgentSlugAvailability(
  env: Env,
  rawSlug: string,
  currentAgent?: { id: number; slug: string } | null
) {
  const db = createDb(env.DB);
  const currentSlug = (currentAgent?.slug || '').toLowerCase();
  const normalized = normalizeSubdomainSlug(rawSlug);

  if (normalized.length < 3 || normalized.length > 24) {
    return {
      available: false,
      normalized,
      reason: '网址前缀需为 3–24 位小写字母、数字或短横线',
      suggestions: [],
    };
  }
  if (currentSlug && normalized === currentSlug) {
    return { available: true, unchanged: true, normalized, reason: '', suggestions: [] };
  }

  const buildSuggestions = async (base: string) => {
    const root = base.slice(0, 16);
    const pool = [
      `${root}88`,
      `${root}66`,
      `${root}-ai`,
      `${root}${generateRandomCode('', 3).toLowerCase()}`,
      `shop-${root}`.slice(0, 24),
    ];
    const out: string[] = [];
    for (const cand of pool) {
      const n = normalizeSubdomainSlug(cand);
      if (n.length < 3 || RESERVED_SUBDOMAINS.has(n)) continue;
      if (!(await existsOtherAgentWithSlug(db, n)) && !out.includes(n)) out.push(n);
      if (out.length >= 3) break;
    }
    return out;
  };

  if (RESERVED_SUBDOMAINS.has(normalized)) {
    return {
      available: false,
      normalized,
      reason: `「${normalized}」为系统保留前缀，请换一个专属前缀`,
      suggestions: await buildSuggestions(normalized),
    };
  }

  if (await existsOtherAgentWithSlug(db, normalized, currentAgent?.id)) {
    return {
      available: false,
      normalized,
      reason: `「${normalized}」已被其他店铺使用，请更换一个`,
      suggestions: await buildSuggestions(normalized),
    };
  }

  return { available: true, unchanged: false, normalized, reason: '', suggestions: [] };
}

/** 更新店铺品牌装修、客服配置、默认加价与 SEO（二级域名前缀开通后永久锁定不可修改） */
export async function updateAgentStorefrontBrand(
  env: Env,
  ctx: ActiveAgentContext,
  body: Record<string, unknown>
) {
  const db = createDb(env.DB);
  const agentId = ctx.agent.id;
  const currentSlug = ctx.agent.slug.toLowerCase();
  if (body.slug !== undefined) {
    const requested = normalizeSubdomainSlug(String(body.slug || ''));
    if (requested && requested !== currentSlug) {
      throw Errors.forbidden('免费二级域名前缀在开通时已永久锁定，不可修改；如需更换网址请绑定独立域名');
    }
  }
  const nextSlug = currentSlug;

  const brandName = String(body.brand_name ?? ctx.agent.brand_name).trim();
  if (!brandName) throw Errors.validation('请填写分站品牌名称');

  if (body.markup_percent !== undefined) {
    const rawMarkup = Number(body.markup_percent);
    if (!Number.isFinite(rawMarkup) || rawMarkup < 0 || rawMarkup > 200) {
      throw Errors.validation('默认加价率必须为 0 – 200 之间的有效数字');
    }
  }
  const markup = Math.min(200, Math.max(0, Number(body.markup_percent ?? ctx.agent.markup_percent ?? 12)));

  if (body.theme_accent !== undefined && String(body.theme_accent).trim() !== '') {
    if (!sanitizeHexColor(body.theme_accent)) {
      throw Errors.validation('主题色格式无效，请使用如 #2D6A57 的 6 位十六进制颜色代码');
    }
  }

  try {
    await updateAgentBrandRecord(db, agentId, {
      slug: nextSlug,
      brandName,
      brandTagline: String(body.brand_tagline ?? ctx.agent.brand_tagline ?? '').trim(),
      announcementBanner: String(body.announcement_banner ?? ctx.agent.announcement_banner ?? '').trim(),
      supportLabel: String(body.support_label ?? ctx.agent.support_label ?? '').trim(),
      supportUrl: String(body.support_url ?? ctx.agent.support_url ?? '').trim(),
      supportNote: String(body.support_note ?? ctx.agent.support_note ?? '').trim(),
      supportMediaJson:
        body.support_media_json !== undefined
          ? sanitizeSupportMediaJson(body.support_media_json)
          : String(ctx.agent.support_media_json || '[]'),
      supportLinksJson:
        body.support_links_json !== undefined
          ? sanitizeSupportLinksJson(body.support_links_json)
          : String(ctx.agent.support_links_json || '[]'),
      themeAccent:
        body.theme_accent !== undefined
          ? sanitizeHexColor(body.theme_accent)
          : String(ctx.agent.theme_accent || ''),
      faviconUrl:
        body.favicon_url !== undefined
          ? sanitizeSafeMediaUrl(body.favicon_url)
          : String(ctx.agent.favicon_url || ''),
      ogImageUrl:
        body.og_image_url !== undefined
          ? sanitizeSafeMediaUrl(body.og_image_url)
          : String(ctx.agent.og_image_url || ''),
      seoTitle:
        body.seo_title !== undefined
          ? String(body.seo_title || '')
              .trim()
              .slice(0, 160)
          : String(ctx.agent.seo_title || ''),
      seoDescription:
        body.seo_description !== undefined
          ? String(body.seo_description || '')
              .trim()
              .slice(0, 400)
          : String(ctx.agent.seo_description || ''),
      footerText:
        body.footer_text !== undefined
          ? String(body.footer_text || '')
              .trim()
              .slice(0, 300)
          : String(ctx.agent.footer_text || ''),
      markupPercent: markup,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/unique/i.test(msg)) {
      throw Errors.conflict('该网址前缀刚刚被其他店铺抢先注册，请换一个再试');
    }
    throw err;
  }

  const updated = await findAgentByIdMapped(db, agentId, env);
  return { ok: true, agent: updated };
}

/** 轮换 B2B 批采 API Key（旧唯一键列保留独立随机标识） */
export async function rotateAgentApiKey(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const newKey = generateRandomCode('ah_agent_', 18).replace(/-/g, '');
  const [apiKeyHash, apiKeyEnc] = await Promise.all([sha256Hex(newKey), encryptSecret(env, newKey)]);
  await updateAgentBrandRecord(db, ctx.agent.id, {
    apiKey: crypto.randomUUID(),
    apiKeyHash,
    apiKeyEnc,
  });
  return { api_key: newKey };
}

/** 更新 B2B API 调用 IP 白名单 */
export async function updateAgentApiWhitelist(env: Env, ctx: ActiveAgentContext, rawWhitelist: string) {
  const lines = rawWhitelist
    .split(/[\r\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  for (const ip of lines) {
    if (!/^[0-9a-fA-F.:]+$/.test(ip)) {
      throw Errors.validation(`IP 格式无效：${ip}（请填写 IPv4 或 IPv6 地址，每行一个）`);
    }
  }
  const normalized = lines.join('\n');
  const db = createDb(env.DB);
  await updateAgentBrandRecord(db, ctx.agent.id, { apiIpWhitelist: normalized });
  return { ok: true, api_ip_whitelist: normalized, count: lines.length };
}
