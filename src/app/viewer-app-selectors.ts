import { getColormapOptions } from '../colormaps';
import { serializeDisplaySelectionKey, sameDisplaySelection } from '../display-model';
import { buildDisplayLuminanceRevisionKey, buildDisplayTextureRevisionKey } from '../display-texture';
import {
  getStokesDegreeModulationLabel,
  getStokesDisplayColormapDefault,
  isStokesDegreeModulationParameter
} from '../stokes';
import { mergeRenderState, pickViewState } from '../view-state';
import type { DisplayLuminanceRange, OpenedImageSession, ViewerSessionState } from '../types';
import {
  buildProbePresentationModel
} from './probe-presentation';
import type {
  StokesDegreeModulationControlModel,
  ViewerAppSnapshot,
  ViewerAppState,
  ViewerLayerOption,
  ViewerOpenedImageOption
} from './viewer-app-types';

export function createViewerAppSnapshot(state: ViewerAppState): ViewerAppSnapshot {
  const activeSession = selectActiveSession(state);
  const activeLayer = activeSession?.decoded.layers[state.sessionState.activeLayer] ?? null;
  const stokesDegreeModulationControl = selectStokesDegreeModulationControl(state.sessionState);

  return {
    state,
    activeSession,
    activeLayer,
    renderState: mergeRenderState(state.sessionState, state.interactionState),
    colormapOptions: state.colormapRegistry ? getColormapOptions(state.colormapRegistry) : [],
    openedImageOptions: buildOpenedImageOptions(state),
    exportTarget: buildExportTarget(activeSession),
    layerOptions: buildLayerOptions(activeSession),
    probePresentation: buildProbePresentationModel({
      activeSession,
      activeLayer,
      sessionState: state.sessionState,
      interactionState: state.interactionState,
      activeColormapLut: state.activeColormapLut,
      activeDisplayLuminanceRange: state.activeDisplayLuminanceRange,
      pendingColormapActivation: state.pendingColormapActivation
    }),
    rgbGroupChannelNames: activeLayer?.channelNames ?? [],
    stokesDegreeModulationControl,
    shouldClearImageBrowserPanels: !activeSession,
    isRgbViewLoading: Boolean(
      state.pendingSelectionTransitionRequestId ||
      state.pendingColormapRequestId ||
      state.pendingColormapActivation
    ),
    resourceRevisionKey: activeSession && activeLayer
      ? `${activeSession.id}:${buildDisplayTextureRevisionKey(state.sessionState)}`
      : null,
    displayRangeRequestKey: buildDisplayRangeRequestKey(state, activeSession, activeLayer),
    renderImageRevisionKey: activeSession && activeLayer
      ? [
          activeSession.id,
          state.sessionState.viewerMode,
          state.sessionState.exposureEv,
          buildDisplayTextureRevisionKey(state.sessionState),
          state.sessionState.visualizationMode,
          state.sessionState.activeColormapId,
          serializeDisplayLuminanceRange(state.sessionState.colormapRange),
          state.sessionState.colormapRangeMode,
          state.sessionState.colormapZeroCentered,
          serializeStokesDegreeModulation(state.sessionState),
          serializeViewState(state.interactionState.view)
        ].join('|')
      : null,
    renderValueOverlayRevisionKey: activeSession && activeLayer
      ? [
          activeSession.id,
          state.sessionState.viewerMode,
          buildDisplayTextureRevisionKey(state.sessionState),
          state.sessionState.visualizationMode,
          serializeViewState(state.interactionState.view)
        ].join('|')
      : null,
    renderProbeOverlayRevisionKey: activeSession && activeLayer
      ? [
          activeSession.id,
          state.sessionState.viewerMode,
          state.sessionState.activeLayer,
          serializePixel(state.sessionState.lockedPixel),
          serializePixel(state.interactionState.hoveredPixel),
          serializeViewState(state.interactionState.view)
        ].join('|')
      : null
  };
}

