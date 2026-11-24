/**
 * 分站工作台：独立展示与功能开关卡片（API 文档显隐、帮助中心继承开关）
 */

import { Loader2, Save, SlidersHorizontal } from 'lucide-react';
import { useSaasI18n } from '../../i18n/namespaces/saas';

interface AgentSitePrefsCardProps {
  showApiDocs: boolean;
  inheritPlatformHelp: boolean;
  savingPrefs: boolean;
  onChangeShowApiDocs: (next: boolean) => void;
  onChangeInheritHelp: (next: boolean) => void;
  onSave: () => void;
}

export function AgentSitePrefsCard({
  showApiDocs,
  inheritPlatformHelp,
  savingPrefs,
  onChangeShowApiDocs,
  onChangeInheritHelp,
  onSave,
}: AgentSitePrefsCardProps) {
  const ss = useSaasI18n();

  return (
    <div className="lg:col-span-7 paper-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        <h2 className="font-editorial text-xl font-semibold">{ss.prefTitle}</h2>
      </div>
      <div className="space-y-3 text-xs">
        <label
          className="flex items-start gap-2.5 p-3.5 rounded-xl border cursor-pointer"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <input
            type="checkbox"
            checked={showApiDocs}
            onChange={(e) => onChangeShowApiDocs(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <div className="font-semibold">{ss.prefShowApiDocsLabel}</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {ss.prefShowApiDocsDesc}
            </div>
          </div>
        </label>
        <label
          className="flex items-start gap-2.5 p-3.5 rounded-xl border cursor-pointer"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <input
            type="checkbox"
            checked={inheritPlatformHelp}
            onChange={(e) => onChangeInheritHelp(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <div className="font-semibold">{ss.prefInheritHelpLabel}</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {ss.prefInheritHelpDesc}
            </div>
          </div>
        </label>
      </div>
      <button
        type="button"
        disabled={savingPrefs}
        onClick={onSave}
        className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
      >
        {savingPrefs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {ss.prefSaveBtn}
      </button>
    </div>
  );
}
