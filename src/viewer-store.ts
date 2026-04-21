import { DEFAULT_COLORMAP_ID } from './colormaps';
import { resolveDisplaySelectionForLayer } from './display-selection';
import { createDefaultStokesDegreeModulation } from './stokes';
import {
  DecodedExrImage,
  ViewerState,
  ZERO_CHANNEL
} from './types';

export function createInitialState(): ViewerState {
  return {
    exposureEv: 0,
    visualizationMode: 'rgb',
    activeColormapId: DEFAULT_COLORMAP_ID,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    zoom: 1,
    panX: 0,
    panY: 0,
    activeLayer: 0,
    displaySource: 'channels',
    stokesParameter: null,
    displayR: ZERO_CHANNEL,
    displayG: ZERO_CHANNEL,
    displayB: ZERO_CHANNEL,
    displayA: null,
    hoveredPixel: null,
    lockedPixel: null
  };
}

export class ViewerStore {
  private state: ViewerState;
  private listeners = new Set<(state: ViewerState, previous: ViewerState) => void>();

  constructor(initialState: ViewerState) {
    this.state = initialState;
  }

  getState(): ViewerState {
    return this.state;
  }

  setState(patch: Partial<ViewerState>): void {
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state, previous);
    }
  }

  subscribe(listener: (state: ViewerState, previous: ViewerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function pickValidLayerIndex(layerCount: number, requestedIndex: number): number {
  if (layerCount <= 0) {
    return 0;
  }

  const resolvedIndex = Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0;
  return Math.min(layerCount - 1, Math.max(0, resolvedIndex));
}

export function buildViewerStateForLayer(
  currentState: ViewerState,
  decoded: DecodedExrImage,
  requestedLayerIndex: number = currentState.activeLayer
): ViewerState {
  const activeLayer = pickValidLayerIndex(decoded.layers.length, requestedLayerIndex);
  const layer = decoded.layers[activeLayer];
  if (!layer) {
    return {
      ...currentState,
      activeLayer: 0,
      displaySource: 'channels',
      stokesParameter: null,
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL,
      displayA: null
    };
  }

  return {
    ...currentState,
    activeLayer,
    ...resolveDisplaySelectionForLayer(layer.channelNames, currentState)
  };
}
