/**
 * 代理分站品牌主色调、Favicon、OG 分享图、独立 SEO Meta 与自定义页脚配置卡
 */

import { Globe, Palette } from 'lucide-react';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';

interface AgentSeoThemeBoxProps {
  themeAccent: string;
  faviconUrl: string;
  ogImageUrl: string;
  seoTitle: string;
  seoDescription: string;
  footerText: string;
  onChange: (patch: {
    theme_accent?: string;
    favicon_url?: string;
    og_image_url?: string;
    seo_title?: string;
    seo_description?: string;
    footer_text?: string;
  }) => void;
}

const ACCENT_PRESETS = ['#D97757', '#2D6A57', '#3B6FD8', '#7C5CFA', '#B85D3B', '#1F6F78'];

export function AgentSeoThemeBox({
  themeAccent,
  faviconUrl,
  ogImageUrl,
  seoTitle,
  seoDescription,
  footerText,
  onChange,
}: AgentSeoThemeBoxProps) {
  const ag = useAgentI18n();
  return (
    <div className="pt-3 border-t space-y-3" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Palette className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
        {ag.seoSectionTitle}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {ag.seoScopeHint}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.seoAccentLabel}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(themeAccent) ? themeAccent : '#D97757'}
              onChange={(e) => onChange({ theme_accent: e.target.value.toUpperCase() })}
              className="w-9 h-9 rounded-lg border p-0.5 cursor-pointer shrink-0"
              style={{ borderColor: 'var(--border-color)' }}
              aria-label={ag.seoPickerAria}
            />
            <input
              type="text"
              value={themeAccent}
              onChange={(e) => onChange({ theme_accent: e.target.value })}
              placeholder="#2D6A57"
              className="acct-input text-xs font-mono-num flex-1"
            />
            {themeAccent && (
              <button
                type="button"
                onClick={() => onChange({ theme_accent: '' })}
                className="px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer shrink-0"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {ag.seoResetBtn}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {ACCENT_PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onChange({ theme_accent: hex })}
                className="w-4 h-4 rounded-full border cursor-pointer"
                style={{
                  backgroundColor: hex,
                  borderColor: themeAccent.toUpperCase() === hex ? 'var(--ink-primary)' : 'transparent',
                }}
                aria-label={fmt(ag.seoPresetAria, { hex })}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.seoFaviconLabel}
          </div>
          <input
            type="text"
            value={faviconUrl}
            onChange={(e) => onChange({ favicon_url: e.target.value })}
            placeholder="https://cdn.example.com/favicon.png"
            className="acct-input text-xs font-mono-num"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div
            className="block text-[11px] mb-1 flex items-center gap-1"
            style={{ color: 'var(--ink-muted)' }}
          >
            <Globe className="w-3 h-3" />
            {ag.seoMetaTitleLabel}
          </div>
          <input
            type="text"
            value={seoTitle}
            onChange={(e) => onChange({ seo_title: e.target.value })}
            placeholder={ag.seoMetaTitlePlaceholder}
            className="acct-input text-xs"
          />
        </div>
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.seoOgImageLabel}
          </div>
          <input
            type="text"
            value={ogImageUrl}
            onChange={(e) => onChange({ og_image_url: e.target.value })}
            placeholder="https://cdn.example.com/og-cover.png"
            className="acct-input text-xs font-mono-num"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.seoMetaDescLabel}
          </div>
          <input
            type="text"
            value={seoDescription}
            onChange={(e) => onChange({ seo_description: e.target.value })}
            placeholder={ag.seoMetaDescPlaceholder}
            className="acct-input text-xs"
          />
        </div>
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.seoFooterLabel}
          </div>
          <input
            type="text"
            value={footerText}
            onChange={(e) => onChange({ footer_text: e.target.value })}
            placeholder={ag.seoFooterPlaceholder}
            className="acct-input text-xs"
          />
        </div>
      </div>
    </div>
  );
}
