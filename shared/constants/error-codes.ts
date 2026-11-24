import type { SupportedLocale } from './enums';
import { buildMultilingualErrorPatterns } from './error-patterns';

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  SANDBOX_DISABLED: 'SANDBOX_DISABLED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DOWNLINE_DISCOUNT_BELOW_FLOOR: 'DOWNLINE_DISCOUNT_BELOW_FLOOR',
  BELOW_COST_MARGIN: 'BELOW_COST_MARGIN',
  TIER_DISCOUNT_CAUSES_LOSS: 'TIER_DISCOUNT_CAUSES_LOSS',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  DEMO_MODE_READONLY: 'DEMO_MODE_READONLY',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_BALANCE: 402,
  INSUFFICIENT_STOCK: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  PAYMENT_FAILED: 402,
  SANDBOX_DISABLED: 403,
  CONFIGURATION_ERROR: 500,
  INTERNAL_ERROR: 500,
  DOWNLINE_DISCOUNT_BELOW_FLOOR: 400,
  BELOW_COST_MARGIN: 400,
  TIER_DISCOUNT_CAUSES_LOSS: 400,
  TOTP_REQUIRED: 401,
  DEMO_MODE_READONLY: 403,
};

export interface ErrorI18nEntry {
  zh: string;
  'zh-CN': string;
  'zh-TW': string;
  en: string;
  ja: string;
  ko: string;
}

