export const THEME_STORAGE_KEY = 'openexr-viewer:theme:v1';
export const DEFAULT_THEME_ID = 'default';
export const SPECTRUM_LATTICE_THEME_ID = 'spectrum-lattice';

export type ThemeId = typeof DEFAULT_THEME_ID | typeof SPECTRUM_LATTICE_THEME_ID;

export function parseStoredTheme(value: string | null): ThemeId {
  return value === SPECTRUM_LATTICE_THEME_ID ? SPECTRUM_LATTICE_THEME_ID : DEFAULT_THEME_ID;
}

export function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME_ID;
  }

  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveStoredTheme(theme: ThemeId): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime theme anyway.
  }
}

export function applyTheme(theme: ThemeId, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}
