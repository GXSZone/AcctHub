/**
 * 总控后台营销工具面板（3 个聚焦 Tab：优惠券 / 余额充值卡密 CDK / 主站推广返佣设置）
 */

import { Check, Copy, Gift, Plus, Tag, Ticket, Trash2 } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { useAdminOpsI18n } from '../../i18n/namespaces/admin-ops';
import type { CouponRecord, RechargeCdkRecord } from '../../types';
import { AdminAffiliateSettingsCard } from './AdminAffiliateSettingsCard';

type MarketingSubTab = 'coupons' | 'cdks' | 'affiliate';

export function AdminMarketingPanel({
  coupons,
  cdks,
  settingsDraft,
  setSettingsDraft,
  onReload,
  onStorefrontUpdated,
  showToast,
}: {
  coupons: CouponRecord[];
  cdks: RechargeCdkRecord[];
  settingsDraft?: Record<string, string>;
  setSettingsDraft?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onReload: () => Promise<void>;
  onStorefrontUpdated?: () => void;
  showToast: (msg: string) => void;
}) {
  const ao = useAdminOpsI18n();
  const ac = useAdminCoreI18n();
  const [subTab, setSubTab] = useState<MarketingSubTab>('coupons');

  const [cpnCode, setCpnCode] = useState('');
  const [cpnName, setCpnName] = useState('');
  const [cpnType, setCpnType] = useState<'fixed' | 'percent'>('fixed');
  const [cpnVal, setCpnVal] = useState(10);
  const [cpnMin, setCpnMin] = useState(50);
  const [cpnMax, setCpnMax] = useState(100);

  const [cdkAmt, setCdkAmt] = useState(100);
  const [cdkCount, setCdkCount] = useState(5);
  const [cdkNote, setCdkNote] = useState('');
  const [lastBatch, setLastBatch] = useState<string[]>([]);
  const [copiedBatch, setCopiedBatch] = useState(false);

  const tabs: Array<{
    id: MarketingSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'coupons', label: ac.mktTabCoupons, icon: Tag },
    { id: 'cdks', label: ac.mktTabCdks, icon: Ticket },
    ...(settingsDraft && setSettingsDraft
      ? [{ id: 'affiliate' as const, label: ac.mktTabAffiliate, icon: Gift }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ac.navMarketingLabel}
        className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl border"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(item.id)}
              className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer inline-flex items-center gap-1.5"
              style={{
                backgroundColor: active ? 'var(--accent)' : 'transparent',
                color: active ? '#FAF9F5' : 'var(--ink-secondary)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1：优惠券 / 满减折扣码 */}
      {subTab === 'coupons' && (
        <div className="paper-card rounded-2xl p-6 space-y-4">
          <div
            className="flex items-center gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <Tag className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{ao.mktCouponTitle}</h2>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await adminApi.createCoupon({
                code: cpnCode || undefined,
                name: cpnName || ao.mktCouponDefaultName,
                discount_type: cpnType,
                discount_value: cpnVal,
                min_order_amount: cpnMin,
                max_uses: cpnMax,
              });
              setCpnCode('');
              setCpnName('');
              await onReload();
              showToast(fmt(ao.mktCouponCreatedToast, { code: res.code }));
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs"
          >
            <input
              value={cpnCode}
              onChange={(e) => setCpnCode(e.target.value.toUpperCase())}
              placeholder={ao.mktCodePh}
              className="acct-input font-mono-num"
            />
            <input
              value={cpnName}
              onChange={(e) => setCpnName(e.target.value)}
              placeholder={ao.mktNamePh}
              className="acct-input"
            />
            <select
              value={cpnType}
              onChange={(e) => setCpnType(e.target.value as 'fixed' | 'percent')}
              className="acct-input"
            >
              <option value="fixed">{ao.mktTypeFixedOpt}</option>
              <option value="percent">{ao.mktTypePercentOpt}</option>
            </select>
            <input
              type="number"
              min={1}
              required
              value={cpnVal}
              onChange={(e) => setCpnVal(Number(e.target.value))}
              placeholder={cpnType === 'percent' ? ao.mktValPercentPh : ao.mktValFixedPh}
              className="acct-input font-mono-num"
            />
            <input
              type="number"
              min={0}
              value={cpnMin}
              onChange={(e) => setCpnMin(Number(e.target.value))}
              placeholder={ao.mktMinPh}
              className="acct-input font-mono-num"
            />
            <input
              type="number"
              min={0}
              value={cpnMax}
              onChange={(e) => setCpnMax(Number(e.target.value))}
              placeholder={ao.mktMaxPh}
              className="acct-input font-mono-num"
            />
            <button
              type="submit"
              className="sm:col-span-2 lg:col-span-6 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {ao.mktCreateCouponBtn}
            </button>
          </form>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {coupons.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-xl border flex items-center justify-between gap-2 text-xs"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
                      {c.code}
                    </span>
                    <span className="font-medium truncate">{c.name}</span>
                  </div>
                  <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {fmt(ao.mktCouponMeta, {
                      discount:
                        c.discount_type === 'percent'
                          ? fmt(ao.mktPercentDesc, { val: c.discount_value })
                          : fmt(ao.mktFixedDesc, { val: c.discount_value }),
                      min: c.min_order_amount,
                      used: c.used_count,
                      max: c.max_uses > 0 ? String(c.max_uses) : '∞',
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await adminApi.toggleCoupon(c.id, c.is_active ? 0 : 1);
                      await onReload();
                    }}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer"
                    style={{
                      backgroundColor: c.is_active ? 'var(--success-soft)' : 'var(--bg-subtle)',
                      color: c.is_active ? 'var(--success)' : 'var(--ink-muted)',
                    }}
                  >
                    {c.is_active ? ao.mktStatusActive : ao.mktStatusDisabled}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await openConfirm({
                        title: ao.mktDeleteCouponTitle,
                        description: fmt(ao.mktDeleteCouponDesc, { code: c.code }),
                        confirmLabel: ao.mktDeleteConfirmBtn,
                        tone: 'danger',
                      });
                      if (!ok) return;
                      await adminApi.deleteCoupon(c.id);
                      await onReload();
                    }}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2：余额充值卡密 (CDK) 批量制卡 */}
      {subTab === 'cdks' && (
        <div className="paper-card rounded-2xl p-6 space-y-4">
          <div
            className="flex items-center gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <Ticket className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{ao.mktCdkTitle}</h2>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await adminApi.generateCdks({
                amount: cdkAmt,
                count: cdkCount,
                batch_note: cdkNote,
              });
              setLastBatch(res.generated);
              setCdkNote('');
              await onReload();
              showToast(fmt(ao.mktCdkGeneratedToast, { count: res.count, amount: cdkAmt }));
            }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs"
          >
            <div>
              <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                {ao.mktCdkAmtLabel}
              </div>
              <input
                type="number"
                min={1}
                required
                value={cdkAmt}
                onChange={(e) => setCdkAmt(Number(e.target.value))}
                className="acct-input font-mono-num"
              />
            </div>
            <div>
              <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                {ao.mktCdkCountLabel}
              </div>
              <input
                type="number"
                min={1}
                max={50}
                required
                value={cdkCount}
                onChange={(e) => setCdkCount(Number(e.target.value))}
                className="acct-input font-mono-num"
              />
            </div>
            <div>
              <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                {ao.mktCdkNoteLabel}
              </div>
              <input
                value={cdkNote}
                onChange={(e) => setCdkNote(e.target.value)}
                placeholder={ao.mktCdkNotePh}
                className="acct-input"
              />
            </div>
            <button
              type="submit"
              className="sm:col-span-3 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {ao.mktCdkGenBtn}
            </button>
          </form>

          {lastBatch.length > 0 && (
            <div
              className="p-3 rounded-xl border space-y-2 text-xs"
              style={{ borderColor: 'var(--success)', backgroundColor: 'var(--success-soft)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: 'var(--success)' }}>
                  {fmt(ao.mktBatchTitle, { count: lastBatch.length })}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(lastBatch.join('\n'));
                    setCopiedBatch(true);
                    setTimeout(() => setCopiedBatch(false), 1600);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/80 text-[11px] font-medium cursor-pointer"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {copiedBatch ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedBatch ? ao.mktCopiedAll : ao.mktCopyAllBtn}
                </button>
              </div>
              <pre className="font-mono-num text-[11px] max-h-24 overflow-y-auto">{lastBatch.join('\n')}</pre>
            </div>
          )}

          <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
            {cdks.map((k) => (
              <div
                key={k.id}
                className="px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="min-w-0">
                  <span className="font-mono-num font-semibold">{k.code}</span>
                  <span className="ml-2 font-mono-num" style={{ color: 'var(--accent)' }}>
                    ¥{k.amount}
                  </span>
                  {k.used_by_email && (
                    <span className="ml-2 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {fmt(ao.mktCdkRedeemedBy, { email: k.used_by_email })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="px-2 py-0.5 rounded-full text-[10.5px]"
                    style={{
                      backgroundColor: k.status === 'available' ? 'var(--success-soft)' : 'var(--bg-subtle)',
                      color: k.status === 'available' ? 'var(--success)' : 'var(--ink-muted)',
                    }}
                  >
                    {k.status === 'available' ? ao.mktCdkAvail : ao.mktCdkUsed}
                  </span>
                  {k.status === 'available' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await adminApi.deleteCdk(k.id);
                        await onReload();
                      }}
                      className="p-1 rounded cursor-pointer"
                      style={{ color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3：主站推广返佣配置（原归属站点设置，现归位营销中心） */}
      {subTab === 'affiliate' && settingsDraft && setSettingsDraft && (
        <AdminAffiliateSettingsCard
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          onReload={onReload}
          onStorefrontUpdated={onStorefrontUpdated}
          showToast={showToast}
        />
      )}
    </div>
  );
}
