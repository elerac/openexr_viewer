export const SPECTRUM_LATTICE_MOTION_STORAGE_KEY = 'openexr-viewer:spectrum-lattice-motion:v1';
export const SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM = 'system';
export const SPECTRUM_LATTICE_MOTION_ANIMATE = 'animate';
export const DEFAULT_SPECTRUM_LATTICE_MOTION_PREFERENCE = SPECTRUM_LATTICE_MOTION_ANIMATE;

interface SpectrumLatticeMotionPreferenceDefinitionBase {
  id: string;
  label: string;
}

export const SPECTRUM_LATTICE_MOTION_PREFERENCES = [
  { id: SPECTRUM_LATTICE_MOTION_ANIMATE, label: 'Animate' },
  { id: SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM, label: 'Follow system' }
] as const satisfies readonly SpectrumLatticeMotionPreferenceDefinitionBase[];

export type SpectrumLatticeMotionPreference = (typeof SPECTRUM_LATTICE_MOTION_PREFERENCES)[number]['id'];

export function parseSpectrumLatticeMotionPreference(value: string | null): SpectrumLatticeMotionPreference {
  return isSpectrumLatticeMotionPreference(value) ? value : DEFAULT_SPECTRUM_LATTICE_MOTION_PREFERENCE;
}

export function isSpectrumLatticeMotionPreference(
  value: string | null
): value is SpectrumLatticeMotionPreference {
  return SPECTRUM_LATTICE_MOTION_PREFERENCES.some((preference) => preference.id === value);
}

export function readStoredSpectrumLatticeMotionPreference(): SpectrumLatticeMotionPreference {
  if (typeof window === 'undefined') {
    return DEFAULT_SPECTRUM_LATTICE_MOTION_PREFERENCE;
  }

  try {
    return parseSpectrumLatticeMotionPreference(
      window.localStorage.getItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY)
    );
  } catch {
    return DEFAULT_SPECTRUM_LATTICE_MOTION_PREFERENCE;
  }
}

export function saveStoredSpectrumLatticeMotionPreference(
  preference: SpectrumLatticeMotionPreference
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (preference === DEFAULT_SPECTRUM_LATTICE_MOTION_PREFERENCE) {
      window.localStorage.removeItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SPECTRUM_LATTICE_MOTION_STORAGE_KEY, preference);
    }
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime preference anyway.
  }
}
