import {
  AUTO_EXPOSURE_PERCENTILE,
  AUTO_EXPOSURE_SOURCE
} from '../analysis/auto-exposure';
import {
  isGroupedRgbStokesSelection,
  serializeDisplaySelectionKey,
  type DisplaySelection
} from '../display-model';
import type { ViewerState, VisualizationMode } from '../types';

function serializeDisplaySelectionRevisionKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode
): string {
  if (!selection) {
    return 'none';
  }

  const baseKey = serializeDisplaySelectionKey(selection);
  return isGroupedRgbStokesSelection(selection)
    ? `${baseKey}:${visualizationMode}`
    : baseKey;
}

export function serializeDisplaySelectionLuminanceKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): string {
  if (!selection) {
    return 'none';
  }

  switch (selection.kind) {
    case 'channelRgb':
      return `channelRgb:${selection.r}:${selection.g}:${selection.b}`;
    case 'channelMono':
      return `channelMono:${selection.channel}`;
    case 'stokesScalar':
    case 'stokesAngle':
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode);
  }
}

export function buildDisplayTextureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb')
  ].join(':');
}

export function buildDisplayLuminanceRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionLuminanceKey(state.displaySelection, state.visualizationMode ?? 'rgb')
  ].join(':');
}

export function buildDisplayImageStatsRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb')
  ].join(':');
}

export function buildDisplayAutoExposureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> & Partial<Pick<ViewerState, 'visualizationMode'>>,
  percentile = AUTO_EXPOSURE_PERCENTILE
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb'),
    `autoExposure:${AUTO_EXPOSURE_SOURCE}:p${percentile}`
  ].join(':');
}
