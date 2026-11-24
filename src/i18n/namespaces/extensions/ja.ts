import type { ExtensionsDict } from './zh-CN';

export const extensionsJa: ExtensionsDict = {
  currencyAria: '表示通貨を切り替え',
  currencySettlementHint: '参考換算価格です。決済は人民元または決済ゲートウェイの実勢レートで行われます。',

  memberPriceBadge: '会員限定価格',
  memberPriceLoginHint: 'ログインで会員価格 {price}',
  memberPriceActiveHint: '会員限定価格が自動適用されました',

  cardSelectTitle: 'ラベル指定で在庫を選択（任意）',
  cardSelectRandomOpt: 'システム自動割り当て（手数料無料）',
  cardSelectFeeTag: '+{fee} 指名料',
  cardSelectFreeTag: '無料選択',
  cardSelectSingleOnlyHint: '個別指定時は購入数量が 1 点に固定されます。',

  editorMemberPriceHeading: 'ゲスト/会員価格分離 & 在庫ラベル選択',
  editorMemberPriceLabel: 'ログイン会員限定価格（CNY・空欄で通常と同額）',
  editorAllowCardSelectLabel:
    '公開ラベルによる個別選択を許可（形式：ラベル||カード または ラベル||追加料||カード）',
  editorCardSelectFeeLabel: 'デフォルト選択追加料（CNY・0 で無料）',

  admin2FaSubTab: '管理者 2FA',
  admin2FaTitle: '管理者ログイン 2FA 二段階認証（TOTP）',
  admin2FaDesc: '有効化すると管理者ログイン時にパスワードに加えて 6 桁の認証アプリコードが必須になります。',
  admin2FaStatusOn: '二段階認証は有効です',
  admin2FaStatusOff: '未設定（有効化を強く推奨）',
  admin2FaStartSetupBtn: 'TOTP シークレットと設定 URI を生成',
  admin2FaSecretLabel: '手動入力キー（Base32）',
  admin2FaOtpUriLabel: '認証アプリ用 URI（otpauth://）',
  admin2FaCodeLabel: '認証アプリの 6 桁コードを入力',
  admin2FaEnableBtn: '検証して 2FA を有効化',
  admin2FaDisableBtn: '検証して 2FA を無効化',
  admin2FaEnabledToast: '管理者 2FA を有効化しました',
  admin2FaDisabledToast: '管理者 2FA を無効化しました',
  authTotpPromptTitle: '管理者二段階認証（2FA）',
  authTotpPromptDesc: '認証アプリに表示された 6 桁のコードを入力してログインを完了してください。',
  authTotpPlaceholder: '6 桁の認証コード',

  webhooksSubTab: 'Webhook',
  webhooksTitle: '業務アウトバウンド Webhook と外部 API 自動納品',
  webhooksDesc:
    '注文作成・納品・返金時に HMAC-SHA256 署名付きイベントを外部へ通知し、/api/webhooks/fulfill-callback での納品書き戻しに対応します。',
  webhooksAddTitle: 'Webhook を追加',
  webhooksNameLabel: '名称',
  webhooksUrlLabel: '送信先 URL（HTTPS）',
  webhooksSecretLabel: '署名シークレット（X-AcctHub-Signature）',
  webhooksEventsLabel: '購読イベント',
  webhooksAllowOverrideLabel: '外部システムからの応答/コールバックによる納品書き戻しを許可',
  webhooksCreateBtn: 'Webhook を追加',
  webhooksTestBtn: 'テスト送信',
  webhooksDeleteBtn: '削除',
  webhooksEmpty: '設定されたアウトバウンド Webhook はありません。',
  webhooksCreatedToast: 'Webhook を追加しました',
  webhooksDeletedToast: 'Webhook を削除しました',
  webhooksTestOkToast: 'テスト送信成功（HTTP {status}）',
  webhooksTestFailToast: 'テスト送信失敗：{error}',
};
