import {
  type ChannelMonoSelection,
  type ChannelRgbSelection,
  type StokesSelection,
  type StokesParameter,
  type ViewerState
} from '../../src/types';
import {
  buildRgbStokesLuminanceSelection,
  buildRgbStokesSplitSelection,
  buildScalarStokesSelection,
  type RgbStokesComponent
} from '../../src/stokes';
import { createInitialState } from '../../src/viewer-store';
import { DecodedExrImage, DecodedLayer } from '../../src/types';

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
  displaySource: 'stokesScalar' | 'stokesRgb' = 'stokesScalar',
  component: RgbStokesComponent | null = null
): StokesSelection {
  if (displaySource === 'stokesScalar') {
    return buildScalarStokesSelection(stokesParameter);
  }

  return component
    ? buildRgbStokesSplitSelection(stokesParameter, component)
    : buildRgbStokesLuminanceSelection(stokesParameter);
}

export function createChannelRgbSelection(
  r = 'R',
  g = 'G',
  b = 'B',
  alpha: string | null = null
): ChannelRgbSelection {
  return {
    kind: 'channelRgb',
    r,
    g,
    b,
    alpha
  };
}

export function createChannelMonoSelection(
  channel = 'Y',
  alpha: string | null = null
): ChannelMonoSelection {
  return {
    kind: 'channelMono',
    channel,
    alpha
  };
}
