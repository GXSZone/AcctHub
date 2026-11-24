import { useEffect, useRef } from 'react';
import { safeSetHTML } from '../lib/sanitizeHtml';

interface RichContentRendererProps {
  content: string;
  className?: string;
}

export function RichContentRenderer({ content, className = '' }: RichContentRendererProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const el = ref.current;
    if (!el) return;
    void safeSetHTML(el, content, () => !active).catch(() => {
      if (active && el) {
        el.textContent = content;
      }
    });
    return () => {
      active = false;
    };
  }, [content]);

  return <div ref={ref} className={`acct-prose ${className}`} />;
}
