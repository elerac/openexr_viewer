import type { ViewerAppCore } from '../app/viewer-app-core';
import type { ViewerAppState } from '../app/viewer-app-types';
import type {
  DisplayLuminanceRange,
  DisplaySelection,
  ImagePixel,
  ViewerSessionState,
  ViewerViewState
} from '../types';

export interface EmbedViewerStateSnapshot {
  viewerMode?: ViewerSessionState['viewerMode'];
  visualizationMode?: ViewerSessionState['visualizationMode'];
  activeLayer?: number;
  displaySelection?: DisplaySelection | null;
  exposureEv?: number;
  displayGamma?: number;
  activeColormapId?: string | null;
  colormapExposureEv?: number;
  colormapGamma?: number;
  colormapRange?: DisplayLuminanceRange | null;
  colormapZeroCentered?: boolean;
  colormapReversed?: boolean;
  depthChannel?: string | null;
  depthFocalLengthPx?: number | null;
  depthPointSizePx?: number;
  lockedPixel?: ImagePixel | null;
  view?: Partial<ViewerViewState>;
}

export function createEmbedViewerStateSnapshot(state: ViewerAppState): EmbedViewerStateSnapshot {
  const session = state.sessionState;
  const view = state.interactionState.view;
  return {
    viewerMode: session.viewerMode,
    visualizationMode: session.visualizationMode,
    activeLayer: session.activeLayer,
    displaySelection: cloneJsonValue(session.displaySelection),
    exposureEv: session.exposureEv,
    displayGamma: session.displayGamma,
    activeColormapId: session.activeColormapId,
    colormapExposureEv: session.colormapExposureEv,
    colormapGamma: session.colormapGamma,
    colormapRange: session.colormapRange ? { ...session.colormapRange } : null,
    colormapZeroCentered: session.colormapZeroCentered,
    colormapReversed: session.colormapReversed,
    depthChannel: session.depthChannel,
    depthFocalLengthPx: session.depthFocalLengthPx,
    depthPointSizePx: session.depthPointSizePx,
    lockedPixel: session.lockedPixel ? { ...session.lockedPixel } : null,
    view: {
      zoom: view.zoom,
      panX: view.panX,
      panY: view.panY,
      panoramaYawDeg: view.panoramaYawDeg,
      panoramaPitchDeg: view.panoramaPitchDeg,
      panoramaHfovDeg: view.panoramaHfovDeg,
      depthYawDeg: view.depthYawDeg,
      depthPitchDeg: view.depthPitchDeg,
      depthZoom: view.depthZoom
    }
  };
}

export function encodeEmbedViewerState(snapshot: EmbedViewerStateSnapshot | null | undefined): string | null {
  if (!snapshot) {
    return null;
  }

  try {
    return encodeURIComponent(JSON.stringify(snapshot));
  } catch {
    return null;
  }
}

export function decodeEmbedViewerState(value: string | null): EmbedViewerStateSnapshot | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return normalizeEmbedViewerStateSnapshot(parsed);
  } catch {
    return null;
  }
}

export function applyEmbedViewerStateSnapshot(
  core: ViewerAppCore,
  snapshot: EmbedViewerStateSnapshot | null | undefined
): void {
  if (!snapshot) {
    return;
  }

  if (isViewerMode(snapshot.viewerMode)) {
    core.dispatch({ type: 'viewerModeSet', viewerMode: snapshot.viewerMode });
  }
  if (isNonNegativeInteger(snapshot.activeLayer)) {
    core.dispatch({ type: 'activeLayerSet', activeLayer: snapshot.activeLayer });
  }
  if (snapshot.displaySelection !== undefined) {
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: snapshot.displaySelection
    });
  }
  if (snapshot.visualizationMode === 'rgb' || snapshot.visualizationMode === 'colormap') {
    core.dispatch({ type: 'visualizationModeRequested', visualizationMode: snapshot.visualizationMode });
  }
  if (isFiniteNumber(snapshot.exposureEv)) {
    core.dispatch({ type: 'exposureSet', exposureEv: snapshot.exposureEv });
    core.dispatch({ type: 'exposureCommitted' });
  }
  if (isFiniteNumber(snapshot.displayGamma) && snapshot.displayGamma > 0) {
    core.dispatch({ type: 'displayGammaSet', displayGamma: snapshot.displayGamma });
    core.dispatch({ type: 'displayGammaCommitted' });
  }
  if (snapshot.activeColormapId !== undefined) {
    core.dispatch({ type: 'activeColormapSet', colormapId: snapshot.activeColormapId });
  }
  if (isFiniteNumber(snapshot.colormapExposureEv)) {
    core.dispatch({ type: 'colormapExposureSet', exposureEv: snapshot.colormapExposureEv });
  }
  if (isFiniteNumber(snapshot.colormapGamma) && snapshot.colormapGamma > 0) {
    core.dispatch({ type: 'colormapGammaSet', gamma: snapshot.colormapGamma });
  }
  if (isDisplayLuminanceRange(snapshot.colormapRange)) {
    core.dispatch({ type: 'colormapRangeSet', range: snapshot.colormapRange });
  }
  if (snapshot.colormapZeroCentered === true && !core.getState().sessionState.colormapZeroCentered) {
    core.dispatch({ type: 'colormapZeroCenteredToggled' });
  }
  if (snapshot.colormapReversed === true && !core.getState().sessionState.colormapReversed) {
    core.dispatch({ type: 'colormapReverseToggled' });
  }
  if (snapshot.lockedPixel !== undefined) {
    core.dispatch({ type: 'lockedPixelSet', pixel: snapshot.lockedPixel });
  }
  if (
    snapshot.depthChannel !== undefined ||
    snapshot.depthFocalLengthPx !== undefined ||
    snapshot.depthPointSizePx !== undefined
  ) {
    core.dispatch({
      type: 'depthSettingsEdited',
      patch: {
        ...(snapshot.depthChannel !== undefined ? { depthChannel: snapshot.depthChannel } : {}),
        ...(snapshot.depthFocalLengthPx !== undefined ? { depthFocalLengthPx: snapshot.depthFocalLengthPx } : {}),
        ...(snapshot.depthPointSizePx !== undefined ? { depthPointSizePx: snapshot.depthPointSizePx } : {})
      }
    });
  }

  const viewPatch = normalizeViewPatch(snapshot.view);
  if (Object.keys(viewPatch).length > 0) {
    core.dispatch({ type: 'viewerStateEdited', patch: viewPatch });
    core.dispatch({ type: 'viewStateCommitted', view: viewPatch });
  }
}

