import { describe, expect, it } from 'vitest';
import { __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { computeRec709Luminance } from '../src/color';
import {
  buildDisplayTexture,
  buildSelectedDisplayTexture,
  buildStokesDisplayTexture
} from '../src/display/materialize-cpu';
import { samplePixelValuesForDisplay } from '../src/sampling/probe';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayer,
  createLayerFromChannels,
  createSpectralRgbSelection,
  createStokesSelection
} from './helpers/state-fixtures';

describe('display CPU materialization', () => {
  it('builds RGBA display texture from selected channels', () => {
    const layer = createLayer();
    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B');

    expect(texture.length).toBe(16);
    expect(Array.from(texture.slice(0, 4))).toEqual([0, 10, 20, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([3, 13, 23, 1]);
  });

  it('writes selected display alpha into RGBA display textures', () => {
    const layer = createLayerFromChannels({
      R: [1, 1, 1, 1],
      G: [0, 0, 0, 0],
      B: [0, 0, 0, 0],
      A: [0.25, 2, -1, Number.NaN]
    }, 'rgba');

    const texture = buildDisplayTexture(layer, 2, 2, 'R', 'G', 'B', 'A');
    expect(Array.from(texture.filter((_, index) => index % 4 === 3))).toEqual([0.25, 1, 0, 0]);
  });

  it('builds grayscale display textures for mono selections', () => {
    const layer = createLayerFromChannels({
      Y: [0.25, 0.5, 0.75, 1]
    }, 'gray');

    const texture = buildSelectedDisplayTexture(layer, 2, 2, createChannelMonoSelection('Y'));
    expect(Array.from(texture.slice(0, 4))).toEqual([0.25, 0.25, 0.25, 1]);
    expect(Array.from(texture.slice(12, 16))).toEqual([1, 1, 1, 1]);
  });

  it('builds scalar Stokes AoLP display textures with values duplicated across RGB', () => {
    const layer = createLayerFromChannels({
      S0: [1, 1, 1, 1],
      S1: [1, 0, -1, 0],
      S2: [0, 1, 0, -1],
      S3: [0, 0, 0, 0]
    }, 'stokes');

    const texture = buildStokesDisplayTexture(layer, 2, 2, createStokesSelection('aolp'));

    expect(Array.from(texture.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(texture[4]).toBeCloseTo(Math.PI / 4, 6);
    expect(texture[5]).toBeCloseTo(Math.PI / 4, 6);
    expect(texture[8]).toBeCloseTo(Math.PI / 2, 6);
    expect(texture[12]).toBeCloseTo((3 * Math.PI) / 4, 6);
  });

  it('builds scalar Stokes DoLP display textures and stabilizes invalid samples', () => {
    const layer = createLayerFromChannels({
      S0: [1, 2, 0, 1],
      S1: [1, 1, 1, Number.NaN],
      S2: [0, Math.sqrt(3), 1, 0],
      S3: [0, 0, 0, 0]
    }, 'stokes');

    const texture = buildSelectedDisplayTexture(layer, 2, 2, createStokesSelection('dolp'));
    expect(texture[0]).toBeCloseTo(1, 6);
    expect(texture[4]).toBeCloseTo(1, 6);
    expect(texture[8]).toBe(0);
    expect(texture[12]).toBe(0);
  });

  it('builds suffixed scalar Stokes display textures', () => {
    const layer = createLayerFromChannels({
      'S0.500nm': [2],
      'S1.500nm': [1],
      'S2.500nm': [Math.sqrt(3)],
      'S3.500nm': [0]
    }, 'spectral-stokes');

    const texture = buildSelectedDisplayTexture(
      layer,
      1,
      1,
      createStokesSelection('dolp', 'stokesScalar', null, '500nm')
    );

    expect(texture[0]).toBeCloseTo(1, 6);
    expect(texture[1]).toBeCloseTo(1, 6);
    expect(texture[2]).toBeCloseTo(1, 6);
    expect(texture[3]).toBe(1);
  });

  it('builds grouped RGB Stokes display textures for None and Colormap, plus split RGB textures', () => {
    const layer = createLayerFromChannels({
      'S0.R': [1],
      'S0.G': [2],
      'S0.B': [4],
      'S1.R': [1],
      'S1.G': [1],
      'S1.B': [2],
      'S2.R': [0],
      'S2.G': [Math.sqrt(3)],
      'S2.B': [0],
      'S3.R': [0],
      'S3.G': [0],
      'S3.B': [0]
    }, 'stokes-rgb');

    const grouped = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('dolp', 'stokesRgb'));
    const groupedColormap = buildSelectedDisplayTexture(
      layer,
      1,
      1,
      createStokesSelection('dolp', 'stokesRgb'),
      'colormap'
    );
    const split = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('aolp', 'stokesRgb', 'G'));

    expect(grouped[0]).toBeCloseTo(1, 6);
    expect(grouped[1]).toBeCloseTo(1, 6);
    expect(grouped[2]).toBeCloseTo(0.5, 6);
    expect(groupedColormap[0]).toBeCloseTo(
      Math.sqrt(
        computeRec709Luminance(1, 1, 2) ** 2 +
        computeRec709Luminance(0, Math.sqrt(3), 0) ** 2
      ) / computeRec709Luminance(1, 2, 4),
      6
    );
    expect(split[0]).toBeCloseTo(Math.PI / 6, 6);
    expect(split[1]).toBeCloseTo(Math.PI / 6, 6);
    expect(split[2]).toBeCloseTo(Math.PI / 6, 6);
  });

  it('handles null display selections by returning black textures', () => {
    const layer = createLayer();
    const texture = buildSelectedDisplayTexture(layer, 2, 2, null);
    expect(Array.from(texture)).toEqual(new Array(16).fill(0).map((value, index) => index % 4 === 3 ? 1 : 0));
  });

  it('builds spectral RGB display textures and appends probe display values', () => {
    const layer = createLayerFromChannels({
      '410nm': [0.1],
      '500nm': [0.8],
      '650nm': [0.2]
    }, 'spectral');
    const selection = createSpectralRgbSelection();

    const texture = buildSelectedDisplayTexture(layer, 1, 1, selection);
    const sample = samplePixelValuesForDisplay(layer, 1, 1, { ix: 0, iy: 0 }, selection);

    expect(texture[0]).toBeGreaterThanOrEqual(0);
    expect(texture[0]).toBeLessThanOrEqual(1);
    expect(texture[1]).toBeGreaterThanOrEqual(0);
    expect(texture[1]).toBeLessThanOrEqual(1);
    expect(texture[2]).toBeGreaterThanOrEqual(0);
    expect(texture[2]).toBeLessThanOrEqual(1);
    expect(texture[3]).toBe(1);
    expect(sample?.values['Spectral RGB.R']).toBeCloseTo(texture[0] ?? 0, 6);
    expect(sample?.values['Spectral RGB.G']).toBeCloseTo(texture[1] ?? 0, 6);
    expect(sample?.values['Spectral RGB.B']).toBeCloseTo(texture[2] ?? 0, 6);
  });

  it('builds signed spectral Stokes RGB display textures before deriving Stokes parameters', () => {
    const channelValues: Record<string, number[]> = {};
    for (let wavelength = 380; wavelength <= 780; wavelength += 20) {
      channelValues[`S0.${wavelength}nm`] = [1];
      channelValues[`S1.${wavelength}nm`] = [-0.5];
      channelValues[`S2.${wavelength}nm`] = [0];
      channelValues[`S3.${wavelength}nm`] = [0];
    }
    const layer = createLayerFromChannels(channelValues, 'spectral-stokes');

    const texture = buildSelectedDisplayTexture(layer, 1, 1, createStokesSelection('s1_over_s0', 'stokesSpectralRgb'));
    const colormapTexture = buildSelectedDisplayTexture(
      layer,
      1,
      1,
      createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      'colormap'
    );
    const sample = samplePixelValuesForDisplay(
      layer,
      1,
      1,
      { ix: 0, iy: 0 },
      createStokesSelection('s1_over_s0', 'stokesSpectralRgb')
    );

    expect(texture[0]).toBeCloseTo(-0.5, 5);
    expect(texture[1]).toBeCloseTo(-0.5, 5);
    expect(texture[2]).toBeCloseTo(-0.5, 5);
    expect(texture[3]).toBe(1);
    expect(colormapTexture[0]).toBeCloseTo(-0.5, 5);
    expect(colormapTexture[1]).toBeCloseTo(-0.5, 5);
    expect(colormapTexture[2]).toBeCloseTo(-0.5, 5);
    expect(sample?.values['S1/S0 Spectral RGB.R']).toBeCloseTo(-0.5, 5);
    expect(sample?.values['S1/S0 Spectral RGB.G']).toBeCloseTo(-0.5, 5);
    expect(sample?.values['S1/S0 Spectral RGB.B']).toBeCloseTo(-0.5, 5);
  });

  it('preserves signed S1/S2/S3 spectral RGB samples for spectral Stokes layers', () => {
    const channelValues: Record<string, number[]> = {};
    for (let wavelength = 380; wavelength <= 780; wavelength += 20) {
      channelValues[`S0.${wavelength}nm`] = [1];
      channelValues[`S1.${wavelength}nm`] = [-0.5];
      channelValues[`S2.${wavelength}nm`] = [-0.25];
      channelValues[`S3.${wavelength}nm`] = [-0.75];
    }
    const layer = createLayerFromChannels(channelValues, 'spectral-stokes');

    const s1Texture = buildSelectedDisplayTexture(layer, 1, 1, createSpectralRgbSelection('S1'));
    const s2Texture = buildSelectedDisplayTexture(layer, 1, 1, createSpectralRgbSelection('S2'));
    const s3Texture = buildSelectedDisplayTexture(layer, 1, 1, createSpectralRgbSelection('S3'));

    expect(s1Texture[0]).toBeLessThan(0);
    expect(s1Texture[1]).toBeLessThan(0);
    expect(s1Texture[2]).toBeLessThan(0);
    expect(s2Texture[0]).toBeLessThan(0);
    expect(s2Texture[1]).toBeLessThan(0);
    expect(s2Texture[2]).toBeLessThan(0);
    expect(s3Texture[0]).toBeLessThan(0);
    expect(s3Texture[1]).toBeLessThan(0);
    expect(s3Texture[2]).toBeLessThan(0);
    expect(Math.abs(s3Texture[1] ?? 0)).toBeGreaterThan(Math.abs(s1Texture[1] ?? 0));
    expect(Math.abs(s1Texture[1] ?? 0)).toBeGreaterThan(Math.abs(s2Texture[1] ?? 0));
  });

  it('does not trigger planar materialization during normal display reads', () => {
    const layer = createLayer();

    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    buildSelectedDisplayTexture(layer, 2, 2, createChannelRgbSelection('R', 'G', 'B'));
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    samplePixelValuesForDisplay(layer, 2, 2, { ix: 0, iy: 0 }, createChannelRgbSelection('R', 'G', 'B'));
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });
});
