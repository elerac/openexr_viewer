// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  SPECTRUM_LATTICE_MOTION_ANIMATE,
  SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM,
  SPECTRUM_LATTICE_MOTION_STORAGE_KEY,
  parseSpectrumLatticeMotionPreference,
  readStoredSpectrumLatticeMotionPreference,
  saveStoredSpectrumLatticeMotionPreference
} from '../src/spectrum-lattice-motion';

afterEach(() => {
  window.localStorage.clear();
});

describe('Spectrum lattice motion settings', () => {
  it('defaults missing and invalid stored values to animating', () => {
    expect(parseSpectrumLatticeMotionPreference(null)).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(parseSpectrumLatticeMotionPreference('')).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(parseSpectrumLatticeMotionPreference('unknown')).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(parseSpectrumLatticeMotionPreference(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM)).toBe(
      SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM
    );
    expect(parseSpectrumLatticeMotionPreference(SPECTRUM_LATTICE_MOTION_ANIMATE)).toBe(
      SPECTRUM_LATTICE_MOTION_ANIMATE
    );
  });

  it('persists follow-system and clears storage for the default animate preference', () => {
    saveStoredSpectrumLatticeMotionPreference(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);

    expect(window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)).toBe(
      SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM
    );
    expect(readStoredSpectrumLatticeMotionPreference()).toBe(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);

    saveStoredSpectrumLatticeMotionPreference(SPECTRUM_LATTICE_MOTION_ANIMATE);

    expect(window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)).toBeNull();
    expect(readStoredSpectrumLatticeMotionPreference()).toBe(SPECTRUM_LATTICE_MOTION_ANIMATE);
  });
});
