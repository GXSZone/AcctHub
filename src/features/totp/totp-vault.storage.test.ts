import { afterEach, expect, it, vi } from 'vitest';
import { loadLocalTotpVault, parseBatchTotpLines, saveLocalTotpVault } from './totp-vault.storage';

afterEach(() => vi.unstubAllGlobals());

it('[B35] 批量解析保留 URI 参数并给普通密钥使用默认值', () => {
  const items = parseBatchTotpLines(
    'otpauth://totp/Fixture:member?secret=JBSWY3DPEHPK3PXP&digits=8&period=60\nONSWG4TFOQ======'
  );
  expect(items).toMatchObject([
    { issuer: 'Fixture', account_name: 'member', digits: 8, period: 60 },
    { secret: 'ONSWG4TFOQ', digits: 6, period: 30 },
  ]);
});

it('[B36] 浏览器拒绝持久化时立即失败并保留已有记录', () => {
  const previous = {
    id: '1',
    issuer: 'Test',
    account_name: 'Test',
    secret: 'JBSWY3DP',
    digits: 6,
    period: 30,
  };
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify([previous]),
    setItem: () => {
      throw new DOMException('Test storage full', 'QuotaExceededError');
    },
  });
  expect(() => saveLocalTotpVault([])).toThrow('Test storage full');
  expect(loadLocalTotpVault()).toEqual([previous]);
});

it('[B36] 本机保险箱拒绝超过 50 条的写入', () => {
  let stored = '[]';
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  const items = Array.from({ length: 51 }, (_, i) => ({
    id: String(i),
    issuer: 'Test',
    account_name: 'Test',
    secret: 'JBSWY3DP',
    digits: 6,
    period: 30,
  }));
  expect(() => saveLocalTotpVault(items)).toThrow();
  expect(loadLocalTotpVault()).toEqual([]);
});
