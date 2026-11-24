import type { DocsDict } from './zh-CN';

/**
 * 开放平台 API 文档域 —— English
 */

export const docsEn: DocsDict = {
  sidebarTitle: 'API Reference',
  sidebarAllOverview: 'All Endpoints',
  statusCodesTitle: 'HTTP Status Conventions',
  status200: 'Success with JSON payload',
  status400: 'Validation error or missing fields',
  status401: 'Invalid or expired API Key / JWT',
  status402: 'Insufficient wallet balance',
  status403: 'Forbidden or Turnstile check failed',
  status409: 'Out of stock or duplicate Slug',
  status429: 'Rate limited; respect Retry-After',

  pageTitle: 'AcctHub Open Platform & B2B Wholesale API',
  pageSubtitlePrefix:
    'Standard RESTful JSON endpoints running on Cloudflare Workers edge nodes. Supports reseller catalog/stock sync, atomic balance checkout, multi-store routing, and full CMS operations. Offline spec available in ',
  pageSubtitleSuffix: '.',
  authCardTitle: 'Authentication Methods',
  authCardDescPart1: 'B2B wholesale uses ',
  authCardDescPart2: '; members use JWT; public write routes support ',
  authCardDescPart3: ' verification.',
  tenantCardTitle: 'Edge Multi-Tenancy',
  tenantCardDescPart1: 'Pass ',
  tenantCardDescPart2: ' or header ',
  tenantCardDescPart3: ' to apply reseller store markups automatically.',
  sandboxTitlePrefix: 'Interactive API Sandbox (',
  sandboxModeAuthed: 'Verified Partner/Admin · Live debug with 3s cooldown',
  sandboxModeGuest: 'Guest Mode · Local static mock only, zero backend quota',
  sandboxTitleSuffix: ')',
  sandboxCcNotice:
    'Anti-CC protection active: guests receive static mock responses without querying D1. Sign in as a verified partner or admin to test against live endpoints with your API key.',
  apiKeyLabel: 'Partner API Key (auto-filled when signed in; never hardcoded)',
  apiKeyPlaceholder: 'Sign in as partner or paste your ah_agent_... key',
  tenantSlugLabel: 'Store Slug (optional, for snippet generation)',
  tenantSlugPlaceholder: 'Leave empty for main store, or enter e.g. my-shop',
  errGuestMockNote:
    'Guest static mock mode: no real backend request was sent. Sign in with a verified partner account to run live requests (3s cooldown).',
  errWriteProtectedNote:
    'Mutating endpoint (order/login/write): sandbox returns a safe static sample to prevent accidental charges or dirty writes. Copy the snippet to execute locally.',
  errMissingKey: 'Please enter your ah_agent_... API key above before triggering a live request',

  authResellerKey: 'Partner API Key',
  authUserJwt: 'User JWT',
  authAdminJwt: 'Admin Auth',
  authNone: 'Public',
  btnCooldown: 'Cooldown ({sec}s)',
  btnRunLive: 'Run Live Call',
  btnRunSandbox: 'Sandbox Mock',
  paramsTitle: 'Parameters',
  thName: 'Name',
  thIn: 'In',
  thType: 'Type',
  thRequired: 'Required',
  thDesc: 'Description',
  yes: 'Yes',
  no: 'No',
  reqExampleTitle: 'Request Snippet ({lang})',
  copied: 'Copied',
  copyCode: 'Copy Code',
  respTitleMock: 'Local Static Mock Response',
  respTitleLive: 'Live Endpoint Response',
  respTitleSample: 'Sample Response (200 OK)',
  rateRemainingPrefix: 'Remaining ',

  grpResellerLabel: 'B2B Wholesale & Pricing API',
  grpResellerBadge: 'Core',
  grpStorefrontLabel: 'Storefront & Multi-Tenant API',
  grpStorefrontBadge: 'Public',
  grpOrdersLabel: 'Checkout & Order Lookup API',
  grpOrdersBadge: 'Orders',
  grpAuthLabel: 'Auth & Partner Portal API',
  grpAuthBadge: 'Auth',
  grpAdminLabel: 'Admin Console CMS API',
  grpAdminBadge: 'Admin',

  epResellerBalTitle: 'Query Reseller Balance & Commission',
  epResellerBalSum:
    'Authenticated with B2B API Key. Returns real-time spendable balance, tier commission rate, and cumulative earnings prior to automated pulls.',
  epResellerBalP1: 'Format: Bearer ah_agent_...',
  epResellerProdTitle: 'Fetch Live Wholesale Catalog & Stock',
  epResellerProdSum:
    'Returns all active products with retail price, partner discounted wholesale_price, multi-SKU breakdown, and live stock for automated storefront/bot sync.',
  epResellerProdP1: 'Bearer ah_agent_...',
  epResellerOrderTitle: 'B2B Wholesale Orders and Delivery',
  epResellerOrderSum:
    'A delivered order includes credentials. An upstream_pending order has been charged and returns an empty cards array. Query the original order to check delivery.',
  epResellerOrderP6: 'Stable idempotency key for this purchase, up to 64 characters',
  epResellerOrderStatusTitle: 'Look Up a Wholesale Order',
  epResellerOrderStatusSum:
    'Use the same reseller key and supply the original order number or idempotency key. The lookup never creates an order.',
  epResellerOrderP1: 'Bearer ah_agent_...',
  epResellerOrderP2: 'Product ID (from /products)',
  epResellerOrderP3: 'Spec ID (defaults to first spec if omitted)',
  epResellerOrderP4: 'Quantity (1–20, default 1)',
  epResellerOrderP5: 'Downstream order ref or customer email for reconciliation',
  epResellerCompatTitle: 'Flat Storefront Compatibility Catalog Endpoint',
  epResellerCompatSum:
    'Standardized flat SKU catalog endpoint compatible with third-party card platforms, outputting partner wholesale prices and real-time stock per SKU.',
  epResellerCompatP1: 'Bearer ah_agent_... (also supports X-API-Key header)',

  epSfBootTitle: 'Storefront Bootstrap & Tenant Context',
  epSfBootSum:
    'Resolves incoming `Host`, `?tenant=<slug>`, or `X-Tenant-Slug`, returning brand config, grouped categories tree, item counts, notices, and active payment channels.',
  epSfBootP1: 'Optional partner store slug (e.g. studio) for custom store markup',
  epSfBootP2: 'Equivalent to ?tenant query parameter for SPA requests',
  epSfProdTitle: 'Query Product Catalog & Live Stock',
  epSfProdSum:
    'Supports filtering by category slug (`featured` / `all` / custom slug), keyword query, and tag filter with automatic storefront markup.',
  epSfProdP1: 'Category slug (default: featured; pass all for entire catalog)',
  epSfProdP2: 'Fuzzy search keyword across title, subtitle, and tags',
  epSfProdP3: 'Exact tag filter',
  epSfDetailTitle: 'Get Full Product Detail (/item/:id)',
  epSfDetailSum:
    'Returns rich Markdown content, risk guidelines, multi-SKU pricing, per-spec live inventory (`spec_stock`), shared seat matrix, custom fields, and FAQ.',
  epSfDetailP1: 'Numeric product ID (e.g. 1) or slug',
  epSfConciergeTitle: 'Smart Intent Catalog Match',
  epSfConciergeSum:
    'Scores active catalog items against natural language prompts and returns the best bundle recommendations with reasoning.',
  epSfConciergeP1: 'Natural language requirement prompt',

  epOrdCreateTitle: 'Retail / Storefront Checkout & Instant Fulfill',
  epOrdCreateSum:
    'Supports guest and wallet checkout. Handles card delivery, API key issuance, seat reservation, and multi-tier reseller commission settlement.',
  epOrdCreateP1: 'Product ID',
  epOrdCreateP2: 'Spec ID',
  epOrdCreateP3: 'Quantity (1–20)',
  epOrdCreateP4: 'Delivery & lookup email',
  epOrdCreateP5: 'balance | enabled payment plugin ID',
  epOrdCreateP6: 'Custom checkout field values (e.g. target account email)',
  epOrdLookupTitle: 'Order Lookup & Credential Retrieval',
  epOrdLookupSum:
    'Guests use their public lookup number. Signed-in users can omit `q` to page through their own orders on this site, up to 50 per page.',
  epOrdLookupP1: 'Public lookup number received at checkout (AHQ-…)',
  epOrdLookupPassword: 'Lookup password, if set for the order',
  epOrdLookupCursor: 'The previous page’s next_cursor. Omit for the first page.',
  epOrdLookupTurnstile: 'When verification is enabled, guests submit a token for order_lookup.',

  epAuthLoginTitle: 'Email & Password Sign-In (HMAC JWT)',
  epAuthLoginSum:
    'Issues a 14-day HS256 JWT along with user balance and linked reseller store context. Include `cf-turnstile-response` / `X-Turnstile-Token` when Turnstile is enabled.',
  epAuthLoginP1: 'Registered email',
  epAuthLoginP2: 'Account password',
  epAuthLoginP3: 'Cloudflare Turnstile verification token (required in production when enabled)',
  epAgentApplyTitle: 'Update an Active Partner Store',
  epAgentApplySum:
    'Signed-in members activate a partner tier through POST /api/agent/recharge and can check their status with GET /api/agent/me. An active partner uses PUT /api/agent/brand to update the store slug, brand, domain, and markup. POST /api/agent/apply performs the same update. POST /api/agent/rotate-key also requires an active partner.',
  epAgentApplyP1: 'Active partner JWT: Bearer <jwt>',
  epAgentApplyP2: '3–24 lowercase alphanumeric or hyphen characters',
  epAgentApplyP3: 'Storefront brand name',
  epAgentApplyP4: 'Markup percentage (0–200)',
  epAgentApplyP5: 'Cloudflare for SaaS custom domain',

  epAdminOverviewTitle: 'Admin Console Overview & CMS Endpoints',
  epAdminOverviewSum:
    'Requires a valid JWT issued by an administrator sign-in. Includes `PUT /api/admin/settings`, `POST/PUT/DELETE /api/admin/groups|categories|products|announcements|help`, card vault management, agent management, and payment plugin config.',
  epAdminOverviewP1: 'Super Admin JWT: Bearer <YOUR_SUPER_ADMIN_JWT>',

  demoBrandName: 'Stardust AI Studio',
  demoProdTitle: 'Claude Pro Official Direct Top-up · Monthly',
  demoProdShort: 'Claude Pro Official Top-up · Monthly',
  demoSpec1: 'Official Top-up · 1 Month (Your Email)',
  demoSpec2: 'Private Ready Account · 1 Month',
  demoCardSample: 'CLAUDE-TOPUP-VOUCHER-11X9-A8F2 (Redeem via portal)',
  demoGroupName: 'Frontier AI Subscriptions',
  demoStockLabel: 'In Stock',
  demoConciergePrompt: 'Need Claude + Cursor for coding and 4K Netflix',
  demoConciergeReason: 'Selected 4 matching plans based on your prompt...',
  demoAgentBrand: 'Aurora AI Store',
};
