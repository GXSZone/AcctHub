/**
 * 全局统一品牌风格表单校验气泡宿主
 * 捕获全站任意 <form> 控件的原生 invalid 事件并拦截浏览器默认白底橙标气泡，
 * 改以 AcctHub 暖纸感 Editorial 品牌锚定气泡精准呈现（支持 Top-Layer 弹窗与 5 语种）。
 */

import { AlertCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fmt } from '../i18n';
import { type CommonModalsDict, useCommonModalsI18n } from '../i18n/namespaces/common-modals';

type ValidatableElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface ValidationBubbleState {
  message: string;
  top: number;
  left: number;
  arrowLeft: number;
  placement: 'bottom' | 'top';
}

const BUBBLE_MAX_WIDTH = 320;
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 10;

function isValidatableControl(el: EventTarget | null): el is ValidatableElement {
  return (
    el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
  );
}

/** 将 HTML5 ValidityState 统一映射为站内 5 语种品牌提示文案 */
function resolveValidationMessage(el: ValidatableElement, dict: CommonModalsDict): string {
  const v = el.validity;
  if (v.customError && el.validationMessage.trim()) {
    return el.validationMessage.trim();
  }
  if (v.valueMissing) return dict.valRequired;
  if (v.rangeUnderflow && 'min' in el && el.min) {
    return fmt(dict.valMin, { min: el.min });
  }
  if (v.rangeOverflow && 'max' in el && el.max) {
    return fmt(dict.valMax, { max: el.max });
  }
  if (v.stepMismatch) return dict.valStep;
  if (v.typeMismatch) {
    if (el instanceof HTMLInputElement && el.type === 'email') return dict.valEmail;
    if (el instanceof HTMLInputElement && el.type === 'url') return dict.valUrl;
    return dict.valInvalid;
  }
  if (v.tooShort && 'minLength' in el && el.minLength > 0) {
    return fmt(dict.valTooShort, { min: el.minLength });
  }
  if (v.tooLong && 'maxLength' in el && el.maxLength > 0) {
    return fmt(dict.valTooLong, { max: el.maxLength });
  }
  if (v.patternMismatch || v.badInput) return dict.valInvalid;
  return el.validationMessage.trim() || dict.valInvalid;
}

/** 计算紧贴失效输入框的锚定坐标（下方空间不足时自动翻转至上方） */
function computeAnchorPosition(el: ValidatableElement): Omit<ValidationBubbleState, 'message'> {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const estHeight = 52;
  const placement: 'bottom' | 'top' =
    rect.bottom + ANCHOR_GAP + estHeight <= vh - VIEWPORT_MARGIN || rect.top < estHeight + ANCHOR_GAP
      ? 'bottom'
      : 'top';

  const preferredLeft = rect.left;
  const maxLeft = Math.max(VIEWPORT_MARGIN, vw - BUBBLE_MAX_WIDTH - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, preferredLeft), maxLeft);
  const anchorCenter = rect.left + Math.min(rect.width * 0.28, 36);
  const arrowLeft = Math.min(Math.max(16, anchorCenter - left), BUBBLE_MAX_WIDTH - 24);
  const top = placement === 'bottom' ? rect.bottom + ANCHOR_GAP : rect.top - ANCHOR_GAP;

  return { top, left, arrowLeft, placement };
}

