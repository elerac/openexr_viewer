import { buildChannelViewItems } from '../channel-view-items';
import { getSuccessValue, idleResource } from '../async-resource';
import { cloneDisplaySelection, sameDisplaySelection } from '../display-model';
import {
  serializeChannelThumbnailContextKey,
  serializeChannelThumbnailRequestKey
} from '../channel-thumbnail-keys';
import { getColormapOptions, type ColormapLut } from '../colormaps';
import {
  getStokesDegreeModulationLabel,
  isStokesDegreeModulationParameter
} from '../stokes';
import type {
  DisplayLuminanceRange,
  ExportImageBatchTarget,
  ImageStats,
  OpenedImageSession,
  ViewerSessionState
} from '../types';
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

export function selectColormapLutById(state: ViewerAppState, colormapId: string): ColormapLut | null {
  return state.colormapLutResource.status === 'success' && state.colormapLutResource.key === colormapId
    ? state.colormapLutResource.value
    : null;
}

export function selectActiveColormapLut(state: ViewerAppState): ColormapLut | null {
  return selectColormapLutById(state, state.sessionState.activeColormapId);
}

export function selectActiveDisplayLuminanceRange(state: ViewerAppState): DisplayLuminanceRange | null {
  return getSuccessValue(state.displayRangeResource) ?? null;
}

export function selectActiveImageStats(state: ViewerAppState): ImageStats | null {
  return getSuccessValue(state.imageStatsResource) ?? null;
}

export function buildOpenedImageOptions(state: ViewerAppState): ViewerOpenedImageOption[] {
  const sources = state.sessions.map((session) => ({
    fallbackLabel: session.displayName,
    sourceDetail: getSessionSourceDetail(session)
  }));
  const labels = buildOpenedImageOptionLabels(state, sources);

  return state.sessions.map((session, index) => ({
    id: session.id,
    label: labels[index] ?? session.displayName,
    sizeBytes: session.fileSizeBytes,
    sourceDetail: sources[index]?.sourceDetail ?? session.displayName,
    thumbnailDataUrl: getSuccessValue(state.thumbnailsBySessionId[session.id] ?? idleResource()) ?? null,
    thumbnailAspectRatio: resolveThumbnailAspectRatio(session.decoded.width, session.decoded.height)
  }));
}

