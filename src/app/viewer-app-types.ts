import type { ChannelViewThumbnailItem } from '../channel-view-items';
import type { AsyncResource, ViewerError } from '../async-resource';
import type { AutoExposureResult } from '../analysis/auto-exposure';
import type { ColormapLut, ColormapRegistry } from '../colormaps';
import type { ProbeColorPreview } from '../probe';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  ExportImageBatchTarget,
  ExrMetadataEntry,
  ImageStats,
  ImageRoi,
  OpenedImageDropPlacement,
  OpenedImageSession,
  PixelSample,
  RoiStats,
  StokesAolpDegreeModulationMode,
  ViewportInsets,
  ViewportInfo,
  ViewerInteractionState,
  ViewerRenderState,
  ViewerSessionState,
  ViewerViewState
} from '../types';
import type {
  StokesColormapDefaultGroup,
  StokesColormapDefaultSetting,
  StokesColormapDefaultSettings
} from '../stokes';

export interface RestorableVisualizationState {
  visualizationMode: ViewerSessionState['visualizationMode'];
  activeColormapId: string;
  colormapRange: DisplayLuminanceRange | null;
  colormapRangeMode: ViewerSessionState['colormapRangeMode'];
  colormapZeroCentered: boolean;
}

export interface PendingColormapActivation {
  sessionId: string;
  activeLayer: number;
  displaySelection: ViewerSessionState['displaySelection'];
}

export interface ProbeReadoutModel {
  mode: 'Hover' | 'Locked';
  sample: PixelSample | null;
  colorPreview: ProbeColorPreview | null;
  imageSize: { width: number; height: number } | null;
}

export interface RoiReadoutModel {
  roi: ImageRoi | null;
  stats: RoiStats | null;
}

export interface ImageStatsReadoutModel {
  hasActiveImage: boolean;
  isLoading: boolean;
  stats: ImageStats | null;
}

export interface ViewerStateReadoutModel {
  hasActiveImage: boolean;
  viewerMode: ViewerSessionState['viewerMode'];
  view: ViewerViewState;
}

export interface ViewerOpenedImageOption {
  id: string;
  label: string;
  sizeBytes: number | null;
  sourceDetail: string;
  thumbnailDataUrl: string | null;
  thumbnailAspectRatio: number | null;
}

export type ViewerChannelThumbnailItem = ChannelViewThumbnailItem;

export interface ViewerLayerOption {
  index: number;
  label: string;
  channelCount: number;
}

export interface StokesDegreeModulationControlModel {
  label: string;
  enabled: boolean;
  showAolpMode: boolean;
  aolpMode: StokesAolpDegreeModulationMode;
}

export interface ViewerResourceTarget {
  sessionId: string;
  activeLayer: number;
  visualizationMode: ViewerSessionState['visualizationMode'];
  displaySelection: ViewerSessionState['displaySelection'];
  decodedRef: OpenedImageSession['decoded'];
}

export interface ViewerDisplayRangeRequest extends ViewerResourceTarget {
  requestKey: string;
}

export interface ViewerAutoExposureRequest extends ViewerResourceTarget {
  requestKey: string;
  percentile: number;
  source: 'rgbMax';
}

export interface ViewerImageStatsRequest extends ViewerResourceTarget {
  requestKey: string;
}

export interface ViewerAppState {
  sessionState: ViewerSessionState;
  interactionState: ViewerInteractionState;
  sessions: OpenedImageSession[];
  activeSessionId: string | null;
  errorMessage: string | null;
  isLoading: boolean;
  colormapRegistry: ColormapRegistry | null;
  defaultColormapId: string;
  colormapLutResource: AsyncResource<ColormapLut>;
  displayRangeResource: AsyncResource<DisplayLuminanceRange | null>;
  imageStatsResource: AsyncResource<ImageStats | null>;
  autoExposureResource: AsyncResource<AutoExposureResult | null>;
  pendingColormapActivation: PendingColormapActivation | null;
  pendingSelectionTransitionRequestId: number | null;
  thumbnailsBySessionId: Record<string, AsyncResource<string | null>>;
  channelThumbnailsByRequestKey: Record<string, AsyncResource<string | null>>;
  channelThumbnailLatestRequestKeyByContextKey: Record<string, string>;
  stokesDisplayRestoreStates: Record<string, RestorableVisualizationState>;
  stokesColormapDefaults: StokesColormapDefaultSettings;
  autoFitImageOnSelect: boolean;
  autoExposureEnabled: boolean;
  autoExposurePercentile: number;
  rulersVisible: boolean;
}

