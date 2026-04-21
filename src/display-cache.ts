import type { DisplayLuminanceRange } from './types';

export const DISPLAY_CACHE_BUDGET_STORAGE_KEY = 'openexr-viewer:display-cache-budget-mb:v1';
export const DISPLAY_CACHE_BUDGET_OPTIONS_MB = [64, 128, 256, 512, 1024] as const;
export const MIN_DISPLAY_CACHE_BUDGET_MB = DISPLAY_CACHE_BUDGET_OPTIONS_MB[0];
export const MAX_DISPLAY_CACHE_BUDGET_MB =
  DISPLAY_CACHE_BUDGET_OPTIONS_MB[DISPLAY_CACHE_BUDGET_OPTIONS_MB.length - 1];
export const DEFAULT_DISPLAY_CACHE_BUDGET_MB = 256;
export const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface DisplayCacheEntry {
  id: string;
  displayTexture: Float32Array | null;
  displayLuminanceRange: DisplayLuminanceRange | null;
  displayLuminanceRangeRevisionKey: string;
  textureRevisionKey: string;
  pinned: boolean;
  lastTouched: number;
}

export function createDisplayCacheEntry(id: string): DisplayCacheEntry {
  return {
    id,
    displayTexture: null,
    displayLuminanceRange: null,
    displayLuminanceRangeRevisionKey: '',
    textureRevisionKey: '',
    pinned: false,
    lastTouched: 0
  };
}

export function clearSessionDisplayCache(session: DisplayCacheEntry): void {
  session.displayTexture = null;
  session.displayLuminanceRange = null;
  session.displayLuminanceRangeRevisionKey = '';
  session.textureRevisionKey = '';
  session.lastTouched = 0;
}

export function getRetainedDisplayCacheBytes(
  sessions: Array<Pick<DisplayCacheEntry, 'displayTexture'>>
): number {
  return sessions.reduce((total, session) => total + (session.displayTexture?.byteLength ?? 0), 0);
}

export function pruneDisplayCachesToBudget(
  sessions: DisplayCacheEntry[],
  activeSessionId: string | null,
  budgetBytes: number
): string[] {
  const normalizedBudgetBytes = Math.max(0, Math.floor(budgetBytes));
  let retainedBytes = getRetainedDisplayCacheBytes(sessions);
  if (retainedBytes <= normalizedBudgetBytes) {
    return [];
  }

  const evictedSessionIds: string[] = [];
  const evictionCandidates = sessions
    .filter(
      (session) =>
        session.id !== activeSessionId &&
        !session.pinned &&
        Boolean(session.displayTexture)
    )
    .sort((a, b) => {
      if (a.lastTouched !== b.lastTouched) {
        return a.lastTouched - b.lastTouched;
      }

      return a.id.localeCompare(b.id);
    });

  for (const session of evictionCandidates) {
    if (retainedBytes <= normalizedBudgetBytes) {
      break;
    }

    retainedBytes -= session.displayTexture?.byteLength ?? 0;
    clearSessionDisplayCache(session);
    evictedSessionIds.push(session.id);
  }

  return evictedSessionIds;
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
