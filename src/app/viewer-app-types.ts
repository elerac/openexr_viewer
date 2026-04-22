import type { ColormapLut, ColormapRegistry } from '../colormaps';
import type { ProbeColorPreview } from '../probe';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  ExrMetadataEntry,
  OpenedImageSession,
  PixelSample,
  ViewportInfo,
  ViewerInteractionState,
  ViewerRenderState,
  ViewerSessionState
} from '../types';

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

export interface ProbePresentationModel {
  mode: 'Hover' | 'Locked';
  sample: PixelSample | null;
  colorPreview: ProbeColorPreview | null;
  imageSize: { width: number; height: number } | null;
  metadata: ExrMetadataEntry[] | null;
}

export interface ViewerOpenedImageOption {
  id: string;
  label: string;
  sizeBytes: number | null;
  sourceDetail: string;
  thumbnailDataUrl: string | null;
}

export interface ViewerLayerOption {
  index: number;
  label: string;
  channelCount: number;
}

export interface StokesDegreeModulationControlModel {
  label: string;
  enabled: boolean;
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
  activeColormapLut: ColormapLut | null;
  loadedColormapId: string | null;
  activeDisplayLuminanceRange: DisplayLuminanceRange | null;
  pendingColormapActivation: PendingColormapActivation | null;
  pendingColormapRequestId: number | null;
  pendingSelectionTransitionRequestId: number | null;
  pendingDisplayRangeRequestId: number | null;
  pendingDisplayRangeRequestKey: string | null;
  pendingThumbnailTokensBySessionId: Record<string, number>;
  thumbnailsBySessionId: Record<string, string | null>;
  stokesDisplayRestoreStates: Record<string, RestorableVisualizationState>;
}

export type ViewerIntent =
  | { type: 'errorSet'; message: string | null }
  | { type: 'loadingSet'; loading: boolean }
  | { type: 'colormapRegistryResolved'; registry: ColormapRegistry }
  | { type: 'colormapLoadStarted'; requestId: number }
  | { type: 'colormapLoadResolved'; requestId: number; colormapId: string; lut: ColormapLut }
  | { type: 'colormapLoadFailed'; requestId: number; message: string }
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
  | { type: 'lockedPixelToggled'; pixel: ViewerSessionState['lockedPixel'] }
  | { type: 'interactionStatePublished'; interactionState: ViewerInteractionState }
  | { type: 'viewStateCommitted'; view: ViewerInteractionState['view'] }
  | { type: 'sessionLoaded'; session: OpenedImageSession }
  | { type: 'sessionReloaded'; sessionId: string; session: OpenedImageSession }
  | { type: 'activeSessionSwitched'; sessionId: string }
  | { type: 'sessionsReordered'; draggedSessionId: string; targetSessionId: string }
  | { type: 'sessionClosed'; sessionId: string }
  | { type: 'allSessionsClosed' }
  | { type: 'activeSessionReset'; viewport: ViewportInfo }
  | { type: 'thumbnailRequested'; sessionId: string; token: number }
  | { type: 'thumbnailReady'; sessionId: string; token: number; thumbnailDataUrl: string | null }
  | { type: 'displayRangeRequestStarted'; requestId: number; requestKey: string }
  | {
      type: 'displayLuminanceRangeResolved';
      requestId: number | null;
      sessionId: string;
      activeLayer: number;
      displaySelection: ViewerSessionState['displaySelection'];
      displayLuminanceRange: DisplayLuminanceRange | null;
    };

export interface ViewerAppSnapshot {
  state: ViewerAppState;
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  renderState: ViewerRenderState;
  colormapOptions: Array<{ id: string; label: string }>;
  openedImageOptions: ViewerOpenedImageOption[];
  exportTarget: { filename: string; sourceWidth: number; sourceHeight: number } | null;
  layerOptions: ViewerLayerOption[];
  probePresentation: ProbePresentationModel;
  rgbGroupChannelNames: string[];
  stokesDegreeModulationControl: StokesDegreeModulationControlModel | null;
  shouldClearImageBrowserPanels: boolean;
  isRgbViewLoading: boolean;
  resourceRevisionKey: string | null;
  displayRangeRequestKey: string | null;
  renderImageRevisionKey: string | null;
  renderValueOverlayRevisionKey: string | null;
  renderProbeOverlayRevisionKey: string | null;
}

export interface ViewerAppTransition {
  previousState: ViewerAppState;
  state: ViewerAppState;
  previousSnapshot: ViewerAppSnapshot;
  snapshot: ViewerAppSnapshot;
  intent: ViewerIntent;
  invalidation: number;
}
