import { sameDisplayLuminanceRange } from '../colormap-range';
import { sameDisplaySelection } from '../display-model';
import type { OpenedImageSession } from '../types';
import type { ViewerAppState, ViewerUiSnapshot } from './viewer-app-types';
import {
  sameColormapOptions,
  sameChannelThumbnailItems,
  sameExportBatchTarget,
  sameExportTarget,
  sameLayerOptions,
  sameMetadata,
  sameOpenedImageOptions,
  sameStokesControl
} from './viewer-app-equality';
import { sameStokesColormapDefaultSettings } from '../stokes-colormap-settings';
import {
  buildExportTarget,
  buildExportBatchTarget,
  buildChannelThumbnailItems,
  buildLayerOptions,
  buildOpenedImageOptions,
  getViewerColormapOptions,
  selectActiveColormapLut,
  selectActiveDisplayLuminanceRange,
  selectActiveSession,
  selectStokesDegreeModulationControl
} from './viewer-app-selectors';

export const enum ViewerUiInvalidationFlags {
  None = 0,
  Error = 1 << 0,
  Loading = 1 << 1,
  OpenedImages = 1 << 2,
  ExportTarget = 1 << 3,
  ExportBatchTarget = 1 << 4,
  AutoFitImageOnSelect = 1 << 5,
  AutoExposure = 1 << 6,
  RulersVisible = 1 << 7,
  Exposure = 1 << 8,
  ViewerMode = 1 << 9,
  VisualizationMode = 1 << 10,
  StokesDegreeModulation = 1 << 11,
  ActiveColormap = 1 << 12,
  ColormapOptions = 1 << 13,
  ColormapGradient = 1 << 14,
  ColormapRange = 1 << 15,
  LayerOptions = 1 << 16,
  Metadata = 1 << 17,
  RgbGroupOptions = 1 << 18,
  ClearPanels = 1 << 19,
  StokesColormapDefaults = 1 << 20
}

export function createViewerUiSnapshotSelector(): (state: ViewerAppState) => ViewerUiSnapshot {
  const selectColormapOptions = createColormapOptionsSelector();
  const selectOpenedImageOptions = createOpenedImageOptionsSelector();
  const selectExportTarget = createExportTargetSelector();
  const selectExportBatchTarget = createExportBatchTargetSelector();
  const selectLayerOptions = createLayerOptionsSelector();
  const selectMetadata = createMetadataSelector();
  const selectRgbGroupChannelNames = createRgbGroupChannelNamesSelector();
  const selectChannelThumbnailItems = createChannelThumbnailItemsSelector();
  const selectStokesControl = createStokesControlSelector();

  let previousSnapshot: ViewerUiSnapshot | null = null;
  return (state) => {
    const activeSession = selectActiveSession(state);
    const activeColormapLut = selectActiveColormapLut(state);
    const activeDisplayLuminanceRange = selectActiveDisplayLuminanceRange(state);
    const colormapIsLoading = state.colormapLutResource.status === 'pending';
    const autoExposureIsLoading = state.autoExposureResource.status === 'pending';

    const nextSnapshot: ViewerUiSnapshot = {
      errorMessage: state.errorMessage,
      isLoading: state.isLoading,
      isViewerLoadBlocked: state.isLoading && !activeSession,
      isDisplayBusy: Boolean(
        state.pendingSelectionTransitionRequestId ||
        colormapIsLoading ||
        state.pendingColormapActivation ||
        autoExposureIsLoading
      ),
      isDisplayOverlayLoading: Boolean(
        colormapIsLoading ||
        state.pendingColormapActivation
      ),
      autoFitImageOnSelect: state.autoFitImageOnSelect,
      autoExposureEnabled: state.autoExposureEnabled,
      rulersVisible: state.rulersVisible,
      activeSessionId: state.activeSessionId,
      openedImageOptions: selectOpenedImageOptions(state),
      exportTarget: selectExportTarget(activeSession),
      exportBatchTarget: selectExportBatchTarget(state),
      exposureEv: state.sessionState.exposureEv,
      viewerMode: state.sessionState.viewerMode,
      visualizationMode: state.sessionState.visualizationMode,
      stokesDegreeModulationControl: selectStokesControl(state),
      stokesColormapDefaults: state.stokesColormapDefaults,
      activeColormapId: state.sessionState.activeColormapId,
      defaultColormapId: state.defaultColormapId,
      activeColormapLut,
      colormapOptions: selectColormapOptions(state),
      colormapRange: state.sessionState.colormapRange,
      activeDisplayLuminanceRange,
      isColormapAutoRange: state.sessionState.colormapRangeMode === 'alwaysAuto',
      colormapZeroCentered: state.sessionState.colormapZeroCentered,
      layerOptions: selectLayerOptions(activeSession),
      activeLayer: state.sessionState.activeLayer,
      metadata: selectMetadata(activeSession, state.sessionState.activeLayer),
      displaySelection: state.sessionState.displaySelection,
      rgbGroupChannelNames: selectRgbGroupChannelNames(activeSession, state.sessionState.activeLayer),
      channelThumbnailItems: selectChannelThumbnailItems(state),
      shouldClearImageBrowserPanels: !activeSession
    };

    if (previousSnapshot && sameViewerUiSnapshot(previousSnapshot, nextSnapshot)) {
      return previousSnapshot;
    }

    previousSnapshot = nextSnapshot;
    return nextSnapshot;
  };
}