function buildOpenedImageOptionLabels(
  state: ViewerAppState,
  sources: PathAwareOpenedImageLabelSource[]
): string[] {
  const labels = state.sessions.map((session) => session.displayName);
  const pathAwareSources = state.sessions
    .map((session, index) => ({
      index,
      session,
      source: sources[index] ?? {
        fallbackLabel: session.displayName,
        sourceDetail: session.displayName
      }
    }))
    .filter(({ session }) => !session.displayNameIsCustom);
  const pathAwareLabels = buildPathAwareOpenedImageLabels(pathAwareSources.map(({ source }) => source));

  for (const [pathAwareIndex, entry] of pathAwareSources.entries()) {
    labels[entry.index] = pathAwareLabels[pathAwareIndex] ?? labels[entry.index] ?? '';
  }

  return labels;
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

export function buildExportBatchTarget(state: ViewerAppState): ExportImageBatchTarget | null {
  if (state.sessions.length === 0) {
    return null;
  }

  const openedImageOptions = buildOpenedImageOptions(state);
  const openedOptionsBySessionId = new Map(openedImageOptions.map((item) => [item.id, item]));

  return {
    archiveFilename: 'openexr-export.zip',
    activeSessionId: state.activeSessionId,
    files: state.sessions.map((session) => {
      const option = openedOptionsBySessionId.get(session.id);
      const effectiveState = session.id === state.activeSessionId ? state.sessionState : session.state;
      const layer = session.decoded.layers[effectiveState.activeLayer] ?? null;
      return {
        sessionId: session.id,
        filename: session.filename,
        label: option?.label ?? session.displayName,
        sourcePath: getBatchExportSourcePath(session),
        thumbnailDataUrl: option?.thumbnailDataUrl ?? null,
        activeLayer: effectiveState.activeLayer,
        displaySelection: cloneDisplaySelection(effectiveState.displaySelection),
        channels: layer
          ? buildChannelViewItems(layer.channelNames).map((item) => ({
              value: item.value,
              label: item.label,
              selectionKey: item.selectionKey,
              selection: cloneDisplaySelection(item.selection) ?? item.selection,
              swatches: [...item.swatches],
              mergedOrder: item.mergedOrder,
              splitOrder: item.splitOrder
            }))
          : []
      };
    })
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
      stokesDegreeModulation: state.sessionState.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: state.sessionState.stokesAolpDegreeModulationMode
    });
    const contextKey = serializeChannelThumbnailContextKey(
      session.id,
      state.sessionState.activeLayer,
      item.selectionKey
    );
    const fallbackRequestKey = state.channelThumbnailLatestRequestKeyByContextKey[contextKey] ?? null;
    const exactThumbnailDataUrl = Object.prototype.hasOwnProperty.call(state.channelThumbnailsByRequestKey, requestKey)
      ? getSuccessValue(state.channelThumbnailsByRequestKey[requestKey] ?? idleResource()) ?? null
      : null;
    const fallbackThumbnailDataUrl = fallbackRequestKey
      ? getSuccessValue(state.channelThumbnailsByRequestKey[fallbackRequestKey] ?? idleResource()) ?? null
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
    enabled: sessionState.stokesDegreeModulation[selection.parameter],
    showAolpMode: selection.parameter === 'aolp',
    aolpMode: sessionState.stokesAolpDegreeModulationMode
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

function getBatchExportSourcePath(session: OpenedImageSession): string {
  if (session.source.kind !== 'file') {
    return session.filename;
  }

  const relativePath = session.source.file.webkitRelativePath.trim();
  return relativePath || session.source.file.name || session.filename;
}

export interface PathAwareOpenedImageLabelSource {
  fallbackLabel: string;
  sourceDetail: string;
}

export function buildPathAwareOpenedImageLabels(
  sources: PathAwareOpenedImageLabelSource[]
): string[] {
  const entries = sources.map((source, index) => {
    const segments = splitOpenedImagePath(source.sourceDetail);
    const fallbackBaseName = stripDuplicateSuffix(source.fallbackLabel.trim());
    return {
      index,
      fallbackLabel: source.fallbackLabel,
      duplicateSuffix: getDuplicateSuffix(source.fallbackLabel),
      segments,
      baseName: segments[segments.length - 1] ?? fallbackBaseName
    };
  });
  const labels = sources.map((source) => source.fallbackLabel);
  const entriesByBaseName = new Map<string, typeof entries>();

  for (const entry of entries) {
    const group = entriesByBaseName.get(entry.baseName) ?? [];
    group.push(entry);
    entriesByBaseName.set(entry.baseName, group);
  }

  for (const group of entriesByBaseName.values()) {
    if (group.length < 2) {
      continue;
    }

    for (const entry of group) {
      if (entry.segments.length < 2) {
        labels[entry.index] = entry.fallbackLabel;
        continue;
      }

      const uniqueSuffix = findShortestUniquePathSuffix(entry.segments, group.map((item) => item.segments));
      const pathLabel = uniqueSuffix ?? entry.segments.join('/');
      labels[entry.index] = uniqueSuffix ? pathLabel : `${pathLabel}${entry.duplicateSuffix}`;
    }
  }

  return labels;
}

function resolveThumbnailAspectRatio(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return width / height;
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

function splitOpenedImagePath(path: string): string[] {
  return path
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0);
}

function stripDuplicateSuffix(label: string): string {
  return label.replace(/ \(\d+\)$/, '');
}

function getDuplicateSuffix(label: string): string {
  return label.match(/ \(\d+\)$/)?.[0] ?? '';
}

function findShortestUniquePathSuffix(
  segments: string[],
  groupSegments: string[][]
): string | null {
  for (let segmentCount = 2; segmentCount <= segments.length; segmentCount += 1) {
    const suffix = buildPathSuffix(segments, segmentCount);
    const matchingCount = groupSegments.reduce((count, currentSegments) => {
      return count + (buildPathSuffix(currentSegments, segmentCount) === suffix ? 1 : 0);
    }, 0);

    if (matchingCount === 1) {
      return suffix;
    }
  }

  return null;
}

function buildPathSuffix(segments: string[], segmentCount: number): string | null {
  if (segments.length < segmentCount) {
    return null;
  }

  return segments.slice(segments.length - segmentCount).join('/');
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
