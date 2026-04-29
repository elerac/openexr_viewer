import {
  type ChannelMonoSelection,
  type ChannelRgbSelection,
  type StokesSelection,
  type StokesParameter,
  type ViewerInteractionState,
  type ViewerSessionState,
  type ViewerState
} from '../../src/types';
import {
  buildRgbStokesLuminanceSelection,
  buildRgbStokesSplitSelection,
  buildScalarStokesSelection,
  type RgbStokesComponent
} from '../../src/stokes';
import { createInitialState } from '../../src/viewer-store';
import {
  createInterleavedChannelStorage,
  createPlanarChannelStorage
} from '../../src/channel-storage';
import { createInteractionState } from '../../src/view-state';
import { DecodedExrImage, DecodedLayer } from '../../src/types';

export function createLayer(): DecodedLayer {
  return createLayerFromChannels({
    R: [0, 1, 2, 3],
    G: [10, 11, 12, 13],
    B: [20, 21, 22, 23]
  });
}

export function createLayerFromChannels(
  channelValues: Record<string, ArrayLike<number>>,
  name = 'beauty'
): DecodedLayer {
  return createLayerFromEntries(Object.entries(channelValues), name);
}

export function createLayerFromEntries(
  channelEntries: Array<[string, ArrayLike<number>]>,
  name = 'beauty'
): DecodedLayer {
  const channelNames = channelEntries.map(([channelName]) => channelName);
  const pixelsByChannel = createPixelsByChannel(channelEntries);

  return {
    name,
    channelNames,
    channelStorage: createPlanarChannelStorage(pixelsByChannel, channelNames),
    analysis: {
      displayLuminanceRangeBySelectionKey: {},
      finiteRangeByChannel: {}
    }
  };
}

export function createInterleavedLayerFromEntries(
  channelEntries: Array<[string, ArrayLike<number>]>,
  name = 'beauty'
): DecodedLayer {
  const channelNames = channelEntries.map(([channelName]) => channelName);
  const pixelCount = channelEntries[0]?.[1].length ?? 0;
  const pixels = new Float32Array(pixelCount * channelNames.length);

  for (const [, values] of channelEntries) {
    if (values.length !== pixelCount) {
      throw new Error('All test channels must use the same pixel count.');
    }
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const pixelBaseIndex = pixelIndex * channelNames.length;
    for (let channelIndex = 0; channelIndex < channelEntries.length; channelIndex += 1) {
      pixels[pixelBaseIndex + channelIndex] = channelEntries[channelIndex]?.[1][pixelIndex] ?? 0;
    }
  }

  return {
    name,
    channelNames,
    channelStorage: createInterleavedChannelStorage(pixels, channelNames),
    analysis: {
      displayLuminanceRangeBySelectionKey: {},
      finiteRangeByChannel: {}
    }
  };
}

export function createInterleavedLayerFromChannels(
  channelValues: Record<string, ArrayLike<number>>,
  name = 'beauty'
): DecodedLayer {
  return createInterleavedLayerFromEntries(Object.entries(channelValues), name);
}

export function createImage(layers: DecodedLayer[]): DecodedExrImage {
  return {
    width: 2,
    height: 2,
    layers
  };
}

function createPixelsByChannel(
  channelEntries: Array<[string, ArrayLike<number>]>
): Record<string, Float32Array> {
  const pixelCount = channelEntries[0]?.[1].length ?? 0;
  const pixelsByChannel: Record<string, Float32Array> = {};

  for (const [channelName, values] of channelEntries) {
    if (values.length !== pixelCount) {
      throw new Error('All test channels must use the same pixel count.');
    }

    const pixels = new Float32Array(pixelCount);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      pixels[pixelIndex] = values[pixelIndex] ?? 0;
    }
    pixelsByChannel[channelName] = pixels;
  }

  return pixelsByChannel;
}

export function createViewerSessionState(overrides: Partial<ViewerSessionState> = {}): ViewerSessionState {
  return {
    ...createInitialState(),
    ...overrides
  };
}

export function createViewerState(overrides: Partial<ViewerState> = {}): ViewerState {
  const sessionState = createViewerSessionState();
  return {
    ...sessionState,
    hoveredPixel: null,
    draftRoi: null,
    roiInteraction: createInteractionState(sessionState).roiInteraction,
    ...overrides
  };
}

export function createViewerInteractionState(
  overrides: Partial<ViewerInteractionState> = {},
  sessionState: ViewerSessionState = createViewerSessionState()
): ViewerInteractionState {
  return {
    ...createInteractionState(sessionState),
    ...overrides,
    view: {
      ...createInteractionState(sessionState).view,
      ...overrides.view
    }
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