export type ViewerIntent =
  | { type: 'errorSet'; message: string | null }
  | { type: 'loadingSet'; loading: boolean }
  | { type: 'autoFitImageOnSelectSet'; enabled: boolean }
  | { type: 'autoExposureSet'; enabled: boolean }
  | { type: 'autoExposurePercentileSet'; percentile: number }
  | { type: 'rulersVisibleSet'; enabled: boolean }
  | { type: 'colormapRegistryResolved'; registry: ColormapRegistry }
  | { type: 'colormapLoadStarted'; requestId: number; colormapId: string }
  | { type: 'colormapLoadResolved'; requestId: number; colormapId: string; lut: ColormapLut }
  | { type: 'colormapLoadFailed'; requestId: number; colormapId: string; error: ViewerError | Error | string }
  | { type: 'displaySelectionTransitionStarted'; requestId: number }
  | { type: 'displaySelectionTransitionFinished'; requestId: number }
  | { type: 'exposureSet'; exposureEv: number }
  | { type: 'viewerModeSet'; viewerMode: ViewerSessionState['viewerMode'] }
  | { type: 'activeLayerSet'; activeLayer: number }
  | {
      type: 'displaySelectionSet';
      displaySelection: ViewerSessionState['displaySelection'];
      restoreState?: RestorableVisualizationState | null;
    }
  | { type: 'visualizationModeRequested'; visualizationMode: ViewerSessionState['visualizationMode'] }
  | { type: 'activeColormapSet'; colormapId: string }
  | { type: 'colormapRangeSet'; range: DisplayLuminanceRange }
  | { type: 'colormapAutoRangeToggled' }
  | { type: 'colormapZeroCenteredToggled' }
  | { type: 'stokesDegreeModulationToggled' }
  | { type: 'stokesAolpDegreeModulationModeSet'; mode: StokesAolpDegreeModulationMode }
  | { type: 'stokesColormapDefaultsSet'; settings: StokesColormapDefaultSettings }
  | { type: 'stokesColormapDefaultSettingSet'; group: StokesColormapDefaultGroup; setting: StokesColormapDefaultSetting }
  | { type: 'stokesActiveColormapDefaultApplied'; setting: StokesColormapDefaultSetting }
  | { type: 'stokesColormapDefaultsReset' }
  | { type: 'lockedPixelToggled'; pixel: ViewerSessionState['lockedPixel'] }
  | { type: 'roiSet'; roi: ViewerSessionState['roi'] }
  | { type: 'viewerStateEdited'; patch: Partial<ViewerViewState> }
  | { type: 'interactionStatePublished'; interactionState: ViewerInteractionState }
  | { type: 'viewStateCommitted'; view: ViewerInteractionState['view'] }
  | { type: 'sessionLoaded'; session: OpenedImageSession }
  | { type: 'sessionReloaded'; sessionId: string; session: OpenedImageSession }
  | { type: 'sessionDisplayNameChanged'; sessionId: string; displayName: string }
  | { type: 'activeSessionSwitched'; sessionId: string; viewport?: ViewportInfo; fitInsets?: ViewportInsets }
  | {
      type: 'sessionsReordered';
      draggedSessionId: string;
      targetSessionId: string;
      placement: OpenedImageDropPlacement;
    }
  | { type: 'sessionClosed'; sessionId: string }
  | { type: 'allSessionsClosed' }
  | { type: 'activeSessionReset'; viewport: ViewportInfo; fitInsets?: ViewportInsets }
  | { type: 'activeSessionFitToViewport'; viewport: ViewportInfo; fitInsets?: ViewportInsets }
  | { type: 'thumbnailRequested'; sessionId: string; token: number }
  | { type: 'thumbnailReady'; sessionId: string; token: number; thumbnailDataUrl: string | null }
  | { type: 'channelThumbnailRequested'; requestKey: string; token: number }
  | {
      type: 'channelThumbnailReady';
      sessionId: string;
      requestKey: string;
      contextKey: string;
      token: number;
      thumbnailDataUrl: string | null;
    }
  | { type: 'displayRangeRequestStarted'; requestId: number; requestKey: string }
  | { type: 'imageStatsRequestStarted'; requestId: number; requestKey: string }
  | { type: 'autoExposureRequestStarted'; requestId: number; requestKey: string }
  | {
      type: 'displayLuminanceRangeResolved';
      requestId: number | null;
      requestKey: string;
      sessionId: string;
      activeLayer: number;
      displaySelection: ViewerSessionState['displaySelection'];
      displayLuminanceRange: DisplayLuminanceRange | null;
    }
  | {
      type: 'imageStatsResolved';
      requestId: number | null;
      requestKey: string;
      sessionId: string;
      activeLayer: number;
      visualizationMode: ViewerSessionState['visualizationMode'];
      displaySelection: ViewerSessionState['displaySelection'];
      imageStats: ImageStats | null;
    }
  | {
      type: 'autoExposurePreviewResolved';
      requestId: number;
      requestKey: string;
      sessionId: string;
      activeLayer: number;
      visualizationMode: ViewerSessionState['visualizationMode'];
      displaySelection: ViewerSessionState['displaySelection'];
      autoExposure: AutoExposureResult | null;
    }
  | {
      type: 'autoExposureResolved';
      requestId: number | null;
      requestKey: string;
      sessionId: string;
      activeLayer: number;
      visualizationMode: ViewerSessionState['visualizationMode'];
      displaySelection: ViewerSessionState['displaySelection'];
      autoExposure: AutoExposureResult | null;
    };

