import { describe, expect, it } from 'vitest';
import { buildWarrantySummaryTemplate, evaluateOrderWarranty, formatWarrantyTypeShort } from './warranty';

describe('shared/domain/warranty', () => {
  it('[B26] 缺少实际交付时间时首登质保未起算', () => {
    expect(evaluateOrderWarranty('', { warranty_type: 'first_login', warranty_days: 2 })).toMatchObject({
      in_warranty: false,
      status: 'not_started',
      expires_at: null,
    });
  });
  it('按自定义小时数格式化 first_login 首登质保文案', () => {
    expect(formatWarrantyTypeShort('first_login', 6)).toBe('首登质保 (6h)');
    expect(buildWarrantySummaryTemplate('first_login', 2)).toBe('首登质保 · 交付 2 小时内首次登录失败包换');
  });

  it('精确计算 first_login 首登质保剩余小时与分钟及到期边界', () => {
    const created = '2026-05-01 10:00:00';
    const createdMs = Date.parse('2026-05-01T10:00:00Z');

    const active = evaluateOrderWarranty(
      created,
      { warranty_type: 'first_login', warranty_days: 2 },
      createdMs + 90 * 60 * 1000
    );
    expect(active.in_warranty).toBe(true);
    expect(active.status).toBe('first_login');
    expect(active.badge_label).toBe('首登质保（余 30 分钟）');

    // 恰好到达过期毫秒（diffMs === 0）应判定为已过质保（P3-01 回归验证）
    const exactBoundary = evaluateOrderWarranty(
      created,
      { warranty_type: 'first_login', warranty_days: 2 },
      createdMs + 2 * 3600 * 1000
    );
    expect(exactBoundary.in_warranty).toBe(false);
    expect(exactBoundary.status).toBe('expired');
  });

  it('准确评估 none 无质保与 full_period 全程质保', () => {
    const created = '2026-05-01 00:00:00';
    const createdMs = Date.parse('2026-05-01T00:00:00Z');

    const none = evaluateOrderWarranty(created, { warranty_type: 'none', warranty_days: 0 }, createdMs);
    expect(none.in_warranty).toBe(false);
    expect(none.status).toBe('none');
    expect(none.warranty_days).toBe(0);

    const full = evaluateOrderWarranty(
      created,
      { warranty_type: 'full_period', warranty_days: 30 },
      createdMs + 10 * 86400 * 1000
    );
    expect(full.in_warranty).toBe(true);
    expect(full.remaining_days).toBe(20);
  });

  it('防御超大质保天数溢出 RangeError 与 0/负数天数文案不一致（P1-09 & P2-08 回归验证）', () => {
    const created = '2026-05-01 00:00:00';
    const createdMs = Date.parse('2026-05-01T00:00:00Z');

    // 超大数值 1e15 不得抛出 RangeError: Invalid time value
    expect(() =>
      evaluateOrderWarranty(created, { warranty_type: 'days', warranty_days: 1e15 }, createdMs)
    ).not.toThrow();
    const huge = evaluateOrderWarranty(created, { warranty_type: 'days', warranty_days: 1e15 }, createdMs);
    expect(huge.warranty_days).toBe(36500);
    expect(huge.expires_at).not.toBeNull();

    // days 类型传入 0 或负数时，实际质保天数与默认文案必须一致回退为 7 天（不能文案写 7 天却按 30 天计算）
    const zeroDays = evaluateOrderWarranty(created, { warranty_type: 'days', warranty_days: 0 }, createdMs);
    expect(zeroDays.warranty_days).toBe(7);
    expect(zeroDays.warranty_summary).toBe(buildWarrantySummaryTemplate('days', 0));
    expect(zeroDays.warranty_summary).toContain('7 天');

    const negDays = evaluateOrderWarranty(created, { warranty_type: 'days', warranty_days: -5 }, createdMs);
    expect(negDays.warranty_days).toBe(7);
  });
});
