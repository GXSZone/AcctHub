/**
 * 独立发卡邮箱配置面板（主站与代理分站通用，基于 TanStack Query v5 管理服务端状态）
 */

import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail, RefreshCw, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { agentApi } from '../../api/agent.api';
import { fmt } from '../../i18n';
import { useMailI18n } from '../../i18n/namespaces/mail';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { toast } from '../../lib/toast';
import { useAdminMailConfigQuery } from '../../queries/admin.queries';
import { useAgentMailConfigQuery } from '../../queries/agent.queries';
import type { MailProvider } from '../../types';
import { MailDeliveryLogsTable } from './MailDeliveryLogsTable';

interface MailConfigPanelProps {
  mode: 'admin' | 'agent';
  defaultBrandName?: string;
  showToast: (msg: string) => void;
}

export function MailConfigPanel({ mode, defaultBrandName = '', showToast }: MailConfigPanelProps) {
  const mt = useMailI18n();
  const rf = useRiskControlI18n();
  const providerHints: Record<MailProvider, { name: string; hint: string; keyPlaceholder: string }> = {
    resend: {
      name: mt.provResendName,
      hint: mt.provResendHint,
      keyPlaceholder: 're_xxxxxxxxxxxxxxxxxxxxxxxx',
    },
    brevo: { name: mt.provBrevoName, hint: mt.provBrevoHint, keyPlaceholder: 'xkeysib-xxxxxxxxxxxxxxxxxxxx' },
    mailgun: {
      name: mt.provMailgunName,
      hint: mt.provMailgunHint,
      keyPlaceholder: 'key-xxxxxxxxxxxxxxxxxxxx',
    },
    custom_webhook: { name: mt.provCustomName, hint: mt.provCustomHint, keyPlaceholder: mt.provCustomKeyPh },
  };

  const isAgent = mode === 'agent';
  const adminQuery = useAdminMailConfigQuery(!isAgent);
  const agentQuery = useAgentMailConfigQuery(isAgent);
  const activeQuery = isAgent ? agentQuery : adminQuery;

  const config = activeQuery.data?.config || null;
  const logs = activeQuery.data?.logs || [];

  const [enabled, setEnabled] = useState(false);
  const [autoSendOrder, setAutoSendOrder] = useState(true);
  const [autoSendRestock, setAutoSendRestock] = useState(true);
  const [provider, setProvider] = useState<MailProvider>('resend');
  const [fromName, setFromName] = useState(defaultBrandName);
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [mailgunDomain, setMailgunDomain] = useState('');
  const [footerNote, setFooterNote] = useState('');
  const [subjectTpl, setSubjectTpl] = useState('');
  const [bodyTpl, setBodyTpl] = useState('');
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setAutoSendOrder(config.auto_send_order);
    setAutoSendRestock(config.auto_send_restock);
    setProvider(config.provider || 'resend');
    setFromName(config.from_name || defaultBrandName);
    setFromEmail(config.from_email || '');
    setReplyTo(config.reply_to || '');
    setApiEndpoint(config.api_endpoint || '');
    setMailgunDomain(config.mailgun_domain || '');
    setFooterNote(config.footer_note || '');
    setSubjectTpl(config.order_email_subject_tpl || '');
    setBodyTpl(config.order_email_body_tpl || '');
  }, [config, defaultBrandName]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isAgent ? agentApi.updateMailConfig(payload) : adminApi.updateMailConfig(payload),
    onSuccess: async (_res, vars) => {
      toast.clearErrors();
      setApiKeyInput('');
      await activeQuery.refetch();
      showToast(vars.clear_api_key ? mt.keyClearedToast : isAgent ? mt.savedAgentToast : mt.savedAdminToast);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : mt.saveFailErr),
  });

  const testMutation = useMutation({
    mutationFn: (email: string) => (isAgent ? agentApi.sendTestMail(email) : adminApi.sendTestMail(email)),
    onSuccess: async (res, email) => {
      toast.clearErrors();
      showToast(
        fmt(mt.testSentToast, {
          provider: res.provider?.toUpperCase() || provider,
          email,
        })
      );
      await activeQuery.refetch();
    },
    onError: async (err) => {
      toast.error(err instanceof Error ? err.message : mt.testFailErr);
      await activeQuery.refetch();
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      enabled,
      auto_send_order: autoSendOrder,
      auto_send_restock: autoSendRestock,
      provider,
      from_name: fromName,
      from_email: fromEmail,
      reply_to: replyTo,
      api_endpoint: apiEndpoint,
      mailgun_domain: mailgunDomain,
      footer_note: footerNote,
      order_email_subject_tpl: subjectTpl,
      order_email_body_tpl: bodyTpl,
    };
    if (apiKeyInput.trim()) payload.api_key = apiKeyInput.trim();
    saveMutation.mutate(payload);
  };

  const handleSendTest = () => {
    const email = testEmail.trim();
    if (!email) {
      toast.error(mt.testEmailRequiredErr);
      return;
    }
    testMutation.mutate(email);
  };

  const providerMeta = providerHints[provider];
  const queryErrorMsg = activeQuery.error instanceof Error ? activeQuery.error.message : '';
  useEffect(() => {
    if (queryErrorMsg) toast.error(queryErrorMsg);
  }, [queryErrorMsg]);

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div
        className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">
              {isAgent ? mt.titleAgent : mt.titleAdmin}
            </h2>
            <span
              className="text-[10.5px] font-medium px-2.5 py-0.5 rounded-full"
              style={{
                backgroundColor: enabled ? 'var(--success-soft)' : 'var(--bg-subtle)',
                color: enabled ? 'var(--success)' : 'var(--ink-muted)',
              }}
            >
              {enabled ? mt.statusEnabled : mt.statusDisabled}
            </span>
          </div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {isAgent ? mt.descAgent : mt.descAdmin}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void activeQuery.refetch()}
          className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer inline-flex items-center gap-1"
          style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${activeQuery.isFetching ? 'animate-spin' : ''}`} />
          {mt.refreshBtn}
        </button>
      </div>

      {activeQuery.isLoading && !config ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : (
        <>
          <form onSubmit={handleSave} className="space-y-4">
            <div
              className="p-3.5 rounded-xl border flex flex-wrap items-center gap-5 text-xs"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                {isAgent ? mt.enableAgent : mt.enableAdmin}
              </label>
              <label
                className="inline-flex items-center gap-2 cursor-pointer"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={autoSendOrder}
                  onChange={(e) => setAutoSendOrder(e.target.checked)}
                />
                {mt.autoOrderLabel}
              </label>
              <label
                className="inline-flex items-center gap-2 cursor-pointer"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={autoSendRestock}
                  onChange={(e) => setAutoSendRestock(e.target.checked)}
                />
                {mt.autoRestockLabel}
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
              <div>
                <div className="block font-semibold mb-1">{mt.providerLabel}</div>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as MailProvider)}
                  className="acct-input text-xs"
                >
                  {(Object.keys(providerHints) as MailProvider[]).map((k) => (
                    <option key={k} value={k}>
                      {providerHints[k].name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="block font-semibold mb-1">{mt.fromNameLabel}</div>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder={defaultBrandName || mt.fromNamePhFallback}
                  className="acct-input text-xs"
                />
              </div>

              <div>
                <div className="block font-semibold mb-1">{mt.fromEmailLabel}</div>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="noreply@yourdomain.com"
                  className="acct-input text-xs font-mono-num"
                />
              </div>

              <div>
                <div className="block font-semibold mb-1">{mt.replyToLabel}</div>
                <input
                  type="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@yourdomain.com"
                  className="acct-input text-xs font-mono-num"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold">
                    {provider === 'custom_webhook' ? mt.webhookTokenLabel : mt.apiKeyLabel}
                  </span>
                  {config?.has_api_key && (
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px]"
                      style={{ color: 'var(--success)' }}
                    >
                      <ShieldCheck className="w-3 h-3" />
                      {fmt(mt.savedKeyBadge, { masked: config.api_key_masked })}
                      <button
                        type="button"
                        onClick={() => saveMutation.mutate({ clear_api_key: true })}
                        className="inline-flex items-center gap-0.5 underline cursor-pointer"
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 className="w-3 h-3" />
                        {mt.clearBtn}
                      </button>
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={config?.has_api_key ? mt.keyKeepPlaceholder : providerMeta.keyPlaceholder}
                  className="acct-input text-xs font-mono-num"
                />
              </div>

              {provider === 'mailgun' && (
                <div>
                  <div className="block font-semibold mb-1">{mt.mailgunDomainLabel}</div>
                  <input
                    type="text"
                    value={mailgunDomain}
                    onChange={(e) => setMailgunDomain(e.target.value)}
                    placeholder="mg.yourdomain.com"
                    className="acct-input text-xs font-mono-num"
                  />
                </div>
              )}

              {(provider === 'custom_webhook' || provider === 'mailgun') && (
                <div className={provider === 'custom_webhook' ? '' : 'md:col-span-2'}>
                  <div className="block font-semibold mb-1">
                    {provider === 'custom_webhook' ? mt.customEndpointLabel : mt.mailgunEndpointLabel}
                  </div>
                  <input
                    type="url"
                    value={apiEndpoint}
                    onChange={(e) => setApiEndpoint(e.target.value)}
                    placeholder={
                      provider === 'custom_webhook'
                        ? 'https://mail-relay.yourdomain.com/send'
                        : 'https://api.eu.mailgun.net/v3/mg.yourdomain.com/messages'
                    }
                    className="acct-input text-xs font-mono-num"
                  />
                </div>
              )}

              <div className="md:col-span-2">
                <div className="block font-semibold mb-1">{mt.footerNoteLabel}</div>
                <input
                  type="text"
                  value={footerNote}
                  onChange={(e) => setFooterNote(e.target.value)}
                  placeholder={mt.footerNotePh}
                  className="acct-input text-xs"
                />
              </div>

              <div
                className="md:col-span-2 p-3.5 rounded-xl border space-y-2.5"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="font-semibold">{rf.mailTplSectionTitle}</div>
                <div>
                  <div
                    className="block text-[11px] font-medium mb-1"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {rf.mailTplSubjectLabel}
                  </div>
                  <input
                    type="text"
                    value={subjectTpl}
                    onChange={(e) => setSubjectTpl(e.target.value)}
                    placeholder={rf.mailTplSubjectPh}
                    className="acct-input text-xs"
                  />
                </div>
                <div>
                  <div
                    className="block text-[11px] font-medium mb-1"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {rf.mailTplBodyLabel}
                  </div>
                  <textarea
                    rows={4}
                    value={bodyTpl}
                    onChange={(e) => setBodyTpl(e.target.value)}
                    placeholder={rf.mailTplBodyPh}
                    className="acct-input font-mono-num text-xs"
                  />
                </div>
                <div className="text-[10.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                  {rf.mailTplVarsHint}
                </div>
              </div>
            </div>

            <div
              className="p-3 rounded-xl text-[11.5px] leading-relaxed"
              style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-secondary)' }}
            >
              <strong>{mt.guidePrefix}</strong>
              {providerMeta.hint}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {mt.saveBtn}
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder={mt.testEmailPh}
                  className="acct-input h-9 w-56 text-xs font-mono-num"
                />
                <button
                  type="button"
                  disabled={testMutation.isPending || !testEmail.trim()}
                  onClick={handleSendTest}
                  className="h-9 px-4 rounded-xl border text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-45"
                  style={{
                    borderColor: 'var(--accent)',
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent)',
                  }}
                >
                  {testMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {mt.sendTestBtn}
                </button>
              </div>
            </div>
          </form>

          <MailDeliveryLogsTable logs={logs} isAgent={isAgent} />
        </>
      )}
    </div>
  );
}