export const ERROR_CODE_I18N: Record<ErrorCode, ErrorI18nEntry> = {
  VALIDATION_ERROR: {
    zh: '请求参数校验未通过，请检查输入内容',
    'zh-CN': '请求参数校验未通过，请检查输入内容',
    'zh-TW': '請求參數校驗未通過，請檢查輸入內容',
    en: 'Invalid request parameters. Please check your input.',
    ja: 'リクエストパラメータが無効です。入力内容をご確認ください。',
    ko: '요청 매개변수가 올바르지 않습니다. 입력 내용을 확인해 주세요.',
  },
  UNAUTHORIZED: {
    zh: '请先登录账号后再执行此操作',
    'zh-CN': '请先登录账号后再执行此操作',
    'zh-TW': '請先登入帳號後再執行此操作',
    en: 'Authentication required. Please sign in first.',
    ja: 'ログインが必要です。先にアカウントへサインインしてください。',
    ko: '로그인이 필요합니다. 먼저 계정으로 로그인해 주세요.',
  },
  FORBIDDEN: {
    zh: '无权限执行此操作',
    'zh-CN': '无权限执行此操作',
    'zh-TW': '無權限執行此操作',
    en: 'You do not have permission to perform this action.',
    ja: 'この操作を実行する権限がありません。',
    ko: '이 작업을 수행할 권한이 없습니다.',
  },
  NOT_FOUND: {
    zh: '请求的资源或记录不存在',
    'zh-CN': '请求的资源或记录不存在',
    'zh-TW': '請求的資源或記錄不存在',
    en: 'The requested resource was not found.',
    ja: '要求されたリソースが見つかりません。',
    ko: '요청하신 리소스를 찾을 수 없습니다.',
  },
  CONFLICT: {
    zh: '当前资源状态冲突，请刷新后重试',
    'zh-CN': '当前资源状态冲突，请刷新后重试',
    'zh-TW': '目前資源狀態衝突，請重新整理後重試',
    en: 'Resource state conflict. Please refresh and try again.',
    ja: 'リソースの状態が競合しています。再読み込みしてやり直してください。',
    ko: '리소스 상태가 충돌했습니다. 새로고침 후 다시 시도해 주세요.',
  },
  INSUFFICIENT_BALANCE: {
    zh: '账户钱包余额不足，请先充值',
    'zh-CN': '账户钱包余额不足，请先充值',
    'zh-TW': '帳戶錢包餘額不足，請先儲值',
    en: 'Insufficient wallet balance. Please top up first.',
    ja: 'ウォレット残高が不足しています。先にチャージしてください。',
    ko: '지갑 잔액이 부족합니다. 먼저 충전해 주세요.',
  },
  INSUFFICIENT_STOCK: {
    zh: '当前商品规格库存不足',
    'zh-CN': '当前商品规格库存不足',
    'zh-TW': '目前商品規格庫存不足',
    en: 'Insufficient stock for the selected product specification.',
    ja: '選択された商品仕様の在庫が不足しています。',
    ko: '선택하신 상품 옵션의 재고가 부족합니다.',
  },
  RATE_LIMITED: {
    zh: '请求过于频繁，请稍后再试',
    'zh-CN': '请求过于频繁，请稍后再试',
    'zh-TW': '請求過於頻繁，請稍後再試',
    en: 'Too many requests. Please try again later.',
    ja: 'リクエストが多すぎます。しばらくしてから再試行してください。',
    ko: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  UPSTREAM_ERROR: {
    zh: '上游供货节点响应异常或超时',
    'zh-CN': '上游供货节点响应异常或超时',
    'zh-TW': '上游供貨節點回應異常或逾時',
    en: 'Upstream provider error or request timed out.',
    ja: '上流プロバイダーでエラーまたはタイムアウトが発生しました。',
    ko: '상위 공급자 오류 또는 요청 시간 초과가 발생했습니다.',
  },
  PAYMENT_FAILED: {
    zh: '支付校验未通过或通道暂不可用',
    'zh-CN': '支付校验未通过或通道暂不可用',
    'zh-TW': '支付校驗未通過或通道暫不可用',
    en: 'Payment verification failed or gateway unavailable.',
    ja: '決済認証に失敗したか、決済ゲートウェイが利用できません。',
    ko: '결제 확인에 실패했거나 결제 게이트웨이를 사용할 수 없습니다.',
  },
  SANDBOX_DISABLED: {
    zh: '当前生产环境已关闭沙盒演示模式',
    'zh-CN': '当前生产环境已关闭沙盒演示模式',
    'zh-TW': '目前正式環境已關閉沙盒演示模式',
    en: 'Sandbox demo mode is disabled in the production environment.',
    ja: '本番環境ではサンドボックスデモモードが無効になっています。',
    ko: '프로덕션 환경에서는 샌드박스 데모 모드가 비활성화되어 있습니다.',
  },
  CONFIGURATION_ERROR: {
    zh: '服务内部配置异常，请联系管理员',
    'zh-CN': '服务内部配置异常，请联系管理员',
    'zh-TW': '服務內部設定異常，請聯絡管理員',
    en: 'Server configuration error. Please contact the administrator.',
    ja: 'サーバー設定エラーが発生しました。管理者にお問い合わせください。',
    ko: '서버 설정 오류가 발생했습니다. 관리자에게 문의해 주세요.',
  },
  INTERNAL_ERROR: {
    zh: '服务器内部错误，请稍后重试',
    'zh-CN': '服务器内部错误，请稍后重试',
    'zh-TW': '伺服器內部錯誤，請稍後重試',
    en: 'Internal server error. Please try again later.',
    ja: 'サーバー内部エラーが発生しました。しばらくしてから再試行してください。',
    ko: '내부 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  },
  DOWNLINE_DISCOUNT_BELOW_FLOOR: {
    zh: '防亏拦截：给下级设置的拿货折扣不得低于您自身的底价折扣',
    'zh-CN': '防亏拦截：给下级设置的拿货折扣不得低于您自身的底价折扣',
    'zh-TW': '防虧攔截：給下級設定的拿貨折扣不得低於您自身的底價折扣',
    en: 'Anti-loss guard: Downline discount rate cannot be lower than your own wholesale cost floor.',
    ja: '赤字防止ガード：下位代理店の割引率はご自身の仕入底値割引率を下回ることはできません。',
    ko: '손실 방지 차단: 하위 대리점 할인율은 본인의 도매 원가 할인율보다 낮을 수 없습니다.',
  },
  BELOW_COST_MARGIN: {
    zh: '防亏拦截：最低代理拿货价低于商品进货成本价',
    'zh-CN': '防亏拦截：最低代理拿货价低于商品进货成本价',
    'zh-TW': '防虧攔截：最低代理拿貨價低於商品進貨成本價',
    en: 'Anti-loss guard: Lowest agent wholesale price is below product cost price.',
    ja: '赤字防止ガード：最低代理店仕入価格が商品原価を下回っています。',
    ko: '손실 방지 차단: 최저 대리점 도매가가 상품 원가보다 낮습니다.',
  },
  TIER_DISCOUNT_CAUSES_LOSS: {
    zh: '防亏拦截：该等级折扣将导致在售商品折后价低于成本价',
    'zh-CN': '防亏拦截：该等级折扣将导致在售商品折后价低于成本价',
    'zh-TW': '防虧攔截：該等級折扣將導致在售商品折後價低於成本價',
    en: 'Anti-loss guard: This tier discount would cause active products to sell below cost.',
    ja: '赤字防止ガード：このランク割引により一部商品が原価割れとなります。',
    ko: '손실 방지 차단: 해당 등급 할인율 적용 시 일부 상품이 원가 이하로 판매됩니다.',
  },
  TOTP_REQUIRED: {
    zh: '该管理员账号已开启两步验证，请输入 6 位动态验证码',
    'zh-CN': '该管理员账号已开启两步验证，请输入 6 位动态验证码',
    'zh-TW': '該管理員帳號已開啟兩步驟驗證，請輸入 6 位動態驗證碼',
    en: 'Two-factor authentication is enabled. Please enter your 6-digit authenticator code.',
    ja: '二段階認証が有効です。6 桁の認証コードを入力してください。',
    ko: '2단계 인증이 활성화되어 있습니다. 6자리 OTP 코드를 입력해 주세요.',
  },
  DEMO_MODE_READONLY: {
    zh: '公开演示环境已限制该高危修改，请注册独立测试账号或本地部署体验完整控制权限',
    'zh-CN': '公开演示环境已限制该高危修改，请注册独立测试账号或本地部署体验完整控制权限',
    'zh-TW': '公開演示環境已限制此高風險修改，請註冊獨立測試帳號或本地部署體驗完整控制權限',
    en: 'This high-risk change is restricted in the public demo. Register your own test account or self-host for full control.',
    ja: '公開デモ環境ではこの高リスク操作が制限されています。ご自身のテストアカウントを登録するか、セルフホストでお試しください。',
    ko: '공개 데모 환경에서는 해당 고위험 변경이 제한됩니다. 별도의 테스트 계정을 등록하거나 셀프 호스팅으로 전체 권한을 이용해 보세요.',
  },
};

export type ErrorLang = 'zh' | SupportedLocale;

function normalizeErrorLang(lang: ErrorLang): SupportedLocale {
  if (lang === 'zh' || lang === 'zh-CN') return 'zh-CN';
  if (lang === 'zh-TW' || lang === 'en' || lang === 'ja' || lang === 'ko') return lang;
  return 'zh-CN';
}

const MULTILINGUAL_ERROR_PATTERNS = buildMultilingualErrorPatterns(ERROR_CODE_I18N);

/**
 * 从请求头（X-Lang 或 Accept-Language）解析客户端期望语言，兼容 5 语种
 */
export function resolveRequestLocale(
  headers?: Headers | Record<string, string | undefined> | null
): SupportedLocale {
  if (!headers) return 'zh-CN';
  const getHeader = (name: string): string => {
    if (typeof (headers as Headers).get === 'function') {
      return ((headers as Headers).get(name) || '').trim();
    }
    const rec = headers as Record<string, string | undefined>;
    return (rec[name] || rec[name.toLowerCase()] || '').trim();
  };
  const explicit = getHeader('X-Lang').toLowerCase();
  if (explicit === 'zh-tw' || explicit === 'zh-hk' || explicit === 'zh-hant') return 'zh-TW';
  if (explicit === 'en' || explicit.startsWith('en-')) return 'en';
  if (explicit === 'ja' || explicit.startsWith('ja-')) return 'ja';
  if (explicit === 'ko' || explicit.startsWith('ko-')) return 'ko';
  if (explicit === 'zh' || explicit.startsWith('zh-')) return 'zh-CN';

  const accept = getHeader('Accept-Language').toLowerCase();
  if (accept.startsWith('zh-tw') || accept.startsWith('zh-hk')) return 'zh-TW';
  if (accept.startsWith('en')) return 'en';
  if (accept.startsWith('ja')) return 'ja';
  if (accept.startsWith('ko')) return 'ko';
  return 'zh-CN';
}

/**
 * 兼容旧版 resolveRequestLang（保留向后兼容导出）
 */
export function resolveRequestLang(
  headers?: Headers | Record<string, string | undefined> | null
): 'zh' | 'en' {
  const loc = resolveRequestLocale(headers);
  return loc === 'zh-CN' || loc === 'zh-TW' ? 'zh' : 'en';
}

/**
 * 将后端 API 返回的错误消息与错误码按 5 种目标语种进行标准化国际化转换
 */
export function translateApiErrorMessage(
  rawError: string | undefined,
  code?: string,
  lang: ErrorLang = 'zh-CN',
  status?: number
): string {
  const trimmed = (rawError || '').trim();
  const locale = normalizeErrorLang(lang);

  if (locale === 'zh-CN') {
    for (const rule of MULTILINGUAL_ERROR_PATTERNS) {
      if (rule.matchEn) {
        const m = rule.matchEn.exec(trimmed);
        if (m) return rule.render(m, 'zh-CN');
      }
    }
    if (!trimmed && code && code in ERROR_CODE_I18N) {
      return ERROR_CODE_I18N[code as ErrorCode]['zh-CN'];
    }
    return trimmed || `请求失败 (${status || 400})`;
  }

  for (const rule of MULTILINGUAL_ERROR_PATTERNS) {
    const m = rule.matchZh.exec(trimmed) || (rule.matchEn ? rule.matchEn.exec(trimmed) : null);
    if (m) return rule.render(m, locale);
  }

  if (code && code in ERROR_CODE_I18N) {
    if (locale === 'en' && trimmed && /^[\x20-\x7E]+$/.test(trimmed)) {
      return trimmed;
    }
    return ERROR_CODE_I18N[code as ErrorCode][locale];
  }

  if (locale === 'en' && trimmed && /^[\x20-\x7E]+$/.test(trimmed)) {
    return trimmed;
  }
  if (status === 401) return ERROR_CODE_I18N.UNAUTHORIZED[locale];
  if (status === 403) return ERROR_CODE_I18N.FORBIDDEN[locale];
  if (status === 404) return ERROR_CODE_I18N.NOT_FOUND[locale];
  if (status === 409) return ERROR_CODE_I18N.CONFLICT[locale];
  if (status === 429) return ERROR_CODE_I18N.RATE_LIMITED[locale];
  if (status && status >= 500) return ERROR_CODE_I18N.INTERNAL_ERROR[locale];
  return trimmed || `${ERROR_CODE_I18N.VALIDATION_ERROR[locale]} (${status || 400})`;
}
