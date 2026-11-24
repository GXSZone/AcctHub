// Color-scheme toggle following modern-web-guidance:
// - Stores override in localStorage ("light" | "dark"), removes key when reverting to system
// - Updates <meta name="color-scheme"> which CSS :root:has(...) maps to `color-scheme`
// - Syncs across tabs via `storage` event; never retroactively clears a pinned scheme on OS change

const STORAGE_KEY = 'color-scheme';

function getSystemScheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredScheme(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function getEffectiveScheme(): 'light' | 'dark' {
  return getStoredScheme() ?? getSystemScheme();
}

function applyColorScheme(override: 'light' | 'dark' | null): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = override ?? 'light dark';
  }
}

export function toggleColorScheme(): 'light' | 'dark' {
  const current = getEffectiveScheme();
  const target: 'light' | 'dark' = current === 'dark' ? 'light' : 'dark';
  const system = getSystemScheme();

  try {
    if (target === system) {
      localStorage.removeItem(STORAGE_KEY);
      applyColorScheme(null);
    } else {
      localStorage.setItem(STORAGE_KEY, target);
      applyColorScheme(target);
    }
  } catch {
    applyColorScheme(target);
  }
  return target;
}

export function initThemeSync(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyColorScheme(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : null);
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
