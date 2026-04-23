import { buildChannelViewItems } from '../channel-view-items';
import {
  serializeChannelThumbnailContextKey,
  serializeChannelThumbnailRequestKey
} from '../channel-thumbnail-keys';
import { getColormapOptions } from '../colormaps';
import { sameDisplaySelection } from '../display-model';
import {
  getStokesDegreeModulationLabel,
  isStokesDegreeModulationParameter
} from '../stokes';
import type { DisplayLuminanceRange, OpenedImageSession, ViewerSessionState } from '../types';
import type {
  StokesDegreeModulationControlModel,
  ViewerAppState,
  ViewerChannelThumbnailItem,
  ViewerLayerOption,
  ViewerOpenedImageOption
} from './viewer-app-types';

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
): { filename: string } | null {
  if (!session) {
    return null;
  }

  return {
    filename: buildDefaultExportFilename(session.displayName)
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

export function buildChannelThumbnailItems(state: ViewerAppState): ViewerChannelThumbnailItem[] {
  const session = selectActiveSession(state);
  if (!session) {
    return [];
  }

  const layer = session.decoded.layers[state.sessionState.activeLayer] ?? null;
  if (!layer) {
    return [];
  }

  return buildChannelViewItems(layer.channelNames).map((item) => {
    const requestKey = serializeChannelThumbnailRequestKey({
      sessionId: session.id,
      activeLayer: state.sessionState.activeLayer,
      selection: item.selection,
      exposureEv: state.sessionState.exposureEv,
      stokesDegreeModulation: state.sessionState.stokesDegreeModulation
    });
    const contextKey = serializeChannelThumbnailContextKey(
      session.id,
      state.sessionState.activeLayer,
      item.selectionKey
    );
    const fallbackRequestKey = state.channelThumbnailLatestRequestKeyByContextKey[contextKey] ?? null;
    const exactThumbnailDataUrl = Object.prototype.hasOwnProperty.call(state.channelThumbnailsByRequestKey, requestKey)
      ? state.channelThumbnailsByRequestKey[requestKey] ?? null
      : null;
    const fallbackThumbnailDataUrl = fallbackRequestKey
      ? state.channelThumbnailsByRequestKey[fallbackRequestKey] ?? null
      : null;

    return {
      ...item,
      thumbnailDataUrl: exactThumbnailDataUrl ?? fallbackThumbnailDataUrl
    };
  });
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

export function getViewerColormapOptions(state: ViewerAppState): Array<{ id: string; label: string }> {
  return state.colormapRegistry ? getColormapOptions(state.colormapRegistry) : [];
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

export function getSessionSourceDetail(session: OpenedImageSession): string {
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
