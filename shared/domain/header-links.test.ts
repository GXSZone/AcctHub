import { describe, expect, it } from 'vitest';
import {
  parseHeaderLinks,
  parseHeaderNavEntries,
  parseHeaderNavEntriesDraft,
  sanitizeHeaderLinksJson,
} from './header-links';

describe('顶部导航栏自定义外链与分组解析', () => {
  it('兼容历史扁平数组并过滤非法协议与空项', () => {
    const legacy = JSON.stringify([
      { label: '2FA 生成', url: 'https://2fa.example.com' },
      { label: '非法协议', url: 'javascript:alert(1)' },
      { label: '   ', url: 'https://empty.example.com' },
    ]);
    const parsed = parseHeaderNavEntries(legacy);
    expect(parsed).toEqual([{ type: 'link', label: '2FA 生成', url: 'https://2fa.example.com' }]);
    expect(parseHeaderLinks(legacy)).toEqual([{ label: '2FA 生成', url: 'https://2fa.example.com' }]);
  });

  it('支持单个外链与多个自定义名称分组混排，并过滤空分组', () => {
    const raw = JSON.stringify([
      { type: 'link', label: '公告频道', url: 'https://t.me/channel' },
      {
        type: 'group',
        label: '实用工具',
        items: [
          { label: '2FA 生成', url: 'https://2fa.example.com' },
          { label: '卡密查询', url: 'https://check.example.com' },
        ],
      },
      {
        type: 'group',
        label: '教程中心',
        items: [{ label: '新手教程', url: 'https://docs.example.com/guide' }],
      },
      {
        type: 'group',
        label: '空分组',
        items: [{ label: '坏链接', url: 'ftp://invalid.example.com' }],
      },
    ]);

    const entries = parseHeaderNavEntries(raw);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ type: 'link', label: '公告频道', url: 'https://t.me/channel' });
    expect(entries[1]).toEqual({
      type: 'group',
      label: '实用工具',
      items: [
        { label: '2FA 生成', url: 'https://2fa.example.com' },
        { label: '卡密查询', url: 'https://check.example.com' },
      ],
    });
    expect(entries[2]).toEqual({
      type: 'group',
      label: '教程中心',
      items: [{ label: '新手教程', url: 'https://docs.example.com/guide' }],
    });

    // sanitizeHeaderLinksJson 序列化后再解析保持幂等
    expect(parseHeaderNavEntries(sanitizeHeaderLinksJson(raw))).toEqual(entries);
  });

  it('草稿解析保留正在填写的空分组与未填完直链', () => {
    const draft = JSON.stringify([
      { type: 'group', label: '待命名分组', items: [{ label: '', url: 'https://' }] },
      { type: 'link', label: '', url: 'https://' },
    ]);
    const parsed = parseHeaderNavEntriesDraft(draft);
    expect(parsed).toEqual([
      { type: 'group', label: '待命名分组', items: [{ label: '', url: 'https://' }] },
      { type: 'link', label: '', url: 'https://' },
    ]);
  });
});
