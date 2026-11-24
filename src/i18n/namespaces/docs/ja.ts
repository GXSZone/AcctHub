import type { DocsDict } from './zh-CN';

/**
 * 开放平台 API 文档域 —— 日本語
 */

export const docsJa: DocsDict = {
  sidebarTitle: 'API リファレンス',
  sidebarAllOverview: 'すべてのエンドポイント',
  statusCodesTitle: '標準 HTTP ステータスコード',
  status200: '成功（JSON レスポンス）',
  status400: 'パラメータ不足または検証エラー',
  status401: 'API キー / JWT が無効または期限切れ',
  status402: 'ウォレット残高不足',
  status403: '権限不足または Turnstile 検証失敗',
  status409: '在庫不足または Slug 重複',
  status429: 'レート制限到達（Retry-After 準拠）',

  pageTitle: 'AcctHub オープンプラットフォーム & B2B 卸売 API',
  pageSubtitlePrefix:
    'Cloudflare Workers エッジノード上で稼働する RESTful JSON API。代理店のリアルタイム卸価格・在庫同期、残高即時決済、マルチストア設定、CMS 運用管理に対応。リポジトリ直下のオフライン仕様：',
  pageSubtitleSuffix: '。',
  authCardTitle: '3種類の認証方式',
  authCardDescPart1: 'B2B 卸発注は ',
  authCardDescPart2: '、会員操作はログイン JWT、公開書き込みエンドポイントは ',
  authCardDescPart3: ' に対応。',
  tenantCardTitle: 'エッジ・マルチテナント',
  tenantCardDescPart1: 'クエリ ',
  tenantCardDescPart2: ' またはヘッダー ',
  tenantCardDescPart3: ' 指定で代理店ごとの販売上乗せ価格を返却。',
  sandboxTitlePrefix: 'API サンドボックスデバッグ設定（',
  sandboxModeAuthed: '認定代理店・管理者 · 実リクエスト対応（3秒クールダウン）',
  sandboxModeGuest: 'ゲストモード · ローカル静的モックのみ（バックエンド非課金）',
  sandboxTitleSuffix: '）',
  sandboxCcNotice:
    'CC 攻撃保護が有効です：ゲスト時はブラウザ内の静的モックを返却し D1 へ問い合わせません。認定代理店アカウントでログインするとご自身の API キーで実通信テストが可能です。',
  apiKeyLabel: '連携用 API キー（ログイン時に自動入力・公開キーの事前設定なし）',
  apiKeyPlaceholder: '認定代理店でログインするか ah_agent_... キーを入力',
  tenantSlugLabel: '任意ストア Slug（スニペット生成用）',
  tenantSlugPlaceholder: '空欄でメインストア基準（例：my-shop）',
  errGuestMockNote:
    '現在はゲスト静的モックモードのため実サーバーへ送信されていません。認定代理店アカウントでログインすると実リクエストが可能です。',
  errWriteProtectedNote:
    '注文作成・ログイン・DB 書き込み系エンドポイントのため、誤課金防止として静的サンプルを返却しました。左記コードをコピーしてローカル環境から実行してください。',
  errMissingKey: '実リクエストを実行する前に、上部に専用の API キー（ah_agent_...）を入力してください',

  authResellerKey: '連携 API キー',
  authUserJwt: '会員 JWT',
  authAdminJwt: '管理者認証',
  authNone: '認証不要（公開）',
  btnCooldown: 'クールダウン ({sec}秒)',
  btnRunLive: 'オンライン実テスト',
  btnRunSandbox: 'サンドボックス試走',
  paramsTitle: 'リクエストパラメータ',
  thName: 'パラメータ名',
  thIn: '位置',
  thType: '型',
  thRequired: '必須',
  thDesc: '説明',
  yes: 'はい',
  no: 'いいえ',
  reqExampleTitle: 'リクエスト例 ({lang})',
  copied: 'コピー済み',
  copyCode: 'コードをコピー',
  respTitleMock: 'ローカル静的モック応答（未通信）',
  respTitleLive: '実エンドポイント応答',
  respTitleSample: '標準レスポンス例 (200 OK)',
  rateRemainingPrefix: '残クォータ ',

  grpResellerLabel: 'B2B 卸発注・リアルタイム価格 API',
  grpResellerBadge: '推奨コア',
  grpStorefrontLabel: 'ストアカタログ・マルチテナント API',
  grpStorefrontBadge: '公開',
  grpOrdersLabel: '注文決済・納品照会 API',
  grpOrdersBadge: '取引',
  grpAuthLabel: '認証・代理店ポータル API',
  grpAuthBadge: '認証',
  grpAdminLabel: '運用コンソール CMS API',
  grpAdminBadge: '管理者',

  epResellerBalTitle: '代理店残高と報酬ステータス照会',
  epResellerBalSum:
    'B2B API キー認証で現在の仕入れ残高・デフォルト報酬率・累計収益を返却します。自動発注前の残高確認に推奨されます。',
  epResellerBalP1: '固定形式：Bearer ah_agent_...',
  epResellerProdTitle: '全商品の最新価格表・卸在庫を取得',
  epResellerProdSum:
    '全販売商品の標準小売価格、代理店割引後卸価格（wholesale_price）、SKU 内訳とリアルタイム在庫を一括返却します。',
  epResellerProdP1: 'Bearer ah_agent_...',
  epResellerOrderTitle: 'B2B 仕入れ注文と納品',
  epResellerOrderSum:
    'delivered は納品済みです。upstream_pending は引き落とし済みで cards が空のため、元の注文を照会してください。',
  epResellerOrderP6: '同じ発注に使う冪等キー。最大 64 文字',
  epResellerOrderStatusTitle: '仕入れ注文の状態を照会',
  epResellerOrderStatusSum:
    '同じ代理店キーで元の注文番号か冪等キーを指定します。照会では新規注文は作成されません。',
  epResellerOrderP1: 'Bearer ah_agent_...',
  epResellerOrderP2: '商品 ID（/products より取得）',
  epResellerOrderP3: '仕様 ID（省略時は先頭仕様）',
  epResellerOrderP4: '発注数量（1–20、既定 1）',
  epResellerOrderP5: '照合用の下流注文番号または顧客メールアドレス',
  epResellerCompatTitle: '汎用販売システム互換フラットカタログ API',
  epResellerCompatSum:
    '外部発券ボット・汎用ショップシステム向けのフラット商品・在庫同期エンドポイントです。代理店ランク別の仕入れ値と残数を出力します。',
  epResellerCompatP1: 'Bearer ah_agent_...（X-API-Key ヘッダーにも対応）',

  epSfBootTitle: 'ストア初期設定・マルチテナントコンテキスト取得',
  epSfBootSum:
    '接続ホスト名 `Host` または `?tenant=<slug>` / `X-Tenant-Slug` を自動判別し、ブランド設定・カテゴリツリー・在庫件数・お知らせ・有効決済手段を返却します。',
  epSfBootP1: '代理店サブストア Slug（例：studio）指定で独自ブランド・上乗せ価格を適用',
  epSfBootP2: '?tenant クエリと同等（SPA リクエスト向け）',
  epSfProdTitle: '商品カタログ・リアルタイム在庫一覧',
  epSfProdSum:
    'カテゴリ Slug（`featured` / `all` / 任意カテゴリ）、キーワード、タグによる絞り込みに対応し、販売価格はテナント設定を自動反映します。',
  epSfProdP1: 'カテゴリ Slug（既定 featured、all で全件）',
  epSfProdP2: 'タイトル・特徴・タグの部分一致検索キーワード',
  epSfProdP3: 'タグによる完全一致フィルター',
  epSfDetailTitle: '単一商品フル詳細取得（/item/:id）',
  epSfDetailSum:
    'Markdown 詳細、注意事項、仕様別在庫（`spec_stock`）、共有シート占有状況、カスタム入力項目、FAQ を返却します。',
  epSfDetailP1: '商品 ID（例：1）または Slug',
  epSfConciergeTitle: 'Claude 自然言語プラン提案マッチ',
  epSfConciergeSum:
    '自然言語の要望を解析して在庫から最適なプラン構成をスコアリングし、推奨理由とともに返却します。',
  epSfConciergeP1: 'ユーザーの自然言語要件テキスト',

  epOrdCreateTitle: '一般 / サブストア注文作成と即時納品',
  epOrdCreateSum:
    'ゲスト購入・会員残高決済に対応。カード在庫引き当て、API キー発行、共有席割り当て、代理店マージン精算を自動実行します。',
  epOrdCreateP1: '商品 ID',
  epOrdCreateP2: '仕様 ID',
  epOrdCreateP3: '購入数量（1–20）',
  epOrdCreateP4: '納品・照会用メールアドレス',
  epOrdCreateP5: 'balance | 有効化された決済プラグイン ID',
  epOrdCreateP6: 'カスタム入力フィールド値（対象メールアドレス等）',
  epOrdLookupTitle: '注文照会・納品認証情報取得',
  epOrdLookupSum:
    'ゲストは照会番号で注文を確認できます。ログイン後 `q` を省略すると、このサイトの自分の注文を 1 ページ最大 50 件ずつ取得できます。',
  epOrdLookupP1: '購入時に受け取った照会番号（AHQ-…）',
  epOrdLookupPassword: '照会パスワードを設定した場合に入力',
  epOrdLookupCursor: '前のページの next_cursor。最初のページでは省略します。',
  epOrdLookupTurnstile: '認証が有効な場合、ゲストは order_lookup のトークンを送信します。',

  epAuthLoginTitle: 'メール・パスワードログイン (HMAC JWT)',
  epAuthLoginSum:
    '14日間有効な HS256 トークンとユーザー情報・代理店コンテキストを返却します。Turnstile 有効環境ではトークンを付与してください。',
  epAuthLoginP1: '登録メールアドレス',
  epAuthLoginP2: 'パスワード',
  epAuthLoginP3: 'Cloudflare Turnstile 検証トークン（本番環境で有効時に必須）',
  epAgentApplyTitle: '有効な代理店ストアの更新',
  epAgentApplySum:
    'ログインした会員は POST /api/agent/recharge で代理店ランクを有効にし、GET /api/agent/me で状態を確認できます。有効な代理店は PUT /api/agent/brand で店舗の識別子、ブランド、ドメイン、上乗せ率を更新します。POST /api/agent/apply も同じ更新を行います。POST /api/agent/rotate-key にも有効な代理店資格が必要です。',
  epAgentApplyP1: '有効な代理店の JWT：Bearer <jwt>',
  epAgentApplyP2: '3〜24文字の小文字英数字・ハイフン',
  epAgentApplyP3: '独自ストアブランド名',
  epAgentApplyP4: '標準価格への上乗せ率（0–200%）',
  epAgentApplyP5: 'Cloudflare for SaaS 独自ドメイン',

  epAdminOverviewTitle: '管理コンソール全体データ & CMS API 群',
  epAdminOverviewSum:
    '管理者ログインで発行された有効な JWT が必要です。設定・カテゴリ・商品・在庫カード・お知らせ・代理店・決済設定などの全管理操作を含みます。',
  epAdminOverviewP1: '最高管理者 JWT：Bearer <YOUR_SUPER_ADMIN_JWT>',

  demoBrandName: 'Stardust AI セレクト',
  demoProdTitle: 'Claude Pro 公式直チャージ · 月額プラン',
  demoProdShort: 'Claude Pro 公式直チャージ · 月額',
  demoSpec1: '公式直チャージ · 1ヶ月（ご自身のアカウント）',
  demoSpec2: '専用アカウント納品 · 1ヶ月',
  demoCardSample: 'CLAUDE-TOPUP-VOUCHER-11X9-A8F2 (有効化手順参照)',
  demoGroupName: '最先端 AI サブスク',
  demoStockLabel: '在庫十分',
  demoConciergePrompt: '開発で Claude と Cursor、休日に 4K Netflix を使いたい',
  demoConciergeReason: 'ご要望に合致する最適プランを4件厳選しました...',
  demoAgentBrand: 'Aurora AI ショップ',
};
