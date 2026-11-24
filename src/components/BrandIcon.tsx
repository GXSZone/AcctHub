import { Building2, Layers, Puzzle, Sparkles, Star } from 'lucide-react';
import { useId, useState } from 'react';
import type { UiKitDict } from '../i18n/namespaces/ui-kit';

interface BrandIconOption {
  key: string;
  label: string;
  tint: string;
}

const BRAND_ICON_DEFS: BrandIconOption[] = [
  { key: 'claude', label: 'Claude', tint: '#D97757' },
  { key: 'openai', label: 'ChatGPT / OpenAI', tint: '#10A37F' },
  { key: 'gemini', label: 'Gemini', tint: '#4E86F6' },
  { key: 'cursor', label: 'Cursor', tint: '#2B2A27' },
  { key: 'midjourney', label: 'Midjourney', tint: '#6E5CA8' },
  { key: 'grok', label: 'Grok / X', tint: '#1F1E1C' },
  { key: 'perplexity', label: 'Perplexity', tint: '#20808D' },
  { key: 'cpu', label: 'API Compute', tint: '#D97757' },
  { key: 'netflix', label: 'Netflix', tint: '#C9382B' },
  { key: 'spotify', label: 'Spotify', tint: '#1DB954' },
  { key: 'youtube', label: 'YouTube', tint: '#D93636' },
  { key: 'gmail', label: 'Gmail / Email', tint: '#D14836' },
  { key: 'notion', label: 'Notion', tint: '#2A2927' },
  { key: 'building', label: 'Enterprise Team', tint: '#2D6A57' },
  { key: 'puzzle', label: 'Extensions', tint: '#7A7267' },
];

/** 根据当前语种字典生成本地化的品牌图标选项列表 */
export function buildBrandIconOptions(ui: UiKitDict): BrandIconOption[] {
  const labelOverrides: Record<string, string> = {
    cpu: ui.brandCpu,
    gmail: ui.brandGmail,
    notion: ui.brandNotion,
    building: ui.brandBuilding,
    puzzle: ui.brandPuzzle,
  };
  return BRAND_ICON_DEFS.map((item) => ({
    ...item,
    label: labelOverrides[item.key] || item.label,
  }));
}

export function resolveBrandTint(icon: string, fallback?: string): string {
  const normalized = normalizeIconKey(icon);
  const found = BRAND_ICON_DEFS.find((o) => o.key === normalized);
  return found?.tint || fallback || '#D97757';
}

function normalizeIconKey(icon: string): string {
  switch (icon) {
    case 'terminal':
      return 'cursor';
    case 'palette':
      return 'midjourney';
    case 'play':
      return 'netflix';
    case 'globe':
      return 'gmail';
    case 'chatgpt':
      return 'openai';
    case 'api':
      return 'cpu';
    default:
      return icon;
  }
}

/** AcctHub 品牌主印章（双卡叠放结构，支持随主题色 --accent 自动换肤） */
export function AcctHubSeal({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="26" fill="var(--accent)" />
      {/* 后置凭证卡（3.5px 同心等距呼吸缝避让前卡） */}
      <path
        d="M 24 20 H 61 A 8 8 0 0 1 69 28 V 30.5 A 1 1 0 0 1 68 31.5 H 39 A 11.5 11.5 0 0 0 27.5 43 V 61 A 1 1 0 0 1 26.5 62 H 24 A 8 8 0 0 1 16 54 V 28 A 8 8 0 0 1 24 20 Z"
        fill="#FAF9F5"
        fillOpacity="0.45"
      />
      {/* 前置交付主卡与右上角切角 */}
      <path
        d="M 39 35 H 58 L 84 61 V 72 A 8 8 0 0 1 76 80 H 39 A 8 8 0 0 1 31 72 V 43 A 8 8 0 0 1 39 35 Z"
        fill="#FAF9F5"
      />
      <path d="M 62.2 35 H 76 A 8 8 0 0 1 84 43 V 56.8 Z" fill="#FAF9F5" fillOpacity="0.45" />
    </svg>
  );
}

