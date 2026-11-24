/**
 * 总管理员专属 AI 商品文案优化引擎面板（基于 TanStack Query v5）
 */

import { Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type AiConfigResponse, type AiProviderType, aiApi } from '../../api/ai.api';
import { fmt } from '../../i18n';
import { useAdminAiI18n } from '../../i18n/namespaces/admin-ai';
import { useAdminAiConfigQuery } from '../../queries/admin.queries';
import { AdminAiConfigForm, buildAiProviderCards } from './AdminAiConfigForm';
import { type AdminAiProductSample, AdminAiSandbox } from './AdminAiSandbox';

interface AdminAiPanelProps {
  products: AdminAiProductSample[];
  onAppliedToProduct: () => void;
  showToast: (msg: string) => void;
}

export function AdminAiPanel({ products, onAppliedToProduct, showToast }: AdminAiPanelProps) {
  const aai = useAdminAiI18n();
  const aiConfigQuery = useAdminAiConfigQuery(true);
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [provider, setProvider] = useState<AiProviderType>('openai_compatible');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [model, setModel] = useState('gpt-5-mini');
  const [temperature, setTemperature] = useState(0.6);
  const [systemPrompt, setSystemPrompt] = useState('');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    duration_ms?: number;
    model?: string;
    reply: string;
  } | null>(null);

  useEffect(() => {
    const cfg = aiConfigQuery.data?.config;
    if (!cfg) return;
    setConfig(cfg);
    setProvider(cfg.provider);
    setBaseUrl(cfg.base_url);
    setModel(cfg.model);
    setTemperature(cfg.temperature);
    setSystemPrompt(cfg.system_prompt);
    setApiKeyInput('');
  }, [aiConfigQuery.data]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await aiApi.updateConfig({
        provider,
        base_url: baseUrl,
        api_key: apiKeyInput.trim() || undefined,
        model,
        temperature,
        system_prompt: systemPrompt,
      });
      setConfig(res.config);
      setApiKeyInput('');
      showToast(aai.aiSavedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : aai.aiSaveFailErr);
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    try {
      const res = await aiApi.updateConfig({ clear_api_key: true });
      setConfig(res.config);
      setApiKeyInput('');
      showToast(aai.aiKeyClearedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : aai.aiClearFailErr);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await aiApi.updateConfig({
        provider,
        base_url: baseUrl,
        api_key: apiKeyInput.trim() || undefined,
        model,
        temperature,
        system_prompt: systemPrompt,
      });
      setApiKeyInput('');
      const refreshed = await aiConfigQuery.refetch();
      if (refreshed.data?.config) setConfig(refreshed.data.config);

      const res = await aiApi.testConnection();
      setTestResult({ ok: true, duration_ms: res.duration_ms, model: res.model, reply: res.reply });
      showToast(fmt(aai.aiTestOkToast, { ms: res.duration_ms }));
    } catch (err) {
      setTestResult({ ok: false, reply: err instanceof Error ? err.message : aai.aiTestFailErr });
    } finally {
      setTesting(false);
    }
  };

  if (aiConfigQuery.isLoading && !config) {
    return (
      <div className="paper-card rounded-2xl p-12 flex items-center justify-center gap-2 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
        {aai.aiLoading}
      </div>
    );
  }

  if (aiConfigQuery.error) {
    return (
      <div
        className="paper-card rounded-2xl p-6 border flex items-start gap-3 text-xs"
        style={{
          borderColor: 'var(--danger)',
          backgroundColor: 'var(--danger-soft)',
          color: 'var(--danger)',
        }}
      >
        <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-sm">{aai.aiNoAccessTitle}</div>
          <p className="mt-1">
            {aiConfigQuery.error instanceof Error ? aiConfigQuery.error.message : aai.aiLoadFailErr}
          </p>
        </div>
      </div>
    );
  }

  const providerLabel = buildAiProviderCards(aai).find((p) => p.key === provider)?.label || provider;

  return (
    <div className="space-y-6">
      <div
        className="paper-card rounded-2xl p-5 border flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        style={{ borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border-color))' }}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {aai.aiHeroBadge}
            </span>
            <span className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
              {fmt(aai.aiHeroChannelMeta, { channel: providerLabel, model })}
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {aai.aiHeroDesc}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <AdminAiConfigForm
          config={config}
          provider={provider}
          baseUrl={baseUrl}
          apiKeyInput={apiKeyInput}
          model={model}
          temperature={temperature}
          systemPrompt={systemPrompt}
          saving={saving}
          testing={testing}
          testResult={testResult}
          onProviderChange={setProvider}
          onBaseUrlChange={setBaseUrl}
          onApiKeyInputChange={setApiKeyInput}
          onModelChange={setModel}
          onTemperatureChange={setTemperature}
          onSystemPromptChange={setSystemPrompt}
          onSave={(e) => void handleSave(e)}
          onClearKey={() => void handleClearKey()}
          onTest={() => void handleTest()}
        />
        <AdminAiSandbox products={products} onAppliedToProduct={onAppliedToProduct} showToast={showToast} />
      </div>
    </div>
  );
}
