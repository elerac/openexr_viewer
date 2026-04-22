import { sameDisplayLuminanceRange } from '../colormap-range';
import { sameDisplaySelection } from '../display-model';
import { samePixel, sameViewState } from '../view-state';
import type {
  ViewerAppSnapshot,
  ViewerLayerOption,
  ViewerOpenedImageOption
} from './viewer-app-types';

export const enum InvalidationFlags {
  None = 0,
  UiError = 1 << 0,
  UiLoading = 1 << 1,
  UiOpenedImages = 1 << 2,
  UiExportTarget = 1 << 3,
  UiExposure = 1 << 4,
  UiViewerMode = 1 << 5,
  UiVisualizationMode = 1 << 6,
  UiStokesDegreeModulation = 1 << 7,
  UiActiveColormap = 1 << 8,
  UiColormapOptions = 1 << 9,
  UiColormapGradient = 1 << 10,
  UiColormapRange = 1 << 11,
  UiLayerOptions = 1 << 12,
  UiProbeMetadata = 1 << 13,
  UiRgbGroupOptions = 1 << 14,
  UiClearPanels = 1 << 15,
  UiProbeReadout = 1 << 16,
  ResourcePrepare = 1 << 17,
  ResourceRequestDisplayRange = 1 << 18,
  ResourceClearImage = 1 << 19,
  RenderImage = 1 << 20,
  RenderValueOverlay = 1 << 21,
  RenderProbeOverlay = 1 << 22
}

export function computeInvalidationFlags(
  previous: ViewerAppSnapshot,
  next: ViewerAppSnapshot
): InvalidationFlags {
  let flags = InvalidationFlags.None;

  if (previous.state.errorMessage !== next.state.errorMessage) {
    flags |= InvalidationFlags.UiError;
  }

  if (previous.state.isLoading !== next.state.isLoading || previous.isRgbViewLoading !== next.isRgbViewLoading) {
    flags |= InvalidationFlags.UiLoading;
  }

  if (!sameOpenedImageOptions(previous.openedImageOptions, next.openedImageOptions)
    || previous.state.activeSessionId !== next.state.activeSessionId) {
    flags |= InvalidationFlags.UiOpenedImages;
  }

  if (!sameExportTarget(previous.exportTarget, next.exportTarget)) {
    flags |= InvalidationFlags.UiExportTarget;
  }

  if (previous.state.sessionState.exposureEv !== next.state.sessionState.exposureEv) {
    flags |= InvalidationFlags.UiExposure;
  }

  if (previous.state.sessionState.viewerMode !== next.state.sessionState.viewerMode || previous.shouldClearImageBrowserPanels !== next.shouldClearImageBrowserPanels) {
    flags |= InvalidationFlags.UiViewerMode;
  }

  if (previous.state.sessionState.visualizationMode !== next.state.sessionState.visualizationMode || previous.shouldClearImageBrowserPanels !== next.shouldClearImageBrowserPanels) {
    flags |= InvalidationFlags.UiVisualizationMode;
  }

  if (!sameStokesControl(previous.stokesDegreeModulationControl, next.stokesDegreeModulationControl)) {
    flags |= InvalidationFlags.UiStokesDegreeModulation;
  }

  if (previous.state.sessionState.activeColormapId !== next.state.sessionState.activeColormapId) {
    flags |= InvalidationFlags.UiActiveColormap;
  }

  if (!sameColormapOptions(previous.colormapOptions, next.colormapOptions)) {
    flags |= InvalidationFlags.UiColormapOptions;
  }

  if (previous.state.activeColormapLut !== next.state.activeColormapLut) {
    flags |= InvalidationFlags.UiColormapGradient;
  }

  if (
    !sameDisplayLuminanceRange(previous.state.sessionState.colormapRange, next.state.sessionState.colormapRange) ||
    !sameDisplayLuminanceRange(previous.state.activeDisplayLuminanceRange, next.state.activeDisplayLuminanceRange) ||
    previous.state.sessionState.colormapRangeMode !== next.state.sessionState.colormapRangeMode ||
    previous.state.sessionState.colormapZeroCentered !== next.state.sessionState.colormapZeroCentered
  ) {
    flags |= InvalidationFlags.UiColormapRange;
  }

  if (!sameLayerOptions(previous.layerOptions, next.layerOptions)
    || previous.state.sessionState.activeLayer !== next.state.sessionState.activeLayer) {
    flags |= InvalidationFlags.UiLayerOptions;
  }

  if (!sameMetadata(previous.probePresentation.metadata, next.probePresentation.metadata)) {
    flags |= InvalidationFlags.UiProbeMetadata;
  }

  if (
    !sameDisplaySelection(previous.state.sessionState.displaySelection, next.state.sessionState.displaySelection) ||
    previous.rgbGroupChannelNames.join('|') !== next.rgbGroupChannelNames.join('|')
  ) {
    flags |= InvalidationFlags.UiRgbGroupOptions;
  }

  if (previous.shouldClearImageBrowserPanels !== next.shouldClearImageBrowserPanels && next.shouldClearImageBrowserPanels) {
    flags |= InvalidationFlags.UiClearPanels;
  }

  if (!sameProbePresentation(previous, next)) {
    flags |= InvalidationFlags.UiProbeReadout;
  }

  if (previous.resourceRevisionKey !== next.resourceRevisionKey && Boolean(next.resourceRevisionKey)) {
    flags |= InvalidationFlags.ResourcePrepare;
  }

  if (
    previous.displayRangeRequestKey !== next.displayRangeRequestKey &&
    Boolean(next.displayRangeRequestKey)
  ) {
    flags |= InvalidationFlags.ResourceRequestDisplayRange;
  }

  if (!previous.activeSession && !next.activeSession) {
    flags |= InvalidationFlags.ResourceClearImage;
  } else if (previous.activeSession && !next.activeSession) {
    flags |= InvalidationFlags.ResourceClearImage;
  }

  if (previous.renderImageRevisionKey !== next.renderImageRevisionKey && Boolean(next.renderImageRevisionKey)) {
    flags |= InvalidationFlags.RenderImage;
  }

  if (previous.renderValueOverlayRevisionKey !== next.renderValueOverlayRevisionKey && Boolean(next.renderValueOverlayRevisionKey)) {
    flags |= InvalidationFlags.RenderValueOverlay;
  }

  if (previous.renderProbeOverlayRevisionKey !== next.renderProbeOverlayRevisionKey && Boolean(next.renderProbeOverlayRevisionKey)) {
    flags |= InvalidationFlags.RenderProbeOverlay;
  }

  return flags;
}

