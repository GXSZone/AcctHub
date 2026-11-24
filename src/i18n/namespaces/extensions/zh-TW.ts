import type { ExtensionsDict } from './zh-CN';

export const extensionsZhTW: ExtensionsDict = {
  currencyAria: '切換顯示幣種',
  currencySettlementHint: '目前為即時參考折算價，結帳統一按人民幣或所選閘道即時匯率結算',

  memberPriceBadge: '會員專享價',
  memberPriceLoginHint: '登入立享會員價 {price}',
  memberPriceActiveHint: '已為您自動套用會員專享價',

  cardSelectTitle: '自選卡密 / 選號下單（選填）',
  cardSelectRandomOpt: '系統隨機自動發卡（免選號費）',
  cardSelectFeeTag: '+{fee} 選號費',
  cardSelectFreeTag: '免費自選',
  cardSelectSingleOnlyHint: '已指定預選卡密，單次固定購買 1 件',

  editorMemberPriceHeading: '遊客價 vs 會員價分離 & 卡密預選選號',
  editorMemberPriceLabel: '登入會員專享價（元，留空則遊客與會員同價）',
  editorAllowCardSelectLabel:
    '允許買家按公開標籤自選卡密（匯入格式：公開標籤||卡密正文 或 公開標籤||加價||卡密正文）',
  editorCardSelectFeeLabel: '預設選號加價（元，0 為免費自選）',

  admin2FaSubTab: '管理員 2FA',
  admin2FaTitle: '管理員登入 2FA 兩步驟驗證保護（TOTP）',
  admin2FaDesc:
    '開啟後，使用管理員信箱密碼登入總控後台時必須額外輸入 6 位動態驗證碼，徹底杜絕撞庫與密碼外洩風險。',
  admin2FaStatusOn: '已開啟兩步驟驗證保護',
  admin2FaStatusOff: '尚未開啟兩步驟驗證（強烈建議立即啟用）',
  admin2FaStartSetupBtn: '產生綁定密鑰與驗證器連結',
  admin2FaSecretLabel: '手動輸入密鑰（Base32）',
  admin2FaOtpUriLabel: '驗證器匯入連結（otpauth://）',
  admin2FaCodeLabel: '輸入驗證器顯示的 6 位動態驗證碼',
  admin2FaEnableBtn: '驗證並正式開啟 2FA',
  admin2FaDisableBtn: '驗證並關閉 2FA',
  admin2FaEnabledToast: '管理員 2FA 兩步驟驗證已開啟，下次登入將自動生效',
  admin2FaDisabledToast: '管理員 2FA 兩步驟驗證已關閉',
  authTotpPromptTitle: '管理員兩步驟驗證（2FA）',
  authTotpPromptDesc: '請輸入您驗證器 App 中的 6 位動態驗證碼完成安全登入。',
  authTotpPlaceholder: '6 位數字驗證碼',

  webhooksSubTab: '出站 Webhook',
  webhooksTitle: '業務出站 Webhook 擴充鉤子與外部 API 開通回填',
  webhooksDesc:
    '在訂單建立、自動發卡交付或退款時向您的外部系統發送 HMAC-SHA256 簽名事件；支援同步回應或回調 /api/webhooks/fulfill-callback 回填開通憑證。',
  webhooksAddTitle: '新增出站 Webhook',
  webhooksNameLabel: '名稱',
  webhooksUrlLabel: '接收位址（HTTPS URL）',
  webhooksSecretLabel: '簽名密鑰（用於 X-AcctHub-Signature 驗簽）',
  webhooksEventsLabel: '訂閱事件',
  webhooksAllowOverrideLabel: '允許該外部服務回應或回調回填訂單交付憑證（外部 API 自動開通）',
  webhooksCreateBtn: '新增 Webhook',
  webhooksTestBtn: '發送測試',
  webhooksDeleteBtn: '刪除',
  webhooksEmpty: '尚未設定任何出站 Webhook。',
  webhooksCreatedToast: '出站 Webhook 已新增',
  webhooksDeletedToast: '出站 Webhook 已刪除',
  webhooksTestOkToast: '測試事件發送成功（HTTP {status}）',
  webhooksTestFailToast: '測試事件發送失敗：{error}',
};
