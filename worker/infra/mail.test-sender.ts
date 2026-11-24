import type { Env } from '../env';
import { getSiteMailConfig, sendSiteEmail } from './mail';
import { buildOrderDeliveryEmailTemplate } from './mail.templates';

/** 发送测试发卡邮件以验证站点独立邮箱通道是否联通 */
export async function sendTestDeliveryEmail(
  env: Env,
  ownerAgentId: number,
  toEmail: string,
  fallbackBrandName: string
) {
  const cfg = await getSiteMailConfig(env, ownerAgentId);
  const brand = cfg.from_name || fallbackBrandName || 'AcctHub';
  const tpl = buildOrderDeliveryEmailTemplate({
    brandName: brand,
    orderNo: `TEST${Date.now().toString().slice(-6)}`,
    productTitle: '【发信通道测试】AI 订阅成品号示例商品',
    specName: '测试规格 · 月卡',
    quantity: 1,
    totalAmount: 99,
    deliveredPayload: 'demo_test@example.com----DemoPass2026!----2FA:JBSWY3DPEHPK3PXP',
    warrantySummary: '这是一封测试发卡邮件，说明您的独立发信邮箱配置已完全联通！',
    footerNote:
      cfg.footer_note ||
      '如收到此邮件，代表您配置的邮件服务商工作正常，买家下单后将自动收到同款发卡凭证邮件。',
    customSubjectTpl: cfg.order_email_subject_tpl,
    customBodyTpl: cfg.order_email_body_tpl,
  });

  return sendSiteEmail(env, ownerAgentId, {
    to: toEmail.trim(),
    subject: `[测试发信] ${brand} 独立邮箱发卡配置验证成功`,
    html: tpl.html,
    text: tpl.text,
    orderNo: 'TEST-MAIL',
    scene: 'test',
    forceIgnoreDisabled: true,
  });
}
