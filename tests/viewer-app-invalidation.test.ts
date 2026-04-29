import { describe, expect, it } from 'vitest';
import { createInitialViewerAppState } from '../src/app/viewer-app-core';
import { buildChannelViewItems } from '../src/channel-view-items';
import {
  serializeChannelThumbnailContextKey,
  serializeChannelThumbnailRequestKey
} from '../src/channel-thumbnail-keys';
import {
  createViewerRenderSnapshotSelector,
  computeViewerRenderInvalidation,
  ViewerRenderInvalidationFlags
} from '../src/app/viewer-app-render';
import {
  createViewerUiSnapshotSelector,
  computeViewerUiInvalidation,
  ViewerUiInvalidationFlags
} from '../src/app/viewer-app-ui';
import type { ViewerAppState } from '../src/app/viewer-app-types';
import { createInteractionState } from '../src/view-state';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createLayerFromChannels
} from './helpers/state-fixtures';
import type { DecodedExrImage, OpenedImageSession } from '../src/types';

function createDecodedImage(channelNames: string[] = ['R', 'G', 'B']): DecodedExrImage {
  const channelValues: Record<string, Float32Array> = {};
  for (const channelName of channelNames) {
    channelValues[channelName] = new Float32Array([1, 0]);
  }

  return {
    width: 2,
    height: 1,
    layers: [createLayerFromChannels(channelValues, 'beauty')]
  };
}

function createSession(id = 'session-1', decoded = createDecodedImage()): OpenedImageSession {
  const state = buildViewerStateForLayer(createInitialState(), decoded, 0);
  return {
    id,
    filename: `${id}.exr`,
    displayName: `${id}.exr`,
    fileSizeBytes: 16,
    source: { kind: 'url', url: `/${id}.exr` },
    decoded,
    state
  };
}

function createActiveState(): ViewerAppState {
  const session = createSession();
  const state = createInitialViewerAppState();
  return {
    ...state,
    sessions: [session],
    activeSessionId: session.id,
    sessionState: session.state,
    interactionState: createInteractionState(session.state)
  };
}

function createReloadedActiveState(
  previous: ViewerAppState,
  decoded: DecodedExrImage,
  sessionState: ViewerAppState['sessionState'] = previous.sessionState
): ViewerAppState {
  const activeSession = previous.sessions[0]!;
  const reloadedSession: OpenedImageSession = {
    ...activeSession,
    decoded,
    state: sessionState
  };

  return {
    ...previous,
    sessions: [reloadedSession],
    sessionState,
    interactionState: createInteractionState(sessionState)
  };
}

function createUiFlags(previous: ViewerAppState, next: ViewerAppState): number {
  const selectUiSnapshot = createViewerUiSnapshotSelector();
  return computeViewerUiInvalidation(selectUiSnapshot(previous), selectUiSnapshot(next));
}

function createRenderFlags(previous: ViewerAppState, next: ViewerAppState): number {
  const selectRenderSnapshot = createViewerRenderSnapshotSelector();
  return computeViewerRenderInvalidation(selectRenderSnapshot(previous), selectRenderSnapshot(next));
}

function hasUiFlag(flags: number, flag: ViewerUiInvalidationFlags): boolean {
  return (flags & flag) !== 0;
}

function hasRenderFlag(flags: number, flag: ViewerRenderInvalidationFlags): boolean {
  return (flags & flag) !== 0;
}

