import { describe, expect, it } from 'vitest';
import { evaluateBulkTierPricing, normalizeTierPricingRules, resolveEffectiveUnitPrice } from './pricing';

describe('shared/domain/pricing 阶梯批发价纯领域计算', () => {
  it('规范化阶梯规则：过滤非法值、同件数保留最优折扣并升序排序', () => {
    const normalized = normalizeTierPricingRules([
      { min_qty: 10, discount_rate: 0.8 },
      { min_qty: 1, discount_rate: 0.95 }, // < 2 无效
      { min_qty: 5, discount_rate: 0.9 },
      { min_qty: 5, discount_rate: 0.88 }, // 同件数取更优
      { min_qty: 20, discount_rate: 1.0 }, // >= 1 无效
      { min_qty: 30, discount_rate: 0.05 }, // < 0.1 无效
    ]);
    expect(normalized).toEqual([
      { min_qty: 5, discount_rate: 0.88 },
      { min_qty: 10, discount_rate: 0.8 },
    ]);
  });

  it('普通买家命中阶梯批发并给出下一档凑单提醒', () => {
    const tiers = [
      { min_qty: 5, discount_rate: 0.9 },
      { min_qty: 10, discount_rate: 0.8 },
    ];
    const r1 = evaluateBulkTierPricing({ baseUnitPrice: 100, quantity: 3, tiers });
    expect(r1.appliedTier).toBeNull();
    expect(r1.tierUnitPrice).toBe(100);
    expect(r1.nextTier).toEqual({
      min_qty: 5,
      discount_rate: 0.9,
      remaining_qty: 2,
      projected_unit_price: 90,
    });

    const r2 = evaluateBulkTierPricing({ baseUnitPrice: 100, quantity: 5, tiers });
    expect(r2.appliedTier).toEqual({ min_qty: 5, discount_rate: 0.9 });
    expect(r2.tierUnitPrice).toBe(90);
    expect(r2.nextTier?.remaining_qty).toBe(5);
  });

  it('受成本价底线保护时自动钳位，严防批发跌破进货成本', () => {
    const r = evaluateBulkTierPricing({
      baseUnitPrice: 100,
      quantity: 10,
      tiers: [{ min_qty: 10, discount_rate: 0.6 }],
      costPrice: 75,
    });
    expect(r.tierUnitPrice).toBe(75);
    expect(r.costClamped).toBe(true);
  });

  it('认证代理在「代理折扣」与「阶梯折扣」之间取更优但不叠加折上折', () => {
    const tiers = [
      { min_qty: 5, discount_rate: 0.9 },
      { min_qty: 10, discount_rate: 0.75 },
    ];
    // 代理 85 折 vs 5 件 9 折 => 选代理 85 折（¥85），不叠成 76.5
    const rAgentWins = resolveEffectiveUnitPrice({
      retailUnitPrice: 100,
      quantity: 5,
      tiers,
      agentDiscountRate: 0.85,
    });
    expect(rAgentWins.unitPrice).toBe(85);
    expect(rAgentWins.appliedMode).toBe('agent_tier');

    // 代理 85 折 vs 10 件 75 折 => 选阶梯 75 折（¥75），仍不叠加
    const rBulkWins = resolveEffectiveUnitPrice({
      retailUnitPrice: 100,
      quantity: 10,
      tiers,
      agentDiscountRate: 0.85,
    });
    expect(rBulkWins.unitPrice).toBe(75);
    expect(rBulkWins.appliedMode).toBe('bulk_tier');
    expect(rBulkWins.appliedBulkTier).toEqual({ min_qty: 10, discount_rate: 0.75 });
  });
});