export function FormValidationHost() {
  const m = useCommonModalsI18n();
  const dictRef = useRef(m);
  dictRef.current = m;

  const [bubble, setBubble] = useState<ValidationBubbleState | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const activeFieldRef = useRef<ValidatableElement | null>(null);
  const batchClaimedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const clearBubble = () => {
      clearTimeout(hideTimerRef.current);
      setBubble(null);
      activeFieldRef.current = null;
    };

    const onInvalid = (event: Event) => {
      if (!isValidatableControl(event.target)) return;
      // 始终阻止浏览器原生的白底橙标校验气泡
      event.preventDefault();

      const target = event.target;
      target.classList.add('user-invalid-fallback');
      target.setAttribute('aria-invalid', 'true');

      // 同一轮表单提交可能同时触发多个字段的 invalid，仅聚焦并提示首个失效字段
      if (batchClaimedRef.current) return;
      batchClaimedRef.current = true;
      queueMicrotask(() => {
        batchClaimedRef.current = false;
      });

      activeFieldRef.current = target;
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }

      const show = () => {
        if (activeFieldRef.current !== target) return;
        const message = resolveValidationMessage(target, dictRef.current);
        const pos = computeAnchorPosition(target);
        setBubble({ message, ...pos });
      };

      show();
      requestAnimationFrame(show);

      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(clearBubble, 4500);
    };

    const onFieldEdit = (event: Event) => {
      const target = event.target;
      if (isValidatableControl(target) && target.validity.valid) {
        target.classList.remove('user-invalid-fallback');
      }
      if (activeFieldRef.current && target === activeFieldRef.current) {
        clearBubble();
      }
    };

    const onDismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (activeFieldRef.current) clearBubble();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!activeFieldRef.current) return;
      if (event.target === activeFieldRef.current) return;
      if (hostRef.current && event.target instanceof Node && hostRef.current.contains(event.target)) {
        return;
      }
      clearBubble();
    };

    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onFieldEdit, true);
    document.addEventListener('change', onFieldEdit, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onDismiss, true);
    window.addEventListener('scroll', clearBubble, true);
    window.addEventListener('resize', clearBubble);

    return () => {
      clearTimeout(hideTimerRef.current);
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onFieldEdit, true);
      document.removeEventListener('change', onFieldEdit, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onDismiss, true);
      window.removeEventListener('scroll', clearBubble, true);
      window.removeEventListener('resize', clearBubble);
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current as
      | (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void })
      | null;
    if (!el || typeof el.showPopover !== 'function' || typeof el.hidePopover !== 'function') return;
    try {
      if (bubble) {
        if (el.matches(':popover-open')) el.hidePopover();
        el.showPopover();
      } else if (el.matches(':popover-open')) {
        el.hidePopover();
      }
    } catch {
      // 兼容不支持原生 popover 的测试或旧环境
    }
  }, [bubble]);

  if (!bubble) return null;

  return (
    <div
      ref={hostRef}
      popover="manual"
      role="alert"
      aria-live="assertive"
      className="acct-validation-popover fixed z-[96] pointer-events-none"
      style={{
        top: `${bubble.top}px`,
        left: `${bubble.left}px`,
        maxWidth: `min(${BUBBLE_MAX_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
        transform: bubble.placement === 'top' ? 'translateY(-100%)' : undefined,
        margin: 0,
        padding: 0,
        border: 'none',
        backgroundColor: 'transparent',
        overflow: 'visible',
      }}
    >
      <div
        className="relative pointer-events-auto rounded-xl border px-3.5 py-2.5 flex items-center gap-2.5 text-xs leading-snug font-medium"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'color-mix(in srgb, var(--danger) 55%, var(--border-strong))',
          color: 'var(--ink-primary)',
          boxShadow: '0 12px 28px -10px rgba(18, 17, 16, 0.24), 0 2px 6px rgba(18, 17, 16, 0.06)',
        }}
      >
        <span
          aria-hidden="true"
          className="absolute w-2.5 h-2.5 rotate-45"
          style={{
            left: `${bubble.arrowLeft}px`,
            ...(bubble.placement === 'bottom'
              ? {
                  top: '-6px',
                  borderTop: '1px solid color-mix(in srgb, var(--danger) 55%, var(--border-strong))',
                  borderLeft: '1px solid color-mix(in srgb, var(--danger) 55%, var(--border-strong))',
                }
              : {
                  bottom: '-6px',
                  borderRight: '1px solid color-mix(in srgb, var(--danger) 55%, var(--border-strong))',
                  borderBottom: '1px solid color-mix(in srgb, var(--danger) 55%, var(--border-strong))',
                }),
            backgroundColor: 'var(--bg-surface)',
          }}
        />
        <span
          className="w-6 h-6 rounded-lg inline-flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          <AlertCircle className="w-3.5 h-3.5" />
        </span>
        <span className="break-words">{bubble.message}</span>
      </div>
    </div>
  );
}
