function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOrderCreatedEmailTemplate(params: {
  brandName: string;
  orderNo: string;
  productTitle: string;
  specName: string;
  quantity: number;
  lookupUrl?: string;
}) {
  const details = [
    `${params.brandName || '商城'} 已收到您的订单`,
    `订单号：${params.orderNo}`,
    `商品：${params.productTitle}（${params.specName} × ${params.quantity}）`,
    '订单完成交付后会另行发送交付凭证。',
    ...(params.lookupUrl ? [`在线查单：${params.lookupUrl}`] : []),
  ];
  return {
    subject: `[${params.brandName || '商城'}] 订单 ${params.orderNo} 已创建`,
    html: details.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
    text: details.join('\n'),
  };
}

export function buildRestockEmailTemplate(brand: string, productTitle: string) {
  const text = `您好，您预约的 ${productTitle} 已补货，欢迎前往选购。`;
  return {
    subject: `[${brand}] 您预约的商品已补货：${productTitle}`,
    html: `<p>${escapeHtml(text)}</p>`,
    text,
  };
}

/** 安全替换自定义邮件模板变量占位符（全部变量先转义防 HTML 注入） */
function renderTplVars(tpl: string, vars: Record<string, string>, htmlMode: boolean): string {
  return tpl.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const val = vars[key.toLowerCase()] ?? '';
    return htmlMode ? escapeHtml(val) : val;
  });
}

/** 构造管理员紧急风控熔断邮件（附带第 N/3 封序号防邮件客户端自动折叠） */
export function buildRiskAlertEmailTemplate(params: {
  brandName: string;
  seq: number;
  totalSeq: number;
  eventType: string;
  summary: string;
  lines: string[];
}) {
  const safeBrand = escapeHtml(params.brandName || 'AcctHub');
  const subject = `[紧急风控告警 ${params.seq}/${params.totalSeq}] ${params.brandName || 'AcctHub'} · ${params.summary.slice(0, 60)}`;
  const bodyLines = [
    `告警序号：第 ${params.seq} 封 / 共 ${params.totalSeq} 封（高危风控紧急连发提醒）`,
    `事件类型：${params.eventType}`,
    `摘要说明：${params.summary}`,
    ...params.lines,
    '请立即登录总控后台查看「运营概览 / 安全风控」，必要时保持紧急熔断开关开启并核查异常订单与资金流水。',
  ];
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:24px 12px;background:#FDF2F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1D1B;">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:2px solid #DC2626;border-radius:16px;overflow:hidden;">
    <div style="padding:18px 22px;background:#DC2626;color:#FFFFFF;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;">URGENT RISK ALERT · ${safeBrand} · 第 ${params.seq}/${params.totalSeq} 封</div>
      <h1 style="margin:6px 0 0;font-size:18px;line-height:1.4;">${escapeHtml(params.summary)}</h1>
    </div>
    <div style="padding:20px 22px;font-size:13px;line-height:1.7;">
      ${bodyLines.map((l) => `<p style="margin:0 0 8px;">${escapeHtml(l)}</p>`).join('')}
    </div>
  </div></body></html>`;
  return { subject, html, text: bodyLines.join('\n') };
}

/** 构造会员邮箱找回密码 6 位一次性验证码邮件 */
export function buildPasswordResetEmailTemplate(params: { brandName: string; code: string }) {
  const safeBrand = escapeHtml(params.brandName || 'AcctHub');
  const safeCode = escapeHtml(params.code);
  const subject = `[${params.brandName || 'AcctHub'}] 密码重置验证码：${params.code}`;
  const text = `您正在重置 ${params.brandName || 'AcctHub'} 账号密码，本次一次性验证码为：${params.code}（10 分钟内有效，切勿泄露给他人）。如非本人操作请忽略本邮件。`;
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:24px 12px;background:#F7F5EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141413;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E0D5;border-radius:16px;padding:24px;">
    <div style="font-size:12px;font-weight:700;color:#D97757;">${safeBrand}</div>
    <h1 style="margin:8px 0 12px;font-size:19px;">重置登录密码验证码</h1>
    <p style="font-size:13px;color:#5E5C55;line-height:1.6;">请在 10 分钟内输入以下 6 位一次性验证码完成密码重置（重置成功后所有旧设备将自动下线）：</p>
    <div style="margin:18px 0;padding:16px;text-align:center;background:#FAF9F5;border:1px dashed #D97757;border-radius:12px;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:0.25em;color:#141413;">${safeCode}</div>
    <p style="font-size:12px;color:#8A8881;">如非本人发起操作，请直接忽略此邮件，您的账号密码不会被修改。</p>
  </div></body></html>`;
  return { subject, html, text };
}