function normalizeEmbedViewerStateSnapshot(value: unknown): EmbedViewerStateSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    viewerMode: isViewerMode(record.viewerMode) ? record.viewerMode : undefined,
    visualizationMode: record.visualizationMode === 'rgb' || record.visualizationMode === 'colormap'
      ? record.visualizationMode
      : undefined,
    activeLayer: isNonNegativeInteger(record.activeLayer) ? record.activeLayer : undefined,
    displaySelection: normalizeDisplaySelection(record.displaySelection),
    exposureEv: isFiniteNumber(record.exposureEv) ? record.exposureEv : undefined,
    displayGamma: isFiniteNumber(record.displayGamma) && record.displayGamma > 0 ? record.displayGamma : undefined,
    activeColormapId: typeof record.activeColormapId === 'string' || record.activeColormapId === null
      ? record.activeColormapId
      : undefined,
    colormapExposureEv: isFiniteNumber(record.colormapExposureEv) ? record.colormapExposureEv : undefined,
    colormapGamma: isFiniteNumber(record.colormapGamma) && record.colormapGamma > 0 ? record.colormapGamma : undefined,
    colormapRange: isDisplayLuminanceRange(record.colormapRange) ? record.colormapRange : undefined,
    colormapZeroCentered: typeof record.colormapZeroCentered === 'boolean' ? record.colormapZeroCentered : undefined,
    colormapReversed: typeof record.colormapReversed === 'boolean' ? record.colormapReversed : undefined,
    depthChannel: typeof record.depthChannel === 'string' || record.depthChannel === null
      ? record.depthChannel
      : undefined,
    depthFocalLengthPx: isFiniteNumber(record.depthFocalLengthPx) || record.depthFocalLengthPx === null
      ? record.depthFocalLengthPx
      : undefined,
    depthPointSizePx: isFiniteNumber(record.depthPointSizePx) ? record.depthPointSizePx : undefined,
    lockedPixel: normalizeImagePixel(record.lockedPixel),
    view: normalizeViewPatch(record.view)
  };
}

function normalizeViewPatch(value: unknown): Partial<ViewerViewState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const patch: Partial<ViewerViewState> = {};
  for (const key of [
    'zoom',
    'panX',
    'panY',
    'panoramaYawDeg',
    'panoramaPitchDeg',
    'panoramaHfovDeg',
    'depthYawDeg',
    'depthPitchDeg',
    'depthZoom'
  ] as const) {
    if (isFiniteNumber(record[key])) {
      patch[key] = record[key];
    }
  }
  return patch;
}

function normalizeImagePixel(value: unknown): ImagePixel | null | undefined {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return isNonNegativeInteger(record.ix) && isNonNegativeInteger(record.iy)
    ? { ix: record.ix, iy: record.iy }
    : undefined;
}

function normalizeDisplaySelection(value: unknown): DisplaySelection | null | undefined {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return cloneJsonValue(value) as DisplaySelection;
}

function isViewerMode(value: unknown): value is ViewerSessionState['viewerMode'] {
  return value === 'image' || value === 'panorama' || value === 'depth';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDisplayLuminanceRange(value: unknown): value is DisplayLuminanceRange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isFiniteNumber(record.min) && isFiniteNumber(record.max);
}

function cloneJsonValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