describe('viewer app lanes', () => {
  it('returns no flags for identical snapshots', () => {
    const state = createActiveState();

    expect(createUiFlags(state, state)).toBe(ViewerUiInvalidationFlags.None);
    expect(createRenderFlags(state, state)).toBe(ViewerRenderInvalidationFlags.None);
  });

  it('exposes auto-fit selection mode through the UI lane only', () => {
    const state = createActiveState();
    const nextState = {
      ...state,
      autoFitImageOnSelect: true
    };
    const selectUiSnapshot = createViewerUiSnapshotSelector();
    const snapshot = selectUiSnapshot(nextState);
    const uiFlags = createUiFlags(state, nextState);

    expect(snapshot.autoFitImageOnSelect).toBe(true);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.AutoFitImageOnSelect)).toBe(true);
    expect(createRenderFlags(state, nextState)).toBe(ViewerRenderInvalidationFlags.None);
  });

  it('exposes ruler visibility through UI and ruler render lanes only', () => {
    const state = createActiveState();
    const nextState = {
      ...state,
      rulersVisible: true
    };
    const selectUiSnapshot = createViewerUiSnapshotSelector();
    const snapshot = selectUiSnapshot(nextState);
    const uiFlags = createUiFlags(state, nextState);
    const renderFlags = createRenderFlags(state, nextState);

    expect(snapshot.rulersVisible).toBe(true);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.RulersVisible)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderRulerOverlay)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(false);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderValueOverlay)).toBe(false);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(false);
  });

  it('exposes auto exposure through UI and render request lanes', () => {
    const state = createActiveState();
    const nextState = {
      ...state,
      autoExposureEnabled: true
    };
    const selectUiSnapshot = createViewerUiSnapshotSelector();
    const snapshot = selectUiSnapshot(nextState);
    const uiFlags = createUiFlags(state, nextState);
    const renderFlags = createRenderFlags(state, nextState);

    expect(snapshot.autoExposureEnabled).toBe(true);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.AutoExposure)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourceRequestAutoExposure)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(false);
  });

  it('uses the configured auto exposure percentile in render requests', () => {
    const state = {
      ...createActiveState(),
      autoExposureEnabled: true
    };
    const nextState = {
      ...state,
      autoExposurePercentile: 98.2
    };
    const selectRenderSnapshot = createViewerRenderSnapshotSelector();
    const previousSnapshot = selectRenderSnapshot(state);
    const nextSnapshot = selectRenderSnapshot(nextState);
    const renderFlags = computeViewerRenderInvalidation(previousSnapshot, nextSnapshot);

    expect(previousSnapshot.autoExposureRequest?.percentile).toBe(99.5);
    expect(nextSnapshot.autoExposureRequest?.percentile).toBe(98.2);
    expect(previousSnapshot.autoExposureRequest?.requestKey).toContain('p99.5');
    expect(nextSnapshot.autoExposureRequest?.requestKey).toContain('p98.2');
    expect(previousSnapshot.autoExposureRequest?.requestKey).not.toBe(nextSnapshot.autoExposureRequest?.requestKey);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourceRequestAutoExposure)).toBe(true);
  });

  it('keeps display selection transitions busy without requesting the full loading overlay', () => {
    const state = createActiveState();
    const selectUiSnapshot = createViewerUiSnapshotSelector();

    const pendingSelection = selectUiSnapshot({
      ...state,
      pendingSelectionTransitionRequestId: 1
    });
    expect(pendingSelection.isDisplayBusy).toBe(true);
    expect(pendingSelection.isDisplayOverlayLoading).toBe(false);

    const pendingColormap = selectUiSnapshot({
      ...state,
      pendingColormapRequestId: 2
    });
    expect(pendingColormap.isDisplayBusy).toBe(true);
    expect(pendingColormap.isDisplayOverlayLoading).toBe(true);
  });

  it('treats hover-only changes as render-lane probe work', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      interactionState: {
        ...previous.interactionState,
        hoveredPixel: { ix: 1, iy: 0 }
      }
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(uiFlags).toBe(ViewerUiInvalidationFlags.None);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ProbeReadout)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(false);
  });

  it('treats view-only changes as render invalidation without rebuilding probe readout', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      interactionState: {
        ...previous.interactionState,
        view: {
          ...previous.interactionState.view,
          zoom: 2
        }
      }
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(uiFlags).toBe(ViewerUiInvalidationFlags.None);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderValueOverlay)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ViewerStateReadout)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ProbeReadout)).toBe(false);
  });

  it('redraws rulers on view-only changes when rulers are enabled', () => {
    const previous = {
      ...createActiveState(),
      rulersVisible: true
    };
    const next = {
      ...previous,
      interactionState: {
        ...previous.interactionState,
        view: {
          ...previous.interactionState.view,
          panX: previous.interactionState.view.panX + 1
        }
      }
    };

    const renderFlags = createRenderFlags(previous, next);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderRulerOverlay)).toBe(true);
  });

  it('treats locked-pixel changes as render-lane probe invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessionState: {
        ...previous.sessionState,
        lockedPixel: { ix: 1, iy: 0 }
      }
    };

    const renderFlags = createRenderFlags(previous, next);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ProbeReadout)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(true);
  });

  it('treats committed ROI changes as readout and overlay invalidation without rerendering the image', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessionState: {
        ...previous.sessionState,
        roi: { x0: 0, y0: 0, x1: 1, y1: 0 }
      }
    };

    const renderFlags = createRenderFlags(previous, next);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RoiReadout)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(false);
  });

  it('treats draft ROI changes as overlay-only invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      interactionState: {
        ...previous.interactionState,
        draftRoi: { x0: 0, y0: 0, x1: 1, y1: 1 }
      }
    };

    const renderFlags = createRenderFlags(previous, next);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RoiReadout)).toBe(false);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(true);
  });

  it('marks session switches as UI and render invalidation', () => {
    const previous = createActiveState();
    const second = createSession('session-2');
    const next = {
      ...previous,
      sessions: [previous.sessions[0]!, second],
      activeSessionId: second.id,
      sessionState: second.state,
      interactionState: createInteractionState(second.state)
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.OpenedImages)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourcePrepare)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(true);
  });

  it('marks display-selection changes for RGB group UI and render invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessionState: {
        ...previous.sessionState,
        displaySelection: createChannelMonoSelection('R')
      }
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.RgbGroupOptions)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourcePrepare)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(true);
  });

  it('keeps the previous channel thumbnail visible while a refreshed thumbnail is pending', () => {
    const previous = createActiveState();
    const activeSession = previous.sessions[0]!;
    const descriptor = buildChannelViewItems(activeSession.decoded.layers[0]!.channelNames)[0]!;
    const contextKey = serializeChannelThumbnailContextKey(activeSession.id, previous.sessionState.activeLayer, descriptor.selectionKey);
    const previousRequestKey = serializeChannelThumbnailRequestKey({
      sessionId: activeSession.id,
      activeLayer: previous.sessionState.activeLayer,
      selection: descriptor.selection,
      exposureEv: previous.sessionState.exposureEv,
      stokesDegreeModulation: previous.sessionState.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: previous.sessionState.stokesAolpDegreeModulationMode
    });
    const pendingState = {
      ...previous,
      channelThumbnailsByRequestKey: {
        [previousRequestKey]: 'thumb-0'
      },
      channelThumbnailLatestRequestKeyByContextKey: {
        [contextKey]: previousRequestKey
      },
      sessionState: {
        ...previous.sessionState,
        exposureEv: 1
      }
    };

    const snapshot = createViewerUiSnapshotSelector()(pendingState);
    const item = snapshot.channelThumbnailItems.find((entry) => entry.selectionKey === descriptor.selectionKey);
    expect(item?.thumbnailDataUrl).toBe('thumb-0');
  });

  it('marks channel-thumbnail updates as RGB-group UI invalidation', () => {
    const previous = createActiveState();
    const activeSession = previous.sessions[0]!;
    const descriptor = buildChannelViewItems(activeSession.decoded.layers[0]!.channelNames)[0]!;
    const requestKey = serializeChannelThumbnailRequestKey({
      sessionId: activeSession.id,
      activeLayer: previous.sessionState.activeLayer,
      selection: descriptor.selection,
      exposureEv: previous.sessionState.exposureEv,
      stokesDegreeModulation: previous.sessionState.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: previous.sessionState.stokesAolpDegreeModulationMode
    });
    const contextKey = serializeChannelThumbnailContextKey(activeSession.id, previous.sessionState.activeLayer, descriptor.selectionKey);
    const next = {
      ...previous,
      channelThumbnailsByRequestKey: {
        [requestKey]: 'thumb-0'
      },
      channelThumbnailLatestRequestKeyByContextKey: {
        [contextKey]: requestKey
      }
    };

    const uiFlags = createUiFlags(previous, next);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.RgbGroupOptions)).toBe(true);
  });

  it('marks colormap-load completion as UI gradient and render texture invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      activeColormapLut: { id: '0', label: 'Default', entryCount: 2, rgba8: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.ColormapGradient)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ColormapTexture)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(false);
  });

  it('marks auto-range resolution as colormap-range and image invalidation', () => {
    const previous = {
      ...createActiveState(),
      sessionState: {
        ...createActiveState().sessionState,
        visualizationMode: 'colormap' as const,
        colormapRangeMode: 'alwaysAuto' as const,
        colormapRange: null
      }
    };
    const next = {
      ...previous,
      sessionState: {
        ...previous.sessionState,
        colormapRange: { min: 0, max: 1 }
      },
      activeDisplayLuminanceRange: { min: 0, max: 1 }
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.ColormapRange)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(true);
  });

  it('marks active-session reloads as resource and render invalidation even when view state is unchanged', () => {
    const previous = createActiveState();
    const next = createReloadedActiveState(previous, createDecodedImage());

    const renderFlags = createRenderFlags(previous, next);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourcePrepare)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderValueOverlay)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderProbeOverlay)).toBe(true);
  });

  it('marks auto-range requests dirty when the active session reloads in colormap mode', () => {
    const previous = {
      ...createActiveState(),
      sessionState: {
        ...createActiveState().sessionState,
        visualizationMode: 'colormap' as const,
        colormapRangeMode: 'alwaysAuto' as const,
        displaySelection: createChannelMonoSelection('R')
      }
    };
    const next = createReloadedActiveState(previous, createDecodedImage(), previous.sessionState);

    const renderFlags = createRenderFlags(previous, next);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourcePrepare)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourceRequestDisplayRange)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.RenderImage)).toBe(true);
  });

  it('marks empty-session transitions as clear-panels and clear-image invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessions: [],
      activeSessionId: null,
      sessionState: createInitialState(),
      interactionState: createInteractionState(createInitialState())
    };

    const uiFlags = createUiFlags(previous, next);
    const renderFlags = createRenderFlags(previous, next);
    expect(hasUiFlag(uiFlags, ViewerUiInvalidationFlags.ClearPanels)).toBe(true);
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ResourceClearImage)).toBe(true);
  });

  it('keeps panel models memoized across committed view-state persistence', () => {
    const state = createActiveState();
    const selectUiSnapshot = createViewerUiSnapshotSelector();
    const before = selectUiSnapshot(state);
    const nextSessionState = {
      ...state.sessionState,
      zoom: 3,
      panX: 4,
      panY: 5
    };
    const next = {
      ...state,
      sessionState: nextSessionState,
      sessions: [{
        ...state.sessions[0]!,
        state: nextSessionState
      }]
    };
    const after = selectUiSnapshot(next);

    expect(after).toBe(before);
    expect(after.openedImageOptions).toBe(before.openedImageOptions);
    expect(after.layerOptions).toBe(before.layerOptions);
    expect(after.metadata).toBe(before.metadata);
  });

  it('keeps probe readout memoized across pure view changes', () => {
    const state = createActiveState();
    const selectRenderSnapshot = createViewerRenderSnapshotSelector();
    const before = selectRenderSnapshot(state);
    const after = selectRenderSnapshot({
      ...state,
      interactionState: {
        ...state.interactionState,
        view: {
          ...state.interactionState.view,
          zoom: 2
        }
      }
    });

    expect(after.probeReadout).toBe(before.probeReadout);
    expect(after.renderState).not.toBe(before.renderState);
  });
});
