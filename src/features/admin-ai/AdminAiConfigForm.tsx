/**
 * AI 文案引擎模型接口配置表单（总控后台左栏）
 */

import { AI_MODEL_PRESETS } from '@shared/index';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, Save, Sliders, Trash2 } from 'lucide-react';
import type React from 'react';
import type { AiConfigResponse, AiProviderType } from '../../api/ai.api';
import { fmt } from '../../i18n';
import { type AdminAiDict, useAdminAiI18n } from '../../i18n/namespaces/admin-ai';

export function buildAiProviderCards(
  aai: AdminAiDict
): Array<{ key: AiProviderType; label: string; desc: string }> {
  return [
    { key: 'openai_compatible', label: aai.aiProvOpenAiLabel, desc: aai.aiProvOpenAiDesc },
    { key: 'anthropic', label: aai.aiProvAnthropicLabel, desc: aai.aiProvAnthropicDesc },
    { key: 'gemini', label: aai.aiProvGeminiLabel, desc: aai.aiProvGeminiDesc },
  ];
}

interface AdminAiConfigFormProps {
  config: AiConfigResponse | null;
  provider: AiProviderType;
  baseUrl: string;
  apiKeyInput: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  saving: boolean;
  testing: boolean;
  testResult: { ok: boolean; duration_ms?: number; model?: string; reply: string } | null;
  onProviderChange: (v: AiProviderType) => void;
  onBaseUrlChange: (v: string) => void;
  onApiKeyInputChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onTemperatureChange: (v: number) => void;
  onSystemPromptChange: (v: string) => void;
  onSave: (e?: React.FormEvent) => void;
  onClearKey: () => void;
  onTest: () => void;
}

export function AdminAiConfigForm({
  config,
  provider,
  baseUrl,
  apiKeyInput,
  model,
  temperature,
  systemPrompt,
  saving,
  testing,
  testResult,
  onProviderChange,
  onBaseUrlChange,
  onApiKeyInputChange,
  onModelChange,
  onTemperatureChange,
  onSystemPromptChange,
  onSave,
  onClearKey,
  onTest,
}: AdminAiConfigFormProps) {
  const aai = useAdminAiI18n();
  const providerCards = buildAiProviderCards(aai);
  return (
    <form onSubmit={onSave} className="lg:col-span-7 paper-card rounded-2xl p-6 space-y-5 text-xs">
      <div
        className="flex items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{aai.aiFormTitle}</h2>
        </div>
        {config?.has_api_key && (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono-num"
            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
          >
            <KeyRound className="w-3 h-3" />
            {fmt(aai.aiFormKeyBadge, { masked: config.api_key_masked })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {providerCards.map((card) => {
          const active = provider === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onProviderChange(card.key)}
              className="p-3.5 rounded-xl border text-left cursor-pointer transition-colors space-y-1"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-canvas)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="font-semibold"
                  style={{ color: active ? 'var(--accent)' : 'var(--ink-primary)' }}
                >
                  {card.label}
                </span>
                {active && (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                )}
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                {card.desc}
              </p>
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          {aai.aiFormPresetsLabel}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AI_MODEL_PRESETS.map((preset) => {
            const isSelected = baseUrl === preset.base_url && model === preset.model;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onProviderChange(preset.provider);
                  onBaseUrlChange(preset.base_url);
                  onModelChange(preset.model);
                }}
                className="px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors"
                style={{
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border-strong)',
                  backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                  color: isSelected ? 'var(--accent)' : 'var(--ink-primary)',
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <div className="block font-semibold mb-1">{aai.aiFormBaseUrlLabel}</div>
          <input
            required
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="acct-input font-mono-num"
          />
        </div>

        <div>
          <div className="block font-semibold mb-1">{aai.aiFormModelLabel}</div>
          <input
            required
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="gpt-5-mini / claude-sonnet-4-6 / gemini-2.5-flash"
            className="acct-input font-mono-num"
          />
        </div>

        <div>
          <div className="block font-semibold mb-1">{aai.aiFormTempLabel}</div>
          <input
            type="number"
            step="0.1"
            min="0"
            max="1.2"
            value={temperature}
            onChange={(e) => onTemperatureChange(Number(e.target.value))}
            className="acct-input font-mono-num"
          />
        </div>

        <div className="sm:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold">
              API Key {config?.has_api_key ? aai.aiFormApiKeyLabelKeep : '*'}
            </span>
            {config?.has_api_key && (
              <button
                type="button"
                onClick={onClearKey}
                className="inline-flex items-center gap-1 text-[11px] cursor-pointer"
                style={{ color: 'var(--danger)' }}
              >
                <Trash2 className="w-3 h-3" />
                {aai.aiFormClearKeyBtn}
              </button>
            )}
          </div>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => onApiKeyInputChange(e.target.value)}
            placeholder={
              config?.has_api_key
                ? fmt(aai.aiFormApiKeyPhMasked, { masked: config.api_key_masked })
                : aai.aiFormApiKeyPhEmpty
            }
            className="acct-input font-mono-num"
          />
        </div>
      </div>

      <div>
        <div className="block font-semibold mb-1">{aai.aiFormSysPromptLabel}</div>
        <textarea
          rows={3}
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          className="acct-input leading-relaxed"
        />
      </div>

      {testResult && (
        <div
          className="p-3.5 rounded-xl border text-xs space-y-1"
          style={{
            borderColor: testResult.ok ? 'var(--success)' : 'var(--danger)',
            backgroundColor: testResult.ok ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: testResult.ok ? 'var(--success)' : 'var(--danger)',
          }}
        >
          <div className="font-semibold flex items-center gap-1.5">
            {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {testResult.ok
              ? fmt(aai.aiFormTestOkHeadline, {
                  model: testResult.model || '',
                  ms: testResult.duration_ms || 0,
                })
              : aai.aiFormTestFailHeadline}
          </div>
          <div style={{ color: 'var(--ink-primary)' }}>{testResult.reply}</div>
        </div>
      )}

      <div className="pt-2 flex flex-wrap items-center gap-2.5">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {aai.aiFormSaveBtn}
        </button>
        <button
          type="button"
          disabled={testing || saving}
          onClick={onTest}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border font-medium cursor-pointer disabled:opacity-50"
          style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
        >
          {testing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          )}
          {aai.aiFormSaveTestBtn}
        </button>
      </div>
    </form>
  );
}
