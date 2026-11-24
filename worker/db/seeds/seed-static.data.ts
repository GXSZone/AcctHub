/**
 * 演示环境静态配置、分组、分类、公告、帮助文档与支付插件数据
 */

export const DEMO_SITE_SETTINGS: ReadonlyArray<readonly [string, string]> = [
  ['brand_name', 'AcctHub'],
  ['brand_tagline', '温润可靠的前沿 AI 与数字席位台'],
  ['brand_tagline_en', 'Curated AI seats & digital compute concierge'],
  ['hero_title', '精选 AI 算力与数字订阅'],
  ['hero_title_en', 'Curated AI Seats & Digital Access'],
  ['hero_subtitle', '官方直充 · 独立席位 · 聚合 API 算力池 · 边缘自动发卡，面向个人与代理分站'],
  [
    'hero_subtitle_en',
    'Official top-up, dedicated seats, aggregated API pools & reseller storefronts at the edge.',
  ],
  ['support_label', '在线客服'],
  ['support_url', 'https://t.me/accthub_concierge'],
  ['support_note', '每日 09:00–23:30 人工在线，质保期内异常极速换新'],
  ['default_view_mode', 'list'],
  ['show_smart_bar', 'true'],
  [
    'announcement_banner',
    '全新 Claude 4 / GPT-5 / Gemini Pro 官方直充与聚合 API 池已补货，支持代理一键开通独立品牌分站。',
  ],
  ['ticker_mode', 'vertical'],
  ['popup_enabled', 'true'],
  ['popup_title', '欢迎来到 AcctHub · 边缘与补货播报'],
  [
    'popup_content',
    '<div class="acct-callout acct-callout-tip"><p><strong>本周补货：</strong>Claude Pro 官方直充、ChatGPT Plus 独享成品号与多模型聚合 API 池已全面补货，付款后自动秒发凭证。</p></div><ul><li><strong>免登极速体验</strong>：所有商品均支持游客填邮箱直接下单，也可登录演示账号体验余额秒付。</li><li><strong>内置离线 2FA 工具</strong>：顶部导航点击「2FA生成」即可本地解析 6 位动态验证码。</li><li><strong>代理独立分站</strong>：点击「开通代理」即可 10 秒创建带自主加价率的白标分站与 B2B 批采 API。</li></ul>',
  ],
  ['popup_frequency', 'once_per_day'],
  ['popup_version', '1'],
  ['agent_signup_platform_fee_pct', '0'],
  ['neutral_base_domain', ''],
  ['saas_cname_target', ''],
  ['notify_low_stock_threshold', '3'],
  [
    'notify_events_json',
    JSON.stringify(['new_order', 'new_ticket', 'low_stock', 'withdrawal', 'restock', 'upstream_alert']),
  ],
  ['support_media_json', '[]'],
  ['support_links_json', '[]'],
  ['downline_popup_enabled', 'false'],
  ['downline_popup_title', '渠道伙伴专属通知 · 供货与运营播报'],
  [
    'downline_popup_content',
    '<p>欢迎回到渠道工作台！本栏专门用于接收主站面向直属代理商的供货调价、新品上架与运营政策通知。</p>',
  ],
  ['downline_popup_frequency', 'once_per_day'],
  ['downline_popup_version', '1'],
];

export const DEMO_CATEGORY_GROUPS = [
  { slug: 'ai-models', name: '前沿 AI 订阅', nameEn: 'Frontier AI Seats', sortOrder: 1 },
  { slug: 'compute-api', name: '算力与 API 中转', nameEn: 'Compute & API Pool', sortOrder: 2 },
  { slug: 'digital-life', name: '流媒体与数字工具', nameEn: 'Streaming & Digital', sortOrder: 3 },
  { slug: 'enterprise-ops', name: '企业定制与代充', nameEn: 'Enterprise & Top-up', sortOrder: 4 },
  { slug: 'extensions', name: '扩展生态槽位', nameEn: 'Extensions', sortOrder: 5 },
] as const;

