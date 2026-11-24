import { describe, expect, it } from 'vitest';
import { cleanSecret, generateTOTP, parseOtpAuthUri } from './totp';

describe('src/lib/totp', () => {
  it('正确提取含连字符或空格分隔的 Base32 密钥且不提前截断（P2-08 回归验证）', () => {
    expect(cleanSecret('JBSW-Y3DP-EHPK-3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(cleanSecret('secret=JBSW-Y3DP-EHPK-3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(cleanSecret('otpauth://totp/GitHub:user?secret=JBSW-Y3DP-EHPK-3PXP&issuer=GitHub')).toBe(
      'JBSWY3DPEHPK3PXP'
    );
    const parsed = parseOtpAuthUri(
      'otpauth://totp/OpenAI:demo@accthub.io?secret=JBSW-Y3DP-EHPK-3PXP&issuer=OpenAI'
    );
    expect(parsed.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(parsed.issuer).toBe('OpenAI');
    expect(parsed.account).toBe('demo@accthub.io');
  });

  it('防御 period <= 0 或 NaN 导致除零产生 Infinity/NaN（P2-08 回归验证）', async () => {
    const resZero = await generateTOTP('JBSWY3DPEHPK3PXP', 0, 6);
    expect(resZero.code).toMatch(/^\d{6}$/);
    expect(Number.isFinite(resZero.remaining)).toBe(true);
    expect(resZero.remaining).toBeGreaterThanOrEqual(1);
    expect(resZero.remaining).toBeLessThanOrEqual(30);
    expect(Number.isFinite(resZero.progress)).toBe(true);

    const resNeg = await generateTOTP('JBSWY3DPEHPK3PXP', -30, 6);
    expect(resNeg.code).toMatch(/^\d{6}$/);
    expect(Number.isFinite(resNeg.remaining)).toBe(true);

    const resNaN = await generateTOTP('JBSWY3DPEHPK3PXP', Number.NaN, 6);
    expect(resNaN.code).toMatch(/^\d{6}$/);
    expect(Number.isFinite(resNaN.remaining)).toBe(true);
  });
});
