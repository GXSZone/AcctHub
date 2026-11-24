/**
 * 分站工作台右侧：免费二级域名（只读锁定）与独立域名授权绑定及傻瓜式 DNS 指引卡片
 */

import { Check, Copy, Globe, Info, Loader2, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import type { AgentInfo, TenantDomainItem } from '../../types';
import { AgentSubdomainBox } from './AgentSubdomainBox';

interface AgentDomainCardProps {
  agent: AgentInfo;
  domainConfig: {
    neutral_base_domain: string;
    saas_cname_target: string;
    cf_saas_enabled: boolean;
  };
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

/** 从完整域名拆出 DNS 服务商所需填写的主机记录（如 shop.example.com -> shop，根域 -> @） */
function extractDnsHostPrefix(hostname: string): string {
  const parts = hostname.trim().toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return '@';
  return parts.slice(0, parts.length - 2).join('.');
}

export function AgentDomainCard({ agent, domainConfig, onToast, onError }: AgentDomainCardProps) {
  const ag = useAgentI18n();
  const ss = useSaasI18n();
  const [domains, setDomains] = useState<TenantDomainItem[]>([]);
  const [quota, setQuota] = useState({
    allow_custom_domain: true,
    max_custom_domains: 1,
    used_custom_domains: 0,
  });
  const [loadingList, setLoadingList] = useState(true);
  const [newHostname, setNewHostname] = useState('');
  const [binding, setBinding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState('');

  const copyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? '' : prev)), 1600);
    } catch {
      onToast(val);
    }
  };

  const loadDomains = useCallback(async () => {
    try {
      const res = await tenantAgentApi.listDomains();
      setDomains(res.items || []);
      if (res.quota) setQuota(res.quota);
    } catch (err) {
      onError(err instanceof Error ? err.message : ag.bdDomainBindErr);
    } finally {
      setLoadingList(false);
    }
  }, [ag.bdDomainBindErr, onError]);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  const handleBind = async () => {
    const host = newHostname.trim().toLowerCase();
    if (!host) return;
    setBinding(true);
    onError('');
    try {
      const res = await tenantAgentApi.bindDomain({ hostname: host, is_primary: domains.length === 0 });
      setNewHostname('');
      await loadDomains();
      onToast(res.message || ss.domBindSuccessToast);
    } catch (err) {
      onError(err instanceof Error ? err.message : ag.bdDomainBindErr);
    } finally {
      setBinding(false);
    }
  };

  const statusMeta = (status: TenantDomainItem['status']) => {
    switch (status) {
      case 'active':
        return { bg: 'var(--success-soft)', color: 'var(--success)', label: ss.domStatusActive };
      case 'pending_review':
        return { bg: 'var(--warning-soft)', color: 'var(--warning)', label: ss.domStatusPendingReview };
      case 'expired':
        return { bg: 'var(--danger-soft)', color: 'var(--danger)', label: ss.domStatusExpired };
      case 'revoked':
        return { bg: 'var(--danger-soft)', color: 'var(--danger)', label: ss.domStatusRevoked };
      default:
        return { bg: 'var(--accent-soft)', color: 'var(--accent)', label: ss.domStatusPendingDns };
    }
  };

  return (
    <div className="lg:col-span-5 paper-card rounded-2xl p-6 space-y-4 self-start">
      <div
        className="flex items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ag.domCardTitle}</h2>
        </div>
        <span
          className="px-2 py-0.5 rounded-full text-[10.5px] font-mono-num font-medium"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
        >
          {fmt(ss.domQuotaBadge, { used: quota.used_custom_domains, max: quota.max_custom_domains })}
        </span>
      </div>

      <AgentSubdomainBox
        agentSlug={agent.slug}
        neutralBaseDomain={domainConfig.neutral_base_domain}
        onToast={onToast}
      />

      <div className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <div className="block text-xs font-semibold">{ag.domCustomDomainLabel}</div>

        {!quota.allow_custom_domain ? (
          <div
            className="p-3 rounded-xl border text-xs"
            style={{
              borderColor: 'var(--warning)',
              backgroundColor: 'var(--warning-soft)',
              color: 'var(--warning)',
            }}
          >
            {ss.domNotAllowedBanner}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newHostname}
              onChange={(e) => setNewHostname(e.target.value)}
              placeholder={ss.domBindInputPlaceholder}
              className="acct-input font-mono-num flex-1 text-xs"
            />
            <button
              type="button"
              disabled={binding || !newHostname.trim()}
              onClick={() => void handleBind()}
              className="h-10 px-3.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {binding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {ss.domBindSubmitBtn}
            </button>
          </div>
        )}

        {/* 完整小白 3 步绑定指引 */}
        <div
          className="p-3.5 rounded-xl border text-[11px] space-y-2 leading-relaxed"
          style={{
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--bg-canvas)',
            color: 'var(--ink-secondary)',
          }}
        >
          <div className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {ag.domGuideTitle}
          </div>
          <div>{ag.domGuideStep1}</div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span>
              {ag.domGuideStep2Prefix}{' '}
              <code
                className="px-1 py-0.5 rounded font-mono-num font-semibold"
                style={{ backgroundColor: 'var(--bg-subtle)' }}
              >
                CNAME
              </code>{' '}
              {ag.domGuideStep2Suffix}{' '}
              <code className="font-mono-num font-semibold" style={{ color: 'var(--accent)' }}>
                {domainConfig.saas_cname_target || ag.domCnameWait}
              </code>
            </span>
            {domainConfig.saas_cname_target && (
              <button
                type="button"
                onClick={() => void copyValue('guide-cname', domainConfig.saas_cname_target)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10.5px] cursor-pointer"
                style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
              >
                {copiedKey === 'guide-cname' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedKey === 'guide-cname' ? ag.domCopiedBtn : ag.domCopyCnameBtn}
              </button>
            )}
          </div>
          <div>{domainConfig.cf_saas_enabled ? ag.domGuideStep3 : ag.domGuideStep3Manual}</div>
          <div
            className="flex items-start gap-1.5 pt-1.5 border-t text-[10.5px]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--warning)' }}
          >
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{ag.domDnsCfProxyTip}</span>
          </div>
        </div>

        {loadingList ? (
          <div className="py-4 flex justify-center">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : domains.length === 0 ? (
          <div className="text-[11px] py-2" style={{ color: 'var(--ink-muted)' }}>
            {ss.domEmptyList}
          </div>
        ) : (
          <div className="space-y-2.5">
            {domains.map((d) => {
              const st = statusMeta(d.status);
              const busy = busyId === d.id;
              const hostPrefix = extractDnsHostPrefix(d.hostname);
              const txtHost = hostPrefix === '@' ? '_accthub-verify' : `_accthub-verify.${hostPrefix}`;
              const dnsRows: Array<{ id: string; type: string; host: string; value: string }> = [];
              if (d.status !== 'active') {
                if (domainConfig.saas_cname_target) {
                  dnsRows.push({
                    id: `cname-${d.id}`,
                    type: 'CNAME',
                    host: hostPrefix,
                    value: domainConfig.saas_cname_target,
                  });
                }
                if (d.verification_token) {
                  dnsRows.push({
                    id: `txt-${d.id}`,
                    type: 'TXT',
                    host: txtHost,
                    value: d.verification_token,
                  });
                }
              }

              return (
                <div
                  key={d.id}
                  className="p-3 rounded-xl border text-xs space-y-2.5"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono-num font-semibold truncate">{d.hostname}</span>
                      {d.is_primary && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          <Star className="w-2.5 h-2.5" />
                          {ss.domPrimaryTag}
                        </span>
                      )}
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                      style={{ backgroundColor: st.bg, color: st.color }}
                    >
                      {st.label}
                    </span>
                  </div>

                  {dnsRows.length > 0 && (
                    <div
                      className="rounded-lg border overflow-hidden text-[10.5px]"
                      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div
                        className="grid grid-cols-12 gap-1 px-2.5 py-1.5 font-medium border-b"
                        style={{
                          borderColor: 'var(--border-color)',
                          backgroundColor: 'var(--bg-subtle)',
                          color: 'var(--ink-muted)',
                        }}
                      >
                        <span className="col-span-2">{ag.domDnsTableType}</span>
                        <span className="col-span-4">{ag.domDnsTableHost}</span>
                        <span className="col-span-6">{ag.domDnsTableValue}</span>
                      </div>
                      {dnsRows.map((row) => (
                        <div
                          key={row.id}
                          className="grid grid-cols-12 gap-1 items-center px-2.5 py-1.5 border-b last:border-b-0 font-mono-num"
                          style={{ borderColor: 'var(--border-color)' }}
                        >
                          <span className="col-span-2 font-semibold" style={{ color: 'var(--accent)' }}>
                            {row.type}
                          </span>
                          <button
                            type="button"
                            onClick={() => void copyValue(`${row.id}-h`, row.host)}
                            className="col-span-4 text-left truncate cursor-pointer hover:underline"
                            title={row.host}
                          >
                            {copiedKey === `${row.id}-h` ? ag.domCopiedBtn : row.host}
                          </button>
                          <div className="col-span-6 flex items-center justify-between gap-1 min-w-0">
                            <span className="truncate" title={row.value}>
                              {row.value}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyValue(`${row.id}-v`, row.value)}
                              className="p-1 rounded border shrink-0 cursor-pointer"
                              style={{ borderColor: 'var(--border-strong)' }}
                              aria-label={ag.domCopyCnameBtn}
                            >
                              {copiedKey === `${row.id}-v` ? (
                                <Check className="w-2.5 h-2.5" style={{ color: 'var(--success)' }} />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {ss.domExpiresPrefix}
                    {d.expires_at ? d.expires_at : ss.domPermanentLabel}
                  </div>
                  {d.error_message && (
                    <div className="text-[11px]" style={{ color: 'var(--danger)' }}>
                      {d.error_message}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusyId(d.id);
                        try {
                          const res = await tenantAgentApi.verifyDomainById(d.id);
                          await loadDomains();
                          onToast(res.message);
                        } catch (err) {
                          onError(err instanceof Error ? err.message : ag.bdDomainVerifyErr);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                      style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
                      {ss.domVerifyNowBtn}
                    </button>

                    {!d.is_primary && d.status === 'active' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusyId(d.id);
                          try {
                            await tenantAgentApi.setPrimaryDomain(d.id);
                            await loadDomains();
                            onToast(ss.domSetPrimaryToast);
                          } catch (err) {
                            onError(err instanceof Error ? err.message : ag.bdDomainBindErr);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                        style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                      >
                        <Star className="w-3 h-3" />
                        {ss.domSetPrimaryBtn}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusyId(d.id);
                        try {
                          await tenantAgentApi.deleteDomain(d.id);
                          await loadDomains();
                          onToast(ss.domUnbindDoneToast);
                        } catch (err) {
                          onError(err instanceof Error ? err.message : ag.bdDomainBindErr);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      {ss.domUnbindConfirmBtn}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
