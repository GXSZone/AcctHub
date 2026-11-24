/** 2FA 密钥生成器与密钥箱模块（简体中文） */
export const totpZhCN = {
  // TwoFactorPage & storage
  detectedLinesToast: '已识别 {count} 行内容，为您打开批量导入',
  clipboardEmptyToast: '剪贴板为空',
  pasteHotkeyToast: '请按 Ctrl+V / ⌘V 粘贴密钥',
  invalidSecretErr: '密钥格式无效',
  minLengthSecretErr: '请输入至少 8 位有效 Base32 密钥（A-Z、2-7）',
  defaultAccountIssuer: 'AI 账号',
  savedCloudToast: '已加密保存到您的账号云端密钥箱（换设备也能同步）',
  savedLocalToast: '已保存在此浏览器。登录后本机条目仍留在此处。',
  saveFailedErr: '保存失败',
  localVaultFullErr: '本机密钥箱最多保存 {limit} 条。请删除旧条目后重试。',
  batchLimitErr: '每次最多导入 {limit} 条。请拆分后重试。',
  batchEmptyErr: '未识别到有效 Base32 密钥或 otpauth:// 链接',
  batchCloudSuccessToast: '成功批量加密导入 {count} 条密钥至云端！',
  batchLocalSuccessToast: '成功导入 {count} 条密钥到本机浏览器！',
  focusPromptToast: '请先在左侧粘贴密钥，再点击保存',
  importFallbackSingle: '导入账号',
  importFallbackBatch: '批量导入',

  // TotpGeneratorCard
  clearTooltip: '清空',
  copySecretTooltip: '复制密钥',
  pasteClipboardTooltip: '从剪贴板粘贴',
  validSecretHint: '有效的 Base32 密钥 · {len} 个字符',

  // TotpQrCard
  zoomQrAria: '放大 2FA 二维码',
  qrAlt: '2FA 二维码',
  zoomQrTooltip: '放大二维码',
  qrScanTitle: '扫码添加到验证器',
  qrScanDesc: '用 Google Authenticator 等验证器 App 扫一扫即可添加。',
  copiedUriBtn: '已复制链接',
  copyUriBtn: '复制链接',
  downloadBtn: '下载',
  issuerLabel: '服务名称',
  issuerPh: '如：Google / Claude',
  accountLabel: '账号',
  accountPh: '如：name@gmail.com',

  // TotpVaultPanel
  fallbackItemIssuer: '账号密钥',
  deleteTooltip: '删除',

  // TotpModals
  modalZoomAria: '放大二维码',
  modalZoomTitle: '扫码添加到验证器 App',
  modalZoomAlt: '2FA 放大二维码',
  modalBatchAria: '批量导入 2FA 密钥',
  modalBatchTitle: '批量导入 2FA 密钥',
  modalBatchDescPrefix: '每行一条，自动兼容以下格式：',
  modalBatchDescFormat1: '`otpauth://totp/...`',
  modalBatchDescMid: '、',
  modalBatchDescFormat2: '`服务名----邮箱----Base32密钥`',
  modalBatchDescSuffix: ' 或纯 Base32 密钥。',
  cancelBtn: '取消',
  modalBatchSubmitBtn: '开始解析并导入',
};

export type TotpDict = typeof totpZhCN;
