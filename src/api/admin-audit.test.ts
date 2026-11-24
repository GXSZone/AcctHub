import { afterEach, expect, it, vi } from 'vitest';
import { adminApi } from './admin.api';

afterEach(() => vi.unstubAllGlobals());

it('[B12] 审计列表和 CSV 请求应用相同的目标类型、关键词、动作和日期筛选', async () => {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (path: string) => {
    seen.push(path);
    return Response.json({ logs: [] });
  });
  const filter = { target_type: 'orders', action: 'update', q: 'AH-1', days: 7 };
  await adminApi.auditLogs(filter);
  await adminApi.downloadAuditLogsCsv(filter);
  expect(seen).toEqual([
    '/api/admin/audit-logs?action=update&target_type=orders&q=AH-1&days=7',
    '/api/admin/audit-logs/csv?action=update&target_type=orders&q=AH-1&days=7',
  ]);
});
