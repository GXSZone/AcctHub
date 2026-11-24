/**
 * 演示商品种子数据（前 5 款 AI 核心订阅商品）
 */

export interface DemoProductSeed {
  categorySlug: string;
  slug: string;
  title: string;
  titleEn: string;
  subtitle: string;
  subtitleEn: string;
  iconKey: string;
  accentColor: string;
  deliveryType: string;
  tags: string[];
  basePrice: number;
  originalPrice: number | null;
  wholesaleDiscount: number;
  stockMode: string;
  manualStock: number;
  seatTotal: number;
  seatUsed: number;
  warrantyType: string;
  warrantyDays: number;
  warrantySummary: string;
  isFeatured: number;
  sortOrder: number;
  salesCount: number;
  riskNotice: string;
  summaryMarkdown: string;
  detailMarkdown: string;
  faq: Array<{ q: string; a: string }>;
  customFields: Array<{
    key: string;
    label: string;
    label_en?: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
  }>;
  specs: Array<{
    id: string;
    name: string;
    name_en?: string;
    price: number;
    original_price?: number;
    badge?: string;
    description?: string;
    seat_slots?: number;
    api_credit_usd?: number;
  }>;
}

export const DEMO_PRODUCTS_PART_A: DemoProductSeed[] = [
  {
    categorySlug: 'claude',
    slug: 'claude-pro-official-topup',
    title: 'Claude Pro 官方直充 · 月卡（低风控优选方案）',
    titleEn: 'Claude Pro Official Top-Up · Monthly',
    subtitle: '支持自备老号安全代充或成品独享号直登，内置完整防风控指引与 2FA 辅助',
    subtitleEn: 'Safe official billing on your account or clean dedicated ready-to-use account.',
    iconKey: 'claude',
    accentColor: '#D97757',
    deliveryType: 'auto',
    tags: ['官方充值', '自动发货', '推荐', '低风控'],
    basePrice: 140,
    originalPrice: 168,
    wholesaleDiscount: 0.85,
    stockMode: 'cards',
    manualStock: 42,
    seatTotal: 0,
    seatUsed: 0,
    warrantyType: 'full_period',
    warrantyDays: 30,
    warrantySummary: '30 天全周期质保 · 非人为封号或掉订阅按质保规则换新/补发',
    isFeatured: 1,
    sortOrder: 1,
    salesCount: 846,
    riskNotice:
      'Claude 对节点纯净度敏感：请勿使用万人机场免费节点或频繁跨洲切换 IP；建议固定美/日住宅或静态原生节点，首次登录后建议开启本平台顶部内置的 2FA 校验工具绑定保护。',
    summaryMarkdown:
      '正规美区企业卡源官方直充，支持 Claude Sonnet / Opus 全系列最新模型与 Projects、Artifacts 完整功能。',
    detailMarkdown: `### 核心权益说明
- **全量官方功能**：解锁 Claude 最新旗舰模型、超长上下文、Projects 知识库与 Artifacts 实时预览。
- **双交付模式可选**：可选择「自备邮箱代充券（自动发卡兑换码）」或「全新独立成品号（含原始邮箱密保）」。
- **全程透明质保**：因官方支付渠道引起的订阅异常，质保期内按剩余天数无条件补发或退款。

### 使用与防风控建议
1. 登录前请先关闭浏览器中冲突的代理插件，推荐使用纯净无痕窗口或独立 Chrome Profile。
2. 尽量保持固定的登录区域（推荐 US / JP / SG 原生线路），避免 10 分钟内多国跳跃。
3. 拿到成品号后，请先登录原邮箱验证状态，切勿第一天连续高并发触发反滥用阈值。`,
    faq: [
      {
        q: '自备号代充需要提供密码吗？',
        a: '无需提供账号密码，我们采用官方礼品/代充链接或一次性登录验证方式完成，安全可控。',
      },
      {
        q: '封号如何售后？',
        a: '官方直充卡源本身零黑卡风险；如遇非违规操作导致的订阅退款/掉订阅，提供订单号找客服秒处理。',
      },
      { q: '代理可以批采吗？', a: '支持！开通代理后可按 8.5 折自动批发拿货，或在你的独立分站加价零售。' },
    ],
    customFields: [
      {
        key: 'target_email',
        label: '接收/代充目标邮箱（成品号可留空）',
        label_en: 'Target Claude Email (optional for ready account)',
        placeholder: 'name@example.com',
        required: false,
        type: 'email',
      },
    ],
    specs: [
      {
        id: 'official_topup',
        name: '官方直充 · 1个月（自备号）',
        name_en: 'Official Top-up · 1 Mo',
        price: 140,
        original_price: 168,
        badge: '低风控推荐',
        description: '最稳方案，直接充值到你自己的 Claude 账号',
      },
      {
        id: 'ready_account',
        name: '成品独享账号 · 1个月（含原邮）',
        name_en: 'Dedicated Ready Account · 1 Mo',
        price: 165,
        original_price: 199,
        badge: '即买即用',
        description: '自动发货：邮箱 + 密码 + 2FA 恢复指引',
      },
      {
        id: 'max_5x_seat',
        name: 'Claude Max 5x 独享重度版 · 1个月',
        name_en: 'Claude Max 5x · 1 Mo',
        price: 680,
        original_price: 760,
        badge: '开发者旗舰',
        description: '5 倍官方额度，适配 Claude Code 与重度推理',
      },
    ],
  },
  {
    categorySlug: 'claude',
    slug: 'claude-team-seat-matrix',
    title: 'Claude Team 独立席位拼车 · 5人精品车队',
    titleEn: 'Claude Team Dedicated Seat (5-Seat Pod)',
    subtitle: '独立邮箱隔离对话记录，互不可见，直观查看当前车队空位按席位入座',
    subtitleEn: 'Private isolated workspace seat in a curated 5-member Team pod.',
    iconKey: 'claude',
    accentColor: '#C86647',
    deliveryType: 'auto',
    tags: ['独立席位', '质保全程', '自动发货'],
    basePrice: 78,
    originalPrice: 110,
    wholesaleDiscount: 0.8,
    stockMode: 'seats',
    manualStock: 12,
    seatTotal: 5,
    seatUsed: 3,
    warrantyType: 'full_period',
    warrantyDays: 30,
    warrantySummary: '30 天全周期质保 · 翻车或掉席位免费换车补发',
    isFeatured: 1,
    sortOrder: 2,
    salesCount: 512,
    riskNotice:
      'Team 车位彼此历史会话完全隔离，支持用你自己的邮箱接收官方 Team 邀请函。请勿在车内共享账号密码给多人登录。',
    summaryMarkdown: '高性价比体验官方 Claude Team 更高消息额度与更稳企业级通道。',
    detailMarkdown: `### 为什么选择 Team 独立席位？
- **隐私完全隔离**：每个席位使用独立邮箱加入工作区，其他成员无法看到你的对话和上传文件。
- **更高频率上限**：相比个人 Pro，Team 席位在高峰期的速率限制更宽松。
- **翻车包赔**：车队由 AcctHub 官方企业卡按月续费维护，掉车按天折算秒补新席位。`,
    faq: [
      {
        q: '别人能看到我的聊天记录吗？',
        a: '绝对不能。Team 工作区中个人对话默认完全私有，除非你主动点击 Share 发布到团队空间。',
      },
      {
        q: '到期可以原号续费保留记录吗？',
        a: '可以！到期前在订单页点击续费或下单同一车队席位即可无缝延续。',
      },
    ],
    customFields: [
      {
        key: 'invite_email',
        label: '接收官方 Team 邀请的邮箱',
        label_en: 'Email for Team Invite',
        placeholder: 'yourname@gmail.com',
        required: true,
        type: 'email',
      },
    ],
    specs: [
      {
        id: 'seat_1m',
        name: '1 个独立席位 · 月付',
        name_en: '1 Seat · Monthly',
        price: 78,
        original_price: 110,
        badge: '剩余 2 席',
        seat_slots: 1,
      },
      {
        id: 'seat_3m',
        name: '1 个独立席位 · 季付特惠',
        name_en: '1 Seat · Quarterly',
        price: 215,
        original_price: 330,
        badge: '省 ¥19',
        seat_slots: 1,
      },
    ],
  },
  {
    categorySlug: 'chatgpt',
    slug: 'chatgpt-plus-dedicated',
    title: 'ChatGPT Plus 独享成品账号（质保全程订阅与防掉）',
    titleEn: 'ChatGPT Plus Dedicated Account (Full Warranty)',
    subtitle: '独立美区原邮成品，解锁 GPT-5 / o3 / Sora / 语音与深度研究，拍下秒发',
    subtitleEn: 'Clean US dedicated account with full GPT-5, o3, voice & deep research access.',
    iconKey: 'openai',
    accentColor: '#2D6A57',
    deliveryType: 'auto',
    tags: ['成品账号', '自动发货', '质保全程', '推荐'],
    basePrice: 55.8,
    originalPrice: 145,
    wholesaleDiscount: 0.78,
    stockMode: 'cards',
    manualStock: 180,
    seatTotal: 0,
    seatUsed: 0,
    warrantyType: 'full_period',
    warrantyDays: 30,
    warrantySummary: '30 天全周期质保 · 非人为封号或掉订阅按质保规则换新/补发',
    isFeatured: 1,
    sortOrder: 1,
    salesCount: 2340,
    riskNotice:
      '成品账号发货格式为「账号----密码----2FA密钥/辅助邮箱」，可使用顶部【2FA生成】工具获取一次性登录动态码。',
    summaryMarkdown: '全站销量冠军，独立一人一号，不拼车不串号，支持改密与全程质保。',
    detailMarkdown: `### 商品包含权益
- **一人一号绝对独享**：交付后归你个人使用，可自行修改密码并绑定 2FA。
- **全模型解锁**：畅享 GPT-5、深度推理、代码解释器、画图、实时语音与 Deep Research。
- **自动发卡秒交付**：付款完成即刻在页面展示卡密，并同步记录到你的订单凭证库。`,
    faq: [
      {
        q: '登录后提示需要 6 位验证码怎么办？',
        a: '复制发货信息里的 2FA Secret Key，点击本站顶部导航的【2FA生成】粘贴即可实时拿到 6 位动态验证码。',
      },
      { q: '支持开 Team 5 席吗？', a: '支持，可在下方规格栏直接切换 ChatGPT Team 独立席位或整车。' },
    ],
    customFields: [],
    specs: [
      {
        id: 'plus_1m',
        name: 'Plus 独享成品号 · 1个月',
        name_en: 'Plus Dedicated · 1 Mo',
        price: 55.8,
        original_price: 145,
        badge: '爆款现货',
      },
      {
        id: 'plus_topup',
        name: 'Plus 官方正规代充 · 1个月',
        name_en: 'Plus Official Top-up · 1 Mo',
        price: 138,
        original_price: 158,
        badge: '自备号保数据',
      },
      {
        id: 'pro_5x_100',
        name: 'ChatGPT 官方 $100 余额充值',
        name_en: 'Official $100 Credit Top-up',
        price: 645,
        original_price: 730,
        badge: '大额优选',
      },
    ],
  },
  {
    categorySlug: 'gemini',
    slug: 'gemini-pro-us-account',
    title: 'Gemini Advanced Pro 1个月美区成品号（含 2TB 空间）',
    titleEn: 'Gemini Advanced Pro · US Ready Account (2TB)',
    subtitle: '100% 原生美区可用最新 Gemini 旗舰模型、Veo 视频生成与 Google One 2TB 云盘',
    subtitleEn: 'Verified US account with latest Gemini Pro models, Veo video & 2TB Google One.',
    iconKey: 'gemini',
    accentColor: '#3B6CB7',
    deliveryType: 'auto',
    tags: ['官方充值', '成品账号', '质保全程', '自动发货'],
    basePrice: 38.9,
    originalPrice: 142,
    wholesaleDiscount: 0.75,
    stockMode: 'cards',
    manualStock: 64,
    seatTotal: 0,
    seatUsed: 0,
    warrantyType: 'full_period',
    warrantyDays: 30,
    warrantySummary: '30 天全周期质保 · 非人为封号或掉订阅按质保规则换新/补发',
    isFeatured: 1,
    sortOrder: 1,
    salesCount: 1128,
    riskNotice: '首次登录 Google 账号请优先使用美国 IP 节点，避免使用香港/俄罗斯等未开放区域。',
    summaryMarkdown: '自带 2TB Google One 存储与 NotebookLM Plus，学术科研与多模态首选。',
    detailMarkdown: `### 为什么选美区原生号？
- **功能零阉割**：支持 Gemini 最新推理模型、Deep Research、NotebookLM Plus 与 Workspace 集成。
- **额外福利**：附带 2TB Google Drive / Photos 空间，支持随时导出备份。
- **可选 3 个月活动代开**：低门槛尝鲜，性价比拉满。`,
    faq: [
      {
        q: '可以在 Google AI Studio 里使用吗？',
        a: '可以，美区原生 Google 账号可直接使用 AI Studio 及 Gemini Web 端。',
      },
    ],
    customFields: [],
    specs: [
      {
        id: 'gem_1m',
        name: 'Gemini Pro 成品号 · 1个月（全程质保）',
        name_en: 'Gemini Pro Ready · 1 Mo',
        price: 38.9,
        original_price: 142,
        badge: '全网热推',
      },
      {
        id: 'gem_3m_promo',
        name: 'Gemini 活动代开 · 3个月体验版',
        name_en: 'Gemini Promo · 3 Mo',
        price: 18.8,
        original_price: 68,
        badge: '高性价比',
      },
      {
        id: 'gem_ultra',
        name: 'Gemini Ultra 顶配号 · 1个月',
        name_en: 'Gemini Ultra · 1 Mo',
        price: 299,
        original_price: 499,
        badge: '重度多模态',
      },
    ],
  },
  {
    categorySlug: 'coding-ai',
    slug: 'cursor-pro-coding-seat',
    title: 'Cursor Pro 开发者独享订阅（稳定高频不限速）',
    titleEn: 'Cursor Pro Developer Dedicated Plan',
    subtitle: '独立账号即登即写代码，无缝调用 Claude Sonnet / Opus 与自动补全 Tab',
    subtitleEn: 'Clean dedicated Cursor Pro subscription with fast Claude & Tab completions.',
    iconKey: 'terminal',
    accentColor: '#2A2927',
    deliveryType: 'auto',
    tags: ['编程必备', '成品账号', '自动发货', '推荐'],
    basePrice: 118,
    originalPrice: 148,
    wholesaleDiscount: 0.84,
    stockMode: 'cards',
    manualStock: 55,
    seatTotal: 0,
    seatUsed: 0,
    warrantyType: 'full_period',
    warrantyDays: 30,
    warrantySummary: '30 天全周期质保 · 非人为封号或掉订阅按质保规则换新/补发',
    isFeatured: 1,
    sortOrder: 1,
    salesCount: 934,
    riskNotice: '同一台电脑如之前登过免费试用号，建议先退出旧账号并清理 Cursor 本地缓存再登录新 Pro 账号。',
    summaryMarkdown: '独立开发者高频生产力工具，支持官方直充或秒发成品号。',
    detailMarkdown: `### 开发者专属保障
- **500 次官方高速请求 + 无限慢速请求 + 无限 Tab 补全**。
- **不绑定机器码限制**：单人多设备（公司 Mac + 家里 Windows）正常同步开发。
- **可选官方自备号直充**：保留你已有的 Cursor 规则与设置。`,
    faq: [{ q: '支持绑定 GitHub 吗？', a: '成品号独立邮箱发货，也可在规格中选择「自备号官方直充」。' }],
    customFields: [
      {
        key: 'cursor_email',
        label: '若选官方直充，请填写 Cursor 注册邮箱',
        label_en: 'Cursor Email (for top-up only)',
        placeholder: 'dev@company.com',
        required: false,
        type: 'email',
      },
    ],
    specs: [
      {
        id: 'cursor_ready',
        name: 'Cursor Pro 成品独享 · 1个月',
        name_en: 'Cursor Pro Ready · 1 Mo',
        price: 118,
        original_price: 148,
        badge: '现货秒发',
      },
      {
        id: 'cursor_topup',
        name: 'Cursor Pro 自备号直充 · 1个月',
        name_en: 'Cursor Pro Top-up · 1 Mo',
        price: 145,
        original_price: 158,
        badge: '原号保留',
      },
    ],
  },
];
