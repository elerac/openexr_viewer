import { describe, expect, it } from 'vitest';
import { createInitialViewerAppState } from '../src/app/viewer-app-core';
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
    expect(hasRenderFlag(renderFlags, ViewerRenderInvalidationFlags.ProbeReadout)).toBe(false);
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
    expect(after.probeMetadata).toBe(before.probeMetadata);
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
