import type { ExtensionsDict } from './zh-CN';

export const extensionsKo: ExtensionsDict = {
  currencyAria: '표시 통화 전환',
  currencySettlementHint:
    '실시간 참고 환산 가격이며, 실제 결제는 위안화(CNY) 또는 결제사 실시간 환율로 정산됩니다.',

  memberPriceBadge: '회원 전용가',
  memberPriceLoginHint: '로그인 시 회원가 {price}',
  memberPriceActiveHint: '회원 전용 할인가가 자동 적용되었습니다',

  cardSelectTitle: '공개 라벨로 재고 지정 선택 (선택 사항)',
  cardSelectRandomOpt: '시스템 무작위 자동 발송 (추가 비용 없음)',
  cardSelectFeeTag: '+{fee} 선택비',
  cardSelectFreeTag: '무료 선택',
  cardSelectSingleOnlyHint: '재고 지정 선택 시 수량은 1개로 고정됩니다.',

  editorMemberPriceHeading: '비회원/회원가 분리 및 재고 사전 선택',
  editorMemberPriceLabel: '로그인 회원 전용가(CNY, 비워 두면 일반가와 동일)',
  editorAllowCardSelectLabel:
    '공개 라벨별 재고 사전 선택 허용(입력 형식: 라벨||카드 또는 라벨||추가요금||카드)',
  editorCardSelectFeeLabel: '기본 선택 추가요금(CNY, 0 = 무료)',

  admin2FaSubTab: '관리자 2FA',
  admin2FaTitle: '관리자 로그인 2FA 2단계 인증 보호 (TOTP)',
  admin2FaDesc: '활성화하면 관리자 로그인 시 비밀번호 외에 6자리 OTP 인증 코드 입력이 필수가 됩니다.',
  admin2FaStatusOn: '2단계 인증 활성화됨',
  admin2FaStatusOff: '미설정(활성화 강력 권장)',
  admin2FaStartSetupBtn: 'TOTP 시크릿 및 설정 URI 생성',
  admin2FaSecretLabel: '수동 입력 키 (Base32)',
  admin2FaOtpUriLabel: '인증 앱 URI (otpauth://)',
  admin2FaCodeLabel: '인증 앱에 표시된 6자리 코드 입력',
  admin2FaEnableBtn: '검증 후 2FA 활성화',
  admin2FaDisableBtn: '검증 후 2FA 비활성화',
  admin2FaEnabledToast: '관리자 2FA가 활성화되었습니다',
  admin2FaDisabledToast: '관리자 2FA가 비활성화되었습니다',
  authTotpPromptTitle: '관리자 2단계 인증 (2FA)',
  authTotpPromptDesc: '인증 앱의 6자리 코드를 입력하여 로그인을 완료하세요.',
  authTotpPlaceholder: '6자리 숫자 코드',

  webhooksSubTab: '출구 Webhook',
  webhooksTitle: '비즈니스 아웃바운드 Webhook 및 외부 API 자동 발송',
  webhooksDesc:
    '주문 생성/발송/환불 시 HMAC-SHA256 서명 이벤트를 전송하며 /api/webhooks/fulfill-callback 콜백으로 발송 정보를 회신받을 수 있습니다.',
  webhooksAddTitle: 'Webhook 추가',
  webhooksNameLabel: '이름',
  webhooksUrlLabel: '수신 URL (HTTPS)',
  webhooksSecretLabel: '서명 시크릿 (X-AcctHub-Signature)',
  webhooksEventsLabel: '구독 이벤트',
  webhooksAllowOverrideLabel: '외부 응답/콜백으로 주문 발송 결과 덮어쓰기 허용',
  webhooksCreateBtn: 'Webhook 추가',
  webhooksTestBtn: '테스트 전송',
  webhooksDeleteBtn: '삭제',
  webhooksEmpty: '설정된 아웃바운드 Webhook이 없습니다.',
  webhooksCreatedToast: 'Webhook이 추가되었습니다',
  webhooksDeletedToast: 'Webhook이 삭제되었습니다',
  webhooksTestOkToast: '테스트 전송 성공 (HTTP {status})',
  webhooksTestFailToast: '테스트 전송 실패: {error}',
};
