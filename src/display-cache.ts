import type { DisplayLuminanceRange } from './types';

export const DISPLAY_CACHE_BUDGET_STORAGE_KEY = 'openexr-viewer:display-cache-budget-mb:v1';
export const DISPLAY_CACHE_BUDGET_OPTIONS_MB = [64, 128, 256, 512, 1024] as const;
export const MIN_DISPLAY_CACHE_BUDGET_MB = DISPLAY_CACHE_BUDGET_OPTIONS_MB[0];
export const MAX_DISPLAY_CACHE_BUDGET_MB =
  DISPLAY_CACHE_BUDGET_OPTIONS_MB[DISPLAY_CACHE_BUDGET_OPTIONS_MB.length - 1];
export const DEFAULT_DISPLAY_CACHE_BUDGET_MB = 256;
export const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface SessionResourceEntry {
  id: string;
  decodedBytes: number;
  layerUploads: Set<number>;
  luminanceRangeByRevision: Map<string, DisplayLuminanceRange | null>;
  activeTextureRevisionKey: string;
}

export function createSessionResourceEntry(id: string, decodedBytes = 0): SessionResourceEntry {
  return {
    id,
    decodedBytes: Math.max(0, Math.floor(decodedBytes)),
    layerUploads: new Set<number>(),
    luminanceRangeByRevision: new Map<string, DisplayLuminanceRange | null>(),
    activeTextureRevisionKey: ''
  };
}

export function clearSessionResources(entry: SessionResourceEntry): void {
  entry.decodedBytes = 0;
  entry.layerUploads.clear();
  entry.luminanceRangeByRevision.clear();
  entry.activeTextureRevisionKey = '';
}

export function getTrackedSessionCpuBytes(
  sessions: Array<Pick<SessionResourceEntry, 'decodedBytes'>>
): number {
  return sessions.reduce((total, session) => total + Math.max(0, session.decodedBytes), 0);
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
