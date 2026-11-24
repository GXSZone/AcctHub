import type { ExtensionsDict } from './zh-CN';

export const extensionsEn: ExtensionsDict = {
  currencyAria: 'Switch display currency',
  currencySettlementHint: 'Estimated display conversion; checkout settles in CNY or gateway live FX rate.',

  memberPriceBadge: 'Member Price',
  memberPriceLoginHint: 'Sign in for member price {price}',
  memberPriceActiveHint: 'Member-exclusive price applied automatically',

  cardSelectTitle: 'Choose Specific Item by Label (Optional)',
  cardSelectRandomOpt: 'Auto-assign randomly (no extra fee)',
  cardSelectFeeTag: '+{fee} pick fee',
  cardSelectFreeTag: 'Free pick',
  cardSelectSingleOnlyHint: 'Fixed quantity of 1 when choosing a specific item.',

  editorMemberPriceHeading: 'Member vs Guest Pricing & Card Pre-Selection',
  editorMemberPriceLabel: 'Signed-in Member Price (CNY, blank = same as guest)',
  editorAllowCardSelectLabel:
    'Allow buyers to pre-select cards by public label (Import: label||card or label||fee||card)',
  editorCardSelectFeeLabel: 'Default Selection Fee (CNY, 0 = free)',

  admin2FaSubTab: 'Admin 2FA',
  admin2FaTitle: 'Administrator Login 2FA Protection (TOTP)',
  admin2FaDesc:
    'Require a 6-digit TOTP authenticator code in addition to password when signing into the super-admin console.',
  admin2FaStatusOn: '2FA Protection Active',
  admin2FaStatusOff: '2FA Not Enabled (Strongly Recommended)',
  admin2FaStartSetupBtn: 'Generate TOTP Secret & Setup URI',
  admin2FaSecretLabel: 'Manual Entry Key (Base32)',
  admin2FaOtpUriLabel: 'Authenticator URI (otpauth://)',
  admin2FaCodeLabel: 'Enter 6-digit code from your authenticator app',
  admin2FaEnableBtn: 'Verify & Enable 2FA',
  admin2FaDisableBtn: 'Verify & Disable 2FA',
  admin2FaEnabledToast: 'Admin 2FA enabled and active on next login',
  admin2FaDisabledToast: 'Admin 2FA disabled',
  authTotpPromptTitle: 'Admin Two-Factor Verification',
  authTotpPromptDesc: 'Enter the 6-digit code from your authenticator app to complete login.',
  authTotpPlaceholder: '6-digit TOTP code',

  webhooksSubTab: 'Webhooks',
  webhooksTitle: 'Outbound Business Webhooks & External Fulfillment',
  webhooksDesc:
    'Send HMAC-SHA256 signed order events (created/delivered/refunded) to external systems, with optional credential callback to /api/webhooks/fulfill-callback.',
  webhooksAddTitle: 'Add Outbound Webhook',
  webhooksNameLabel: 'Name',
  webhooksUrlLabel: 'Endpoint URL (HTTPS)',
  webhooksSecretLabel: 'Signing Secret (X-AcctHub-Signature)',
  webhooksEventsLabel: 'Subscribed Events',
  webhooksAllowOverrideLabel: 'Allow response/callback to fulfill or override order credentials',
  webhooksCreateBtn: 'Add Webhook',
  webhooksTestBtn: 'Send Test',
  webhooksDeleteBtn: 'Delete',
  webhooksEmpty: 'No outbound webhooks configured yet.',
  webhooksCreatedToast: 'Outbound webhook created',
  webhooksDeletedToast: 'Outbound webhook deleted',
  webhooksTestOkToast: 'Test event delivered (HTTP {status})',
  webhooksTestFailToast: 'Test delivery failed: {error}',
};
