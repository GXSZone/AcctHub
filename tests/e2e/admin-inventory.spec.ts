import type { Page } from '@playwright/test';
import { expect, seededSession, test } from './browser-fixture';

async function signInAdmin(page: Page, locale = 'zh-CN') {
  const token = seededSession('admin');
  await page.goto('/');
  await page.evaluate(
    ({ token, locale }) => {
      localStorage.setItem('accthub_token', token);
      localStorage.setItem('accthub_lang', locale);
    },
    { token, locale }
  );
  await page.goto('/admin');
}

test('[S42] 两个工单分别恢复各自的未发送草稿', async ({ page, request }) => {
  const marker = Date.now().toString();
  const token = seededSession('agent');
  const subjects = [`草稿甲-${marker}`, `草稿乙-${marker}`];
  for (const subject of subjects) {
    const ticket = await request.post('/api/account/tickets', {
      headers: { Authorization: `Bearer ${token}` },
      data: { category: 'other', subject, content: '测试工单内容' },
    });
    expect(ticket.ok()).toBe(true);
  }
  await signInAdmin(page);
  await page
    .locator('aside')
    .getByRole('button', { name: /工单中心/ })
    .click();
  const draft = page.getByPlaceholder(/输入平台官方处理回复/);
  await page.getByRole('button', { name: new RegExp(subjects[0]) }).click();
  await draft.fill('甲工单未发送草稿');
  await page.getByRole('button', { name: '返回工单列表' }).click();
  await page.getByRole('button', { name: new RegExp(subjects[1]) }).click();
  await expect(draft).toHaveValue('');
  await draft.fill('乙工单未发送草稿');
  await page.getByRole('button', { name: '返回工单列表' }).click();
  await page.getByRole('button', { name: new RegExp(subjects[0]) }).click();
  await expect(draft).toHaveValue('甲工单未发送草稿');
});

test('[B47] 中英文界面创建货源提交相同的业务过滤默认值', async ({ page }) => {
  const submitted: string[][] = [];
  await page.route('**/api/admin/upstreams', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const { filter_rules } = route.request().postDataJSON() as {
      filter_rules: { exclude_keywords: string[] };
    };
    submitted.push(filter_rules.exclude_keywords);
    await route.fulfill({ status: 200, json: { ok: true, id: 1 } });
  });
  await signInAdmin(page);
  await page
    .locator('aside')
    .getByRole('button', { name: /上游对接/ })
    .click();
  await page.getByRole('button', { name: '新增上游货源', exact: true }).click();
  let drawer = page.locator('dialog[open]');
  await drawer.locator('input').first().fill('中文界面测试货源');
  await drawer.getByRole('button', { name: '仅保存配置' }).click();
  await expect(drawer).toHaveCount(0);
  await signInAdmin(page, 'en');
  await page
    .locator('aside')
    .getByRole('button', { name: /Upstreams/ })
    .click();
  await page.getByRole('button', { name: /add.*source/i }).click();
  drawer = page.locator('dialog[open]');
  await drawer.locator('input').first().fill('English UI fixture source');
  await drawer
    .getByRole('button', { name: /save.*(config|only)/i })
    .first()
    .click();
  await expect(drawer).toHaveCount(0);
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toEqual(submitted[1]);
});

test('[B13] 同步失败后沿用已创建的货源 ID', async ({ page }) => {
  const sourceName = `同步重试-${Date.now()}`;
  const createdIds: number[] = [];
  const syncedIds: number[] = [];
  await page.route('**/api/admin/upstreams', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    if (response.ok()) createdIds.push(((await response.json()) as { id: number }).id);
    await route.fulfill({ response });
  });
  await page.route('**/api/admin/upstreams/*/sync', async (route) => {
    const path = new URL(route.request().url()).pathname;
    syncedIds.push(Number(path.split('/').at(-2)));
    const ok = syncedIds.length > 1;
    await route.fulfill({ status: 200, json: { ok, message: ok ? '同步完成' : '同步暂时失败' } });
  });
  await signInAdmin(page);
  await page
    .locator('aside')
    .getByRole('button', { name: /上游对接/ })
    .click();
  await page.getByRole('button', { name: '新增上游货源', exact: true }).click();
  const drawer = page.locator('dialog[open]');
  await drawer.locator('input').first().fill(sourceName);
  const sync = drawer.getByRole('button', { name: '保存并立即同步', exact: true });
  await sync.click();
  await expect(drawer.getByText('同步暂时失败')).toBeVisible();
  await expect(drawer.getByRole('heading', { name: `配置上游 · ${sourceName}` })).toBeVisible();
  await sync.click();
  await expect(drawer).toHaveCount(0);
  expect(createdIds).toHaveLength(1);
  expect(syncedIds).toEqual([createdIds[0], createdIds[0]]);
});

test('[B43] 切换商品后忽略上一商品迟到的绑定响应', async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${seededSession('admin')}` };
  const overview = await request.get('/api/admin/overview', { headers });
  await expect(overview).toBeOK();
  const { products } = (await overview.json()) as { products: Array<{ id: number; title: string }> };
  expect(products.length).toBeGreaterThanOrEqual(2);
  const [first, second] = products;
  const source = await request.post('/api/admin/upstreams', {
    headers,
    data: { name: '绑定切换测试货源', adapter_type: 'mock_sandbox' },
  });
  await expect(source).toBeOK();
  const { id: sourceId } = (await source.json()) as { id: number };
  const firstItem = `route-first-${sourceId}`;
  const secondItem = `route-second-${sourceId}`;
  for (const [productId, itemId] of [
    [first.id, firstItem],
    [second.id, secondItem],
  ]) {
    await expect(
      await request.post('/api/admin/upstreams/bindings', {
        headers,
        data: { product_id: productId, spec_id: 'default', source_id: sourceId, upstream_item_id: itemId },
      })
    ).toBeOK();
  }

  const firstPath = `/api/admin/upstreams/bindings/list?product_id=${first.id}`;
  let markFirstRequested!: () => void;
  const firstRequested = new Promise<void>((resolve) => {
    markFirstRequested = resolve;
  });
  let releaseFirst!: () => void;
  const releaseFirstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(
    (url) => url.pathname + url.search === firstPath,
    async (route) => {
      const response = await route.fetch();
      markFirstRequested();
      await releaseFirstResponse;
      await route.fulfill({ response });
    }
  );
  await signInAdmin(page);
  await page
    .locator('aside')
    .getByRole('button', { name: /商品与卡密/ })
    .click();
  const edit = (title: string) =>
    page
      .getByRole('row')
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole('button', { name: '编辑', exact: true })
      .click();
  const drawer = page.locator('dialog[open]');
  try {
    await edit(first.title);
    await firstRequested;
    await drawer.getByRole('button', { name: '关闭编辑器', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await edit(second.title);
    await drawer.getByRole('button', { name: /^多规格/ }).click();
    await expect(drawer.getByText(`(${secondItem})`)).toBeVisible();
    const lateResponse = page.waitForResponse((response) => response.url().endsWith(firstPath));
    releaseFirst();
    await (await lateResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await expect(drawer.getByText(`(${secondItem})`)).toBeVisible();
    await expect(drawer.getByText(`(${firstItem})`)).toHaveCount(0);
  } finally {
    releaseFirst();
  }
});
