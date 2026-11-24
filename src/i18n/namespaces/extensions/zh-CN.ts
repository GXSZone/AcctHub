export const extensionsZhCN = {
  // 多币种
  currencyAria: '切换显示币种',
  currencySettlementHint: '当前为实时参考折算价，结账统一按人民币或所选网关实时汇率结算',

  // 会员价 vs 游客价
  memberPriceBadge: '会员专享价',
  memberPriceLoginHint: '登录立享会员价 {price}',
  memberPriceActiveHint: '已为您自动应用会员专享价',

  // 卡密预选
  cardSelectTitle: '自选卡密 / 选号下单（可选）',
  cardSelectRandomOpt: '系统随机自动发卡（免选号费）',
  cardSelectFeeTag: '+{fee} 选号费',
  cardSelectFreeTag: '免费自选',
  cardSelectSingleOnlyHint: '已指定预选卡密，单次固定购买 1 件',

  // 后台商品编辑补充
  editorMemberPriceHeading: '游客价 vs 会员价分离 & 卡密预选选号',
  editorMemberPriceLabel: '登录会员专享价（元，留空则游客与会员同价）',
  editorAllowCardSelectLabel:
    '允许买家按公开标签自选卡密（导入格式：公开标签||卡密正文 或 公开标签||加价||卡密正文）',
  editorCardSelectFeeLabel: '默认选号加价（元，0 为免费自选）',

  // 管理员 2FA 登录二次保护
  admin2FaSubTab: '管理员 2FA',
  admin2FaTitle: '管理员登录 2FA 两步验证保护（TOTP）',
  admin2FaDesc:
    '开启后，使用管理员邮箱密码登录总控后台时必须额外输入 6 位动态验证码，彻底杜绝撞库与密码泄露风险。',
  admin2FaStatusOn: '已开启两步验证保护',
  admin2FaStatusOff: '尚未开启两步验证（强烈建议立即启用）',
  admin2FaStartSetupBtn: '生成绑定密钥与验证器链接',
  admin2FaSecretLabel: '手动输入密钥（Base32）',
  admin2FaOtpUriLabel: '验证器导入链接（otpauth://）',
  admin2FaCodeLabel: '输入验证器显示的 6 位动态验证码',
  admin2FaEnableBtn: '验证并正式开启 2FA',
  admin2FaDisableBtn: '验证并关闭 2FA',
  admin2FaEnabledToast: '管理员 2FA 两步验证已开启，下次登录将自动生效',
  admin2FaDisabledToast: '管理员 2FA 两步验证已关闭',
  authTotpPromptTitle: '管理员两步验证（2FA）',
  authTotpPromptDesc: '请输入您验证器 App 中的 6 位动态验证码完成安全登录。',
  authTotpPlaceholder: '6 位数字验证码',

  // 业务出站 Webhook 扩展钩子
  webhooksSubTab: '出站 Webhook',
  webhooksTitle: '业务出站 Webhook 扩展钩子与外部 API 开通回填',
  webhooksDesc:
    '在订单创建、自动发卡交付或退款时向您的外部系统发送 HMAC-SHA256 签名事件；支持同步响应或回调 /api/webhooks/fulfill-callback 回填开通凭证。',
  webhooksAddTitle: '新增出站 Webhook',
  webhooksNameLabel: '名称',
  webhooksUrlLabel: '接收地址（HTTPS URL）',
  webhooksSecretLabel: '签名密钥（用于 X-AcctHub-Signature 验签）',
  webhooksEventsLabel: '订阅事件',
  webhooksAllowOverrideLabel: '允许该外部服务响应或回调回填订单交付凭证（外部 API 自动开通）',
  webhooksCreateBtn: '添加 Webhook',
  webhooksTestBtn: '发送测试',
  webhooksDeleteBtn: '删除',
  webhooksEmpty: '尚未配置任何出站 Webhook。',
  webhooksCreatedToast: '出站 Webhook 已添加',
  webhooksDeletedToast: '出站 Webhook 已删除',
  webhooksTestOkToast: '测试事件发送成功（HTTP {status}）',
  webhooksTestFailToast: '测试事件发送失败：{error}',
} as const;

export type ExtensionsDict = { [K in keyof typeof extensionsZhCN]: string };
