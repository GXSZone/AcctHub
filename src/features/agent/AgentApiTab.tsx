/**
 * 分站工作台 Tab 8：对接 B2B API 密钥、发卡网标准参数、实时联调与 IP 白名单
 */

import { discountDisplay } from '@shared/domain/money';
import { Check, Copy, Loader2, Play, RefreshCw, Save, Shield, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { agentApi } from '../../api/agent.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import type { AgentInfo } from '../../types';

interface AgentApiTabProps {
  agent: AgentInfo;
  myDiscountFloor: number;
  apiBaseOrigin: string;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentApiTab({
  agent,
  myDiscountFloor,
  apiBaseOrigin,
  onRefresh,
  onToast,
  onError,
}: AgentApiTabProps) {
  const ag = useAgentI18n();
  const [copiedKey, setCopiedKey] = useState(false);
  const [apiOutput, setApiOutput] = useState('');
  const [apiTesting, setApiTesting] = useState(false);
  const [ipWhitelist, setIpWhitelist] = useState(agent.api_ip_whitelist || '');
  const [savingWhitelist, setSavingWhitelist] = useState(false);

  useEffect(() => {
    setIpWhitelist(agent.api_ip_whitelist || '');
  }, [agent.api_ip_whitelist]);

  const handleRotateKey = async () => {
    const ok = await openConfirm({
      title: ag.apiRotateTitle,
      description: ag.apiRotateDesc,
      confirmLabel: ag.apiRotateConfirm,
      tone: 'danger',
    });
    if (!ok) return;
    await agentApi.rotateKey();
    await onRefresh();
    onToast(ag.apiRotatedToast);
  };

  const runLiveTest = async (endpoint: '/balance' | '/products') => {
    if (!agent.api_key) return;
    setApiTesting(true);
    try {
      const data = await agentApi.testResellerApi(agent.api_key, endpoint);
      setApiOutput(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiOutput(JSON.stringify({ error: err instanceof Error ? err.message : 'Request failed' }, null, 2));
    } finally {
      setApiTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="paper-card rounded-2xl p-6 space-y-5">
        <div
          className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <h2 className="font-editorial text-xl font-semibold">{ag.apiTitle}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ag.apiDescPart1}{' '}
              {fmt(ag.apiDescPart2, {
                ...discountDisplay(myDiscountFloor),
              })}
            </p>
          </div>
          <Link
            to="/docs"
            className="text-xs font-medium underline underline-offset-2"
            style={{ color: 'var(--accent)' }}
          >
            {ag.apiViewDocsBtn}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex-1 min-w-[240px] px-4 py-2.5 rounded-xl border font-mono-num text-xs truncate"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            {agent.api_key}
          </div>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(agent.api_key);
              setCopiedKey(true);
              setTimeout(() => setCopiedKey(false), 1800);
            }}
            className="px-4 py-2.5 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
          >
            {copiedKey ? (
              <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedKey ? ag.apiKeyCopied : ag.apiCopyKey}
          </button>
          <button
            type="button"
            onClick={() => void handleRotateKey()}
            className="px-4 py-2.5 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {ag.apiRotateBtn}
          </button>
        </div>

        <div
          className="p-4 rounded-xl border space-y-2 text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <div className="font-semibold flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {ag.apiParamsHeading}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono-num text-[11.5px]">
            <div>
              {ag.apiCatalogEndpoint}
              <span style={{ color: 'var(--accent)' }}>{apiBaseOrigin}/api/v1/reseller/compat/catalog</span>
            </div>
            <div>
              {ag.apiPurchaseEndpoint}
              <span style={{ color: 'var(--accent)' }}>{apiBaseOrigin}/api/v1/reseller/order</span>
            </div>
            <div>{ag.apiAuthHint}</div>
            <div>
              {ag.apiBalanceEndpoint}
              <span style={{ color: 'var(--accent)' }}>{apiBaseOrigin}/api/v1/reseller/balance</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={apiTesting}
            onClick={() => void runLiveTest('/balance')}
            className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Play className="w-3.5 h-3.5" />
            {ag.apiTestBalanceBtn}
          </button>
          <button
            type="button"
            disabled={apiTesting}
            onClick={() => void runLiveTest('/products')}
            className="px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
          >
            <Play className="w-3.5 h-3.5" />
            {ag.apiTestCatalogBtn}
          </button>
        </div>

        {apiOutput && (
          <pre
            className="p-4 rounded-xl border font-mono-num text-[11px] max-h-72 overflow-auto"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            {apiOutput}
          </pre>
        )}
      </div>

      <div className="paper-card rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h3 className="font-editorial text-lg font-semibold">{ag.apiWhitelistTitle}</h3>
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {ag.apiWhitelistDesc}
        </p>
        <textarea
          rows={3}
          value={ipWhitelist}
          onChange={(e) => setIpWhitelist(e.target.value)}
          placeholder={ag.apiWhitelistPlaceholder}
          className="acct-input font-mono-num text-xs"
        />
        <button
          type="button"
          disabled={savingWhitelist}
          onClick={async () => {
            setSavingWhitelist(true);
            onError('');
            try {
              const res = await agentApi.updateIpWhitelist(ipWhitelist);
              setIpWhitelist(res.api_ip_whitelist);
              onToast(
                res.count > 0
                  ? fmt(ag.apiWhitelistSavedToast, { count: res.count })
                  : ag.apiWhitelistClearedToast
              );
            } catch (err) {
              onError(err instanceof Error ? err.message : ag.apiWhitelistFailErr);
            } finally {
              setSavingWhitelist(false);
            }
          }}
          className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {savingWhitelist ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {ag.apiSaveWhitelistBtn}
        </button>
      </div>
    </div>
  );
}
