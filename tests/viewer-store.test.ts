import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORMAP_ID } from '../src/colormaps';
import { buildViewerStateForLayer, createInitialState, ViewerStore } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createImage,
  createLayer,
  createLayerFromChannels,
  createStokesSelection,
  createViewerState
} from './helpers/state-fixtures';

describe('viewer store', () => {
  it('defaults to normal RGB visualization mode', () => {
    expect(createInitialState().visualizationMode).toBe('rgb');
    expect(createInitialState().activeColormapId).toBe(DEFAULT_COLORMAP_ID);
    expect(createInitialState().colormapRange).toBeNull();
    expect(createInitialState().colormapRangeMode).toBe('alwaysAuto');
    expect(createInitialState().colormapZeroCentered).toBe(false);
    expect(createInitialState().displaySelection).toBeNull();
    expect(createInitialState().stokesDegreeModulation).toEqual({
      aolp: false,
      cop: true,
      top: true
    });
    expect(createInitialState().stokesAolpDegreeModulationMode).toBe('value');
  });

  it('re-resolves display channels when switching to a layer without the current mapping', () => {
    const altLayer = createLayerFromChannels({
      X: [4, 4, 4, 4],
      Y: [5, 5, 5, 5],
      Z: [6, 6, 6, 6]
    }, 'alt');
    const image = createImage([createLayer(), altLayer]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displaySelection: createChannelRgbSelection('R', 'G', 'B')
      }),
      image,
      1
    );

    expect(nextState.activeLayer).toBe(1);
    expect(nextState.displaySelection).toEqual(createChannelMonoSelection('X'));
  });

  it('does not preserve arbitrary mixed channel mappings as display defaults', () => {
    const spectralLayer = createLayerFromChannels({
      '400nm': [4, 4, 4, 4],
      '500nm': [5, 5, 5, 5],
      '600nm': [6, 6, 6, 6],
      '700nm': [7, 7, 7, 7]
    }, 'spectral');
    const image = createImage([spectralLayer]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displaySelection: createChannelRgbSelection('400nm', '500nm', '600nm')
      }),
      image,
      0
    );

    expect(nextState.displaySelection).toEqual(createChannelMonoSelection('400nm'));
  });

  it('resolves a real default mapping when there is no current selection', () => {
    const image = createImage([createLayer()]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        displaySelection: null
      }),
      image,
      0
    );

    expect(nextState.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('clamps an out-of-range layer selection and restores a valid mapping', () => {
    const image = createImage([createLayer()]);

    const nextState = buildViewerStateForLayer(
      createViewerState({
        activeLayer: 3,
        displaySelection: createChannelRgbSelection('X', 'Y', 'Z')
      }),
      image,
      3
    );

    expect(nextState.activeLayer).toBe(0);
    expect(nextState.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('preserves available Stokes selections and falls back when unavailable', () => {
    const stokesLayer = createLayerFromChannels({
      S0: [1, 1, 1, 1],
      S1: [1, 1, 1, 1],
      S2: [0, 0, 0, 0],
      S3: [0, 0, 0, 0]
    }, 'stokes');
    const image = createImage([stokesLayer, createLayer()]);

    const preserved = buildViewerStateForLayer(
      createViewerState({
        displaySelection: createStokesSelection('aolp')
      }),
      image,
      0
    );
    expect(preserved.displaySelection).toEqual(createStokesSelection('aolp'));

    const fallback = buildViewerStateForLayer(preserved, image, 1);
    expect(fallback.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('ignores transient hover fields in runtime store patches', () => {
    const store = new ViewerStore(createInitialState());

    store.setState({ hoveredPixel: { ix: 3, iy: 4 } } as never);

    expect('hoveredPixel' in store.getState()).toBe(false);
  });
});
