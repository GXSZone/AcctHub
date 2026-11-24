import {
  adminAdjustMemberBalanceSchema,
  adminMembersQuerySchema,
  adminResetMemberPasswordSchema,
  adminUpdateMemberStatusSchema,
  positiveIntIdParamSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody, parseQueryParams, parseRouteParams } from '../../middleware/validate.middleware';
import { adminResetMemberPassword } from '../auth/password.service';
import {
  adjustAdminMemberBalance,
  deleteAdminMember,
  listAdminMembers,
  listAdminMemberTransactions,
  revokeAdminMemberSessions,
  updateAdminMemberStatus,
} from './admin.members.service';

export const adminMembersRoutes = new Hono<AppBindings>();

function readActor(c: {
  get: (key: 'user') => { id: number; email: string; role: string } | null;
  req: { header: (name: string) => string | undefined };
}) {
  const adminUser = c.get('user');
  return {
    actorUserId: adminUser?.id ?? 0,
    actorEmail: adminUser?.email ?? 'admin',
    actorRole: adminUser?.role ?? 'admin',
    ip: c.req.header('CF-Connecting-IP') || '',
    userAgent: c.req.header('User-Agent') || '',
  };
}

adminMembersRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  const query = parseQueryParams(c, adminMembersQuerySchema);
  return c.json(await listAdminMembers(c.env, query));
});

adminMembersRoutes.get('/:id/transactions', async (c) => {
  c.header('Cache-Control', 'no-store');
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await listAdminMemberTransactions(c.env, id));
});

adminMembersRoutes.post('/:id/adjust-balance', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, adminAdjustMemberBalanceSchema);
  return c.json(await adjustAdminMemberBalance(c.env, readActor(c), id, body));
});

adminMembersRoutes.post('/:id/revoke-sessions', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await revokeAdminMemberSessions(c.env, readActor(c), id));
});

adminMembersRoutes.put('/:id/status', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, adminUpdateMemberStatusSchema);
  return c.json(await updateAdminMemberStatus(c.env, readActor(c), id, body));
});

adminMembersRoutes.put('/:id/password', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, adminResetMemberPasswordSchema);
  return c.json(await adminResetMemberPassword(c.env, readActor(c), id, body.new_password));
});

adminMembersRoutes.delete('/:id', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAdminMember(c.env, readActor(c), id));
});
