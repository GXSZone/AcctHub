/**
 * 代理等级单行内联 SaaS 分站权限配置条（与全局 SaaS 开关联动：全局关闭时保持占位并禁用置灰，避免 UI 跳动）
 */

import { useSaasI18n } from '../../i18n/namespaces/saas';

export interface TierCapabilityDraft {
  allow_custom_domain: boolean;
  max_custom_domains: number;
  allow_private_products: boolean;
  allow_own_payment: boolean;
}

interface AdminTierCapabilitiesInlineProps {
  value: TierCapabilityDraft;
  disabled?: boolean;
  globalOwnPayEnabled?: boolean;
  globalPrivateEnabled?: boolean;
  onChange: (patch: Partial<TierCapabilityDraft>) => void;
}

export function AdminTierCapabilitiesInline({
  value,
  disabled,
  globalOwnPayEnabled = true,
  globalPrivateEnabled = true,
  onChange,
}: AdminTierCapabilitiesInlineProps) {
  const ss = useSaasI18n();
  const ownPayDisabled = Boolean(disabled) || !globalOwnPayEnabled;
  const privateDisabled = Boolean(disabled) || !globalOwnPayEnabled || !globalPrivateEnabled;

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2.5 mt-2.5 border-t text-[11px]"
      style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
    >
      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.allow_custom_domain}
          onChange={(e) => onChange({ allow_custom_domain: e.target.checked })}
        />
        <span>{ss.tierAllowDomainLabel}</span>
      </label>

      <label
        className={`inline-flex items-center gap-1.5 select-none ${
          value.allow_custom_domain ? '' : 'opacity-45'
        }`}
      >
        <span>{ss.tierMaxDomainsLabel}</span>
        <input
          type="number"
          min={0}
          max={20}
          disabled={disabled || !value.allow_custom_domain}
          value={value.max_custom_domains}
          onChange={(e) => {
            const next = Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0)));
            onChange({ max_custom_domains: next });
          }}
          className="acct-input py-0.5 px-2 w-14 text-[11px] font-mono-num"
        />
      </label>

      <label
        className={`inline-flex items-center gap-1.5 select-none ${
          ownPayDisabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
        }`}
        title={!globalOwnPayEnabled ? ss.globalDisabledTag : undefined}
      >
        <input
          type="checkbox"
          disabled={ownPayDisabled}
          checked={globalOwnPayEnabled && value.allow_own_payment}
          onChange={(e) => {
            const next = e.target.checked;
            // 自有收款仅用于收取本店私有商品，开启时若全局私有商品已开则同步开启私有商品入口
            onChange(
              next
                ? {
                    allow_own_payment: true,
                    ...(globalPrivateEnabled ? { allow_private_products: true } : {}),
                  }
                : { allow_own_payment: false, allow_private_products: false }
            );
          }}
        />
        <span>{ss.tierAllowOwnPayLabel}</span>
        {!globalOwnPayEnabled && (
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            ({ss.globalDisabledTag})
          </span>
        )}
      </label>

      <label
        className={`inline-flex items-center gap-1.5 select-none ${
          privateDisabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
        }`}
        title={!globalOwnPayEnabled || !globalPrivateEnabled ? ss.globalDisabledTag : undefined}
      >
        <input
          type="checkbox"
          disabled={privateDisabled}
          checked={globalOwnPayEnabled && globalPrivateEnabled && value.allow_private_products}
          onChange={(e) => {
            const next = e.target.checked;
            onChange(
              next
                ? { allow_private_products: true, allow_own_payment: true }
                : { allow_private_products: false }
            );
          }}
        />
        <span>{ss.tierAllowPrivateLabel}</span>
        {(!globalOwnPayEnabled || !globalPrivateEnabled) && (
          <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            ({ss.globalDisabledTag})
          </span>
        )}
      </label>
    </div>
  );
}
