import { DEFAULT_COLORMAP_ID } from './colormaps';
import { DEFAULT_PANORAMA_HFOV_DEG } from './interaction';
import { resolveDisplaySelectionForLayer } from './display-selection';
import { createDefaultStokesDegreeModulation } from './stokes';
import {
  DecodedExrImage,
  ViewerSessionState
} from './types';

const SESSION_STATE_KEYS = [
  'exposureEv',
  'viewerMode',
  'visualizationMode',
  'activeColormapId',
  'colormapRange',
  'colormapRangeMode',
  'colormapZeroCentered',
  'stokesDegreeModulation',
  'zoom',
  'panX',
  'panY',
  'panoramaYawDeg',
  'panoramaPitchDeg',
  'panoramaHfovDeg',
  'activeLayer',
  'displaySelection',
  'lockedPixel'
] as const satisfies ReadonlyArray<keyof ViewerSessionState>;

export function createInitialState(): ViewerSessionState {
  return {
    exposureEv: 0,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: DEFAULT_COLORMAP_ID,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
    activeLayer: 0,
    displaySelection: null,
    lockedPixel: null
  };
}

export class ViewerStore {
  private state: ViewerSessionState;
  private listeners = new Set<(state: ViewerSessionState, previous: ViewerSessionState) => void>();

  constructor(initialState: ViewerSessionState) {
    this.state = initialState;
  }

  getState(): ViewerSessionState {
    return this.state;
  }

  setState(patch: Partial<ViewerSessionState>): void {
    const normalizedPatch = pickSessionStatePatch(patch);
    if (!hasStateChanges(this.state, normalizedPatch)) {
      return;
    }

    const previous = this.state;
    this.state = { ...this.state, ...normalizedPatch };
    for (const listener of this.listeners) {
      listener(this.state, previous);
    }
  }

  subscribe(listener: (state: ViewerSessionState, previous: ViewerSessionState) => void): () => void {
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
  currentState: ViewerSessionState,
  decoded: DecodedExrImage,
  requestedLayerIndex: number = currentState.activeLayer
): ViewerSessionState {
  const activeLayer = pickValidLayerIndex(decoded.layers.length, requestedLayerIndex);
  const layer = decoded.layers[activeLayer];
  if (!layer) {
    return {
      ...currentState,
      activeLayer: 0,
      displaySelection: null
    };
  }

  return {
    ...currentState,
    activeLayer,
    displaySelection: resolveDisplaySelectionForLayer(layer.channelNames, currentState.displaySelection)
  };
}

function pickSessionStatePatch(patch: Partial<ViewerSessionState>): Partial<ViewerSessionState> {
  const nextPatch: Partial<ViewerSessionState> = {};
  for (const key of SESSION_STATE_KEYS) {
    if (key in patch) {
      Object.assign(nextPatch, {
        [key]: patch[key]
      });
    }
  }
  return nextPatch;
}

function hasStateChanges(state: ViewerSessionState, patch: Partial<ViewerSessionState>): boolean {
  const entries = Object.entries(patch) as Array<[keyof ViewerSessionState, ViewerSessionState[keyof ViewerSessionState]]>;
  return entries.some(([key, value]) => state[key] !== value);
}