/** 构造订单凭证自动交付的 HTML 与纯文本邮件模板（支持后台自定义模板与占位符，严格转义防 HTML 注入） */
export function buildOrderDeliveryEmailTemplate(params: {
  brandName: string;
  orderNo: string;
  productTitle: string;
  specName: string;
  quantity: number;
  totalAmount: number;
  deliveredPayload: string;
  warrantySummary?: string;
  lookupUrl?: string;
  footerNote?: string;
  replacement?: boolean;
  customSubjectTpl?: string;
  customBodyTpl?: string;
}) {
  const vars: Record<string, string> = {
    brand_name: params.brandName || '数字席位商城',
    order_no: params.orderNo,
    product_title: params.productTitle,
    spec_name: params.specName || '标准版',
    quantity: String(params.quantity),
    total_amount: Number(params.totalAmount).toFixed(2),
    cards: params.deliveredPayload || '请前往订单查询页查看详情',
    warranty: params.warrantySummary || '',
    lookup_url: params.lookupUrl || '',
    footer_note: params.footerNote || '',
  };

  if (params.customBodyTpl?.trim()) {
    const customSubject = params.customSubjectTpl?.trim()
      ? renderTplVars(params.customSubjectTpl.trim(), vars, false).slice(0, 200)
      : `[${vars.brand_name}] 订单 ${params.orderNo} ${params.replacement ? '换新' : ''}凭证已交付 · ${params.productTitle}`;
    const renderedText = renderTplVars(params.customBodyTpl.trim(), vars, false);
    const renderedHtmlBody = renderTplVars(params.customBodyTpl.trim(), vars, true).replace(
      /\r?\n/g,
      '<br/>'
    );
    const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:24px 12px;background:#F7F5EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141413;"><div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E0D5;border-radius:16px;padding:24px;font-size:13.5px;line-height:1.75;word-break:break-word;">${renderedHtmlBody}</div></body></html>`;
    return { subject: customSubject, html, text: renderedText };
  }

  const safeBrand = escapeHtml(params.brandName || '数字席位商城');
  const safeOrderNo = escapeHtml(params.orderNo);
  const safeProd = escapeHtml(params.productTitle);
  const safeSpec = escapeHtml(params.specName || '标准版');
  const safePayload = escapeHtml(params.deliveredPayload || '请前往订单查询页查看详情');
  const safeWarranty = escapeHtml(params.warrantySummary || '');
  const safeFooter = escapeHtml(
    params.footerNote || '请妥善保管您的交付凭证，切勿向无关人员泄露账号密码或 2FA 密钥。'
  );

  const heading = params.replacement ? '您的换新凭证已交付' : '您的订单已交付';
  const subject = params.customSubjectTpl?.trim()
    ? renderTplVars(params.customSubjectTpl.trim(), vars, false).slice(0, 200)
    : `[${params.brandName || '自动发卡'}] 订单 ${params.orderNo} ${params.replacement ? '换新' : ''}凭证已交付 · ${params.productTitle}`;

  const html = `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:24px 12px;background:#F7F5EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#141413;">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E0D5;border-radius:16px;overflow:hidden;">
    <div style="padding:22px 24px;border-bottom:1px solid #EFECE4;background:#FAF9F5;">
      <div style="font-size:12px;letter-spacing:0.08em;color:#D97757;font-weight:700;text-transform:uppercase;">${safeBrand}</div>
      <h1 style="margin:6px 0 0;font-size:20px;line-height:1.35;color:#141413;">${heading}</h1>
      <div style="margin-top:6px;font-size:13px;color:#5E5C55;">订单号：<strong style="font-family:monospace;color:#141413;">${safeOrderNo}</strong></div>
    </div>
    <div style="padding:22px 24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr>
          <td style="padding:6px 0;color:#73716A;width:88px;">购买商品</td>
          <td style="padding:6px 0;font-weight:600;color:#141413;">${safeProd}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#73716A;">规格与数量</td>
          <td style="padding:6px 0;color:#141413;">${safeSpec} × ${params.quantity}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#73716A;">实付金额</td>
          <td style="padding:6px 0;font-family:monospace;font-weight:700;color:#D97757;">¥${Number(params.totalAmount).toFixed(2)}</td>
        </tr>
        ${
          safeWarranty
            ? `<tr><td style="padding:6px 0;color:#73716A;">售后质保</td><td style="padding:6px 0;color:#2E7D5B;font-weight:500;">${safeWarranty}</td></tr>`
            : ''
        }
      </table>

      <div style="font-size:12px;font-weight:700;color:#5E5C55;margin-bottom:8px;">交付凭证 / 卡密内容</div>
      <pre style="margin:0;padding:14px 16px;background:#FAF9F5;border:1px solid #E5E0D5;border-radius:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.65;white-space:pre-wrap;word-break:break-all;color:#141413;">${safePayload}</pre>

      ${
        params.lookupUrl
          ? `<div style="margin-top:18px;text-align:center;">
               <a href="${escapeHtml(params.lookupUrl)}" style="display:inline-block;padding:10px 22px;background:#D97757;color:#FAF9F5;text-decoration:none;border-radius:999px;font-size:13px;font-weight:600;">前往订单页查看与拆解凭证 →</a>
             </div>`
          : ''
      }
    </div>
    <div style="padding:14px 24px;border-top:1px solid #EFECE4;background:#FAF9F5;font-size:11.5px;line-height:1.6;color:#73716A;">
      ${safeFooter}
    </div>
  </div>
</body>
</html>`;

  const text = [
    `${params.brandName || '自动发卡'} - ${heading}`,
    `订单号：${params.orderNo}`,
    `商品：${params.productTitle}（${params.specName || '标准版'} × ${params.quantity}）`,
    `实付：¥${Number(params.totalAmount).toFixed(2)}`,
    ...(params.warrantySummary ? [`售后质保：${params.warrantySummary}`] : []),
    '',
    '--- 交付凭证 / 卡密 ---',
    params.deliveredPayload,
    '----------------------',
    ...(params.lookupUrl ? [`在线查单：${params.lookupUrl}`] : []),
    '',
    params.footerNote || '请妥善保管您的交付凭证。',
  ].join('\n');

  return { subject, html, text };
}
