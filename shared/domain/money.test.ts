import { describe, expect, it } from 'vitest';
import {
  addMoney,
  applyMarkup,
  applyPriceRounding,
  calculateMinSafeRetail,
  evaluateRetailMargin,
  fromCents,
  roundCurrency,
  roundUpCurrency,
  subMoney,
  toCents,
} from './money';

describe('shared/domain/money', () => {
  it('处理分转换与十进制加减运算，消除 IEEE-754 浮点漂移', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subMoney(100, 33.33)).toBe(66.67);
  });

  it('防御 -0、NaN、Infinity 与负数取整污染（P2-08 回归验证）', () => {
    expect(Object.is(roundUpCurrency(0), -0)).toBe(false);
    expect(roundUpCurrency(0)).toBe(0);
    expect(roundCurrency(Number.NaN)).toBe(0);
    expect(roundCurrency(Number.POSITIVE_INFINITY)).toBe(0);

    expect(applyPriceRounding(0, 'point9')).toBe(0);
    expect(applyPriceRounding(-5, 'point9')).toBe(0);
    expect(applyPriceRounding(Number.NaN, 'integer')).toBe(0);
  });

  it('准确应用加价率与尾数定价策略', () => {
    expect(applyMarkup(100, 12)).toBe(112);
    expect(applyMarkup(100, -50)).toBe(100);
    expect(applyPriceRounding(18.2, 'integer')).toBe(19);
    expect(applyPriceRounding(18.2, 'point9')).toBe(18.9);
    expect(applyPriceRounding(18.95, 'point9')).toBe(19.9);
  });

  it('严格执行防亏毛利边界计算与非法折扣率防御', () => {
    expect(calculateMinSafeRetail(72, 0.72)).toBe(100);
    expect(calculateMinSafeRetail(50, 0.72)).toBe(69.45);
    expect(calculateMinSafeRetail(50, 0)).toBe(50);

    const bad = evaluateRetailMargin(90, 72, 0.72);
    expect(bad.isLoss).toBe(true);
    expect(bad.lowestAgentPrice).toBe(64.8);
    expect(bad.lossPerUnit).toBe(7.2);
    expect(bad.safeRetailMin).toBe(100);

    const negRetail = evaluateRetailMargin(-10, 50, 0.8);
    expect(negRetail.isLoss).toBe(true);
    expect(negRetail.lossPerUnit).toBe(58);
  });
});
