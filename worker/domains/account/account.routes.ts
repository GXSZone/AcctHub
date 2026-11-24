import {
  accountAffiliateQuerySchema,
  accountRechargeIntentSchema,
  accountSandboxRechargeSchema,
  batchTotpVaultInputSchema,
  changePasswordInputSchema,
  createTicketInputSchema,
  createTotpVaultInputSchema,
  memberOrdersQuerySchema,
  positiveIntIdParamSchema,
  redeemCdkInputSchema,
  replyTicketInputSchema,
  updateProfileInputSchema,
  walletTransactionsQuerySchema,
} from '@shared/index';
import { Hono } from 'hono';
import { type AppBindings, isSandboxEnabled } from '../../env';
import { assertDemoAccountMutable } from '../../middleware/demo-guard.middleware';
import { parseJsonBody, parseQueryParams, parseRouteParams } from '../../middleware/validate.middleware';
import { listMemberOrdersPage } from '../orders/orders.lookup.service';
import {
  changeMemberPassword,
  createMemberRechargeIntent,
  executeSandboxRecharge,
  getMemberSecurityInfo,
  getMemberSummary,
  getMemberTransactions,
  redeemMemberCdk,
  requireAuthUser,
  updateMemberProfile,
} from './account.service';
import {
  addMemberTotpVaultItem,
  batchImportMemberTotpVault,
  closeOwnTicket,
  createMemberTicket,
  deleteMemberTotpVaultItem,
  getMemberTicketDetail,
  getMemberTickets,
  listMemberTotpVault,
  replyMemberTicket,
} from './account.tickets.service';
import { getMemberAffiliateSummary } from './affiliate.service';

export const accountRoutes = new Hono<AppBindings>();

accountRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

accountRoutes.get('/summary', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getMemberSummary(c.env, user));
});

accountRoutes.get('/affiliate', async (c) => {
  const tenant = c.get('tenant');
  const user = await requireAuthUser(c.req.raw, c.env, tenant);
  const currentSiteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const page = parseQueryParams(c, accountAffiliateQuerySchema);
  return c.json(await getMemberAffiliateSummary(c.env, user.id, currentSiteAgentId, page));
});

accountRoutes.get('/orders', async (c) => {
  const tenant = c.get('tenant');
  const user = await requireAuthUser(c.req.raw, c.env, tenant);
  const { cursor } = parseQueryParams(c, memberOrdersQuerySchema);
  return c.json(
    await listMemberOrdersPage(c.env, user.id, tenant.isSubAgent ? tenant.agentId : null, cursor)
  );
});

accountRoutes.get('/transactions', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const { type } = parseQueryParams(c, walletTransactionsQuerySchema);
  return c.json(await getMemberTransactions(c.env, user, type));
});

accountRoutes.post('/recharge/intent', async (c) => {
  const tenant = c.get('tenant');
  const user = await requireAuthUser(c.req.raw, c.env, tenant);
  const input = await parseJsonBody(c, accountRechargeIntentSchema);
  return c.json(await createMemberRechargeIntent(c.env, user, tenant, new URL(c.req.url).origin, input));
});

if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__) {
  accountRoutes.post('/recharge', async (c) => {
    if (!isSandboxEnabled(c.env)) return c.notFound();
    const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
    const input = await parseJsonBody(c, accountSandboxRechargeSchema);
    return c.json(await executeSandboxRecharge(c.env, user, input));
  });
}

accountRoutes.post('/redeem-cdk', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const input = await parseJsonBody(c, redeemCdkInputSchema);
  return c.json(await redeemMemberCdk(c.env, c.req.raw, user, input));
});

accountRoutes.get('/tickets', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getMemberTickets(c.env, user));
});

accountRoutes.post('/tickets', async (c) => {
  const tenant = c.get('tenant');
  const user = await requireAuthUser(c.req.raw, c.env, tenant);
  const input = await parseJsonBody(c, createTicketInputSchema);
  return c.json(await createMemberTicket(c.env, user, tenant, input));
});

accountRoutes.get('/tickets/:id', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await getMemberTicketDetail(c.env, user, id));
});

accountRoutes.post('/tickets/:id/reply', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const input = await parseJsonBody(c, replyTicketInputSchema);
  return c.json(await replyMemberTicket(c.env, user, id, input));
});

accountRoutes.post('/tickets/:id/close', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await closeOwnTicket(c.env, user, id));
});

accountRoutes.get('/security', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getMemberSecurityInfo(c.env, user));
});

accountRoutes.put('/profile', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const input = await parseJsonBody(c, updateProfileInputSchema);
  return c.json(await updateMemberProfile(c.env, user, input));
});

accountRoutes.put('/password', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  assertDemoAccountMutable(c.env, user.email);
  const input = await parseJsonBody(c, changePasswordInputSchema);
  return c.json(await changeMemberPassword(c.env, user, input));
});

accountRoutes.get('/totp-vault', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listMemberTotpVault(c.env, user));
});

accountRoutes.post('/totp-vault', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const input = await parseJsonBody(c, createTotpVaultInputSchema);
  return c.json(await addMemberTotpVaultItem(c.env, user, input));
});

accountRoutes.post('/totp-vault/batch', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const input = await parseJsonBody(c, batchTotpVaultInputSchema);
  return c.json(await batchImportMemberTotpVault(c.env, user, input));
});

accountRoutes.delete('/totp-vault/:id', async (c) => {
  const user = await requireAuthUser(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteMemberTotpVaultItem(c.env, user, id));
});
