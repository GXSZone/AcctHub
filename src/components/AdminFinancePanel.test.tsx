import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { adminOpsZhCN } from '../i18n/namespaces/admin-ops/zh-CN';
import { AdminFinancePanel } from './AdminFinancePanel';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../queries/admin.queries', () => ({ useAdminFinanceQuery: query }));
vi.mock('../i18n/namespaces/admin-ops', async () => {
  const { adminOpsZhCN } = await import('../i18n/namespaces/admin-ops/zh-CN');
  return { useAdminOpsI18n: () => adminOpsZhCN };
});

const checks = [
  'commission_overflow',
  'refund_reversal',
  'negative_balance',
  'async_payment_sync',
  'promo_ledger_conservation',
  'wallet_ledger_conservation',
  'l1_orphan_deductions',
].map((key) => ({ key, label: key, detail: key, passed: true, count: 0 }));

describe('[B31] 财务巡检状态', () => {
  it.each([
    ['首次取数失败', { isError: true }, true, false],
    ['旧数据刷新失败', { isError: true, data: { integrity_checks: checks } }, true, false],
    ['旧数据刷新中', { isFetching: true, isSuccess: true, data: { integrity_checks: checks } }, false, false],
    ['巡检缺失一项', { isSuccess: true, data: { integrity_checks: checks.slice(1) } }, true, false],
    ['巡检为空', { isSuccess: true, data: { integrity_checks: [] } }, true, false],
    ['本次结果完整', { isSuccess: true, data: { integrity_checks: checks } }, false, true],
  ])('%s', (_scenario, state, hasNotice, passes) => {
    query.mockReturnValue({ ...state });
    const html = renderToStaticMarkup(<AdminFinancePanel showToast={vi.fn()} />);
    expect(html.includes(adminOpsZhCN.finIntegrityPassBadge)).toBe(passes);
    expect(html.includes('role="alert"')).toBe(hasNotice);
  });
});
