import { describe, expect, it } from 'vitest';
import {
  createInterleavedChannelStorage,
  createPlanarChannelStorage
} from '../src/channel-storage';
import {
  DEFAULT_DISPLAY_CACHE_BUDGET_MB,
  DISPLAY_CACHE_BUDGET_OPTIONS_MB,
  MAX_DISPLAY_CACHE_BUDGET_MB,
  MIN_DISPLAY_CACHE_BUDGET_MB,
  clampDisplayCacheBudgetMb,
  clearSessionResources,
  createSessionResourceEntry,
  estimateDecodedImageBytes,
  getTrackedResidentBytes,
  getTrackedResidentChannelBytes,
  parseDisplayCacheBudgetStorageValue
} from '../src/display-cache';
import type { DecodedExrImage } from '../src/types';

describe('display cache resource accounting', () => {
  it('tracks decoded baseline and retained CPU/GPU bytes across session layer channels', () => {
    const sessions = [
      createSessionResourceEntry('a'),
      createSessionResourceEntry('b'),
      createSessionResourceEntry('c')
    ];
    sessions[0].decodedBytes = 10;
    sessions[0].residentLayers.set(0, {
      residentChannels: new Map([
        ['R', { textureBytes: 24, materializedBytes: 12, lastAccessToken: 1 }]
      ])
    });
    sessions[1].decodedBytes = 5;
    sessions[1].residentLayers.set(0, {
      residentChannels: new Map([
        ['G', { textureBytes: 8, materializedBytes: 0, lastAccessToken: 2 }]
      ])
    });
    sessions[1].residentLayers.set(1, {
      residentChannels: new Map([
        ['Z', { textureBytes: 4, materializedBytes: 2, lastAccessToken: 3 }]
      ])
    });

    expect(getTrackedResidentBytes(sessions)).toBe(65);
  });

  it('clamps invalid retained channel byte counts', () => {
    expect(getTrackedResidentChannelBytes({
      textureBytes: 10.9,
      materializedBytes: Number.NaN
    })).toBe(10);
  });

  it('estimates decoded pixel bytes from interleaved and planar channel storage', () => {
    const image: DecodedExrImage = {
      width: 2,
      height: 1,
      layers: [
        {
          name: 'beauty',
          channelNames: ['R', 'G', 'B'],
          channelStorage: createInterleavedChannelStorage(new Float32Array(6), ['R', 'G', 'B']),
          analysis: {
            displayLuminanceRangeBySelectionKey: {},
            finiteRangeByChannel: {}
          }
        },
        {
          name: 'depth',
          channelNames: ['Z', 'A'],
          channelStorage: createPlanarChannelStorage({
            Z: new Float32Array(2),
            A: new Float32Array(2)
          }, ['Z', 'A']),
          analysis: {
            displayLuminanceRangeBySelectionKey: {},
            finiteRangeByChannel: {}
          }
        }
      ]
    };

    expect(estimateDecodedImageBytes(image)).toBe(40);
  });

  it('clears pinned state, decoded bytes, resident channels, and cached ranges', () => {
    const session = createSessionResourceEntry('a');
    session.pinned = true;
    session.decodedBytes = 12;
    session.residentLayers.set(0, {
      residentChannels: new Map([
        ['R', { textureBytes: 24, materializedBytes: 12, lastAccessToken: 7 }]
      ])
    });
    session.luminanceRangeByRevision.set('rev', { min: 0, max: 1 });

    clearSessionResources(session);

    expect(session.pinned).toBe(false);
    expect(session.decodedBytes).toBe(0);
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
