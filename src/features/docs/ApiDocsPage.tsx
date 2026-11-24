/**
 * 开放平台与 B2B 批采 API 文档主页面（全量租户化：纯 Host 域名识别、无主站信息泄露）
 */

import { BookOpen, KeyRound, Layers, Lock, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRawRequest, getAuthToken } from '../../api/http';
import { useTenant } from '../../app/TenantContext';
import { useDocsI18n } from '../../i18n/namespaces/docs';
import type { UserProfile } from '../../types';
import { ApiDocsSidebar } from './ApiDocsSidebar';
import { ApiEndpointCard, type LiveCallResult } from './ApiEndpointCard';
import { buildEndpoints, buildGroupMeta, type CodeLang, type EndpointSpec } from './api-docs.catalog';

const LIVE_COOLDOWN_SEC = 3;

export function ApiDocsPage({ user }: { user: UserProfile | null }) {
  const d = useDocsI18n();
  const { tenant, isSubAgent, capabilities, bootstrap } = useTenant();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-worker.workers.dev';
  const brandName = bootstrap?.settings?.brand_name || tenant?.brandName || 'AcctHub';
  const isOwnerAgent = Boolean(
    isSubAgent && user?.role === 'agent' && user.agent?.id && user.agent.id === tenant?.agentId
  );
  // 分站域名下严禁展示 /api/admin/* 管理接口分组
  const isSuperAdmin = user?.role === 'admin' && !isSubAgent;
  const canLiveDebug = Boolean(user && (isSuperAdmin || user.agent));
  const agentApiKey = user?.agent?.api_key || '';

  const [apiKey, setApiKey] = useState(agentApiKey);
  const prevUserIdRef = useRef<number | null>(user?.id ?? null);
  const prevAgentKeyRef = useRef(agentApiKey);

  useEffect(() => {
    const curUserId = user?.id ?? null;
    if (curUserId !== prevUserIdRef.current) {
      prevUserIdRef.current = curUserId;
      prevAgentKeyRef.current = agentApiKey;
      setApiKey(agentApiKey);
      return;
    }
    if (agentApiKey && agentApiKey !== prevAgentKeyRef.current) {
      const priorKey = prevAgentKeyRef.current;
      prevAgentKeyRef.current = agentApiKey;
      setApiKey((prev) => (!prev.trim() || prev === priorKey ? agentApiKey : prev));
    }
  }, [user?.id, agentApiKey]);

  const [codeLang, setCodeLang] = useState<CodeLang>('curl');
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [liveResults, setLiveResults] = useState<Record<string, LiveCallResult>>({});

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setTimeout(() => setCooldownSec((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSec]);

  const groupMeta = useMemo(() => buildGroupMeta(d), [d]);
  const endpoints = useMemo(() => buildEndpoints(d), [d]);

  const allowedGroups = useMemo(
    () => groupMeta.filter((g) => g.id !== 'admin' || isSuperAdmin),
    [groupMeta, isSuperAdmin]
  );

  const allowedEndpoints = useMemo(
    () => endpoints.filter((e) => e.group !== 'admin' || isSuperAdmin),
    [endpoints, isSuperAdmin]
  );

  const visibleEndpoints = useMemo(
    () =>
      activeGroup === 'all' ? allowedEndpoints : allowedEndpoints.filter((e) => e.group === activeGroup),
    [activeGroup, allowedEndpoints]
  );

  if (isSubAgent && !capabilities.show_api_docs && !isOwnerAgent) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="paper-card rounded-2xl p-8 space-y-3">
          <Lock className="w-8 h-8 mx-auto" style={{ color: 'var(--ink-muted)' }} />
          <h1 className="font-editorial text-2xl font-semibold">{brandName}</h1>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {d.sandboxCcNotice}
          </p>
        </div>
      </div>
    );
  }

  const runLiveRequest = async (ep: EndpointSpec) => {
    const canRealCallThis = canLiveDebug && Boolean(ep.liveTestable);
    if (!canRealCallThis) {
      setLiveResults((prev) => ({
        ...prev,
        [ep.id]: { status: 0, durationMs: 0, body: '', loading: true, simulated: true },
      }));
      window.setTimeout(() => {
        setLiveResults((prev) => ({
          ...prev,
          [ep.id]: {
            status: 200,
            durationMs: 14,
            simulated: true,
            body: JSON.stringify(
              {
                _sandbox_mode: 'local_static_preview',
                _note: !canLiveDebug ? d.errGuestMockNote : d.errWriteProtectedNote,
                ...ep.sampleResponse,
              },
              null,
              2
            ),
            loading: false,
          },
        }));
      }, 160);
      return;
    }

    if (cooldownSec > 0) return;
    if (ep.auth === 'reseller_key' && !apiKey.trim()) {
      setLiveResults((prev) => ({
        ...prev,
        [ep.id]: {
          status: 400,
          durationMs: 0,
          body: JSON.stringify({ error: d.errMissingKey }, null, 2),
          loading: false,
        },
      }));
      return;
    }

    setCooldownSec(LIVE_COOLDOWN_SEC);
    setLiveResults((prev) => ({
      ...prev,
      [ep.id]: { status: 0, durationMs: 0, body: '', loading: true },
    }));

    try {
      const targetPath = ep.livePath || ep.path;
      const headers: Record<string, string> = {};
      if (ep.auth === 'reseller_key') {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      } else if (ep.auth === 'user_jwt' || ep.auth === 'admin_jwt') {
        const token = getAuthToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      if (ep.sampleRequestBody) headers['Content-Type'] = 'application/json';

      const res = await apiRawRequest(targetPath, {
        method: ep.method,
        headers,
        body: ep.sampleRequestBody ? JSON.stringify(ep.sampleRequestBody) : undefined,
      });
      setLiveResults((prev) => ({
        ...prev,
        [ep.id]: {
          status: res.status,
          durationMs: res.durationMs,
          edgeCache: res.edgeCache,
          rateRemaining: res.rateRemaining,
          body: JSON.stringify(res.json, null, 2),
          loading: false,
        },
      }));
    } catch (err) {
      setLiveResults((prev) => ({
        ...prev,
        [ep.id]: {
          status: 500,
          durationMs: 0,
          body: JSON.stringify({ error: err instanceof Error ? err.message : 'Network error' }, null, 2),
          loading: false,
        },
      }));
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col lg:flex-row items-start gap-8">
        <ApiDocsSidebar
          activeGroup={activeGroup}
          allowedGroups={allowedGroups}
          allowedCount={allowedEndpoints.length}
          visibleEndpoints={visibleEndpoints}
          onSelectGroup={setActiveGroup}
        />

        <main className="flex-1 min-w-0 space-y-6">
          <section className="paper-card rounded-2xl p-6 sm:p-8 space-y-5">
            <div>
              <div
                className="text-[11px] font-mono-num uppercase tracking-[0.15em]"
                style={{ color: 'var(--accent)' }}
              >
                {brandName.toUpperCase()} DEVELOPER REFERENCE · V1
              </div>
              <h1 className="font-editorial text-3xl sm:text-4xl font-semibold mt-1">
                {isSubAgent ? `${brandName} API` : d.pageTitle}
              </h1>
              <p className="text-sm mt-2 leading-relaxed max-w-3xl" style={{ color: 'var(--ink-secondary)' }}>
                {d.pageSubtitlePrefix}
                <code className="font-mono-num">API_DOCS.md</code>
                {d.pageSubtitleSuffix}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div
                className="p-4 rounded-xl border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  Base URL
                </div>
                <code className="font-mono-num text-[11.5px] break-all">{origin}</code>
              </div>
              <div
                className="p-4 rounded-xl border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                  {d.authCardTitle}
                </div>
                <p style={{ color: 'var(--ink-secondary)' }}>
                  {d.authCardDescPart1}
                  <code>Bearer ah_agent_...</code>
                  {d.authCardDescPart2}
                  <code>X-Turnstile-Token</code>
                  {d.authCardDescPart3}
                </p>
              </div>
              <div
                className="p-4 rounded-xl border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <Layers className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  {d.tenantCardTitle}
                </div>
                <p style={{ color: 'var(--ink-secondary)' }}>
                  <code>Host: {typeof window !== 'undefined' ? window.location.host : 'your-domain'}</code>
                </p>
              </div>
            </div>

            <div
              className="p-4 rounded-2xl border space-y-3"
              style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <BookOpen className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  {d.sandboxTitlePrefix}
                  {canLiveDebug ? d.sandboxModeAuthed : d.sandboxModeGuest}
                  {d.sandboxTitleSuffix}
                </div>
                <div
                  className="inline-flex rounded-full border p-0.5 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
                >
                  {(['curl', 'ts', 'go'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setCodeLang(l)}
                      className="px-3 py-1 rounded-full font-mono-num text-[11px] cursor-pointer"
                      style={{
                        backgroundColor: codeLang === l ? 'var(--accent)' : 'transparent',
                        color: codeLang === l ? '#FAF9F5' : 'var(--ink-secondary)',
                      }}
                    >
                      {l === 'curl' ? 'cURL' : l === 'ts' ? 'TypeScript' : 'Go'}
                    </button>
                  ))}
                </div>
              </div>

              {!canLiveDebug && (
                <div
                  className="px-3.5 py-2.5 rounded-xl border text-[11.5px] flex items-center gap-2"
                  style={{
                    borderColor: 'var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span>{d.sandboxCcNotice}</span>
                </div>
              )}

              <div>
                <div className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  {d.apiKeyLabel}
                </div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={d.apiKeyPlaceholder}
                  className="acct-input py-1.5 text-xs font-mono-num"
                />
              </div>
            </div>
          </section>

          <div className="space-y-5">
            {visibleEndpoints.map((ep) => (
              <ApiEndpointCard
                key={ep.id}
                ep={ep}
                codeLang={codeLang}
                origin={origin}
                canLiveDebug={canLiveDebug}
                cooldownSec={cooldownSec}
                copiedId={copiedId}
                live={liveResults[ep.id]}
                onCopySnippet={async (epId, snippet) => {
                  await navigator.clipboard.writeText(snippet);
                  setCopiedId(epId);
                  setTimeout(() => setCopiedId(null), 1500);
                }}
                onRunLive={(target) => void runLiveRequest(target)}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
