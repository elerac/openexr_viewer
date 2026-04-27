import type { ColormapRegistry } from './colormaps';
import {
  STOKES_COLORMAP_DEFAULT_GROUPS,
  cloneStokesColormapDefaultSetting,
  cloneStokesColormapDefaultSettings,
  createDefaultStokesColormapDefaultSettings,
  type StokesColormapDefaultGroup,
  type StokesColormapDefaultSetting,
  type StokesColormapDefaultSettings
} from './stokes';

export const STOKES_COLORMAP_DEFAULTS_STORAGE_KEY = 'openexr-viewer:stokes-colormap-defaults:v1';

export function normalizeStokesColormapDefaultSettings(
  input: unknown,
  registry: Pick<ColormapRegistry, 'options'> | null = null
): StokesColormapDefaultSettings {
  const settings = createDefaultStokesColormapDefaultSettings();
  const record = isRecord(input) ? input : {};
  const labelsByKey = registry
    ? new Map(registry.options.map((option) => [normalizeLabel(option.label), option.label]))
    : null;

  for (const group of STOKES_COLORMAP_DEFAULT_GROUPS) {
    settings[group] = normalizeStokesColormapDefaultSetting(group, record[group], labelsByKey);
  }

  return settings;
}

export function readStoredStokesColormapDefaults(
  registry: Pick<ColormapRegistry, 'options'> | null = null
): StokesColormapDefaultSettings {
  if (typeof window === 'undefined') {
    return createDefaultStokesColormapDefaultSettings();
  }

  try {
    const raw = window.localStorage.getItem(STOKES_COLORMAP_DEFAULTS_STORAGE_KEY);
    if (!raw) {
      return createDefaultStokesColormapDefaultSettings();
    }

    return normalizeStokesColormapDefaultSettings(JSON.parse(raw), registry);
  } catch {
    return createDefaultStokesColormapDefaultSettings();
  }
}

export function saveStoredStokesColormapDefaults(settings: StokesColormapDefaultSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (sameStokesColormapDefaultSettings(settings, createDefaultStokesColormapDefaultSettings())) {
      window.localStorage.removeItem(STOKES_COLORMAP_DEFAULTS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STOKES_COLORMAP_DEFAULTS_STORAGE_KEY,
      JSON.stringify(serializeStokesColormapDefaultSettings(settings))
    );
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}

export function sameStokesColormapDefaultSettings(
  a: StokesColormapDefaultSettings,
  b: StokesColormapDefaultSettings
): boolean {
  return STOKES_COLORMAP_DEFAULT_GROUPS.every((group) => sameStokesColormapDefaultSetting(a[group], b[group]));
}

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function normalizeStokesColormapDefaultSetting(
  group: StokesColormapDefaultGroup,
  input: unknown,
  labelsByKey: Map<string, string> | null
): StokesColormapDefaultSetting {
  const defaults = createDefaultStokesColormapDefaultSettings();
  const setting = cloneStokesColormapDefaultSetting(defaults[group]);

  if (typeof input === 'string') {
    const label = normalizeStoredColormapLabel(input, labelsByKey);
    return label ? { ...setting, colormapLabel: label } : setting;
  }

  if (!isRecord(input)) {
    return setting;
  }

  const label = typeof input.colormapLabel === 'string'
    ? normalizeStoredColormapLabel(input.colormapLabel, labelsByKey)
    : null;
  if (label) {
    setting.colormapLabel = label;
  }

  const range = normalizeStoredRange(input.range);
  if (range) {
    setting.range = range;
  }

  if (typeof input.zeroCentered === 'boolean') {
    setting.zeroCentered = input.zeroCentered;
  }

  if (setting.modulation) {
    setting.modulation = normalizeStoredModulation(group, input.modulation, setting.modulation);
  }

  return setting;
}

function normalizeStoredColormapLabel(label: string, labelsByKey: Map<string, string> | null): string | null {
  const trimmed = label.trim();
  if (!trimmed) {
    return null;
  }

  if (!labelsByKey) {
    return trimmed;
  }

  return labelsByKey.get(normalizeLabel(trimmed)) ?? null;
}

function normalizeStoredRange(input: unknown): { min: number; max: number } | null {
  if (!isRecord(input)) {
    return null;
  }

  const min = parseStoredFiniteNumber(input.min);
  const max = parseStoredFiniteNumber(input.max);
  return Number.isFinite(min) && Number.isFinite(max) && min < max
    ? { min, max }
    : null;
}

function parseStoredFiniteNumber(input: unknown): number {
  if (typeof input === 'string' && input.trim().length === 0) {
    return Number.NaN;
  }

  return Number(input);
}

function normalizeStoredModulation(
  group: StokesColormapDefaultGroup,
  input: unknown,
  fallback: NonNullable<StokesColormapDefaultSetting['modulation']>
): NonNullable<StokesColormapDefaultSetting['modulation']> {
  if (typeof input === 'boolean') {
    return group === 'aolp'
      ? { enabled: input, aolpMode: fallback.aolpMode ?? 'value' }
      : { enabled: input };
  }

  if (!isRecord(input)) {
    return { ...fallback };
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled;
  if (group !== 'aolp') {
    return { enabled };
  }

  const aolpMode = input.aolpMode === 'saturation' || input.aolpMode === 'value'
    ? input.aolpMode
    : fallback.aolpMode ?? 'value';
  return { enabled, aolpMode };
}

function serializeStokesColormapDefaultSettings(
  settings: StokesColormapDefaultSettings
): StokesColormapDefaultSettings {
  return cloneStokesColormapDefaultSettings(settings);
}

function sameStokesColormapDefaultSetting(
  a: StokesColormapDefaultSetting,
  b: StokesColormapDefaultSetting
): boolean {
  return (
    a.colormapLabel === b.colormapLabel &&
    a.range.min === b.range.min &&
    a.range.max === b.range.max &&
    a.zeroCentered === b.zeroCentered &&
    sameModulation(a.modulation, b.modulation)
  );
}

function sameModulation(
  a: StokesColormapDefaultSetting['modulation'],
  b: StokesColormapDefaultSetting['modulation']
): boolean {
  if (!a && !b) {
    return true;
  }

  return Boolean(
    a &&
    b &&
    a.enabled === b.enabled &&
    (a.aolpMode ?? 'value') === (b.aolpMode ?? 'value')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
