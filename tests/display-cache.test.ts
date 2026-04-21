import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_CACHE_BUDGET_MB,
  DISPLAY_CACHE_BUDGET_OPTIONS_MB,
  MAX_DISPLAY_CACHE_BUDGET_MB,
  MIN_DISPLAY_CACHE_BUDGET_MB,
  clampDisplayCacheBudgetMb,
  clearSessionResources,
  createSessionResourceEntry,
  getTrackedSessionCpuBytes,
  parseDisplayCacheBudgetStorageValue
} from '../src/display-cache';

describe('display cache resource accounting', () => {
  it('tracks CPU bytes from decoded sessions', () => {
    const sessions = [
      createSessionResourceEntry('a', 24),
      createSessionResourceEntry('b', 8),
      createSessionResourceEntry('c', 0)
    ];

    expect(getTrackedSessionCpuBytes(sessions)).toBe(32);
  });

  it('clears uploaded layers, cached ranges, and active revision metadata', () => {
    const session = createSessionResourceEntry('a', 24);
    session.layerUploads.add(0);
    session.luminanceRangeByRevision.set('rev', { min: 0, max: 1 });
    session.activeTextureRevisionKey = 'rev';

    clearSessionResources(session);

    expect(session.decodedBytes).toBe(0);
    expect(session.layerUploads.size).toBe(0);
    expect(session.luminanceRangeByRevision.size).toBe(0);
    expect(session.activeTextureRevisionKey).toBe('');
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
