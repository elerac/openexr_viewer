import { describe, expect, it } from 'vitest';
import {
  buildDisplayAutoExposureRevisionKey,
  buildDisplayLuminanceRevisionKey,
  buildDisplayTextureRevisionKey
} from '../src/display/revision-keys';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createStokesSelection,
  createViewerState
} from './helpers/state-fixtures';

describe('display revision keys', () => {
  it('builds a stable revision key for display selection state', () => {
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    })).toBe('0:channelRgb:R:G:B:');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'G')
    })).toBe('1:stokesAngle:aolp:rgbComponent:G');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 2,
      displaySelection: createStokesSelection('dolp', 'stokesRgb'),
      visualizationMode: 'rgb'
    })).toBe('2:stokesScalar:dolp:rgbLuminance:rgb');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 2,
      displaySelection: createStokesSelection('dolp', 'stokesRgb'),
      visualizationMode: 'colormap'
    })).toBe('2:stokesScalar:dolp:rgbLuminance:colormap');
  });

  it('builds luminance revision keys that ignore alpha-only channel changes', () => {
    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A')
    })).toBe('0:channelRgb:R:G:B');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    })).toBe('2:channelMono:Y');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 3,
      displaySelection: createStokesSelection('aolp', 'stokesRgb'),
      visualizationMode: 'rgb'
    })).toBe('3:stokesAngle:aolp:rgbLuminance:rgb');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 3,
      displaySelection: createStokesSelection('aolp', 'stokesRgb'),
      visualizationMode: 'colormap'
    })).toBe('3:stokesAngle:aolp:rgbLuminance:colormap');
  });

  it('builds auto-exposure revision keys with rgb max percentile context', () => {
    expect(buildDisplayAutoExposureRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    })).toBe('0:channelRgb:R:G:B::autoExposure:rgbMax:p99.5');
  });

  it('matches revision keys used by viewer state', () => {
    const state = createViewerState({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    });

    expect(buildDisplayTextureRevisionKey(state)).toBe('2:channelMono:Y:A');
  });
});
