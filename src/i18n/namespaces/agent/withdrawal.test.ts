import { describe, expect, it } from 'vitest';
import { agentEn } from './en';
import { agentJa } from './ja';
import { agentKo } from './ko';
import { agentZhCN } from './zh-CN';
import { agentZhTW } from './zh-TW';

describe('[B53] 提现文案说明财务手工打款后才显示已打款', () => {
  it.each([
    ['zh-CN', agentZhCN, /待审核/, /手工打款/, /已打款/],
    ['zh-TW', agentZhTW, /待審核/, /手動匯款/, /已打款/],
    ['en', agentEn, /pending review/i, /manual transfer/i, /paid/i],
    ['ja', agentJa, /審査待ち/, /手動で送金/, /送金済み/],
    ['ko', agentKo, /심사 대기/, /수동 송금/, /송금 완료/],
  ])('%s', (_locale, dict, pending, manual, paid) => {
    expect(dict.ovWdSuccessToast).toMatch(pending);
    expect(dict.ovWdHistoryHint).toMatch(manual);
    expect(dict.ovWdHistoryHint).toMatch(paid);
  });
});
