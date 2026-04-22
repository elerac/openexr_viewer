import type { DisplayLuminanceRange } from './types';

export const DISPLAY_CACHE_BUDGET_STORAGE_KEY = 'openexr-viewer:display-cache-budget-mb:v1';
export const DISPLAY_CACHE_BUDGET_OPTIONS_MB = [64, 128, 256, 512, 1024] as const;
export const MIN_DISPLAY_CACHE_BUDGET_MB = DISPLAY_CACHE_BUDGET_OPTIONS_MB[0];
export const MAX_DISPLAY_CACHE_BUDGET_MB =
  DISPLAY_CACHE_BUDGET_OPTIONS_MB[DISPLAY_CACHE_BUDGET_OPTIONS_MB.length - 1];
export const DEFAULT_DISPLAY_CACHE_BUDGET_MB = 256;
export const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface ResidentChannelResourceEntry {
  textureBytes: number;
  lastAccessToken: number;
}

export interface ResidentLayerResourceEntry {
  residentChannels: Map<string, ResidentChannelResourceEntry>;
}

export interface SessionResourceEntry {
  id: string;
  pinned: boolean;
  residentLayers: Map<number, ResidentLayerResourceEntry>;
  luminanceRangeByRevision: Map<string, DisplayLuminanceRange | null>;
}

export function createSessionResourceEntry(id: string): SessionResourceEntry {
  return {
    id,
    pinned: false,
    residentLayers: new Map<number, ResidentLayerResourceEntry>(),
    luminanceRangeByRevision: new Map<string, DisplayLuminanceRange | null>()
  };
}

export function clearSessionResources(entry: SessionResourceEntry): void {
  entry.pinned = false;
  entry.residentLayers.clear();
  entry.luminanceRangeByRevision.clear();
}

export function getTrackedResidentTextureBytes(
  sessions: Array<Pick<SessionResourceEntry, 'residentLayers'>>
): number {
  return sessions.reduce((total, session) => {
    let sessionBytes = 0;
    for (const layer of session.residentLayers.values()) {
      for (const channel of layer.residentChannels.values()) {
        sessionBytes += Math.max(0, Math.floor(channel.textureBytes));
      }
    }
    return total + sessionBytes;
  }, 0);
}

export function clampDisplayCacheBudgetMb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DISPLAY_CACHE_BUDGET_MB;
  }

  const roundedValue = Math.round(value);
  let nearestBudget: number = DISPLAY_CACHE_BUDGET_OPTIONS_MB[0];
  let nearestDistance = Math.abs(roundedValue - nearestBudget);

  for (const budget of DISPLAY_CACHE_BUDGET_OPTIONS_MB.slice(1)) {
    const distance = Math.abs(roundedValue - budget);
    if (distance < nearestDistance || (distance === nearestDistance && budget > nearestBudget)) {
      nearestBudget = budget;
      nearestDistance = distance;
    }
  }

  return nearestBudget;
}

export function parseDisplayCacheBudgetStorageValue(value: string | null): number {
  if (!value) {
    return DEFAULT_DISPLAY_CACHE_BUDGET_MB;
  }

  const parsed = Number(value);
  return clampDisplayCacheBudgetMb(parsed);
}

export function displayCacheBudgetMbToBytes(valueMb: number): number {
  return clampDisplayCacheBudgetMb(valueMb) * BYTES_PER_MEGABYTE;
}

export function readStoredDisplayCacheBudgetMb(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_DISPLAY_CACHE_BUDGET_MB;
  }

  try {
    return parseDisplayCacheBudgetStorageValue(window.localStorage.getItem(DISPLAY_CACHE_BUDGET_STORAGE_KEY));
  } catch {
    return DEFAULT_DISPLAY_CACHE_BUDGET_MB;
  }
}

export function saveStoredDisplayCacheBudgetMb(valueMb: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedValueMb = clampDisplayCacheBudgetMb(valueMb);

  try {
    window.localStorage.setItem(DISPLAY_CACHE_BUDGET_STORAGE_KEY, String(normalizedValueMb));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime budget anyway.
  }
}
