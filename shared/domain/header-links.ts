/**
 * 顶部导航栏（Header）自定义外链与分组菜单的解析与安全净化纯函数（前后端共享）
 * 支持两类顶层条目自由混排：
 * - 单链（link）：直接展示在 Header 上的独立外链（自动带外链图标）
 * - 分组（group）：自定义分组名，点击展开圆角卡片竖排列表，组内可自定义多条外链
 * 同时 100% 向后兼容历史扁平结构 `[{ label, url }]`。
 */

export interface HeaderCustomLink {
  label: string;
  url: string;
}

export type HeaderNavEntry =
  | { type: 'link'; label: string; url: string }
  | { type: 'group'; label: string; items: HeaderCustomLink[] };

export const MAX_HEADER_ENTRIES = 6;
export const MAX_GROUP_ITEMS = 10;

function isSafeHttpUrl(raw: string): boolean {
  return /^https?:\/\/[^\s<>"']{3,500}$/i.test(raw);
}

function parseLinkItem(raw: unknown): HeaderCustomLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const label = typeof rec.label === 'string' ? rec.label.trim().slice(0, 20) : '';
  const url = typeof rec.url === 'string' ? rec.url.trim() : '';
  if (!label || !isSafeHttpUrl(url)) return null;
  return { label, url };
}

/** 从 JSON 字符串严格解析可安全展示的 Header 自定义导航项（过滤无效链接与空分组） */
export function parseHeaderNavEntries(raw?: string | null): HeaderNavEntry[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HeaderNavEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.type === 'group') {
        const label = typeof rec.label === 'string' ? rec.label.trim().slice(0, 20) : '';
        if (!label || !Array.isArray(rec.items)) continue;
        const subItems: HeaderCustomLink[] = [];
        for (const sub of rec.items) {
          const valid = parseLinkItem(sub);
          if (valid) subItems.push(valid);
          if (subItems.length >= MAX_GROUP_ITEMS) break;
        }
        if (subItems.length > 0) {
          out.push({ type: 'group', label, items: subItems });
        }
      } else {
        // 兼容显式 type === 'link' 与历史无 type 字段的扁平链接对象
        const valid = parseLinkItem(rec);
        if (valid) {
          out.push({ type: 'link', label: valid.label, url: valid.url });
        }
      }
      if (out.length >= MAX_HEADER_ENTRIES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** 后台编辑器草稿解析：保留未填写完整的直链或分组，避免编辑输入中途丢失 */
export function parseHeaderNavEntriesDraft(raw?: string | null): HeaderNavEntry[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HeaderNavEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.type === 'group') {
        const label = typeof rec.label === 'string' ? rec.label.slice(0, 20) : '';
        const rawItems = Array.isArray(rec.items) ? rec.items : [];
        const items: HeaderCustomLink[] = rawItems
          .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
          .slice(0, MAX_GROUP_ITEMS)
          .map((x) => ({
            label: typeof x.label === 'string' ? x.label.slice(0, 20) : '',
            url: typeof x.url === 'string' ? x.url : '',
          }));
        out.push({ type: 'group', label, items });
      } else {
        out.push({
          type: 'link',
          label: typeof rec.label === 'string' ? rec.label.slice(0, 20) : '',
          url: typeof rec.url === 'string' ? rec.url : '',
        });
      }
      if (out.length >= MAX_HEADER_ENTRIES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** 兼容旧调用点：提取所有平铺有效外链 */
export function parseHeaderLinks(raw?: string | null): HeaderCustomLink[] {
  const entries = parseHeaderNavEntries(raw);
  const flat: HeaderCustomLink[] = [];
  for (const entry of entries) {
    if (entry.type === 'link') flat.push({ label: entry.label, url: entry.url });
    else flat.push(...entry.items);
  }
  return flat;
}

/** 净化并序列化顶部导航栏外链/分组配置（服务端落库唯一入口） */
export function sanitizeHeaderLinksJson(raw: unknown): string {
  if (typeof raw === 'string') {
    return JSON.stringify(parseHeaderNavEntries(raw));
  }
  if (Array.isArray(raw)) {
    return JSON.stringify(parseHeaderNavEntries(JSON.stringify(raw)));
  }
  return '[]';
}