function sameProbePresentation(previous: ViewerAppSnapshot, next: ViewerAppSnapshot): boolean {
  return (
    previous.probePresentation.mode === next.probePresentation.mode &&
    samePixel(previous.probePresentation.sample
      ? { ix: previous.probePresentation.sample.x, iy: previous.probePresentation.sample.y }
      : null, next.probePresentation.sample
      ? { ix: next.probePresentation.sample.x, iy: next.probePresentation.sample.y }
      : null) &&
    previous.probePresentation.colorPreview?.cssColor === next.probePresentation.colorPreview?.cssColor &&
    JSON.stringify(previous.probePresentation.colorPreview?.displayValues ?? []) ===
      JSON.stringify(next.probePresentation.colorPreview?.displayValues ?? []) &&
    JSON.stringify(previous.probePresentation.sample?.values ?? {}) === JSON.stringify(next.probePresentation.sample?.values ?? {}) &&
    JSON.stringify(previous.probePresentation.imageSize) === JSON.stringify(next.probePresentation.imageSize)
  );
}

function sameOpenedImageOptions(a: ViewerOpenedImageOption[], b: ViewerOpenedImageOption[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => {
    const other = b[index];
    return Boolean(other)
      && item.id === other.id
      && item.label === other.label
      && item.sizeBytes === other.sizeBytes
      && item.sourceDetail === other.sourceDetail
      && item.thumbnailDataUrl === other.thumbnailDataUrl;
  });
}

function sameLayerOptions(a: ViewerLayerOption[], b: ViewerLayerOption[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => {
    const other = b[index];
    return Boolean(other)
      && item.index === other.index
      && item.label === other.label
      && item.channelCount === other.channelCount;
  });
}

function sameColormapOptions(
  a: Array<{ id: string; label: string }>,
  b: Array<{ id: string; label: string }>
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item.id === b[index]?.id && item.label === b[index]?.label);
}

function sameExportTarget(
  a: ViewerAppSnapshot['exportTarget'],
  b: ViewerAppSnapshot['exportTarget']
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return (
    a.filename === b.filename &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight
  );
}

function sameStokesControl(
  a: ViewerAppSnapshot['stokesDegreeModulationControl'],
  b: ViewerAppSnapshot['stokesDegreeModulationControl']
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.label === b.label && a.enabled === b.enabled;
}

function sameMetadata(
  a: ViewerAppSnapshot['probePresentation']['metadata'],
  b: ViewerAppSnapshot['probePresentation']['metadata']
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item.key === b[index]?.key && item.value === b[index]?.value);
}
