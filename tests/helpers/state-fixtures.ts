import { createInitialState } from '../../src/viewer-store';
import {
  DecodedExrImage,
  DecodedLayer,
  DisplaySelection,
  StokesParameter,
  ViewerState
} from '../../src/types';

export function createLayer(): DecodedLayer {
  const channelData = new Map<string, Float32Array>();
  channelData.set('R', new Float32Array([0, 1, 2, 3]));
  channelData.set('G', new Float32Array([10, 11, 12, 13]));
  channelData.set('B', new Float32Array([20, 21, 22, 23]));

  return {
    name: 'beauty',
    channelNames: ['R', 'G', 'B'],
    channelData
  };
}

export function createImage(layers: DecodedLayer[]): DecodedExrImage {
  return {
    width: 2,
    height: 2,
    layers
  };
}

export function createViewerState(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    ...createInitialState(),
    ...overrides
  };
}

export function createStokesSelection(
  stokesParameter: StokesParameter,
  displaySource: Exclude<DisplaySelection['displaySource'], 'channels'> = 'stokesScalar'
): DisplaySelection {
  return {
    displaySource,
    stokesParameter,
    displayR: 'S0',
    displayG: 'S1',
    displayB: 'S2'
  };
}
