/**
 * 全局悬浮气泡消息总线（脱离文档流滚动位置，全站任意位置触发均可见）
 */

import { ERROR_MESSAGE_PATTERN } from '../i18n/toast-keywords';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  to: string;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  alertRole: boolean;
  action?: ToastAction;
}

type ToastListener = (items: ToastItem[]) => void;

const MAX_TOASTS = 4;
const listeners = new Set<ToastListener>();
let items: ToastItem[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  const snapshot = items.slice();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = items.filter((item) => item.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

export function clearErrorToasts() {
  let changed = false;
  items = items.filter((item) => {
    if (item.tone !== 'error') return true;
    const timer = timers.get(item.id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(item.id);
    }
    changed = true;
    return false;
  });
  if (changed) emit();
}

export function pushToast(
  message: string,
  tone: ToastTone = 'info',
  options?: { durationMs?: number; alertRole?: boolean; action?: ToastAction }
) {
  const text = message.trim();
  if (!text) return;

  // 若存在完全相同内容与类型的气泡，先移除旧条目以刷新计时
  for (const existing of items) {
    if (existing.message === text && existing.tone === tone) {
      const oldTimer = timers.get(existing.id);
      if (oldTimer) {
        clearTimeout(oldTimer);
        timers.delete(existing.id);
      }
    }
  }
  const deduped = items.filter((existing) => !(existing.message === text && existing.tone === tone));

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${items.length}`;
  const nextItem: ToastItem = {
    id,
    tone,
    message: text,
    alertRole: options?.alertRole ?? tone === 'error',
    action: options?.action,
  };

  const trimmed = [...deduped, nextItem];
  while (trimmed.length > MAX_TOASTS) {
    const dropped = trimmed.shift();
    if (dropped) {
      const droppedTimer = timers.get(dropped.id);
      if (droppedTimer) {
        clearTimeout(droppedTimer);
        timers.delete(dropped.id);
      }
    }
  }
  items = trimmed;
  emit();

  const duration = options?.durationMs ?? (tone === 'error' || tone === 'warning' ? 5000 : 3500);
  if (duration > 0 && typeof window !== 'undefined') {
    timers.set(
      id,
      setTimeout(() => {
        dismissToast(id);
      }, duration)
    );
  }
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener(items.slice());
  return () => {
    listeners.delete(listener);
  };
}

type ToastMetaOptions = number | { durationMs?: number; action?: ToastAction };

function normalizeMetaOptions(opts?: ToastMetaOptions) {
  if (typeof opts === 'number') return { durationMs: opts };
  return opts;
}

export const toast = {
  success: (message: string, opts?: ToastMetaOptions) =>
    pushToast(message, 'success', normalizeMetaOptions(opts)),
  error: (message: string, options?: { durationMs?: number; alertRole?: boolean; action?: ToastAction }) =>
    pushToast(message, 'error', options),
  warning: (message: string, opts?: ToastMetaOptions) =>
    pushToast(message, 'warning', normalizeMetaOptions(opts)),
  info: (message: string, opts?: ToastMetaOptions) => pushToast(message, 'info', normalizeMetaOptions(opts)),
  auto: (message: string) => pushToast(message, ERROR_MESSAGE_PATTERN.test(message) ? 'error' : 'success'),
  dismiss: dismissToast,
  clearErrors: clearErrorToasts,
};
