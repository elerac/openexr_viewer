import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_CACHE_BUDGET_MB,
  DISPLAY_CACHE_BUDGET_OPTIONS_MB,
  MAX_DISPLAY_CACHE_BUDGET_MB,
  MIN_DISPLAY_CACHE_BUDGET_MB,
  clampDisplayCacheBudgetMb,
  clearSessionDisplayCache,
  getRetainedDisplayCacheBytes,
  parseDisplayCacheBudgetStorageValue,
  pruneDisplayCachesToBudget
} from '../src/display-cache';

function createSession(
  id: string,
  sizeBytes: number,
  options: {
    touched?: number;
  } = {}
): {
  id: string;
  displayTexture: Float32Array | null;
  displayLuminanceRange: { min: number; max: number } | null;
  displayLuminanceRangeRevisionKey: string;
  textureRevisionKey: string;
  lastTouched: number;
} {
  return {
    id,
    displayTexture: sizeBytes > 0 ? new Float32Array(sizeBytes / 4) : null,
    displayLuminanceRange: sizeBytes > 0 ? { min: 0, max: 1 } : null,
    displayLuminanceRangeRevisionKey: sizeBytes > 0 ? `${id}-range` : '',
    textureRevisionKey: sizeBytes > 0 ? `${id}-texture` : '',
    lastTouched: options.touched ?? 0
  };
}

describe('display cache policy', () => {
  it('evicts the least recently used inactive session first', () => {
    const sessions = [
      createSession('a', 24, { touched: 1 }),
      createSession('b', 16, { touched: 2 }),
      createSession('c', 12, { touched: 3 })
    ];

    const evicted = pruneDisplayCachesToBudget(sessions, 'c', 40);

    expect(evicted).toEqual(['a']);
    expect(sessions[0].displayTexture).toBeNull();
    expect(sessions[1].displayTexture?.byteLength).toBe(16);
    expect(sessions[2].displayTexture?.byteLength).toBe(12);
  });

  it('keeps the active session even when it is the oldest cached entry', () => {
    const sessions = [
      createSession('a', 24, { touched: 1 }),
      createSession('b', 16, { touched: 2 }),
      createSession('c', 12, { touched: 3 })
    ];

    const evicted = pruneDisplayCachesToBudget(sessions, 'a', 40);

    expect(evicted).toEqual(['b']);
    expect(sessions[0].displayTexture?.byteLength).toBe(24);
    expect(sessions[1].displayTexture).toBeNull();
    expect(sessions[2].displayTexture?.byteLength).toBe(12);
  });

  it('continues evicting inactive sessions until retained bytes fit the budget', () => {
    const sessions = [
      createSession('a', 24, { touched: 1 }),
      createSession('b', 16, { touched: 2 }),
      createSession('c', 12, { touched: 3 })
    ];

    const evicted = pruneDisplayCachesToBudget(sessions, 'c', 20);

    expect(evicted).toEqual(['a', 'b']);
    expect(getRetainedDisplayCacheBytes(sessions)).toBe(12);
    expect(sessions[0].displayTexture).toBeNull();
    expect(sessions[1].displayTexture).toBeNull();
    expect(sessions[2].displayTexture?.byteLength).toBe(12);
  });

  it('prunes inactive caches when the budget is lowered', () => {
    const sessions = [
      createSession('a', 12, { touched: 3 }),
      createSession('b', 16, { touched: 1 }),
      createSession('c', 12, { touched: 2 })
    ];

    expect(pruneDisplayCachesToBudget(sessions, 'a', 64)).toEqual([]);

    const evicted = pruneDisplayCachesToBudget(sessions, 'a', 24);

    expect(evicted).toEqual(['b']);
    expect(getRetainedDisplayCacheBytes(sessions)).toBe(24);
  });

  it('does not evict anything when the budget is raised above retained bytes', () => {
    const sessions = [
      createSession('a', 12, { touched: 1 }),
      createSession('b', 16, { touched: 2 }),
      createSession('c', 12, { touched: 3 })
    ];

    const evicted = pruneDisplayCachesToBudget(sessions, 'c', 48);

    expect(evicted).toEqual([]);
    expect(getRetainedDisplayCacheBytes(sessions)).toBe(40);
  });

  it('counts retained bytes from typed-array byteLength only', () => {
    const sessions = [
      createSession('a', 24),
      createSession('b', 8),
      createSession('c', 0)
    ];

    expect(getRetainedDisplayCacheBytes(sessions)).toBe(32);
  });

  it('clears cache payload and revision keys for evicted sessions', () => {
    const session = createSession('a', 24, { touched: 7 });

    clearSessionDisplayCache(session);

    expect(session.displayTexture).toBeNull();
    expect(session.displayLuminanceRange).toBeNull();
    expect(session.displayLuminanceRangeRevisionKey).toBe('');
    expect(session.textureRevisionKey).toBe('');
    expect(session.lastTouched).toBe(0);
  });
});

describe('display cache budget parsing', () => {
  it('falls back to the default budget for corrupt storage values', () => {
    expect(parseDisplayCacheBudgetStorageValue(null)).toBe(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
    expect(parseDisplayCacheBudgetStorageValue('not-a-number')).toBe(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
  });

  it('clamps parsed storage values to the allowed min and max', () => {
    expect(parseDisplayCacheBudgetStorageValue('8')).toBe(MIN_DISPLAY_CACHE_BUDGET_MB);
    expect(parseDisplayCacheBudgetStorageValue('9000')).toBe(MAX_DISPLAY_CACHE_BUDGET_MB);
  });

  it('snaps direct budget updates to the nearest allowed preset', () => {
    expect(clampDisplayCacheBudgetMb(NaN)).toBe(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
    expect(clampDisplayCacheBudgetMb(MIN_DISPLAY_CACHE_BUDGET_MB - 1)).toBe(MIN_DISPLAY_CACHE_BUDGET_MB);
    expect(clampDisplayCacheBudgetMb(MAX_DISPLAY_CACHE_BUDGET_MB + 1)).toBe(MAX_DISPLAY_CACHE_BUDGET_MB);
    expect(clampDisplayCacheBudgetMb(200)).toBe(256);
    expect(clampDisplayCacheBudgetMb(300)).toBe(256);
    expect(clampDisplayCacheBudgetMb(400)).toBe(512);
  });

  it('exposes the supported preset options in ascending order', () => {
    expect(DISPLAY_CACHE_BUDGET_OPTIONS_MB).toEqual([64, 128, 256, 512, 1024]);
  });
});