export const DEMO_CATEGORIES = [
  {
    groupSlug: 'ai-models',
    slug: 'claude',
    name: 'Claude 专属',
    nameEn: 'Claude Series',
    icon: 'claude',
    badgeText: '热销',
    schemaType: 'ai_subscription',
    sortOrder: 1,
  },
  {
    groupSlug: 'ai-models',
    slug: 'chatgpt',
    name: 'ChatGPT / OpenAI',
    nameEn: 'ChatGPT / OpenAI',
    icon: 'openai',
    badgeText: '频度翻倍',
    schemaType: 'ai_subscription',
    sortOrder: 2,
  },
  {
    groupSlug: 'ai-models',
    slug: 'gemini',
    name: 'Gemini / Google',
    nameEn: 'Gemini / Google',
    icon: 'gemini',
    badgeText: '上新',
    schemaType: 'ai_subscription',
    sortOrder: 3,
  },
  {
    groupSlug: 'ai-models',
    slug: 'coding-ai',
    name: 'Cursor & 编程 AI',
    nameEn: 'Cursor & Coding',
    icon: 'terminal',
    badgeText: '',
    schemaType: 'ai_subscription',
    sortOrder: 4,
  },
  {
    groupSlug: 'ai-models',
    slug: 'creative-ai',
    name: '设计 & 视频 AI',
    nameEn: 'Creative AI',
    icon: 'palette',
    badgeText: '',
    schemaType: 'ai_subscription',
    sortOrder: 5,
  },
  {
    groupSlug: 'compute-api',
    slug: 'api-pool',
    name: '多模型聚合 API 池',
    nameEn: 'Multi-Model API',
    icon: 'cpu',
    badgeText: '0.6x 官方价',
    schemaType: 'api_pool',
    sortOrder: 1,
  },
  {
    groupSlug: 'digital-life',
    slug: 'streaming',
    name: 'Netflix / Spotify 影音',
    nameEn: 'Streaming 4K',
    icon: 'play',
    badgeText: '独立PIN',
    schemaType: 'streaming',
    sortOrder: 1,
  },
  {
    groupSlug: 'digital-life',
    slug: 'digital-tools',
    name: '纯净邮箱 & 海外号',
    nameEn: 'Accounts & Mail',
    icon: 'globe',
    badgeText: '',
    schemaType: 'streaming',
    sortOrder: 2,
  },
  {
    groupSlug: 'enterprise-ops',
    slug: 'enterprise',
    name: '企业 Team 席位与代充',
    nameEn: 'Enterprise Seats',
    icon: 'building',
    badgeText: '可开发票',
    schemaType: 'enterprise',
    sortOrder: 1,
  },
  {
    groupSlug: 'extensions',
    slug: 'extension-lab',
    name: '效率工具 & 扩展槽',
    nameEn: 'Productivity & Ext',
    icon: 'puzzle',
    badgeText: '可扩展',
    schemaType: 'custom_extension',
    sortOrder: 1,
  },
] as const;

export const DEMO_ANNOUNCEMENTS = [
  {
    title: 'Claude Pro 官方直充通道恢复极速补货',
    titleEn: 'Claude Pro Official Top-Up Restocked',
    content:
      '本周美区官方企业卡源已完成扩容，Claude Pro 月卡与 Team 5 人精品车队均支持自动发卡与全程质保，风控率较常规通道显著降低。',
    contentEn:
      'Official US billing pool expanded. Claude Pro top-up and Team pods now deliver automatically with full warranty.',
    level: 'highlight',
    isPinned: 1,
  },
  {
    title: '代理白标分站 & B2B 批发 API 正式开放',
    titleEn: 'Reseller White-Label Storefronts & B2B API Live',
    content:
      '点击顶部「开通代理」即可零成本创建你的独立品牌分站（支持自定义加价率与独立域名绑定），同时获发 B2B 批采 API Key，对接外站/闲鱼自动拉货。',
    contentEn: 'Launch your white-label storefront with custom markup and B2B wholesale API keys in seconds.',
    level: 'info',
    isPinned: 1,
  },
  {
    title: '使用 2FA 动态验证器提醒',
    titleEn: 'Tip: Built-in Offline 2FA Generator',
    content:
      '购买成品账号后如需输入 6 位动态验证码，可直接使用顶部「2FA生成」工具（纯浏览器本地计算，绝不上传任何密钥）。',
    contentEn:
      'Use our built-in browser-local 2FA TOTP generator in the header—secrets never leave your device.',
    level: 'warning',
    isPinned: 0,
  },
] as const;

