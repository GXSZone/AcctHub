import type { TenantDomainDto } from '@shared/index';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { agents, type TenantDomainRow, tenantDomains } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export function mapTenantDomainRow(
  row: TenantDomainRow,
  extra?: { agentSlug?: string; agentBrand?: string }
): TenantDomainDto {
  return {
    id: row.id,
    agent_id: row.agentId,
    ...(extra?.agentSlug ? { agent_slug: extra.agentSlug } : {}),
    ...(extra?.agentBrand ? { agent_brand: extra.agentBrand } : {}),
    hostname: row.hostname,
    domain_type: row.domainType as TenantDomainDto['domain_type'],
    is_primary: row.isPrimary === 1,
    auth_mode: row.authMode as TenantDomainDto['auth_mode'],
    status: row.status as TenantDomainDto['status'],
    verification_token: row.verificationToken,
    cf_hostname_id: row.cfHostnameId,
    ssl_status: row.sslStatus,
    authorized_at: row.authorizedAt,
    expires_at: row.expiresAt,
    error_message: row.errorMessage,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function listAgentDomainsRepo(db: AppDatabase, agentId: number): Promise<TenantDomainRow[]> {
  return db
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.agentId, agentId))
    .orderBy(desc(tenantDomains.isPrimary), desc(tenantDomains.id));
}

export async function findDomainByIdRepo(db: AppDatabase, domainId: number): Promise<TenantDomainRow | null> {
  const rows = await db.select().from(tenantDomains).where(eq(tenantDomains.id, domainId)).limit(1);
  return rows[0] ?? null;
}

export async function findDomainByHostnameRepo(
  db: AppDatabase,
  hostname: string
): Promise<TenantDomainRow | null> {
  const rows = await db
    .select()
    .from(tenantDomains)
    .where(sql`lower(${tenantDomains.hostname}) = ${hostname.toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function countAgentCustomDomainsRepo(db: AppDatabase, agentId: number): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(tenantDomains)
    .where(and(eq(tenantDomains.agentId, agentId), eq(tenantDomains.domainType, 'custom')));
  return Number(rows[0]?.c ?? 0);
}

export async function insertTenantDomainRepo(
  db: AppDatabase,
  values: typeof tenantDomains.$inferInsert
): Promise<TenantDomainRow> {
  const [inserted] = await db.insert(tenantDomains).values(values).returning();
  return inserted;
}

export async function updateTenantDomainRepo(
  db: AppDatabase,
  domainId: number,
  patch: Partial<typeof tenantDomains.$inferInsert>
): Promise<TenantDomainRow | null> {
  const [updated] = await db
    .update(tenantDomains)
    .set({ ...patch, updatedAt: sql`datetime('now')` })
    .where(eq(tenantDomains.id, domainId))
    .returning();
  return updated ?? null;
}

export async function setPrimaryTenantDomainRepo(
  db: AppDatabase,
  agentId: number,
  domainId: number
): Promise<void> {
  await db
    .update(tenantDomains)
    .set({ isPrimary: 0, updatedAt: sql`datetime('now')` })
    .where(and(eq(tenantDomains.agentId, agentId), ne(tenantDomains.id, domainId)));
  await db
    .update(tenantDomains)
    .set({ isPrimary: 1, updatedAt: sql`datetime('now')` })
    .where(and(eq(tenantDomains.agentId, agentId), eq(tenantDomains.id, domainId)));
}

export async function deleteTenantDomainRepo(db: AppDatabase, domainId: number): Promise<void> {
  await db.delete(tenantDomains).where(eq(tenantDomains.id, domainId));
}

export async function listAdminDomainsRepo(db: AppDatabase, statusFilter?: string) {
  const query = db
    .select({
      domain: tenantDomains,
      agentSlug: agents.slug,
      agentBrand: agents.brandName,
    })
    .from(tenantDomains)
    .innerJoin(agents, eq(agents.id, tenantDomains.agentId));

  const rows = statusFilter
    ? await query.where(eq(tenantDomains.status, statusFilter)).orderBy(desc(tenantDomains.id)).limit(200)
    : await query.orderBy(desc(tenantDomains.id)).limit(200);

  return rows.map((r) => mapTenantDomainRow(r.domain, { agentSlug: r.agentSlug, agentBrand: r.agentBrand }));
}
