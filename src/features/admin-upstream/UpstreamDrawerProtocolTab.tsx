/**
 * 上游配置抽屉 Tab 2：下单/查单/余额 URL、目录 JSON 字段映射与请求体模板
 */

import type React from 'react';
import type { UpstreamSourceRecord } from '../../api/upstream.api';
import { useAdminUpstreamDrawerI18n } from '../../i18n/namespaces/admin-upstream-drawer';
import { buildFieldMappingPresets, type SourceEditorDraft } from './upstream-constants';

interface UpstreamDrawerProtocolTabProps {
  sourceDraft: SourceEditorDraft;
  setSourceDraft: React.Dispatch<React.SetStateAction<SourceEditorDraft>>;
  editingSourceMeta: UpstreamSourceRecord | null;
}

export function UpstreamDrawerProtocolTab({
  sourceDraft,
  setSourceDraft,
  editingSourceMeta,
}: UpstreamDrawerProtocolTabProps) {
  const d = useAdminUpstreamDrawerI18n();
  const fieldMappingPresets = buildFieldMappingPresets(d);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="block font-semibold mb-1">{d.protoOrderUrlLabel}</div>
          <input
            value={sourceDraft.order_url || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, order_url: e.target.value })}
            placeholder="https://supplier.example.com/api/v1/supplier/order/create"
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.protoQueryUrlLabel}</div>
          <input
            value={sourceDraft.query_order_url || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, query_order_url: e.target.value })}
            placeholder="https://supplier.example.com/api/v1/supplier/order/query"
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.protoBalUrlLabel}</div>
          <input
            value={sourceDraft.balance_url || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, balance_url: e.target.value })}
            placeholder="https://supplier.example.com/api/v1/supplier/balance"
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.protoWebhookLabel}</div>
          <input
            type="password"
            value={sourceDraft.webhook_secret || ''}
            onChange={(e) => setSourceDraft({ ...sourceDraft, webhook_secret: e.target.value })}
            placeholder={
              editingSourceMeta?.has_webhook_secret ? d.protoWebhookSavedPh : d.protoWebhookEmptyPh
            }
            className="acct-input font-mono-num"
          />
        </div>
      </div>

      <div
        className="p-4 rounded-xl border space-y-2.5"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-semibold">{d.protoMappingTitle}</span>
          <div className="flex gap-1.5">
            {fieldMappingPresets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setSourceDraft({ ...sourceDraft, field_mapping: { ...p.mapping } })}
                className="px-2 py-0.5 rounded border text-[10.5px] cursor-pointer"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ['list_path', d.fieldListPath],
              ['id_field', d.fieldId],
              ['title_field', d.fieldTitle],
              ['price_field', d.fieldPrice],
              ['stock_field', d.fieldStock],
              ['status_field', d.fieldStatus],
              ['specs_field', d.fieldSpecs],
              ['desc_field', d.fieldDesc],
            ] as const
          ).map(([k, lbl]) => (
            <div key={k}>
              <div className="block text-[10.5px] mb-0.5" style={{ color: 'var(--ink-muted)' }}>
                {lbl}
              </div>
              <input
                value={sourceDraft.field_mapping?.[k] || ''}
                onChange={(e) =>
                  setSourceDraft({
                    ...sourceDraft,
                    field_mapping: { ...sourceDraft.field_mapping, [k]: e.target.value },
                  })
                }
                className="acct-input py-1 font-mono-num text-[11px]"
              />
            </div>
          ))}
        </div>
      </div>

      <div
        className="p-4 rounded-xl border space-y-2.5"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="font-semibold">{d.protoRespTitle}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(
            [
              ['order_no_path', d.respOrderNoPath],
              ['cards_path', d.respCardsPath],
              ['cost_path', d.respCostPath],
              ['balance_path', d.respBalancePath],
              ['status_path', d.respStatusPath],
              ['error_path', d.respErrorPath],
            ] as const
          ).map(([k, lbl]) => (
            <div key={k}>
              <div className="block text-[10.5px] mb-0.5" style={{ color: 'var(--ink-muted)' }}>
                {lbl}
              </div>
              <input
                value={sourceDraft.response_mapping?.[k] || ''}
                onChange={(e) =>
                  setSourceDraft({
                    ...sourceDraft,
                    response_mapping: { ...sourceDraft.response_mapping, [k]: e.target.value },
                  })
                }
                className="acct-input py-1 font-mono-num text-[11px]"
              />
            </div>
          ))}
        </div>
        <div>
          <div className="block text-[10.5px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {d.protoBodyTplHintPrefix}
            {'{{upstream_item_id}}'}, {'{{upstream_spec_id}}'}, {'{{quantity}}'}, {'{{out_trade_no}}'},{' '}
            {'{{contact_email}}'}, {'{{webhook_url}}'}
            {d.protoBodyTplHintSuffix}
          </div>
          <textarea
            rows={4}
            value={sourceDraft.body_template_text}
            onChange={(e) => setSourceDraft({ ...sourceDraft, body_template_text: e.target.value })}
            placeholder='{"goods_id": "{{upstream_item_id}}", "num": "{{quantity}}", "out_trade_no": "{{out_trade_no}}"}'
            className="acct-input font-mono-num text-[11px]"
          />
        </div>
      </div>
    </div>
  );
}
