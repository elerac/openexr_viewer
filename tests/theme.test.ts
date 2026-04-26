// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_ID,
  SPECTRUM_LATTICE_THEME_ID,
  THEME_STORAGE_KEY,
  applyTheme,
  parseStoredTheme,
  readStoredTheme,
  saveStoredTheme
} from '../src/theme';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme settings', () => {
  it('defaults missing and invalid stored values to the default theme', () => {
    expect(parseStoredTheme(null)).toBe(DEFAULT_THEME_ID);
    expect(parseStoredTheme('')).toBe(DEFAULT_THEME_ID);
    expect(parseStoredTheme(DEFAULT_THEME_ID)).toBe(DEFAULT_THEME_ID);
    expect(parseStoredTheme('unknown')).toBe(DEFAULT_THEME_ID);
    expect(parseStoredTheme(SPECTRUM_LATTICE_THEME_ID)).toBe(SPECTRUM_LATTICE_THEME_ID);
  });

  it('persists, reads, and applies the selected theme', () => {
    saveStoredTheme(SPECTRUM_LATTICE_THEME_ID);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(SPECTRUM_LATTICE_THEME_ID);
    expect(readStoredTheme()).toBe(SPECTRUM_LATTICE_THEME_ID);

    applyTheme(SPECTRUM_LATTICE_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(SPECTRUM_LATTICE_THEME_ID);

    applyTheme(DEFAULT_THEME_ID);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    saveStoredTheme(DEFAULT_THEME_ID);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readStoredTheme()).toBe(DEFAULT_THEME_ID);
  });
});
