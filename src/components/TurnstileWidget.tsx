import { useEffect, useRef, useState } from 'react';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          action?: string;
          theme?: 'light' | 'dark' | 'auto';
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_ID = 'accthub-cf-turnstile-js';
let turnstileScript: Promise<void> | undefined;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error('TURNSTILE_LOAD_FAILED'));
    };
    const timeout = window.setTimeout(fail, 15_000);
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error) => {
    turnstileScript = undefined;
    throw error;
  });
  return turnstileScript;
}

interface TurnstileWidgetProps {
  enabled?: boolean;
  siteKey?: string;
  action: string;
  resetSignal?: number;
  onToken: (token: string) => void;
}

/**
 * 按需加载 Cloudflare Turnstile 人机验证组件：
 * 未配置 SiteKey / Secret 时零脚本加载、直接返回 null。
 */
export function TurnstileWidget(props: TurnstileWidgetProps) {
  const [attempt, setAttempt] = useState(0);
  return <TurnstileAttempt key={attempt} {...props} onRetry={() => setAttempt((n) => n + 1)} />;
}

function TurnstileAttempt({
  enabled,
  siteKey,
  action,
  resetSignal = 0,
  onToken,
  onRetry,
}: TurnstileWidgetProps & { onRetry: () => void }) {
  const m = useCommonModalsI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadFailed, setLoadFailed] = useState(false);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!enabled || !siteKey) {
      onTokenRef.current('');
      return;
    }
    let mounted = true;
    setLoadFailed(false);
    void loadTurnstileScript()
      .then(() => {
        if (!mounted || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        });
      })
      .catch(() => {
        if (!mounted) return;
        onTokenRef.current('');
        setLoadFailed(true);
      });

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [enabled, siteKey, action]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      onTokenRef.current('');
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  if (!enabled || !siteKey) return null;

  return (
    <div className="py-1 flex justify-center">
      <div ref={containerRef} />
      {loadFailed && (
        <button type="button" className="text-sm underline" onClick={onRetry}>
          {m.turnstileLoadRetry}
        </button>
      )}
    </div>
  );
}
