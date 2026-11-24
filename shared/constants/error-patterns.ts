import type { SupportedLocale } from './enums';
import type { ErrorCode, ErrorI18nEntry } from './error-codes';

export interface ErrorPatternRule {
  matchZh: RegExp;
  matchEn?: RegExp;
  render: (m: RegExpExecArray, locale: SupportedLocale) => string;
}

/**
 * 根据基础错误码字典构建多语种正则匹配规则表
 */
export function buildMultilingualErrorPatterns(
  errorCodeI18n: Record<ErrorCode, ErrorI18nEntry>
): ErrorPatternRule[] {
  return [
    {
      matchZh: /^当前站点暂未开启自动发信邮箱，游客暂不支持直接下单/,
      render: (_m, loc) =>
        ({
          'zh-CN':
            '当前站点暂未开启自动发信邮箱，游客暂不支持直接下单，请先登录账号购买并在「我的订单」查看凭证',
          'zh-TW':
            '目前站點尚未開啟自動寄信信箱，訪客暫不支援直接下單，請先登入帳號購買並在「我的訂單」查看憑證',
          en: 'Email delivery is not enabled on this site. Please sign in to place an order and view credentials in My Orders.',
          ja: 'このサイトでは自動メール送信が未設定のためゲスト購入できません。ログイン後、注文して「マイ注文」から認証情報をご確認ください。',
          ko: '이 사이트는 자동 이메일 발송이 꺼져 있어 비회원 주문이 불가합니다. 로그인 후 구매하고 「내 주문」에서 확인해 주세요.',
        })[loc],
    },
    {
      matchZh: /^请先登录/,
      matchEn: /^Authentication required/i,
      render: (_m, loc) => errorCodeI18n.UNAUTHORIZED[loc],
    },
    {
      matchZh: /^需要管理员权限/,
      render: (_m, loc) =>
        ({
          'zh-CN': '需要管理员权限',
          'zh-TW': '需要管理員權限',
          en: 'Administrator privileges required.',
          ja: '管理者権限が必要です。',
          ko: '관리자 권한이 필요합니다.',
        })[loc],
    },
    {
      matchZh: /^当前代理分站已暂停营业/,
      render: (_m, loc) =>
        ({
          'zh-CN': '当前代理分站已暂停营业',
          'zh-TW': '目前代理分站已暫停營業',
          en: 'This partner storefront is currently suspended.',
          ja: 'このパートナーストアは現在一時停止中です。',
          ko: '현재 파트너 스토어가 일시 중지되었습니다.',
        })[loc],
    },
    {
      matchZh: /^商品不存在或已下架$/,
      matchEn: /^Product not found$/i,
      render: (_m, loc) =>
        ({
          'zh-CN': '商品不存在或已下架',
          'zh-TW': '商品不存在或已下架',
          en: 'Product not found or currently unlisted.',
          ja: '商品が見つからないか、公開終了しています。',
          ko: '상품을 찾을 수 없거나 판매가 중단되었습니다.',
        })[loc],
    },
    {
      matchZh: /^订单不存在$/,
      render: (_m, loc) =>
        ({
          'zh-CN': '订单不存在',
          'zh-TW': '訂單不存在',
          en: 'Order not found.',
          ja: '注文が見つかりません。',
          ko: '주문을 찾을 수 없습니다.',
        })[loc],
    },
    {
      matchZh: /^该工单已关闭/,
      render: (_m, loc) =>
        ({
          'zh-CN': '该工单已关闭，无法继续操作',
          'zh-TW': '該工單已關閉，無法繼續操作',
          en: 'This support ticket is closed and cannot be modified.',
          ja: 'このサポートチケットは終了しているため操作できません。',
          ko: '이 문의 티켓은 종료되어 수정할 수 없습니다.',
        })[loc],
    },
    {
      matchZh: /^该订单已经完成过退款/,
      render: (_m, loc) =>
        ({
          'zh-CN': '该订单已经完成过退款',
          'zh-TW': '該訂單已經完成過退款',
          en: 'This order has already been refunded.',
          ja: 'この注文はすでに返金処理済みです。',
          ko: '이 주문은 이미 환불이 완료되었습니다.',
        })[loc],
    },
    {
      matchZh: /^请求过于频繁.*?请\s*(\d+)\s*秒后再试/,
      render: (m, loc) =>
        ({
          'zh-CN': `请求过于频繁，请 ${m[1]} 秒后再试`,
          'zh-TW': `請求過於頻繁，請 ${m[1]} 秒後再試`,
          en: `Too many requests. Please retry after ${m[1]} seconds.`,
          ja: `リクエストが多すぎます。${m[1]}秒後に再試行してください。`,
          ko: `요청이 너무 많습니다. ${m[1]}초 후 다시 시도해 주세요.`,
        })[loc],
    },
    {
      matchZh: /^人机验证/,
      render: (_m, loc) =>
        ({
          'zh-CN': '人机验证未通过，请刷新重试',
          'zh-TW': '人機驗證未通過，請重新整理後重試',
          en: 'Human verification (Turnstile) failed. Please refresh and try again.',
          ja: '人間確認（Turnstile）に失敗しました。再読み込みしてやり直してください。',
          ko: '보안 인증(Turnstile)에 실패했습니다. 새로고침 후 다시 시도해 주세요.',
        })[loc],
    },
    {
      matchZh: /余额不足/,
      matchEn: /^Insufficient agent balance/i,
      render: (_m, loc) => errorCodeI18n.INSUFFICIENT_BALANCE[loc],
    },
    {
      matchZh: /库存不足|已售罄/,
      matchEn: /^Insufficient stock/i,
      render: (_m, loc) => errorCodeI18n.INSUFFICIENT_STOCK[loc],
    },
    {
      matchZh: /^购买数量必须为\s*1\s*[~–-]\s*(\d+)\s*之间的正整数$/,
      matchEn: /^quantity must be an integer between 1 and (\d+)$/i,
      render: (m, loc) => {
        const max = m[1] || '20';
        return {
          'zh-CN': `购买数量必须为 1 ~ ${max} 之间的正整数`,
          'zh-TW': `購買數量必須為 1 ~ ${max} 之間的正整數`,
          en: `Purchase quantity must be an integer between 1 and ${max}.`,
          ja: `購入数量は 1 ～ ${max} の正の整数で指定してください。`,
          ko: `구매 수량은 1 ~ ${max} 사이의 양의 정수여야 합니다.`,
        }[loc];
      },
    },
    {
      matchZh: /^请填写有效的接收邮箱|接收邮箱格式不正确/,
      render: (_m, loc) =>
        ({
          'zh-CN': '请填写有效的接收邮箱地址',
          'zh-TW': '請填寫有效的接收電子郵件地址',
          en: 'Please enter a valid delivery email address.',
          ja: '有効な受取用メールアドレスを入力してください。',
          ko: '유효한 수신 이메일 주소를 입력해 주세요.',
        })[loc],
    },
    {
      matchZh: /优惠券不存在|优惠券无效|优惠券已过期|优惠券已被领完|优惠券已领完/,
      render: (_m, loc) =>
        ({
          'zh-CN': '优惠券不存在、已过期或已领完',
          'zh-TW': '優惠券不存在、已過期或已領完',
          en: 'The coupon code is invalid, expired, or has reached its usage limit.',
          ja: 'クーポンコードが無効、期限切れ、または利用上限に達しています。',
          ko: '쿠폰 코드가 유효하지 않거나 만료되었거나 사용 한도에 도달했습니다.',
        })[loc],
    },
    {
      matchZh: /邮箱或密码错误/,
      render: (_m, loc) =>
        ({
          'zh-CN': '邮箱或密码错误',
          'zh-TW': '電子郵件或密碼錯誤',
          en: 'Incorrect email or password.',
          ja: 'メールアドレスまたはパスワードが正しくありません。',
          ko: '이메일 또는 비밀번호가 올바르지 않습니다.',
        })[loc],
    },
    {
      matchZh: /该邮箱已在本店注册/,
      render: (_m, loc) =>
        ({
          'zh-CN': '该邮箱已在本店注册',
          'zh-TW': '該電子郵件已在本店註冊',
          en: 'This email address is already registered on this storefront.',
          ja: 'このメールアドレスはすでに当ストアに登録されています。',
          ko: '이 이메일 주소는 이미 현재 스토어에 등록되어 있습니다.',
        })[loc],
    },
  ];
}
