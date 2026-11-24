import type { DocsDict } from './zh-CN';

/**
 * 开放平台 API 文档域 —— 한국어
 */

export const docsKo: DocsDict = {
  sidebarTitle: 'API 레퍼런스',
  sidebarAllOverview: '전체 엔드포인트',
  statusCodesTitle: '표준 HTTP 상태 코드',
  status200: '요청 성공 및 JSON 반환',
  status400: '필수 파라미터 누락 또는 검증 실패',
  status401: 'API 키 / JWT 유효하지 않음 또는 만료',
  status402: '지갑 잔액 부족',
  status403: '권한 부족 또는 Turnstile 검증 실패',
  status409: '재고 부족 또는 Slug 중복',
  status429: '요청 제한 초과 (Retry-After 준수)',

  pageTitle: 'AcctHub 오픈 플랫폼 & B2B 도매 API 문서',
  pageSubtitlePrefix:
    'Cloudflare Workers 엣지 노드에서 실행되는 RESTful JSON API입니다. 파트너 실시간 도매가·재고 동기화, 잔액 즉시 발급, 멀티 스토어 라우팅 및 전체 CMS 운영을 지원합니다. 오프라인 사양 파일: ',
  pageSubtitleSuffix: '.',
  authCardTitle: '3가지 인증 방식',
  authCardDescPart1: 'B2B 도매 API는 ',
  authCardDescPart2: ' 사용, 회원은 JWT, 공개 쓰기 엔드포인트는 ',
  authCardDescPart3: ' 검증 지원.',
  tenantCardTitle: '멀티 스토어 컨텍스트 라우팅',
  tenantCardDescPart1: '쿼리 ',
  tenantCardDescPart2: ' 또는 헤더 ',
  tenantCardDescPart3: ' 전달 시 해당 파트너 마진율이 자동 반영됩니다.',
  sandboxTitlePrefix: '온라인 디버그 샌드박스 설정 (',
  sandboxModeAuthed: '인증 파트너/관리자 · 실제 호출 지원 (3초 쿨다운)',
  sandboxModeGuest: '게스트 모드 · 로컬 정적 모의 응답만 제공 (백엔드 미사용)',
  sandboxTitleSuffix: ')',
  sandboxCcNotice:
    '어뷰징 방지 활성화됨: 비로그인 상태에서는 D1 조회 없이 정적 샘플 응답만 표시됩니다. 인증된 파트너 계정으로 로그인하면 실제 API 키로 라이브 테스트가 가능합니다.',
  apiKeyLabel: '연동 API 키 (로그인 시 자동 입력되며 공용 키는 포함되지 않음)',
  apiKeyPlaceholder: '파트너 로그인 또는 ah_agent_... 키 입력',
  tenantSlugLabel: '스토어 Slug (선택, 코드 스니펫 생성용)',
  tenantSlugPlaceholder: '비워두면 메인 스토어 기준 (예: my-shop)',
  errGuestMockNote:
    '게스트 정적 모의 모드로 실제 백엔드 요청을 전송하지 않았습니다. 인증된 파트너로 로그인하면 실시간 호출이 가능합니다.',
  errWriteProtectedNote:
    '주문·로그인·DB 쓰기 엔드포인트로 오과금 방지를 위해 안전한 샘플 응답을 반환했습니다. 좌측 스니펫을 복사해 로컬에서 호출하세요.',
  errMissingKey: '실시간 요청을 실행하기 전에 상단에 전용 API 키(ah_agent_...)를 입력해 주세요',

  authResellerKey: '연동 API 키',
  authUserJwt: '회원 JWT',
  authAdminJwt: '관리자 인증',
  authNone: '공개(인증 불필요)',
  btnCooldown: '대기 중 ({sec}s)',
  btnRunLive: '실시간 테스트 실행',
  btnRunSandbox: '샌드박스 테스트',
  paramsTitle: '요청 파라미터 안내',
  thName: '파라미터명',
  thIn: '위치',
  thType: '타입',
  thRequired: '필수',
  thDesc: '설명',
  yes: '예',
  no: '아니오',
  reqExampleTitle: '요청 예시 ({lang})',
  copied: '복사됨',
  copyCode: '코드 복사',
  respTitleMock: '로컬 정적 모의 응답(미호출)',
  respTitleLive: '실제 API 디버그 응답',
  respTitleSample: '표준 응답 예시 (200 OK)',
  rateRemainingPrefix: '남은 할당량 ',

  grpResellerLabel: 'B2B 도매 발주 및 실시간 단가 API',
  grpResellerBadge: '핵심 추천',
  grpStorefrontLabel: '스토어 카탈로그 & 멀티테넌트 API',
  grpStorefrontBadge: '공개',
  grpOrdersLabel: '주문 결제 & 발급 조회 API',
  grpOrdersBadge: '거래',
  grpAuthLabel: '계정 & 파트너 포털 API',
  grpAuthBadge: '인증',
  grpAdminLabel: '통합 관리자 CMS API',
  grpAdminBadge: '관리자',

  epResellerBalTitle: '파트너 잔액 및 정산 상태 조회',
  epResellerBalSum:
    'B2B API 키로 인증하여 사용 가능한 예치금 잔액, 기본 수수료율 및 누적 정산 수익을 조회합니다. 자동 발주 전 잔액 검증에 권장됩니다.',
  epResellerBalP1: '고정 형식: Bearer ah_agent_...',
  epResellerProdTitle: '전체 실시간 단가표 및 도매 재고 조회',
  epResellerProdSum:
    '판매 중인 모든 상품의 정가, 파트너 할인가(wholesale_price), 다중 옵션 및 실시간 재고를 반환합니다. 외부 스토어/봇 동기화에 적합합니다.',
  epResellerProdP1: 'Bearer ah_agent_...',
  epResellerOrderTitle: 'B2B 도매 주문 및 배송',
  epResellerOrderSum:
    'delivered는 발급 완료입니다. upstream_pending은 결제되었으며 cards가 비어 있으므로 원래 주문을 조회하세요.',
  epResellerOrderP6: '동일한 구매에는 같은 멱등성 키를 사용하세요. 최대 64자',
  epResellerOrderStatusTitle: '도매 주문 상태 조회',
  epResellerOrderStatusSum:
    '같은 리셀러 키와 원래 주문 번호 또는 멱등성 키를 사용합니다. 조회는 새 주문을 만들지 않습니다.',
  epResellerOrderP1: 'Bearer ah_agent_...',
  epResellerOrderP2: '상품 ID (/products에서 확인)',
  epResellerOrderP3: '옵션 ID (미전달 시 첫 번째 옵션 기본 적용)',
  epResellerOrderP4: '구매 수량 (1–20, 기본 1)',
  epResellerOrderP5: '대조용 외부 주문번호 또는 고객 이메일',
  epResellerCompatTitle: '타 플랫폼 호환 평면 카탈로그 연동 API',
  epResellerCompatSum:
    '범용 자동 발송 시스템용 평면화 상품·재고 엔드포인트로, 현재 파트너 등급 할인율이 반영된 공급가와 잔여 수량을 제공합니다.',
  epResellerCompatP1: 'Bearer ah_agent_... (X-API-Key 헤더도 지원)',

  epSfBootTitle: '스토어 초기 설정 및 멀티테넌트 컨텍스트 조회',
  epSfBootSum:
    '요청 `Host` 또는 `?tenant=<slug>` / `X-Tenant-Slug`를 식별하여 브랜드 설정, 그룹·카테고리 트리, 상품 수, 공지 및 결제 수단을 반환합니다.',
  epSfBootP1: '파트너 스토어 Slug (예: studio) 지정 시 브랜드·마진율 적용',
  epSfBootP2: '?tenant 파라미터와 동일 (SPA 헤더 전달용)',
  epSfProdTitle: '상품 카탈로그 및 실시간 재고 목록 조회',
  epSfProdSum:
    '카테고리 Slug(`featured` / `all` / 사용자 지정), 키워드 검색 및 태그 필터링을 지원하며 파트너 마진 정책이 자동 적용됩니다.',
  epSfProdP1: '카테고리 Slug (기본 featured, 전체 조회는 all)',
  epSfProdP2: '제목·특징·태그 검색 키워드',
  epSfProdP3: '태그 정확 일치 필터',
  epSfDetailTitle: '단일 상품 상세 정보 조회 (/item/:id)',
  epSfDetailSum:
    'Markdown 상세 설명, 주의사항, 옵션별 재고(`spec_stock`), 공유 좌석 현황, 사용자 지정 입력 필드 및 FAQ를 반환합니다.',
  epSfDetailP1: '상품 숫자 ID (예: 1) 또는 Slug',
  epSfConciergeTitle: 'Claude 자연어 의도 매칭 추천',
  epSfConciergeSum:
    '사용자의 자연어 요청을 분석해 재고 내 최적 상품 조합을 스코어링하고 추천 사유와 함께 반환합니다.',
  epSfConciergeP1: '사용자 자연어 요구사항',

  epOrdCreateTitle: '일반 / 파트너 스토어 주문 및 즉시 발급',
  epOrdCreateSum:
    '비회원 주문 및 지갑 잔액 결제를 지원하며 카드 출고, API 키 발급, 좌석 배정 및 파트너 정산을 자동 처리합니다.',
  epOrdCreateP1: '상품 ID',
  epOrdCreateP2: '옵션 ID',
  epOrdCreateP3: '구매 수량 (1–20)',
  epOrdCreateP4: '수령 및 주문 조회 이메일',
  epOrdCreateP5: 'balance | 활성화된 결제 플러그인 ID',
  epOrdCreateP6: '사용자 정의 폼 입력값 (예: 충전 대상 이메일)',
  epOrdLookupTitle: '주문 조회 및 발급 정보 확인',
  epOrdLookupSum:
    '비회원은 공개 조회 번호로 주문을 확인합니다. 로그인 후 `q`를 생략하면 이 사이트의 본인 주문을 페이지당 최대 50개씩 조회할 수 있습니다.',
  epOrdLookupP1: '결제 시 받은 공개 조회 번호(AHQ-…)',
  epOrdLookupPassword: '주문에 조회 비밀번호를 설정한 경우 입력',
  epOrdLookupCursor: '이전 페이지의 next_cursor. 첫 페이지에서는 생략합니다.',
  epOrdLookupTurnstile: '인증이 활성화된 경우 비회원은 order_lookup 토큰을 제출합니다.',

  epAuthLoginTitle: '이메일·비밀번호 로그인 및 HMAC JWT 발급',
  epAuthLoginSum:
    '14일 유효한 HS256 토큰과 사용자·파트너 정보를 반환합니다. Turnstile 활성화 환경에서는 검증 토큰을 포함하세요.',
  epAuthLoginP1: '가입 이메일',
  epAuthLoginP2: '비밀번호',
  epAuthLoginP3: '프로덕션 Turnstile 활성화 시 필수 인증 토큰',
  epAgentApplyTitle: '활성 파트너 스토어 수정',
  epAgentApplySum:
    '로그인한 회원은 POST /api/agent/recharge로 파트너 등급을 활성화하고 GET /api/agent/me로 상태를 확인할 수 있습니다. 활성 파트너는 PUT /api/agent/brand로 스토어 식별자, 브랜드, 도메인과 마진율을 수정합니다. POST /api/agent/apply는 같은 작업을 수행합니다. POST /api/agent/rotate-key에도 활성 파트너 자격이 필요합니다.',
  epAgentApplyP1: '활성 파트너 JWT: Bearer <jwt>',
  epAgentApplyP2: '3–24자 영문 소문자/숫자/하이픈',
  epAgentApplyP3: '파트너 스토어 브랜드명',
  epAgentApplyP4: '자율 마진율 (0–200%)',
  epAgentApplyP5: 'Cloudflare for SaaS 연결 도메인',

  epAdminOverviewTitle: '통합 관리자 전체 데이터 및 CMS API',
  epAdminOverviewSum:
    '관리자 로그인으로 발급된 유효한 JWT가 필요합니다. 사이트 설정, 카테고리, 상품, 카드 보관함, 공지, 파트너, 결제 플러그인 관리 엔드포인트를 포함합니다.',
  epAdminOverviewP1: '최고 관리자 JWT: Bearer <YOUR_SUPER_ADMIN_JWT>',

  demoBrandName: 'Stardust AI 셀렉트',
  demoProdTitle: 'Claude Pro 공식 직접 충전 · 월간권',
  demoProdShort: 'Claude Pro 공식 직접 충전 · 월간권',
  demoSpec1: '공식 충전 · 1개월 (본인 계정)',
  demoSpec2: '단독 완성 계정 · 1개월',
  demoCardSample: 'CLAUDE-TOPUP-VOUCHER-11X9-A8F2 (포털에서 활성화)',
  demoGroupName: '최신 AI 구독',
  demoStockLabel: '여유',
  demoConciergePrompt: '개발용 Claude + Cursor 및 4K Netflix 필요',
  demoConciergeReason: '요청하신 목적에 최적화된 4개 상품을 선별했습니다...',
  demoAgentBrand: 'Aurora AI 스토어',
};