export function computeViewerUiInvalidation(
  previous: ViewerUiSnapshot,
  next: ViewerUiSnapshot
): ViewerUiInvalidationFlags {
  if (previous === next) {
    return ViewerUiInvalidationFlags.None;
  }

  let flags = ViewerUiInvalidationFlags.None;

  if (previous.errorMessage !== next.errorMessage) {
    flags |= ViewerUiInvalidationFlags.Error;
  }

  if (
    previous.isLoading !== next.isLoading ||
    previous.isViewerLoadBlocked !== next.isViewerLoadBlocked ||
    previous.isDisplayBusy !== next.isDisplayBusy ||
    previous.isDisplayOverlayLoading !== next.isDisplayOverlayLoading
  ) {
    flags |= ViewerUiInvalidationFlags.Loading;
  }

  if (!sameOpenedImageOptions(previous.openedImageOptions, next.openedImageOptions)
    || previous.activeSessionId !== next.activeSessionId) {
    flags |= ViewerUiInvalidationFlags.OpenedImages;
  }

  if (!sameExportTarget(previous.exportTarget, next.exportTarget)) {
    flags |= ViewerUiInvalidationFlags.ExportTarget;
  }

  if (!sameExportBatchTarget(previous.exportBatchTarget, next.exportBatchTarget)) {
    flags |= ViewerUiInvalidationFlags.ExportBatchTarget;
  }

  if (previous.autoFitImageOnSelect !== next.autoFitImageOnSelect) {
    flags |= ViewerUiInvalidationFlags.AutoFitImageOnSelect;
  }

  if (previous.autoExposureEnabled !== next.autoExposureEnabled) {
    flags |= ViewerUiInvalidationFlags.AutoExposure;
  }

  if (previous.rulersVisible !== next.rulersVisible) {
    flags |= ViewerUiInvalidationFlags.RulersVisible;
  }

  if (previous.exposureEv !== next.exposureEv) {
    flags |= ViewerUiInvalidationFlags.Exposure;
  }

  if (
    previous.viewerMode !== next.viewerMode ||
    previous.shouldClearImageBrowserPanels !== next.shouldClearImageBrowserPanels
  ) {
    flags |= ViewerUiInvalidationFlags.ViewerMode;
  }

  if (
    previous.visualizationMode !== next.visualizationMode ||
    previous.shouldClearImageBrowserPanels !== next.shouldClearImageBrowserPanels
  ) {
    flags |= ViewerUiInvalidationFlags.VisualizationMode;
  }

  if (!sameStokesControl(previous.stokesDegreeModulationControl, next.stokesDegreeModulationControl)) {
    flags |= ViewerUiInvalidationFlags.StokesDegreeModulation;
  }

  if (!sameStokesColormapDefaultSettings(previous.stokesColormapDefaults, next.stokesColormapDefaults)) {
    flags |= ViewerUiInvalidationFlags.StokesColormapDefaults;
  }

  if (previous.activeColormapId !== next.activeColormapId) {
    flags |= ViewerUiInvalidationFlags.ActiveColormap;
  }

  if (!sameColormapOptions(previous.colormapOptions, next.colormapOptions)) {
    flags |= ViewerUiInvalidationFlags.ColormapOptions;
  }

  if (previous.activeColormapLut !== next.activeColormapLut) {
    flags |= ViewerUiInvalidationFlags.ColormapGradient;
  }

  if (
    !sameDisplayLuminanceRange(previous.colormapRange, next.colormapRange) ||
    !sameDisplayLuminanceRange(previous.activeDisplayLuminanceRange, next.activeDisplayLuminanceRange) ||
    previous.isColormapAutoRange !== next.isColormapAutoRange ||
    previous.colormapZeroCentered !== next.colormapZeroCentered
  ) {
    flags |= ViewerUiInvalidationFlags.ColormapRange;
  }

  if (!sameLayerOptions(previous.layerOptions, next.layerOptions) || previous.activeLayer !== next.activeLayer) {
    flags |= ViewerUiInvalidationFlags.LayerOptions;
  }

  if (!sameMetadata(previous.metadata, next.metadata)) {
    flags |= ViewerUiInvalidationFlags.Metadata;
  }

  if (
    !sameDisplaySelection(previous.displaySelection, next.displaySelection) ||
    !sameStringArray(previous.rgbGroupChannelNames, next.rgbGroupChannelNames) ||
    !sameChannelThumbnailItems(previous.channelThumbnailItems, next.channelThumbnailItems)
  ) {
    flags |= ViewerUiInvalidationFlags.RgbGroupOptions;
  }

  if (previous.shouldClearImageBrowserPanels !== next.shouldClearImageBrowserPanels && next.shouldClearImageBrowserPanels) {
    flags |= ViewerUiInvalidationFlags.ClearPanels;
  }

  return flags;
}

