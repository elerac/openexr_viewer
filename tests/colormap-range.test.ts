import { describe, expect, it } from 'vitest';
import { computeRec709Luminance } from '../src/color';
import {
  buildZeroCenteredColormapRange,
  computeDisplayTextureLuminanceRange,
  resolveColormapAutoRange,
  shouldPreserveStokesColormapState,
  shouldRefreshDisplayLuminanceRange
} from '../src/colormap-range';
import { buildDisplayTexture, computeDisplaySelectionLuminanceRange } from '../src/display-texture';
import { DisplaySelection } from '../src/types';
import {
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';

describe('colormap range', () => {
  it('uses predefined Stokes ranges for auto colormap ranges', () => {
    const imageRange = { min: 0.2, max: 0.4 };
    const channelSelection: DisplaySelection = createChannelRgbSelection('R', 'G', 'B');

    expect(resolveColormapAutoRange(channelSelection, imageRange, false)).toEqual(imageRange);
    expect(resolveColormapAutoRange(channelSelection, imageRange, true)).toEqual({ min: -0.4, max: 0.4 });
    expect(resolveColormapAutoRange(createStokesSelection('aolp'), imageRange, false)).toEqual({
      min: 0,
      max: Math.PI
    });
    expect(resolveColormapAutoRange(createStokesSelection('s1_over_s0'), imageRange, false)).toEqual({
      min: -1,
      max: 1
    });
    expect(resolveColormapAutoRange(createStokesSelection('dolp'), imageRange, true)).toEqual({
      min: -1,
      max: 1
    });
  });

  it('preserves Stokes colormap state only within the same default group', () => {
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('dolp'),
      createStokesSelection('dop')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('dop'),
      createStokesSelection('docp')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('dolp'),
      createStokesSelection('docp')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('docp'),
      createStokesSelection('dolp')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('s1_over_s0'),
      createStokesSelection('s2_over_s0')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('s2_over_s0'),
      createStokesSelection('s3_over_s0')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('dolp', 'stokesScalar'),
      createStokesSelection('docp', 'stokesRgb')
    )).toBe(true);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('s1_over_s0', 'stokesRgb'),
      createStokesSelection('s3_over_s0', 'stokesScalar')
    )).toBe(true);
  });

  it('does not preserve Stokes colormap state across different groups or channel selections', () => {
    const channelSelection: DisplaySelection = createChannelRgbSelection('R', 'G', 'B');

    expect(shouldPreserveStokesColormapState(
      createStokesSelection('dolp'),
      createStokesSelection('s1_over_s0')
    )).toBe(false);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('aolp'),
      createStokesSelection('dolp')
    )).toBe(false);
    expect(shouldPreserveStokesColormapState(
      createStokesSelection('cop'),
      createStokesSelection('top')
    )).toBe(false);
    expect(shouldPreserveStokesColormapState(channelSelection, createStokesSelection('dolp'))).toBe(false);
    expect(shouldPreserveStokesColormapState(createStokesSelection('dolp'), channelSelection)).toBe(false);
  });

  it('computes finite luminance range from a display texture', () => {
    const texture = new Float32Array([
      1, 0, 0, 1,
      0, 1, 0, 1,
      0, 0, 1, 1
    ]);

    const range = computeDisplayTextureLuminanceRange(texture);

    expect(range?.min).toBeCloseTo(computeRec709Luminance(0, 0, 1), 6);
    expect(range?.max).toBeCloseTo(computeRec709Luminance(0, 1, 0), 6);
  });

  it('keeps collapsed luminance ranges explicit and returns null for empty textures', () => {
    const flatTexture = new Float32Array([
      0.25, 0.25, 0.25, 1,
      0.25, 0.25, 0.25, 1
    ]);

    expect(computeDisplayTextureLuminanceRange(flatTexture)).toEqual({
      min: 0.25,
      max: 0.25
    });
    expect(computeDisplayTextureLuminanceRange(new Float32Array())).toBeNull();
  });

  it('builds zero-centered colormap ranges from the largest absolute bound', () => {
    expect(buildZeroCenteredColormapRange({ min: -2, max: 1 })).toEqual({ min: -2, max: 2 });
    expect(buildZeroCenteredColormapRange({ min: 0.2, max: 3 })).toEqual({ min: -3, max: 3 });
    expect(buildZeroCenteredColormapRange({ min: 0, max: 0 })).toEqual({ min: -1, max: 1 });
  });

  it('computes colormap luminance range from a repeated single-channel mapping', () => {
    const layer = createLayerFromChannels({
      R: [10, 20],
      G: [0.25, 0.75],
      B: [100, 200]
    });

    const texture = buildDisplayTexture(layer, 2, 1, 'G', 'G', 'G');
    const range = computeDisplayTextureLuminanceRange(texture);

    expect(range?.min).toBeCloseTo(0.25, 6);
    expect(range?.max).toBeCloseTo(0.75, 6);
  });

  it('matches direct-from-source luminance reduction against the snapshot texture path', () => {
    const layer = createLayerFromChannels({
      R: [0.1, 0.4],
      G: [0.2, 0.5],
      B: [0.3, 0.6]
    });
    const selection: DisplaySelection = createChannelRgbSelection('R', 'G', 'B');

    expect(computeDisplaySelectionLuminanceRange(layer, 2, 1, selection)).toEqual(
      computeDisplayTextureLuminanceRange(buildDisplayTexture(layer, 2, 1, 'R', 'G', 'B'))
    );
  });

  it('does not include display alpha in luminance range computation', () => {
    const texture = new Float32Array([
      0.25, 0.25, 0.25, 0,
      0.5, 0.5, 0.5, 1
    ]);

    expect(computeDisplayTextureLuminanceRange(texture)).toEqual({
      min: 0.25,
      max: 0.5
    });
  });

  it('refreshes display luminance range lazily only for stale colormap textures', () => {
    expect(shouldRefreshDisplayLuminanceRange('rgb', 'next', '', true)).toBe(false);
    expect(shouldRefreshDisplayLuminanceRange('colormap', 'next', '', false)).toBe(false);
    expect(shouldRefreshDisplayLuminanceRange('colormap', 'next', 'next', true)).toBe(false);
    expect(shouldRefreshDisplayLuminanceRange('colormap', 'next', 'previous', true)).toBe(true);
  });
});
