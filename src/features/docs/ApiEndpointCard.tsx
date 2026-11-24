/**
 * 单个 API 端点详情卡片（含参数表、多语言代码片段与实时联调响应面板）
 */

import { Check, Clock, Copy, Loader2, Play, ShieldCheck } from 'lucide-react';
import { fmt } from '../../i18n';
import { useDocsI18n } from '../../i18n/namespaces/docs';
import type { CodeLang, EndpointSpec } from './api-docs.catalog';
import { buildSnippet, methodStyle } from './api-docs.snippets';

export interface LiveCallResult {
  status: number;
  durationMs: number;
  body: string;
  loading?: boolean;
  simulated?: boolean;
  edgeCache?: string | null;
  rateRemaining?: string | null;
}

interface ApiEndpointCardProps {
  ep: EndpointSpec;
  codeLang: CodeLang;
  origin: string;
  canLiveDebug: boolean;
  cooldownSec: number;
  copiedId: string | null;
  live?: LiveCallResult;
  onCopySnippet: (epId: string, snippet: string) => void;
  onRunLive: (ep: EndpointSpec) => void;
}

export function ApiEndpointCard({
  ep,
  codeLang,
  origin,
  canLiveDebug,
  cooldownSec,
  copiedId,
  live,
  onCopySnippet,
  onRunLive,
}: ApiEndpointCardProps) {
  const d = useDocsI18n();
  const ms = methodStyle(ep.method);
  const snippet = buildSnippet(ep, codeLang, origin);

  return (
    <article id={ep.id} className="paper-card rounded-2xl p-6 space-y-5 scroll-mt-20">
      <div
        className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono-num text-xs font-semibold px-2.5 py-0.5 rounded-md"
              style={{ backgroundColor: ms.bg, color: ms.color }}
            >
              {ep.method}
            </span>
            <code className="font-mono-num text-sm font-semibold break-all">{ep.path}</code>
            <span
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            >
              <ShieldCheck className="w-3 h-3" />
              {ep.auth === 'reseller_key'
                ? d.authResellerKey
                : ep.auth === 'user_jwt'
                  ? d.authUserJwt
                  : ep.auth === 'admin_jwt'
                    ? d.authAdminJwt
                    : d.authNone}
            </span>
          </div>
          <h2 className="font-editorial text-xl font-semibold">{ep.title}</h2>
          <p className="text-xs sm:text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {ep.summary}
          </p>
        </div>

        <button
          type="button"
          disabled={live?.loading || (canLiveDebug && Boolean(ep.liveTestable) && cooldownSec > 0)}
          onClick={() => onRunLive(ep)}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap disabled:opacity-50 self-start"
          style={{
            backgroundColor: canLiveDebug && ep.liveTestable ? 'var(--accent)' : 'var(--accent-soft)',
            color: canLiveDebug && ep.liveTestable ? '#FAF9F5' : 'var(--accent)',
          }}
        >
          {live?.loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : canLiveDebug && ep.liveTestable && cooldownSec > 0 ? (
            <Clock className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {canLiveDebug && ep.liveTestable
            ? cooldownSec > 0
              ? fmt(d.btnCooldown, { sec: cooldownSec })
              : d.btnRunLive
            : d.btnRunSandbox}
        </button>
      </div>

      {ep.params && ep.params.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2">{d.paramsTitle}</div>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-xs text-left">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-muted)' }}>
                  <th className="py-2 px-3">{d.thName}</th>
                  <th className="py-2 px-3">{d.thIn}</th>
                  <th className="py-2 px-3">{d.thType}</th>
                  <th className="py-2 px-3">{d.thRequired}</th>
                  <th className="py-2 px-3">{d.thDesc}</th>
                </tr>
              </thead>
              <tbody>
                {ep.params.map((p) => (
                  <tr key={p.name} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                    <td className="py-2 px-3 font-mono-num font-semibold">{p.name}</td>
                    <td className="py-2 px-3 font-mono-num">{p.in}</td>
                    <td className="py-2 px-3 font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                      {p.type}
                    </td>
                    <td className="py-2 px-3">
                      {p.required ? (
                        <span style={{ color: 'var(--accent)' }}>{d.yes}</span>
                      ) : (
                        <span style={{ color: 'var(--ink-muted)' }}>{d.no}</span>
                      )}
                    </td>
                    <td className="py-2 px-3" style={{ color: 'var(--ink-secondary)' }}>
                      {p.desc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              {fmt(d.reqExampleTitle, { lang: codeLang.toUpperCase() })}
            </span>
            <button
              type="button"
              onClick={() => onCopySnippet(ep.id, snippet)}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            >
              {copiedId === ep.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedId === ep.id ? d.copied : d.copyCode}
            </button>
          </div>
          <pre
            className="p-3.5 rounded-xl border text-[11.5px] font-mono-num overflow-x-auto leading-relaxed"
            style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-color)' }}
          >
            <code>{snippet}</code>
          </pre>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">
              {live && !live.loading
                ? live.simulated
                  ? d.respTitleMock
                  : d.respTitleLive
                : d.respTitleSample}
            </span>
            {live && !live.loading && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {live.edgeCache && (
                  <span
                    className="font-mono-num text-[10.5px] px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                  >
                    Edge: {live.edgeCache}
                  </span>
                )}
                {live.rateRemaining && (
                  <span
                    className="font-mono-num text-[10.5px] px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-muted)' }}
                  >
                    {d.rateRemainingPrefix}
                    {live.rateRemaining}
                  </span>
                )}
                <span
                  className="font-mono-num text-[11px] px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    backgroundColor: live.simulated
                      ? 'var(--accent-soft)'
                      : live.status >= 200 && live.status < 300
                        ? 'var(--success-soft)'
                        : 'var(--danger-soft)',
                    color: live.simulated
                      ? 'var(--accent)'
                      : live.status >= 200 && live.status < 300
                        ? 'var(--success)'
                        : 'var(--danger)',
                  }}
                >
                  {live.simulated ? 'STATIC MOCK' : `HTTP ${live.status}`} · {live.durationMs}ms
                </span>
              </div>
            )}
          </div>
          <pre
            className="p-3.5 rounded-xl border text-[11.5px] font-mono-num overflow-x-auto max-h-64 leading-relaxed"
            style={{
              backgroundColor: 'var(--bg-canvas)',
              borderColor: live && !live.loading ? 'var(--accent)' : 'var(--border-color)',
            }}
          >
            <code>{live && !live.loading ? live.body : JSON.stringify(ep.sampleResponse, null, 2)}</code>
          </pre>
        </div>
      </div>
    </article>
  );
}
