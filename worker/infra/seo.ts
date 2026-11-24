import type { TenantContext } from '../env';

export interface TenantSeoPayload {
  title: string;
  description: string;
  url: string;
  ogImage: string;
  faviconUrl: string;
  themeAccent: string;
}

const DEFAULT_SEO_TITLE = 'AcctHub · 温润可靠的 AI 与数字席位台';
const DEFAULT_SEO_DESC = '专业 AI 订阅与开发者工具自动发卡、团队席位拼车与代理分销平台。';

/** HTML 属性值实体转义，防御 Stored XSS 突破引号注入 */
function escapeHtmlAttr(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML 文本内容转义（用于 <title> 等标签体） */
function escapeHtmlText(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 校验并清洗安全的十六进制主题色 (#RRGGBB)，非合法格式返回空字符串 */
export function sanitizeHexColor(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  return '';
}

/** 校验并清洗图片/图标 URL（仅允许 https:// / http:// / 站内根相对路径 /...） */
export function sanitizeSafeMediaUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const parsed = new URL(s);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

/** 根据当前租户上下文及主站配置生成最终 SEO Meta 载荷 */
export function buildTenantSeoPayload(
  tenant: TenantContext,
  requestUrl: string,
  mainSettings?: { brandName?: string; brandTagline?: string }
): TenantSeoPayload {
  const safeOriginUrl = (() => {
    try {
      const u = new URL(requestUrl);
      return `${u.origin}${u.pathname}`;
    } catch {
      return requestUrl;
    }
  })();

  if (tenant.isSubAgent) {
    const brand = tenant.brandName || '合作数字商城';
    const tagline = tenant.brandTagline || DEFAULT_SEO_DESC;
    const title =
      (tenant.seoTitle || '').trim() || (tenant.brandTagline ? `${brand} · ${tenant.brandTagline}` : brand);
    const description = (tenant.seoDescription || '').trim() || tagline;
    return {
      title: title.slice(0, 160),
      description: description.slice(0, 400),
      url: safeOriginUrl,
      ogImage: sanitizeSafeMediaUrl(tenant.ogImageUrl),
      faviconUrl: sanitizeSafeMediaUrl(tenant.faviconUrl),
      themeAccent: sanitizeHexColor(tenant.themeAccent),
    };
  }

  const mainBrand = (mainSettings?.brandName || '').trim();
  const mainTagline = (mainSettings?.brandTagline || '').trim();
  const title = mainBrand ? (mainTagline ? `${mainBrand} · ${mainTagline}` : mainBrand) : DEFAULT_SEO_TITLE;

  return {
    title: title.slice(0, 160),
    description: (mainTagline || DEFAULT_SEO_DESC).slice(0, 400),
    url: safeOriginUrl,
    ogImage: '',
    faviconUrl: '',
    themeAccent: '',
  };
}

function upsertOrReplaceMetaTag(
  html: string,
  attrName: 'name' | 'property',
  key: string,
  content: string
): string {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeContent = escapeHtmlAttr(content);
  const tagRegex = new RegExp(`<meta\\s+[^>]*${attrName}=["']${safeKey}["'][^>]*>`, 'i');
  const replacement = `<meta ${attrName}="${key}" content="${safeContent}" />`;
  if (tagRegex.test(html)) {
    return html.replace(tagRegex, replacement);
  }
  return html.replace(/<\/head>/i, `    ${replacement}\n  </head>`);
}

/** 在边缘响应中将 HTML <head> 的标题、Meta 描述、OG 卡片与 Favicon 重写为当前分站配置 */
export function rewriteHtmlWithTenantSeo(html: string, seo: TenantSeoPayload): string {
  let out = html;
  const safeTitle = escapeHtmlText(seo.title);
  if (/<title>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
  } else {
    out = out.replace(/<\/head>/i, `    <title>${safeTitle}</title>\n  </head>`);
  }

  out = upsertOrReplaceMetaTag(out, 'name', 'description', seo.description);
  out = upsertOrReplaceMetaTag(out, 'property', 'og:type', 'website');
  out = upsertOrReplaceMetaTag(out, 'property', 'og:title', seo.title);
  out = upsertOrReplaceMetaTag(out, 'property', 'og:description', seo.description);
  if (seo.url) {
    out = upsertOrReplaceMetaTag(out, 'property', 'og:url', seo.url);
  }
  if (seo.ogImage) {
    out = upsertOrReplaceMetaTag(out, 'property', 'og:image', seo.ogImage);
    out = upsertOrReplaceMetaTag(out, 'name', 'twitter:card', 'summary_large_image');
    out = upsertOrReplaceMetaTag(out, 'name', 'twitter:image', seo.ogImage);
  }
  if (seo.faviconUrl) {
    const safeFav = escapeHtmlAttr(seo.faviconUrl);
    const favTag = `<link rel="icon" href="${safeFav}" />`;
    if (/<link\s+[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*>/i.test(out)) {
      out = out.replace(/<link\s+[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*>/i, favTag);
    } else {
      out = out.replace(/<\/head>/i, `    ${favTag}\n  </head>`);
    }
  }
  if (seo.themeAccent) {
    out = upsertOrReplaceMetaTag(out, 'name', 'theme-color', seo.themeAccent);
  }
  return out;
}
