// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  STOKES_COLORMAP_DEFAULTS_STORAGE_KEY,
  normalizeStokesColormapDefaultSettings,
  readStoredStokesColormapDefaults,
  saveStoredStokesColormapDefaults
} from '../src/stokes-colormap-settings';
import { createDefaultStokesColormapDefaultSettings } from '../src/stokes';

const registry = {
  options: [
    { id: '0', label: 'Viridis' },
    { id: '1', label: 'HSV' },
    { id: '2', label: 'Black-Red' },
    { id: '3', label: 'RdBu' }
  ]
};

describe('stokes colormap settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes stored labels and falls back per invalid or unavailable group', () => {
    const defaults = createDefaultStokesColormapDefaultSettings();

    expect(normalizeStokesColormapDefaultSettings({
      aolp: 'hsv',
      degree: {
        colormapLabel: 'Viridis',
        range: { min: 0.25, max: 0.75 },
        zeroCentered: true
      },
      cop: 'Missing',
      top: 42,
      normalized: {
        colormapLabel: 'RdBu',
        range: { min: 2, max: 1 },
        zeroCentered: false,
        modulation: { enabled: true }
      }
    }, registry)).toEqual({
      ...defaults,
      aolp: {
        ...defaults.aolp,
        colormapLabel: 'HSV'
      },
      degree: {
        ...defaults.degree,
        colormapLabel: 'Viridis',
        range: { min: 0.25, max: 0.75 },
        zeroCentered: true
      },
      normalized: {
        ...defaults.normalized,
        colormapLabel: 'RdBu',
        zeroCentered: false
      }
    });
  });

  it('reads legacy string-label storage into row settings', () => {
    const defaults = createDefaultStokesColormapDefaultSettings();
    window.localStorage.setItem(STOKES_COLORMAP_DEFAULTS_STORAGE_KEY, JSON.stringify({
      aolp: 'Viridis',
      degree: 'RdBu'
    }));

    expect(readStoredStokesColormapDefaults(registry)).toEqual({
      ...defaults,
      aolp: {
        ...defaults.aolp,
        colormapLabel: 'Viridis'
      },
      degree: {
        ...defaults.degree,
        colormapLabel: 'RdBu'
      }
    });
  });

  it('reads and writes stored row settings while clearing storage for defaults', () => {
    const defaults = createDefaultStokesColormapDefaultSettings();
    const settings = {
      ...defaults,
      aolp: {
        ...defaults.aolp,
        colormapLabel: 'Viridis',
        range: { min: -1, max: 1 },
        zeroCentered: true,
        modulation: { enabled: true, aolpMode: 'saturation' as const }
      },
      degree: {
        ...defaults.degree,
        colormapLabel: 'RdBu',
        range: { min: 0.1, max: 0.9 }
      }
    };

    saveStoredStokesColormapDefaults(settings);

    expect(JSON.parse(window.localStorage.getItem(STOKES_COLORMAP_DEFAULTS_STORAGE_KEY) ?? '{}')).toEqual(settings);
    expect(readStoredStokesColormapDefaults(registry)).toEqual(settings);

    saveStoredStokesColormapDefaults(createDefaultStokesColormapDefaultSettings());

    expect(window.localStorage.getItem(STOKES_COLORMAP_DEFAULTS_STORAGE_KEY)).toBeNull();
    expect(readStoredStokesColormapDefaults(registry)).toEqual(createDefaultStokesColormapDefaultSettings());
  });
});