/** 站点左上角品牌图标：优先使用自定义 Logo/Favicon 图片，失败或留空时回退默认太阳纹章 */
export function BrandMark({ logoUrl, className = 'w-8 h-8' }: { logoUrl?: string; className?: string }) {
  const cleanUrl = (logoUrl || '').trim();
  const safeUrl = /^(https?:\/\/|\/(?!\/))/i.test(cleanUrl) ? cleanUrl : '';
  const [failedUrl, setFailedUrl] = useState('');

  if (safeUrl && failedUrl !== safeUrl) {
    return (
      <img
        src={safeUrl}
        alt=""
        aria-hidden="true"
        onError={() => setFailedUrl(safeUrl)}
        className={`${className} rounded-[10px] object-cover border`}
        style={{ borderColor: 'var(--border-color)' }}
      />
    );
  }
  return <AcctHubSeal className={className} />;
}

/**
 * High-recognition official-aligned vector brand marks styled softly
 * to harmonize with AcctHub's warm parchment & deep charcoal aesthetic.
 */
export function CategoryIcon({
  icon,
  className = 'w-4 h-4',
  accentColor,
}: {
  icon: string;
  className?: string;
  accentColor?: string;
}) {
  const key = normalizeIconKey(icon);
  const tint = accentColor || resolveBrandTint(key);
  const gradId = useId();

  switch (key) {
    // Anthropic / Claude 12-ray starburst
    case 'claude':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <g stroke="#D97757" strokeWidth="1.95" strokeLinecap="round">
            <line x1="12" y1="2.4" x2="12" y2="21.6" />
            <line x1="2.4" y1="12" x2="21.6" y2="12" />
            <line x1="5.2" y1="5.2" x2="18.8" y2="18.8" />
            <line x1="18.8" y1="5.2" x2="5.2" y2="18.8" />
            <line x1="7.2" y1="3.6" x2="16.8" y2="20.4" />
            <line x1="16.8" y1="3.6" x2="7.2" y2="20.4" />
            <line x1="3.6" y1="7.2" x2="20.4" y2="16.8" />
            <line x1="20.4" y1="7.2" x2="3.6" y2="16.8" />
          </g>
          <circle cx="12" cy="12" r="2.1" fill="#D97757" />
        </svg>
      );

    // OpenAI / ChatGPT hexagonal blossom knot
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M20.38 9.88a5.04 5.04 0 0 0-.43-4.14 5.1 5.1 0 0 0-5.48-2.45 5.04 5.04 0 0 0-3.8-1.69 5.1 5.1 0 0 0-4.86 3.53 5.04 5.04 0 0 0-3.36 2.44 5.1 5.1 0 0 0 .63 5.97 5.04 5.04 0 0 0 .43 4.14 5.1 5.1 0 0 0 5.48 2.45 5.04 5.04 0 0 0 3.8 1.69 5.1 5.1 0 0 0 4.86-3.53 5.04 5.04 0 0 0 3.36-2.44 5.1 5.1 0 0 0-.63-5.97ZM12.8 20.5a3.78 3.78 0 0 1-2.43-.88l.12-.07 4.03-2.33a.66.66 0 0 0 .33-.57v-5.69l1.7.98a.06.06 0 0 1 .03.05v4.71a3.8 3.8 0 0 1-3.78 3.8ZM4.66 17a3.78 3.78 0 0 1-.45-2.54l.12.07 4.03 2.33a.66.66 0 0 0 .66 0l4.93-2.85v1.96a.06.06 0 0 1-.02.05l-4.08 2.36a3.8 3.8 0 0 1-5.19-1.38ZM3.6 8.21a3.78 3.78 0 0 1 1.98-1.66v4.79a.66.66 0 0 0 .33.57l4.93 2.84-1.7.98a.06.06 0 0 1-.06 0L5 13.38A3.8 3.8 0 0 1 3.6 8.21Zm14.03 3.26-4.93-2.84 1.7-.98a.06.06 0 0 1 .06 0l4.08 2.35a3.8 3.8 0 0 1-.59 6.85v-4.8a.66.66 0 0 0-.32-.58Zm1.7-2.55-.12-.07-4.03-2.33a.66.66 0 0 0-.66 0L9.6 9.37V7.41a.06.06 0 0 1 .02-.05L13.7 5a3.8 3.8 0 0 1 5.63 3.92Zm-10.67 3.5-1.7-.98a.06.06 0 0 1-.03-.05V6.68a3.8 3.8 0 0 1 6.23-2.92l-.12.07-4.03 2.33a.66.66 0 0 0-.33.57l-.02 5.69Zm.93-2 2.2-1.27 2.2 1.27v2.54l-2.2 1.27-2.2-1.27v-2.54Z"
            fill="#10A37F"
          />
        </svg>
      );

    // Google Gemini 4-point gradient sparkle
    case 'gemini':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4E86F6" />
              <stop offset="52%" stopColor="#7C6EE6" />
              <stop offset="100%" stopColor="#D96570" />
            </linearGradient>
          </defs>
          <path
            d="M12 2.2C12.55 7.45 16.55 11.45 21.8 12C16.55 12.55 12.55 16.55 12 21.8C11.45 16.55 7.45 12.55 2.2 12C7.45 11.45 11.45 7.45 12 2.2Z"
            fill={`url(#${gradId})`}
          />
        </svg>
      );

    // Cursor 3D isometric cube + cursor arrow
    case 'cursor':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M12 2.2L20.5 7.1V16.9L12 21.8L3.5 16.9V7.1L12 2.2Z" fill="var(--ink-primary)" />
          <path d="M12 2.2L20.5 7.1L12 12L3.5 7.1L12 2.2Z" fill="var(--ink-secondary)" fillOpacity="0.45" />
          <path d="M12 12L20.5 7.1V16.9L12 21.8V12Z" fill="var(--bg-canvas)" fillOpacity="0.16" />
          <path d="M10.1 7.6L16.5 12.1L12.7 13.2L11.2 16.9L10.1 7.6Z" fill="var(--bg-canvas)" />
        </svg>
      );

    // Midjourney stylized twin-sail boat on waves
    case 'midjourney':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M10.4 4.2C14.2 6.8 15.8 10.6 15.4 15.2H7.2C8.9 12.1 10.1 8.4 10.4 4.2Z" fill="#6E5CA8" />
          <path d="M15.4 7.4C17.9 9.4 19 12.1 18.7 15.2H16.2C16.6 12.4 16.2 9.8 15.4 7.4Z" fill="#9A88CC" />
          <path d="M4.5 16.6H19.5L17.9 19.2H6.1L4.5 16.6Z" fill="#6E5CA8" />
          <path
            d="M3.5 20.8C5.4 19.9 7.3 19.9 9.2 20.8C11.1 21.7 12.9 21.7 14.8 20.8C16.7 19.9 18.6 19.9 20.5 20.8"
            stroke="#6E5CA8"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );

    // Netflix folded ribbon N
    case 'netflix':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect x="5.2" y="3" width="3.7" height="18" rx="0.6" fill="#A6261C" />
          <rect x="15.1" y="3" width="3.7" height="18" rx="0.6" fill="#A6261C" />
          <path d="M5.2 3H8.9L18.8 21H15.1L5.2 3Z" fill="#E04336" />
        </svg>
      );

    // Gmail M envelope mark
    case 'gmail':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M3.2 7.2V17.4C3.2 18.2 3.8 18.8 4.6 18.8H6.8V11.2L3.2 8.4V7.2Z" fill="#4285F4" />
          <path d="M20.8 7.2V17.4C20.8 18.2 20.2 18.8 19.4 18.8H17.2V11.2L20.8 8.4V7.2Z" fill="#34A853" />
          <path d="M17.2 11.2V6.4L12 10.3L6.8 6.4V11.2L12 15.1L17.2 11.2Z" fill="#EA4335" />
          <path d="M3.2 7.2C3.2 5.9 4.7 5.2 5.7 6L6.8 6.8V11.2L3.2 8.5V7.2Z" fill="#C5221F" />
          <path d="M20.8 7.2C20.8 5.9 19.3 5.2 18.3 6L17.2 6.8V11.2L20.8 8.5V7.2Z" fill="#FBBC04" />
        </svg>
      );

    // Spotify sound waves circle
    case 'spotify':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#1DB954" />
          <path
            d="M7.3 9.7C10.5 8.8 14.4 9 17.1 10.5"
            stroke="#FAF9F5"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M8.1 12.9C10.8 12.2 14 12.4 16.2 13.7"
            stroke="#FAF9F5"
            strokeWidth="1.55"
            strokeLinecap="round"
          />
          <path
            d="M8.9 15.9C11.1 15.4 13.6 15.6 15.3 16.6"
            stroke="#FAF9F5"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      );

    // YouTube rounded play badge
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="#D93636" />
          <path d="M10.2 9.1L15.4 12L10.2 14.9V9.1Z" fill="#FAF9F5" />
        </svg>
      );

    // Grok / xAI slash orbit
    case 'grok':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="8.2"
            stroke="var(--ink-primary)"
            strokeWidth="2.1"
            strokeDasharray="36 16"
          />
          <path d="M6.4 18.2L17.8 5.8" stroke="var(--ink-primary)" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );

    // Perplexity geometric prism
    case 'perplexity':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M12 3V21M5 7L12 12L19 7M5 17L12 12L19 17"
            stroke="#20808D"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="6" y="7" width="12" height="10" rx="1.5" stroke="#20808D" strokeWidth="1.5" />
        </svg>
      );

    // Notion cube N
    case 'notion':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="17"
            rx="3.5"
            stroke="var(--ink-primary)"
            strokeWidth="1.8"
            fill="var(--bg-surface)"
          />
          <path
            d="M8.5 16.5V7.8L15.5 16.2V7.5"
            stroke="var(--ink-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    // Unified Multi-Model API Pool Node Chip
    case 'cpu':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect
            x="6"
            y="6"
            width="12"
            height="12"
            rx="3"
            fill="#D97757"
            fillOpacity="0.16"
            stroke="#D97757"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12" r="2.2" fill="#D97757" />
          <path
            d="M9.5 3V6M14.5 3V6M9.5 18V21M14.5 18V21M3 9.5H6M3 14.5H6M18 9.5H21M18 14.5H21"
            stroke="#D97757"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'building':
      return <Building2 className={className} style={{ color: '#2D6A57' }} />;
    case 'puzzle':
      return <Puzzle className={className} style={{ color: tint }} />;
    case 'star':
      return <Star className={className} style={{ color: 'var(--accent)' }} />;
    case 'all':
      return <Layers className={className} style={{ color: 'var(--ink-secondary)' }} />;
    default:
      return <Sparkles className={className} style={{ color: tint }} />;
  }
}

/**
 * Unified warm-paper official brand container badge for cards, list rows & detail headers.
 */
export function BrandBadge({
  icon,
  accentColor,
  size = 'md',
}: {
  icon: string;
  accentColor?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tint = resolveBrandTint(icon, accentColor);
  const boxClass =
    size === 'lg' ? 'w-14 h-14 rounded-2xl' : size === 'sm' ? 'w-7 h-7 rounded-lg' : 'w-11 h-11 rounded-2xl';
  const iconClass = size === 'lg' ? 'w-8 h-8' : size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';

  return (
    <div
      className={`${boxClass} flex items-center justify-center shrink-0 border`}
      style={{
        backgroundColor: `color-mix(in srgb, ${tint} 9%, var(--bg-surface))`,
        borderColor: `color-mix(in srgb, ${tint} 22%, var(--border-color))`,
      }}
    >
      <CategoryIcon icon={icon} className={iconClass} accentColor={tint} />
    </div>
  );
}
