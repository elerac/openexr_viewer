import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_CACHE_BUDGET_MB,
  DISPLAY_CACHE_BUDGET_OPTIONS_MB,
  MAX_DISPLAY_CACHE_BUDGET_MB,
  MIN_DISPLAY_CACHE_BUDGET_MB,
  clampDisplayCacheBudgetMb,
  clearSessionResources,
  createSessionResourceEntry,
  getTrackedResidentTextureBytes,
  parseDisplayCacheBudgetStorageValue
} from '../src/display-cache';

describe('display cache resource accounting', () => {
  it('tracks resident GPU texture bytes across session layer channels', () => {
    const sessions = [
      createSessionResourceEntry('a'),
      createSessionResourceEntry('b'),
      createSessionResourceEntry('c')
    ];
    sessions[0].residentLayers.set(0, {
      residentChannels: new Map([
        ['R', { textureBytes: 24, lastAccessToken: 1 }]
      ])
    });
    sessions[1].residentLayers.set(0, {
      residentChannels: new Map([
        ['G', { textureBytes: 8, lastAccessToken: 2 }]
      ])
    });
    sessions[1].residentLayers.set(1, {
      residentChannels: new Map([
        ['Z', { textureBytes: 4, lastAccessToken: 3 }]
      ])
    });

    expect(getTrackedResidentTextureBytes(sessions)).toBe(36);
  });

  it('clears pinned state, resident channels, and cached ranges', () => {
    const session = createSessionResourceEntry('a');
    session.pinned = true;
    session.residentLayers.set(0, {
      residentChannels: new Map([
        ['R', { textureBytes: 24, lastAccessToken: 7 }]
      ])
    });
    session.luminanceRangeByRevision.set('rev', { min: 0, max: 1 });

    clearSessionResources(session);

    expect(session.pinned).toBe(false);
    expect(session.residentLayers.size).toBe(0);
    expect(session.luminanceRangeByRevision.size).toBe(0);
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
