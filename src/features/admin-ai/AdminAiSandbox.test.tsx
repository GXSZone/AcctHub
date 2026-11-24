import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { AdminAiSandbox } from './AdminAiSandbox';

const fixture = vi.hoisted(() => ({
  selection: 1,
  preview: {
    productId: 1,
    provider: 'test',
    model: 'test-model',
    duration_ms: 1,
    suggestion: {
      title: '新标题',
      title_en: 'New title',
      subtitle: '新副标题',
      subtitle_en: 'New subtitle',
      tags: ['新标签'],
      summary_markdown: '新摘要',
      detail_markdown: '新详情',
      risk_notice: '新风险',
      faq: [{ q: '新问题', a: '新答案' }],
    },
  },
}));

vi.mock('react', async (load) => {
  const real = await load<typeof import('react')>();
  return {
    ...real,
    useState: (init: unknown) =>
      real.useState(init === 1 ? fixture.selection : init === null ? fixture.preview : init),
  };
});
vi.mock('../../i18n/namespaces/admin-ai', async () => {
  const { adminAiZhCN } = await import('../../i18n/namespaces/admin-ai/zh-CN');
  return { useAdminAiI18n: () => adminAiZhCN };
});

function markup(selection: number) {
  fixture.selection = selection;
  const settings = {
    subtitle: '',
    delivery_type: 'auto',
    base_price: 50,
    tags: [],
    summary_markdown: '',
    detail_markdown: '',
    risk_notice: '',
  };
  return renderToStaticMarkup(
    <AdminAiSandbox
      products={[
        { ...settings, id: 1, title: '实际商品甲' },
        { ...settings, id: 2, title: '实际商品乙' },
      ]}
      onAppliedToProduct={vi.fn()}
      showToast={vi.fn()}
    />
  );
}

it('[B20] 预览标明目标商品并展示将写入的每一项内容', () => {
  const html = markup(1);
  expect(html.match(/实际商品甲/g)).toHaveLength(2);
  for (const text of [
    '新标题',
    'New title',
    '新副标题',
    'New subtitle',
    '新标签',
    '新摘要',
    '新详情',
    '新风险',
    '新问题',
    '新答案',
  ]) {
    expect(html).toContain(text);
  }
});

it('[B20] 当前选择不同商品时隐藏旧的生成结果及应用动作', () => {
  const html = markup(2);
  expect(html).not.toContain('新标题');
  expect(html).not.toContain('一键应用');
});
