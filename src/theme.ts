export const THEME_STORAGE_KEY = 'openexr-viewer:theme:v1';
export const DEFAULT_THEME_ID = 'default';
export const SPECTRUM_LATTICE_THEME_ID = 'spectrum-lattice';

interface ThemeDefinitionBase {
  id: string;
  label: string;
}

export const THEMES = [
  { id: DEFAULT_THEME_ID, label: 'Default' },
  { id: SPECTRUM_LATTICE_THEME_ID, label: 'Spectrum lattice' }
] as const satisfies readonly ThemeDefinitionBase[];

export type ThemeId = (typeof THEMES)[number]['id'];

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
}

export function parseStoredTheme(value: string | null): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
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
    if (theme === DEFAULT_THEME_ID) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime theme anyway.
  }
}

export function applyTheme(theme: ThemeId, root: HTMLElement = document.documentElement): void {
  if (theme === DEFAULT_THEME_ID) {
    delete root.dataset.theme;
    return;
  }

  root.dataset.theme = theme;
}
