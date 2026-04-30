import { cloneDisplayLuminanceRange } from '../../colormap-range';
import { sameDisplaySelection } from '../../display-model';
import { idleResource } from '../../async-resource';
import { clampZoom } from '../../interaction/image-geometry';
import {
  clampPanoramaHfov,
  clampPanoramaPitch,
  normalizePanoramaYaw
} from '../../interaction/panorama-geometry';
import { cloneImageRoi, sameImageRoi } from '../../roi';
import { cloneViewerSessionState } from '../../session-state';
import type {
  OpenedImageSession,
  ViewerSessionState,
  ViewerViewState
} from '../../types';
import {
  createEmptyRoiInteractionState,
  createInteractionState,
  samePixel,
  sameRoiInteractionState
} from '../../view-state';
import { sameViewerSessionState } from '../viewer-app-equality';
import type {
  RestorableVisualizationState,
  ViewerAppState,
  ViewerIntent
} from '../viewer-app-types';

export interface ViewerReducerContext {
  readonly initialState: ViewerAppState;
}

export type ViewerDomainReducer = (
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
) => ViewerAppState;

export interface PatchSessionStateOptions {
  syncInteractionView?: boolean;
  clearHover?: boolean;
  resetDisplayRangeContext?: boolean;
}

const VIEW_KEYS = [
  'zoom',
  'panX',
  'panY',
  'panoramaYawDeg',
  'panoramaPitchDeg',
  'panoramaHfovDeg'
] as const;

type ViewCommitState = Pick<ViewerSessionState, (typeof VIEW_KEYS)[number]>;

export function patchSessionState(
  state: ViewerAppState,
  patch: Partial<ViewerSessionState>,
  options: PatchSessionStateOptions = {}
): ViewerAppState {
  const nextSessionState = {
    ...state.sessionState,
    ...patch
  };
  if (sameViewerSessionState(state.sessionState, nextSessionState)) {
    return state;
  }

  let interactionState = state.interactionState;
  if (options.syncInteractionView || options.clearHover) {
    const nextBaseInteractionState = createInteractionState(nextSessionState);
    interactionState = {
      view: options.syncInteractionView ? nextBaseInteractionState.view : state.interactionState.view,
      hoveredPixel: options.clearHover ? null : state.interactionState.hoveredPixel,
      draftRoi: null,
      roiInteraction: nextBaseInteractionState.roiInteraction
    };
  }
  const resetImageStatsContext = shouldResetImageStatsContext(state.sessionState, nextSessionState);

  return {
    ...state,
    sessionState: nextSessionState,
    interactionState,
    sessions: updateActiveSessionStoredState(state.sessions, state.activeSessionId, nextSessionState),
    displayRangeResource: options.resetDisplayRangeContext ? idleResource() : state.displayRangeResource,
    imageStatsResource: resetImageStatsContext ? idleResource() : state.imageStatsResource,
    autoExposureResource: resetImageStatsContext ? idleResource() : state.autoExposureResource
  };
}

export function updateActiveSessionStoredState(
  sessions: OpenedImageSession[],
  activeSessionId: string | null,
  state: ViewerSessionState
): OpenedImageSession[] {
  if (!activeSessionId) {
    return sessions;
  }

  let changed = false;
  const nextSessions = sessions.map((session) => {
    if (session.id !== activeSessionId) {
      return session;
    }

    changed = true;
    return {
      ...session,
      state: cloneViewerSessionState(state)
    };
  });

  return changed ? nextSessions : sessions;
}

export function normalizeViewerViewPatch(patch: Partial<ViewerViewState>): Partial<ViewerViewState> | null {
  const normalized: Partial<ViewerViewState> = {};
  if (patch.zoom !== undefined && Number.isFinite(patch.zoom)) {
    normalized.zoom = clampZoom(patch.zoom);
  }
  if (patch.panX !== undefined && Number.isFinite(patch.panX)) {
    normalized.panX = patch.panX;
  }
  if (patch.panY !== undefined && Number.isFinite(patch.panY)) {
    normalized.panY = patch.panY;
  }
  if (patch.panoramaYawDeg !== undefined && Number.isFinite(patch.panoramaYawDeg)) {
    normalized.panoramaYawDeg = normalizePanoramaYaw(patch.panoramaYawDeg);
  }
  if (patch.panoramaPitchDeg !== undefined && Number.isFinite(patch.panoramaPitchDeg)) {
    normalized.panoramaPitchDeg = clampPanoramaPitch(patch.panoramaPitchDeg);
  }
  if (patch.panoramaHfovDeg !== undefined && Number.isFinite(patch.panoramaHfovDeg)) {
    normalized.panoramaHfovDeg = clampPanoramaHfov(patch.panoramaHfovDeg);
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function cloneInteractionState(state: ViewerAppState['interactionState']): ViewerAppState['interactionState'] {
  return {
    view: { ...state.view },
    hoveredPixel: state.hoveredPixel ? { ...state.hoveredPixel } : null,
    draftRoi: cloneImageRoi(state.draftRoi),
    roiInteraction: { ...(state.roiInteraction ?? createEmptyRoiInteractionState()) }
  };
}

export function sameInteractionState(
  a: ViewerAppState['interactionState'],
  b: ViewerAppState['interactionState']
): boolean {
  return (
    sameViewCommit(a.view, b.view) &&
    samePixel(a.hoveredPixel, b.hoveredPixel) &&
    sameImageRoi(a.draftRoi, b.draftRoi) &&
    sameRoiInteractionState(
      a.roiInteraction ?? createEmptyRoiInteractionState(),
      b.roiInteraction ?? createEmptyRoiInteractionState()
    )
  );
}

export function sameViewCommit(
  sessionState: ViewCommitState,
  view: ViewCommitState
): boolean {
  return VIEW_KEYS.every((key) => sessionState[key] === view[key]);
}

export function cloneRestorableVisualizationState(
  state: RestorableVisualizationState
): RestorableVisualizationState {
  return {
    ...state,
    colormapRange: cloneDisplayLuminanceRange(state.colormapRange)
  };
}

export function clearAnalysisContext(state: ViewerAppState): ViewerAppState {
  if (
    state.displayRangeResource.status === 'idle' &&
    state.imageStatsResource.status === 'idle' &&
    state.autoExposureResource.status === 'idle'
  ) {
    return state;
  }

  return {
    ...state,
    displayRangeResource: idleResource(),
    imageStatsResource: idleResource(),
    autoExposureResource: idleResource()
  };
}

export function sessionExists(state: ViewerAppState, sessionId: string): boolean {
  return state.sessions.some((session) => session.id === sessionId);
}

export function isValidActiveSessionSwitch(state: ViewerAppState, sessionId: string): boolean {
  return state.activeSessionId !== sessionId && sessionExists(state, sessionId);
}

export function isActiveSessionIntent(state: ViewerAppState, sessionId: string): boolean {
  return state.activeSessionId === sessionId && sessionExists(state, sessionId);
}

function shouldResetImageStatsContext(previous: ViewerSessionState, next: ViewerSessionState): boolean {
  return (
    previous.activeLayer !== next.activeLayer ||
    previous.visualizationMode !== next.visualizationMode ||
    !sameDisplaySelection(previous.displaySelection, next.displaySelection)
  );
}
