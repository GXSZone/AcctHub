/**
 * 上游配置抽屉 Tab 1：连接鉴权、签名算法、固定 IP 中继代理与沙盒模拟模式
 */

import { KeyRound, Server } from 'lucide-react';
import type React from 'react';
import type { UpstreamSourceRecord } from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminUpstreamDrawerI18n } from '../../i18n/namespaces/admin-upstream-drawer';
import { buildAdapterOptions, buildAuthModeOptions, type SourceEditorDraft } from './upstream-constants';

interface UpstreamDrawerConnectionTabProps {
  sourceDraft: SourceEditorDraft;
  setSourceDraft: React.Dispatch<React.SetStateAction<SourceEditorDraft>>;
  editingSourceMeta: UpstreamSourceRecord | null;
}

export function UpstreamDrawerConnectionTab({
  sourceDraft,
  setSourceDraft,
  editingSourceMeta,
}: UpstreamDrawerConnectionTabProps) {
  const d = useAdminUpstreamDrawerI18n();
  const adapterOptions = buildAdapterOptions(d);
  const authModeOptions = buildAuthModeOptions(d);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <div className="block font-semibold mb-1">{d.connNameLabel}</div>
          <input
            value={sourceDraft.name}
            onChange={(e) => setSourceDraft({ ...sourceDraft, name: e.target.value })}
            placeholder={d.connNamePh}
            className="acct-input"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.connAdapterLabel}</div>
          <select
            value={sourceDraft.adapter_type}
            onChange={(e) => {
              const nextAdapter = e.target.value;
              const opt = adapterOptions.find((o) => o.key === nextAdapter);
              setSourceDraft({
                ...sourceDraft,
                adapter_type: nextAdapter,
                auth_mode: opt?.defaultAuth || sourceDraft.auth_mode,
              });
            }}
            className="acct-input"
          >
            {adapterOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.connAuthLabel}</div>
          <select
            value={sourceDraft.auth_mode || 'header_bearer'}
            onChange={(e) => setSourceDraft({ ...sourceDraft, auth_mode: e.target.value })}
            className="acct-input"
          >
            {authModeOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <div className="block font-semibold mb-1">
            {d.connBaseUrlLabel} {sourceDraft.adapter_type !== 'mock_sandbox' ? '*' : ''}
          </div>
          <input
            value={sourceDraft.base_url}
            onChange={(e) => setSourceDraft({ ...sourceDraft, base_url: e.target.value })}
            placeholder="https://supplier.example.com/api/v1/supplier/products"
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.connAppIdLabel}</div>
          <input
            value={sourceDraft.app_id || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, app_id: e.target.value })}
            placeholder={d.connAppIdPh}
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">
            <KeyRound className="w-3 h-3 inline mr-1" />
            {d.connApiKeyLabel}
          </div>
          <input
            type="password"
            value={sourceDraft.api_key || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, api_key: e.target.value })}
            placeholder={
              editingSourceMeta?.has_api_key
                ? fmt(d.connApiKeySavedPh, { masked: editingSourceMeta.api_key_masked || '' })
                : d.connApiKeyEmptyPh
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.connApiSecretLabel}</div>
          <input
            type="password"
            value={sourceDraft.api_secret || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, api_secret: e.target.value })}
            placeholder={
              editingSourceMeta?.has_api_secret
                ? fmt(d.connApiSecretSavedPh, { masked: editingSourceMeta.api_secret_masked || '' })
                : d.connApiSecretEmptyPh
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.connHeaderLabel}</div>
          <div className="flex gap-1.5">
            <input
              value={sourceDraft.auth_header}
              onChange={(e) => setSourceDraft({ ...sourceDraft, auth_header: e.target.value })}
              placeholder="Authorization"
              className="acct-input font-mono-num flex-1"
            />
            <input
              value={sourceDraft.auth_prefix}
              onChange={(e) => setSourceDraft({ ...sourceDraft, auth_prefix: e.target.value })}
              placeholder="Bearer "
              className="acct-input font-mono-num w-24"
            />
          </div>
        </div>
      </div>

      <div
        className="p-4 rounded-xl border space-y-2.5"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="font-semibold flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {d.connRelayTitle}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {d.connRelayDesc}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            value={sourceDraft.proxy_relay_url || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, proxy_relay_url: e.target.value })}
            placeholder={d.connRelayUrlPh}
            className="acct-input font-mono-num"
          />
          <input
            type="password"
            value={sourceDraft.proxy_relay_token || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, proxy_relay_token: e.target.value })}
            placeholder={
              editingSourceMeta?.has_proxy_relay_token ? d.connRelayTokenSavedPh : d.connRelayTokenEmptyPh
            }
            className="acct-input font-mono-num"
          />
        </div>
      </div>

      {sourceDraft.adapter_type === 'mock_sandbox' && (
        <div
          className="p-3.5 rounded-xl border space-y-2"
          style={{ borderColor: 'var(--warning)', backgroundColor: 'var(--warning-soft)' }}
        >
          <div className="block font-semibold" style={{ color: 'var(--warning)' }}>
            {d.connSandboxTitle}
          </div>
          <select
            value={sourceDraft.sandbox_mode || 'normal'}
            onChange={(e) => setSourceDraft({ ...sourceDraft, sandbox_mode: e.target.value })}
            className="acct-input text-xs"
          >
            <option value="normal">{d.connSandboxNormal}</option>
            <option value="always_fail">{d.connSandboxFail}</option>
            <option value="always_async">{d.connSandboxAsync}</option>
            <option value="always_timeout">{d.connSandboxTimeout}</option>
          </select>
        </div>
      )}
    </div>
  );
}
