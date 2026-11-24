/**
 * 全局 SaaS 多租户上下文（100% 由当前域名 Host 与 bootstrap 响应驱动）
 */

import type { TenantCapabilitiesDto } from '@shared/index';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { ApiRequestError, getCurrentHostScope } from '../api/http';
import type { BootstrapPayload, TenantInfo } from '../types';

const DEFAULT_CAPABILITIES: TenantCapabilitiesDto = {
  allow_custom_domain: false,
  max_custom_domains: 0,
  allow_private_products: false,
  allow_own_payment: false,
  show_api_docs: true,
  inherit_platform_help: true,
};

export interface TenantContextValue {
  host: string;
  bootstrap: BootstrapPayload | null;
  tenant: TenantInfo | null;
  isSubAgent: boolean;
  isMainSite: boolean;
  capabilities: TenantCapabilitiesDto;
  isUnauthorizedDomain: boolean;
  unauthorizedMessage: string | null;
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  host: 'localhost',
  bootstrap: null,
  tenant: null,
  isSubAgent: false,
  isMainSite: true,
  capabilities: DEFAULT_CAPABILITIES,
  isUnauthorizedDomain: false,
  unauthorizedMessage: null,
  isLoading: false,
});

export function TenantProvider({
  bootstrap,
  isLoading,
  error,
  children,
}: {
  bootstrap: BootstrapPayload | null;
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  const host = getCurrentHostScope();
  const isUnauthorizedDomain = Boolean(
    (error instanceof ApiRequestError && (error.code === 'UNAUTHORIZED_DOMAIN' || error.status === 403)) ||
      bootstrap?.tenant?.resolvedVia === 'unauthorized'
  );
  const unauthorizedMessage = error instanceof Error ? error.message : null;

  const value = useMemo<TenantContextValue>(() => {
    const tenant = bootstrap?.tenant ?? null;
    const isSubAgent = Boolean(tenant?.isSubAgent);
    return {
      host,
      bootstrap,
      tenant,
      isSubAgent,
      isMainSite: !isSubAgent,
      capabilities: tenant?.capabilities ?? DEFAULT_CAPABILITIES,
      isUnauthorizedDomain,
      unauthorizedMessage,
      isLoading,
    };
  }, [bootstrap, host, isLoading, isUnauthorizedDomain, unauthorizedMessage]);

  if (isUnauthorizedDomain) {
    return (
      <TenantContext.Provider value={value}>
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{ background: 'var(--bg-canvas)', color: 'var(--ink-primary)' }}
        >
          <div
            className="max-w-md w-full rounded-2xl border p-8 text-center shadow-sm"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <div className="text-4xl font-bold mb-2" style={{ color: 'var(--accent)' }}>
              403
            </div>
            <h1 className="text-lg font-semibold mb-2">Domain Not Authorized</h1>
            <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--ink-secondary)' }}>
              {unauthorizedMessage || 'This domain is not authorized or has been suspended.'}
            </p>
            <div
              className="inline-block px-3 py-1 rounded-full text-[11px] font-mono"
              style={{ background: 'var(--bg-muted)', color: 'var(--ink-muted)' }}
            >
              {host}
            </div>
          </div>
        </div>
      </TenantContext.Provider>
    );
  }

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  return useContext(TenantContext);
}
