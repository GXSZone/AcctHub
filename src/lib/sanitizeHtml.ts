// Safe HTML sanitization following modern-web-guidance `sanitize-untrusted-html`:
// - Uses native Element.prototype.setHTML() with explicit allowlist when available
// - Lazily code-splits and loads DOMPurify only when native Sanitizer API is missing

const ALLOWED_ELEMENTS = [
  'h2',
  'h3',
  'h4',
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'span',
];

const ALLOWED_ATTRIBUTES = ['class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height'];

let domPurifyPromise: Promise<{ sanitize: (dirty: string, cfg?: Record<string, unknown>) => string }> | null =
  null;

function loadDOMPurify() {
  domPurifyPromise ??= import('dompurify').then((mod) => mod.default ?? mod);
  return domPurifyPromise;
}

/**
 * Converts legacy Markdown content into clean semantic HTML when the input
 * doesn't already contain HTML block markup.
 */
export function normalizeRichContent(raw: string): string {
  const input = (raw || '').trim();
  if (!input) return '';
  if (/<(p|div|h[1-6]|ul|ol|figure|img|table|blockquote|pre)\b/i.test(input)) {
    return input;
  }

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const formatInline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );

  const blocks = input.split(/\n\n+/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (trimmed.startsWith('```')) {
        const code = trimmed.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
      if (trimmed.startsWith('### ')) {
        return `<h3>${formatInline(trimmed.slice(4))}</h3>`;
      }
      if (trimmed.startsWith('## ')) {
        return `<h2>${formatInline(trimmed.slice(3))}</h2>`;
      }
      const lines = trimmed.split('\n');
      if (lines.every((l) => /^-\s+/.test(l.trim()))) {
        return `<ul>${lines.map((l) => `<li>${formatInline(l.trim().replace(/^-\s+/, ''))}</li>`).join('')}</ul>`;
      }
      if (lines.every((l) => /^\d+\.\s+/.test(l.trim()))) {
        return `<ol>${lines.map((l) => `<li>${formatInline(l.trim().replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
      }
      return `<p>${lines.map(formatInline).join('<br />')}</p>`;
    })
    .join('\n');
}

export async function safeSetHTML(
  el: HTMLElement,
  rawContent: string,
  isCancelled?: () => boolean
): Promise<void> {
  const html = normalizeRichContent(rawContent);

  if ('setHTML' in Element.prototype) {
    if (isCancelled?.()) return;
    (el as HTMLElement & { setHTML: (input: string, opts?: unknown) => void }).setHTML(html, {
      sanitizer: {
        elements: ALLOWED_ELEMENTS,
        attributes: ALLOWED_ATTRIBUTES,
      },
    });
  } else {
    const DOMPurify = await loadDOMPurify();
    if (isCancelled?.()) return;
    el.innerHTML = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_ELEMENTS, '#text'],
      ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
  }

  // 加固外部链接与图片协议白名单，拦截 javascript: / data:image/svg+xml 等非安全 URI
  el.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (!/^https?:\/\/|^\//i.test(href)) {
      a.removeAttribute('href');
    } else {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });

  el.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = (img.getAttribute('src') || '').trim();
    if (!/^https?:\/\/|^\/|^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(src)) {
      img.removeAttribute('src');
    }
  });
}
