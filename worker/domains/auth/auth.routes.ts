import {
  authChangePasswordSchema,
  authForgotPasswordSchema,
  authResetPasswordSchema,
  loginInputSchema,
  registerInputSchema,
  ssoExchangeInputSchema,
  ssoIssueInputSchema,
  topupDemoInputSchema,
} from '@shared/index';
import { Hono } from 'hono';
import { type AppBindings, isSandboxEnabled } from '../../env';
import { parseJsonBody } from '../../middleware/validate.middleware';
import { getCurrentUserProfile, loginUser, registerUser, topupDemoBalance } from './auth.service';
import { revokeAuthSession } from './auth.session';
import { changeOwnPassword, confirmPasswordReset, requestPasswordReset } from './password.service';
import { exchangeTenantSsoTicket, issueTenantSsoTicket } from './sso.service';

export const authRoutes = new Hono<AppBindings>();

authRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

authRoutes.post('/register', async (c) => {
  const input = await parseJsonBody(c, registerInputSchema);
  const result = await registerUser(c.env, c.req.raw, c.get('tenant'), input);
  return c.json(result);
});

authRoutes.post('/login', async (c) => {
  const input = await parseJsonBody(c, loginInputSchema);
  const result = await loginUser(c.env, c.req.raw, c.get('tenant'), input);
  return c.json(result);
});

authRoutes.get('/me', async (c) => {
  const result = await getCurrentUserProfile(c.env, c.req.raw, c.get('tenant'));
  return c.json(result);
});

authRoutes.post('/logout', async (c) => c.json(await revokeAuthSession(c.req.raw, c.env)));

// 账号密码闭环：忘记密码（6 位邮箱验证码）与个人中心改密
authRoutes.post('/forgot-password', async (c) => {
  const input = await parseJsonBody(c, authForgotPasswordSchema);
  return c.json(await requestPasswordReset(c.env, c.req.raw, c.get('tenant'), input.email));
});

authRoutes.post('/reset-password', async (c) => {
  const input = await parseJsonBody(c, authResetPasswordSchema);
  return c.json(await confirmPasswordReset(c.env, c.get('tenant'), input));
});

authRoutes.post('/change-password', async (c) => {
  const input = await parseJsonBody(c, authChangePasswordSchema);
  return c.json(await changeOwnPassword(c.env, c.req.raw, c.get('tenant'), input));
});

// 跨站点一次性 SSO 免登票据（主站一键免登直达分站自身域名工作台）
authRoutes.post('/sso/issue', async (c) => {
  const rawText = await c.req.text();
  const input = rawText.trim()
    ? ssoIssueInputSchema.parse(JSON.parse(rawText))
    : ssoIssueInputSchema.parse({});
  return c.json(await issueTenantSsoTicket(c.env, c.req.raw, c.get('tenant'), input.redirect_path));
});

authRoutes.post('/sso/exchange', async (c) => {
  const input = await parseJsonBody(c, ssoExchangeInputSchema);
  return c.json(await exchangeTenantSsoTicket(c.env, c.get('tenant'), input.ticket));
});

if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__) {
  authRoutes.post('/topup-demo', async (c) => {
    if (!isSandboxEnabled(c.env)) return c.notFound();
    const rawText = await c.req.text();
    let input = topupDemoInputSchema.parse({});
    if (rawText.trim()) {
      input = await parseJsonBody(
        new Proxy(c, {
          get(target, prop) {
            if (prop === 'req') {
              return { json: async () => JSON.parse(rawText) };
            }
            return Reflect.get(target, prop);
          },
        }),
        topupDemoInputSchema
      );
    }
    const result = await topupDemoBalance(c.env, c.req.raw, c.get('tenant'), input);
    return c.json(result);
  });
}