export interface ViewerStateTransition {
  previousState: ViewerAppState;
  state: ViewerAppState;
  intent: ViewerIntent;
}

export interface ViewerUiSnapshot {
  errorMessage: string | null;
  isLoading: boolean;
  isDisplayBusy: boolean;
  isDisplayOverlayLoading: boolean;
  autoFitImageOnSelect: boolean;
  autoExposureEnabled: boolean;
  rulersVisible: boolean;
  activeSessionId: string | null;
  openedImageOptions: ViewerOpenedImageOption[];
  exportTarget: { filename: string } | null;
  exportBatchTarget: ExportImageBatchTarget | null;
  exposureEv: number;
  viewerMode: ViewerSessionState['viewerMode'];
  visualizationMode: ViewerSessionState['visualizationMode'];
  stokesDegreeModulationControl: StokesDegreeModulationControlModel | null;
  stokesColormapDefaults: StokesColormapDefaultSettings;
  activeColormapId: string;
  defaultColormapId: string;
  activeColormapLut: ColormapLut | null;
  colormapOptions: Array<{ id: string; label: string }>;
  colormapRange: DisplayLuminanceRange | null;
  activeDisplayLuminanceRange: DisplayLuminanceRange | null;
  isColormapAutoRange: boolean;
  colormapZeroCentered: boolean;
  layerOptions: ViewerLayerOption[];
  activeLayer: number;
  metadata: ExrMetadataEntry[] | null;
  displaySelection: ViewerSessionState['displaySelection'];
  rgbGroupChannelNames: string[];
  channelThumbnailItems: ViewerChannelThumbnailItem[];
  shouldClearImageBrowserPanels: boolean;
}

export interface ViewerUiTransition extends ViewerStateTransition {
  previousSnapshot: ViewerUiSnapshot;
  snapshot: ViewerUiSnapshot;
  invalidation: number;
}

export interface ViewerRenderSnapshot {
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  renderState: ViewerRenderState;
  activeColormapLut: ColormapLut | null;
  probeReadout: ProbeReadoutModel;
  roiReadout: RoiReadoutModel;
  viewerStateReadout: ViewerStateReadoutModel;
  imageStatsReadout: ImageStatsReadoutModel;
  resourceTarget: ViewerResourceTarget | null;
  displayRangeRequest: ViewerDisplayRangeRequest | null;
  imageStatsRequest: ViewerImageStatsRequest | null;
  autoExposureRequest: ViewerAutoExposureRequest | null;
  rulersVisible: boolean;
}

export interface ViewerRenderTransition extends ViewerStateTransition {
  previousSnapshot: ViewerRenderSnapshot;
  snapshot: ViewerRenderSnapshot;
  invalidation: number;
}