export function selectActiveSession(state: ViewerAppState): OpenedImageSession | null {
  if (!state.activeSessionId) {
    return null;
  }

  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

export function buildOpenedImageOptions(state: ViewerAppState): ViewerOpenedImageOption[] {
  return state.sessions.map((session) => ({
    id: session.id,
    label: session.displayName,
    sizeBytes: session.fileSizeBytes,
    sourceDetail: getSessionSourceDetail(session),
    thumbnailDataUrl: state.thumbnailsBySessionId[session.id] ?? null
  }));
}

export function buildExportTarget(
  session: OpenedImageSession | null
): { filename: string; sourceWidth: number; sourceHeight: number } | null {
  if (!session) {
    return null;
  }

  return {
    filename: buildDefaultExportFilename(session.displayName),
    sourceWidth: session.decoded.width,
    sourceHeight: session.decoded.height
  };
}

export function buildLayerOptions(session: OpenedImageSession | null): ViewerLayerOption[] {
  if (!session) {
    return [];
  }

  return session.decoded.layers.map((layer, index) => ({
    index,
    label: buildLayerPanelLabel(layer.name, layer.channelNames, index),
    channelCount: layer.channelNames.length
  }));
}

export function selectStokesDegreeModulationControl(
  sessionState: ViewerSessionState
): StokesDegreeModulationControlModel | null {
  const selection = sessionState.displaySelection;
  if (!selection || !('parameter' in selection) || !isStokesDegreeModulationParameter(selection.parameter)) {
    return null;
  }

  return {
    label: getStokesDegreeModulationLabel(selection.parameter) ?? 'Degree Modulation',
    enabled: sessionState.stokesDegreeModulation[selection.parameter]
  };
}

export function shouldAutoEnterColormapMode(
  state: ViewerAppState,
  displayLuminanceRange: DisplayLuminanceRange | null
): boolean {
  if (!state.pendingColormapActivation) {
    return false;
  }

  const activeSession = selectActiveSession(state);
  return Boolean(
    activeSession &&
    activeSession.id === state.pendingColormapActivation.sessionId &&
    state.sessionState.activeLayer === state.pendingColormapActivation.activeLayer &&
    sameDisplaySelection(state.sessionState.displaySelection, state.pendingColormapActivation.displaySelection) &&
    displayLuminanceRange
  );
}

function buildDisplayRangeRequestKey(
  state: ViewerAppState,
  activeSession: OpenedImageSession | null,
  activeLayer: OpenedImageSession['decoded']['layers'][number] | null
): string | null {
  if (!activeSession || !activeLayer) {
    return null;
  }

  const shouldRequest = state.pendingColormapActivation
    || (state.sessionState.visualizationMode === 'colormap' && state.sessionState.colormapRangeMode === 'alwaysAuto');
  if (!shouldRequest) {
    return null;
  }

  return `${activeSession.id}:${buildDisplayLuminanceRevisionKey(state.sessionState)}`;
}

function getSessionSourceDetail(session: OpenedImageSession): string {
  if (session.source.kind === 'url') {
    return session.source.url;
  }

  const relativePath = session.source.file.webkitRelativePath.trim();
  return relativePath || session.source.file.name || session.filename;
}

function buildDefaultExportFilename(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return 'image.png';
  }

  const duplicateSuffixMatch = trimmed.match(/ \(\d+\)$/);
  const duplicateSuffix = duplicateSuffixMatch?.[0] ?? '';
  const baseName = duplicateSuffix ? trimmed.slice(0, -duplicateSuffix.length) : trimmed;
  const pathSeparatorIndex = Math.max(baseName.lastIndexOf('/'), baseName.lastIndexOf('\\'));
  const extensionIndex = baseName.lastIndexOf('.');
  const withoutExtension = extensionIndex > pathSeparatorIndex ? baseName.slice(0, extensionIndex) : baseName;

  return `${withoutExtension}${duplicateSuffix}.png`;
}

function buildLayerPanelLabel(name: string | null, channelNames: string[], index: number): string {
  if (name) {
    return name;
  }

  const groupedName = inferDominantChannelGroupName(channelNames);
  if (groupedName) {
    return groupedName;
  }

  return index === 0 ? 'Main Layer' : `Layer ${index + 1}`;
}

function inferDominantChannelGroupName(channelNames: string[]): string | null {
  if (channelNames.length === 0) {
    return null;
  }

  const rgbBases = new Map<string, Set<string>>();
  for (const channelName of channelNames) {
    const match = /^(?:(.+)\.)?([RGBA])$/.exec(channelName);
    if (!match) {
      continue;
    }

    const base = match[1] ?? '';
    const suffix = match[2] ?? '';
    const suffixes = rgbBases.get(base) ?? new Set<string>();
    suffixes.add(suffix);
    rgbBases.set(base, suffixes);
  }

  for (const [base, suffixes] of rgbBases.entries()) {
    if (suffixes.has('R') && suffixes.has('G') && suffixes.has('B')) {
      return base || 'RGB';
    }
  }

  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  return null;
}

function serializeViewState(view: ReturnType<typeof pickViewState>): string {
  return [
    view.zoom,
    view.panX,
    view.panY,
    view.panoramaYawDeg,
    view.panoramaPitchDeg,
    view.panoramaHfovDeg
  ].join(':');
}

function serializePixel(pixel: ViewerSessionState['lockedPixel'] | null | undefined): string {
  if (!pixel) {
    return 'none';
  }

  return `${pixel.ix}:${pixel.iy}`;
}

function serializeDisplayLuminanceRange(range: DisplayLuminanceRange | null): string {
  if (!range) {
    return 'none';
  }

  return `${range.min}:${range.max}`;
}

function serializeStokesDegreeModulation(state: ViewerSessionState): string {
  return [
    state.stokesDegreeModulation.aolp,
    state.stokesDegreeModulation.cop,
    state.stokesDegreeModulation.top
  ].join(':');
}
