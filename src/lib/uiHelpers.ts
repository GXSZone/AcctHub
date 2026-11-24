// Dialog top-layer helpers & deferred form validation ARIA synchronization

let supportsDisplayTransitionCache: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (supportsDisplayTransitionCache !== undefined) return supportsDisplayTransitionCache;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransitionCache = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransitionCache;
}

function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

export async function closeDialogSmoothly(dialog: HTMLDialogElement | null): Promise<void> {
  if (!dialog?.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 320)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

export function attachDialogLightDismissFallback(dialog: HTMLDialogElement, onClose: () => void): () => void {
  const handleCancel = (e: Event) => {
    e.preventDefault();
    void closeDialogSmoothly(dialog).then(onClose);
  };
  dialog.addEventListener('cancel', handleCancel);

  let cleanupPointer: (() => void) | null = null;
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        void closeDialogSmoothly(dialog).then(onClose);
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    cleanupPointer = () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }

  return () => {
    dialog.removeEventListener('cancel', handleCancel);
    cleanupPointer?.();
  };
}

/**
 * Synchronize aria-invalid and aria-describedby with CSS :user-invalid
 * using a single polite live region, per modern-web-guidance.
 */
export function initDeferredValidationSync(): () => void {
  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'visually-hidden';
  document.body.appendChild(announcer);

  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let announcedField: Element | null = null;
  const flagged = new WeakSet<Element>();
  const announced = new WeakSet<Element>();

  const linkError = (el: HTMLElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const announceError = (el: HTMLElement) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = (errorEl.textContent || '').replace(/\s+/g, ' ').trim();
    }, 450);
  };

  const syncAria = (target: EventTarget | null, shouldAnnounce = false) => {
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input, select, textarea')) return;

    let isInvalid = false;
    try {
      isInvalid = target.matches(':user-invalid');
    } catch {
      isInvalid = target.classList.contains('user-invalid-fallback');
    }

    if (isInvalid) {
      if (shouldAnnounce && !announced.has(target)) {
        announceError(target);
        announced.add(target);
      }
      target.setAttribute('aria-invalid', 'true');
      linkError(target, true);
      flagged.add(target);
    } else if (flagged.has(target) || target.getAttribute('aria-invalid') !== 'true') {
      target.setAttribute('aria-invalid', 'false');
      linkError(target, false);
      flagged.delete(target);
      announced.delete(target);
      if (announcedField === target) {
        clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    }
  };

  const onBlur = (e: Event) => syncAria(e.target, true);
  const onInput = (e: Event) => {
    if (e.target instanceof HTMLElement && e.target.hasAttribute('aria-invalid')) {
      syncAria(e.target, false);
    }
  };
  const onInvalid = (e: Event) => {
    if (e.target instanceof HTMLElement) {
      announced.add(e.target);
      syncAria(e.target, false);
    }
  };

  document.addEventListener('blur', onBlur, true);
  document.addEventListener('input', onInput);
  document.addEventListener('invalid', onInvalid, true);

  return () => {
    document.removeEventListener('blur', onBlur, true);
    document.removeEventListener('input', onInput);
    document.removeEventListener('invalid', onInvalid, true);
    clearTimeout(announceTimer);
    announcer.remove();
  };
}