function createColormapOptionsSelector(): (state: ViewerAppState) => Array<{ id: string; label: string }> {
  let previousRegistry = null as ViewerAppState['colormapRegistry'];
  let previousResult: Array<{ id: string; label: string }> = [];
  return (state) => {
    if (state.colormapRegistry === previousRegistry) {
      return previousResult;
    }

    previousRegistry = state.colormapRegistry;
    previousResult = getViewerColormapOptions(state);
    return previousResult;
  };
}

function createOpenedImageOptionsSelector(): (state: ViewerAppState) => ReturnType<typeof buildOpenedImageOptions> {
  let previousResult: ReturnType<typeof buildOpenedImageOptions> = [];
  return (state) => {
    const nextOptions = buildOpenedImageOptions(state);
    if (sameOpenedImageOptions(previousResult, nextOptions)) {
      return previousResult;
    }

    previousResult = nextOptions;
    return previousResult;
  };
}

function createExportTargetSelector(): (session: ReturnType<typeof selectActiveSession>) => ReturnType<typeof buildExportTarget> {
  let previousSession: ReturnType<typeof selectActiveSession> | undefined;
  let previousResult: ReturnType<typeof buildExportTarget> = null;
  return (session) => {
    if (session === previousSession) {
      return previousResult;
    }

    const nextResult = buildExportTarget(session);
    if (sameExportTarget(previousResult, nextResult)) {
      previousSession = session;
      return previousResult;
    }

    previousSession = session;
    previousResult = nextResult;
    return previousResult;
  };
}

