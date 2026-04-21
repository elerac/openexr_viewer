import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORMAP_ID } from '../src/colormaps';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { DecodedLayer } from '../src/types';
import { createImage, createLayer, createViewerState } from './helpers/state-fixtures';

describe('viewer store', () => {
  it('defaults to normal RGB visualization mode', () => {
    expect(createInitialState().visualizationMode).toBe('rgb');
    expect(createInitialState().activeColormapId).toBe(DEFAULT_COLORMAP_ID);
    expect(createInitialState().colormapRange).toBeNull();
    expect(createInitialState().colormapRangeMode).toBe('alwaysAuto');
    expect(createInitialState().colormapZeroCentered).toBe(false);
    expect(createInitialState().displaySource).toBe('channels');
    expect(createInitialState().stokesParameter).toBeNull();
    expect(createInitialState().stokesDegreeModulation).toEqual({
      aolp: false,
      cop: true,
      top: true
    });
  });

  it('re-resolves display channels when switching to a layer without the current mapping', () => {
    const altLayer: DecodedLayer = {
      name: 'alt',
      channelNames: ['X', 'Y', 'Z'],
      channelData: new Map([
        ['X', new Float32Array([4, 4, 4, 4])],
        ['Y', new Float32Array([5, 5, 5, 5])],
        ['Z', new Float32Array([6, 6, 6, 6])]
      ])
    };
    const image = createImage([createLayer(), altLayer]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displayR: 'R',
        displayG: 'G',
        displayB: 'B'
      }),
      image,
      1
    );

    expect(nextState.activeLayer).toBe(1);
    expect(nextState.displayR).toBe('X');
    expect(nextState.displayG).toBe('X');
    expect(nextState.displayB).toBe('X');
  });

  it('does not preserve arbitrary mixed channel mappings as display defaults', () => {
    const spectralLayer: DecodedLayer = {
      name: 'spectral',
      channelNames: ['400nm', '500nm', '600nm', '700nm'],
      channelData: new Map([
        ['400nm', new Float32Array([4, 4, 4, 4])],
        ['500nm', new Float32Array([5, 5, 5, 5])],
        ['600nm', new Float32Array([6, 6, 6, 6])],
        ['700nm', new Float32Array([7, 7, 7, 7])]
      ])
    };
    const image = createImage([spectralLayer]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displayR: '400nm',
        displayG: '500nm',
        displayB: '600nm'
      }),
      image,
      0
    );

    expect(nextState.displayR).toBe('400nm');
    expect(nextState.displayG).toBe('400nm');
    expect(nextState.displayB).toBe('400nm');
  });

  it('resolves a real default mapping when the current selection is all zero channels', () => {
    const image = createImage([createLayer()]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displayR: '__ZERO__',
        displayG: '__ZERO__',
        displayB: '__ZERO__'
      }),
      image,
      0
    );

    expect(nextState.displayR).toBe('R');
    expect(nextState.displayG).toBe('G');
    expect(nextState.displayB).toBe('B');
  });

  it('clamps an out-of-range layer selection and restores a valid mapping', () => {
    const image = createImage([createLayer()]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        activeLayer: 3,
        displayR: 'X',
        displayG: 'Y',
        displayB: 'Z'
      }),
      image,
      3
    );

    expect(nextState.activeLayer).toBe(0);
    expect(nextState.displayR).toBe('R');
    expect(nextState.displayG).toBe('G');
    expect(nextState.displayB).toBe('B');
  });

  it('preserves available Stokes selections and falls back when unavailable', () => {
    const stokesLayer: DecodedLayer = {
      name: 'stokes',
      channelNames: ['S0', 'S1', 'S2', 'S3'],
      channelData: new Map([
        ['S0', new Float32Array([1, 1, 1, 1])],
        ['S1', new Float32Array([1, 1, 1, 1])],
        ['S2', new Float32Array([0, 0, 0, 0])],
        ['S3', new Float32Array([0, 0, 0, 0])]
      ])
    };
    const image = createImage([stokesLayer, createLayer()]);

    const preserved = buildViewerStateForLayer(
      createViewerState({
        displaySource: 'stokesScalar',
        stokesParameter: 'aolp',
        displayR: 'S0',
        displayG: 'S1',
        displayB: 'S2'
      }),
      image,
      0
    );
    expect(preserved.displaySource).toBe('stokesScalar');
    expect(preserved.stokesParameter).toBe('aolp');

    const fallback = buildViewerStateForLayer(preserved, image, 1);
    expect(fallback.displaySource).toBe('channels');
    expect(fallback.stokesParameter).toBeNull();
    expect(fallback.displayR).toBe('R');
    expect(fallback.displayG).toBe('G');
    expect(fallback.displayB).toBe('B');
  });
});
