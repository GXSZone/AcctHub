/**
 * 上游商品原始 JSON Payload 检查与一键复制侧滑抽屉
 */

import { Check, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { UpstreamItemRecord } from '../../api/upstream.api';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../lib/uiHelpers';

interface UpstreamJsonDrawerProps {
  inspectItem: UpstreamItemRecord | null;
  onClose: () => void;
}

export function UpstreamJsonDrawer({ inspectItem, onClose }: UpstreamJsonDrawerProps) {
  const au = useAdminUpstreamI18n();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  useEffect(() => {
    const dlg = drawerRef.current;
    if (!dlg) return;
    if (inspectItem) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
    return attachDialogLightDismissFallback(dlg, onClose);
  }, [inspectItem, onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(drawerRef.current).then(onClose);
  };

  return (
    <dialog
      ref={drawerRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="acct-dialog acct-drawer"
      style={{ maxWidth: 'min(94vw, 38rem)' }}
    >
      {inspectItem && (
        <div className="h-full flex flex-col">
          <div
            className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div>
              <div className="text-[11px] font-mono-num" style={{ color: 'var(--accent)' }}>
                RAW UPSTREAM PAYLOAD
              </div>
              <h3 className="font-semibold text-sm truncate max-w-md">{inspectItem.raw_title}</h3>
            </div>
            <button type="button" onClick={handleClose} className="p-1.5 rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 overflow-y-auto flex-1 space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify(inspectItem.raw_payload, null, 2));
                  setCopiedJson(true);
                  setTimeout(() => setCopiedJson(false), 1500);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs cursor-pointer"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {copiedJson ? (
                  <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedJson ? au.copiedBtn : au.copyJsonBtn}
              </button>
            </div>
            <pre
              className="p-3.5 rounded-xl border font-mono-num text-[11px] whitespace-pre-wrap break-all"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              {JSON.stringify(inspectItem.raw_payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </dialog>
  );
}