function createExportBatchTargetSelector(): (state: ViewerAppState) => ReturnType<typeof buildExportBatchTarget> {
  let previousResult: ReturnType<typeof buildExportBatchTarget> = null;
  return (state) => {
    const nextResult = buildExportBatchTarget(state);
    if (sameExportBatchTarget(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function createLayerOptionsSelector(): (session: ReturnType<typeof selectActiveSession>) => ReturnType<typeof buildLayerOptions> {
  let previousSession: ReturnType<typeof selectActiveSession> | undefined;
  let previousResult: ReturnType<typeof buildLayerOptions> = [];
  return (session) => {
    if (session === previousSession) {
      return previousResult;
    }

    const nextResult = buildLayerOptions(session);
    if (sameLayerOptions(previousResult, nextResult)) {
      previousSession = session;
      return previousResult;
    }

    previousSession = session;
    previousResult = nextResult;
    return previousResult;
  };
}

function createMetadataSelector(): (
  session: ReturnType<typeof selectActiveSession>,
  activeLayer: number
) => ViewerUiSnapshot['metadata'] {
  let previousSessionId: string | null = null;
  let previousActiveLayer = -1;
  let previousLayer: OpenedImageSession['decoded']['layers'][number] | null = null;
  let previousResult: ViewerUiSnapshot['metadata'] = null;
  return (session, activeLayer) => {
    const layer = session?.decoded.layers[activeLayer] ?? null;
    const metadata = layer?.metadata ?? null;
    if (session?.id === previousSessionId && activeLayer === previousActiveLayer && layer === previousLayer) {
      return previousResult;
    }

    if (sameMetadata(previousResult, metadata)) {
      previousSessionId = session?.id ?? null;
      previousActiveLayer = activeLayer;
      previousLayer = layer;
      return previousResult;
    }

    previousSessionId = session?.id ?? null;
    previousActiveLayer = activeLayer;
    previousLayer = layer;
    previousResult = metadata;
    return previousResult;
  };
}

function createRgbGroupChannelNamesSelector(): (
  session: ReturnType<typeof selectActiveSession>,
  activeLayer: number
) => string[] {
  let previousSessionId: string | null = null;
  let previousActiveLayer = -1;
  let previousLayer: OpenedImageSession['decoded']['layers'][number] | null = null;
  let previousResult: string[] = [];
  return (session, activeLayer) => {
    const layer = session?.decoded.layers[activeLayer] ?? null;
    const channelNames = layer?.channelNames ?? [];
    if (session?.id === previousSessionId && activeLayer === previousActiveLayer && layer === previousLayer) {
      return previousResult;
    }

    if (sameStringArray(previousResult, channelNames)) {
      previousSessionId = session?.id ?? null;
      previousActiveLayer = activeLayer;
      previousLayer = layer;
      return previousResult;
    }

    previousSessionId = session?.id ?? null;
    previousActiveLayer = activeLayer;
    previousLayer = layer;
    previousResult = [...channelNames];
    return previousResult;
  };
}

function createStokesControlSelector(): (state: ViewerAppState) => ViewerUiSnapshot['stokesDegreeModulationControl'] {
  let previousResult: ViewerUiSnapshot['stokesDegreeModulationControl'] = null;
  return (state) => {
    const nextResult = selectStokesDegreeModulationControl(state.sessionState);
    if (sameStokesControl(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function createChannelThumbnailItemsSelector(): (state: ViewerAppState) => ViewerUiSnapshot['channelThumbnailItems'] {
  let previousResult: ViewerUiSnapshot['channelThumbnailItems'] = [];
  return (state) => {
    const nextResult = buildChannelThumbnailItems(state);
    if (sameChannelThumbnailItems(previousResult, nextResult)) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function sameViewerUiSnapshot(a: ViewerUiSnapshot, b: ViewerUiSnapshot): boolean {
  return (
    a.errorMessage === b.errorMessage &&
    a.isLoading === b.isLoading &&
    a.isViewerLoadBlocked === b.isViewerLoadBlocked &&
    a.isDisplayBusy === b.isDisplayBusy &&
    a.isDisplayOverlayLoading === b.isDisplayOverlayLoading &&
    a.autoFitImageOnSelect === b.autoFitImageOnSelect &&
    a.autoExposureEnabled === b.autoExposureEnabled &&
    a.rulersVisible === b.rulersVisible &&
    a.activeSessionId === b.activeSessionId &&
    sameOpenedImageOptions(a.openedImageOptions, b.openedImageOptions) &&
    sameExportTarget(a.exportTarget, b.exportTarget) &&
    sameExportBatchTarget(a.exportBatchTarget, b.exportBatchTarget) &&
    a.exposureEv === b.exposureEv &&
    a.viewerMode === b.viewerMode &&
    a.visualizationMode === b.visualizationMode &&
    sameStokesControl(a.stokesDegreeModulationControl, b.stokesDegreeModulationControl) &&
    sameStokesColormapDefaultSettings(a.stokesColormapDefaults, b.stokesColormapDefaults) &&
    a.activeColormapId === b.activeColormapId &&
    a.defaultColormapId === b.defaultColormapId &&
    a.activeColormapLut === b.activeColormapLut &&
    sameColormapOptions(a.colormapOptions, b.colormapOptions) &&
    sameDisplayLuminanceRange(a.colormapRange, b.colormapRange) &&
    sameDisplayLuminanceRange(a.activeDisplayLuminanceRange, b.activeDisplayLuminanceRange) &&
    a.isColormapAutoRange === b.isColormapAutoRange &&
    a.colormapZeroCentered === b.colormapZeroCentered &&
    sameLayerOptions(a.layerOptions, b.layerOptions) &&
    a.activeLayer === b.activeLayer &&
    sameMetadata(a.metadata, b.metadata) &&
    sameDisplaySelection(a.displaySelection, b.displaySelection) &&
    sameStringArray(a.rgbGroupChannelNames, b.rgbGroupChannelNames) &&
    sameChannelThumbnailItems(a.channelThumbnailItems, b.channelThumbnailItems) &&
    a.shouldClearImageBrowserPanels === b.shouldClearImageBrowserPanels
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item === b[index]);
}