export const DEMO_HELP_ARTICLES = [
  {
    category: '快速上手',
    title: '如何购买并提取我的账号或 API 密钥？',
    titleEn: 'How do I purchase and retrieve my credentials?',
    content:
      '在首页选择需要的商品进入详情页，选择对应规格（独享/车位/官方直充/API 额度）并填写收货邮箱即可完成下单。支持游客免登购买，付款完成后页面立即展示卡密/密钥；你也可以随时通过顶部「订单查询」输入订单号或邮箱找回历史凭证。',
    contentEn:
      'Pick a product, select a tier, enter your delivery email and complete checkout. Credentials appear instantly and can be retrieved anytime via Order Lookup.',
    sortOrder: 1,
  },
  {
    category: '防风控指南',
    title: '如何正确使用 2FA 动态验证码登录成品号？',
    titleEn: 'How to log in using the built-in 2FA generator?',
    content:
      '部分成品号发货信息中包含类似 `2FA:JBSWY3DPEHPK3PXP` 的密钥字符串。请点击页面顶部「2FA生成」，将该串字符粘贴进输入框，系统会在本地按 RFC 6238 标准实时计算出 6 位动态验证码，并附带 30 秒倒计时，点击即可复制填入登录页。',
    contentEn:
      'Copy the Base32 secret from your delivered card into the 2FA tool in the header to generate live 6-digit TOTP codes locally in your browser.',
    sortOrder: 2,
  },
  {
    category: '代理指南',
    title: '如何开通独立分站或对接 B2B 批发 API？',
    titleEn: 'How to launch a reseller storefront or integrate the B2B API?',
    content:
      '登录账户后进入顶部「开通代理」，填写你的分站标识（如 `myshop`）、品牌名与加价比例即可一键生效。系统将自动分配专属分站二级域名（或由你绑定并授权自己的独立域名）供客户直接访问；也可复制专属 `ah_agent_...` 密钥，调用 `/api/v1/reseller/products` 与 `/api/v1/reseller/order` 实现自动化批发拿货。',
    contentEn:
      'Sign in, open Become Reseller, choose a slug and markup. Share your storefront URL or call /api/v1/reseller/* with your Bearer API key.',
    sortOrder: 3,
  },
  {
    category: '售后与质保',
    title: '质保范围与翻车换新政策说明',
    titleEn: 'Warranty coverage & replacement policy',
    content:
      '所有标注「质保全程」的商品在订阅有效期内如遇非人为违规引起的掉订阅或车队故障，均支持凭借订单号联系客服极速补发新席位或按剩余天数退回站内余额。',
    contentEn:
      'Products marked Full Warranty are replaced rapidly or refunded pro-rata to your wallet balance if subscription issues occur.',
    sortOrder: 4,
  },
] as const;

export const DEMO_PAYMENT_PLUGINS = [
  {
    id: 'demo_instant',
    name: '在线极速收银台（内置演示）',
    description: '零配置开箱即用，真实扣减 D1 库存并即时签发卡密 / API Key',
    enabled: 1,
    configJson: JSON.stringify({ mode: 'instant_sandbox', channels: ['alipay_demo', 'wechat_demo'] }),
  },
  {
    id: 'balance',
    name: '站内钱包余额支付',
    description: '登录用户与代理优先使用账户余额零手续费秒付',
    enabled: 1,
    configJson: JSON.stringify({ min_topup: 10 }),
  },
  {
    id: 'epay',
    name: '易支付通用网关（预留插件）',
    description: '配置商户 ID、网关地址与密钥后即可对接支付宝/微信三方通道',
    enabled: 0,
    configJson: JSON.stringify({ api_url: '', pid: '', key: '' }),
  },
  {
    id: 'stripe',
    name: 'Stripe 全球信用卡 / Apple Pay（预留插件）',
    description: '面向出海客户，支持 Visa/Mastercard 自动 Webhook 回调发货',
    enabled: 0,
    configJson: JSON.stringify({ publishable_key: '', webhook_secret: '' }),
  },
  {
    id: 'usdt_trc20',
    name: 'USDT TRC20 / 链上自动监控（预留插件）',
    description: '支持波场链上收款与 4 位尾数自动放货',
    enabled: 0,
    configJson: JSON.stringify({
      wallet_address: '',
      usdt_cny_rate: '7.25',
      rate_markup: '0.02',
      auto_fx: 'true',
      trongrid_api_key: '',
    }),
  },
  {
    id: 'alipay_f2f',
    name: '支付宝官方当面付（RSA2 扫码）',
    description: '直连支付宝官方预下单生成收款码，纯 Web Crypto RSA2 验签',
    enabled: 0,
    configJson: JSON.stringify({
      app_id: '',
      private_key: '',
      alipay_public_key: '',
      gateway_url: 'https://openapi.alipay.com/gateway.do',
    }),
  },
  {
    id: 'usdt_bep20',
    name: 'USDT BEP20（BSC 币安智能链）',
    description: '低 Gas 费 BSC 链上 4 位尾数防撞单与自动核单',
    enabled: 0,
    configJson: JSON.stringify({
      wallet_address: '',
      usdt_cny_rate: '7.25',
      rate_markup: '0.02',
      auto_fx: 'true',
      explorer_api_key: '',
    }),
  },
  {
    id: 'usdt_erc20',
    name: 'USDT ERC20（以太坊主网）',
    description: '以太坊主网 4 位尾数防撞单与链上自动核单',
    enabled: 0,
    configJson: JSON.stringify({
      wallet_address: '',
      usdt_cny_rate: '7.25',
      rate_markup: '0.02',
      auto_fx: 'true',
      explorer_api_key: '',
    }),
  },
] as const;
