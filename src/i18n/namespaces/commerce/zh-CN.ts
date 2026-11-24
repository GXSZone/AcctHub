export const commerceZhCN = {
  // 卡片与详情角标
  badgeFlashSale: '限时秒杀',
  badgeFlashUpcoming: '即将开抢',
  badgeBundle: '组合套餐',
  badgeGroupBuy: '拼团合租',
  badgeHidden: '隐藏直达',
  badgePassword: '口令专享',

  // 限时秒杀倒计时
  flashTitleActive: '限时闪购进行中',
  flashTitleUpcoming: '限时闪购即将开始',
  flashTitleSoldOut: '本场秒杀名额已抢光',
  flashEndsIn: '距结束',
  flashStartsIn: '距开始',
  flashLeftQuota: '仅剩 {left} 件',
  flashUnlimited: '限时特惠不限量',

  // 隐藏/口令访问
  accessLockedTitle: '该商品为专属口令商品',
  accessLockedDesc: '输入商家提供的访问口令后即可解锁完整介绍、规格价格并下单购买。',
  accessCodePlaceholder: '请输入专属访问口令',
  accessUnlockBtn: '立即解锁查看',
  accessWrongErr: '访问口令不正确，请核对后重试',

  // 组合套餐清单
  bundleCardTitle: '组合套餐内含清单',
  bundleCardDesc: '单次下单原子自动发放以下全部子商品卡密，任一子项缺货不扣款。',
  bundleItemQty: '× {qty} 件',
  bundleItemStock: '子库存 {stock}',

  // 拼团合租
  groupBuyCardTitle: '拼团合租 · 满员自动发卡',
  groupBuyCardDesc: '{size} 人成团立享拼团价 {price}，{hours} 小时未满自动全额退回钱包余额。',
  groupBuyModeRegular: '单独直接购买',
  groupBuyModeStart: '发起新拼团（{price}）',
  groupBuyModeJoin: '参与拼团 #{code}（{price}）',
  groupBuyOpenListTitle: '正在进行中的公开拼团（一键加入）',
  groupBuyOpenEmpty: '当前暂无等待中的公开团，点击下方立即做团长开团！',
  groupBuySlotsLeft: '还差 {left} 人成团',
  groupBuyJoinBtn: '去参团',
  groupBuySelectedBadge: '已选参团',
  groupBuyLoginHint: '发起或参与拼团需先登录账号，以便超时未成团自动退回钱包余额。',
  groupBuySessionCreatedToast: '拼团已开启！团号 {code}，分享链接邀请好友满员后自动发卡。',
  groupBuyCompletedToast: '拼团已满员成团！卡密已自动发放至您的订单与邮箱。',
  groupBuyCopyLinkBtn: '复制拼团邀请链接',
  groupBuyCopiedLinkToast: '拼团邀请链接已复制，快分享给好友参团吧！',

  // 订阅到期与一键复购
  statusGrouping: '拼团中',
  renewalExpiringBadge: '{days} 天后到期',
  renewalExpiredBadge: '订阅已到期',
  rebuyBtn: '一键复购',
  rebuyBannerTitle: '已为您自动恢复上次购买规格，确认数量后即可快速续费！',

  // 后台商品编辑器：高转化营销形态 Tab
  editorSectionMarketing: '营销形态（秒杀/口令/套餐/拼团）',
  editorHiddenHeading: '隐藏商品与口令专属访问',
  editorIsHiddenLabel: '在首页与分类列表中隐藏（仅通过直达链接访问）',
  editorAccessPwdLabel: '访问口令密码（留空不设密）',
  editorAccessPwdPlaceholder: '例如 VIP2026，买家需输入此口令才能查看与下单',
  editorFlashHeading: '限时秒杀 / 闪购倒计时',
  editorFlashPriceLabel: '秒杀价（元，留空不启用）',
  editorFlashLimitLabel: '秒杀限量件数（0 为不限）',
  editorFlashStartLabel: '开始时间（ISO 或本地时间，留空立即开始）',
  editorFlashEndLabel: '结束时间（必填以开启倒计时）',
  editorBundleHeading: '组合套餐 / 捆绑包（单次下单原子发放多商品卡密）',
  editorBundleAddBtn: '添加子商品',
  editorBundleProductIdLabel: '子商品 ID',
  editorBundleSpecIdLabel: '规格 ID',
  editorBundleQtyLabel: '包含数量',
  editorBundleRemoveBtn: '移除',
  editorBundleEmptyHint: '未配置子商品时作为普通单品售卖；添加 1 个及以上子商品即变为组合套餐。',
  editorGroupBuyHeading: '拼团合租（成团自动发卡，超时自动退余额）',
  editorGroupBuyEnableLabel: '开启拼团合租',
  editorGroupBuySizeLabel: '成团人数（2-20）',
  editorGroupBuyPriceLabel: '拼团单价（元）',
  editorGroupBuyHoursLabel: '拼团有效期（小时）',
} as const;

export type CommerceDict = { [K in keyof typeof commerceZhCN]: string };
