import { describe, expect, it } from 'vitest';
import { createViewerAppSnapshot } from '../src/app/viewer-app-selectors';
import { createInitialViewerAppState } from '../src/app/viewer-app-core';
import { computeInvalidationFlags, InvalidationFlags } from '../src/app/viewer-app-invalidation';
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

function createActiveState() {
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

function hasFlag(flags: number, flag: InvalidationFlags): boolean {
  return (flags & flag) !== 0;
}

describe('viewer app invalidation', () => {
  it('returns no flags for identical snapshots', () => {
    const state = createActiveState();
    const flags = computeInvalidationFlags(createViewerAppSnapshot(state), createViewerAppSnapshot(state));

    expect(flags).toBe(InvalidationFlags.None);
  });

  it('treats hover-only changes as probe readout and probe-overlay invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      interactionState: {
        ...previous.interactionState,
        hoveredPixel: { ix: 1, iy: 0 }
      }
    };

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiProbeReadout)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderProbeOverlay)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderImage)).toBe(false);
  });

  it('treats view-only changes as image and overlay invalidation', () => {
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

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.RenderImage)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderValueOverlay)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderProbeOverlay)).toBe(true);
  });

  it('treats locked-pixel changes as probe readout and probe-overlay invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessionState: {
        ...previous.sessionState,
        lockedPixel: { ix: 1, iy: 0 }
      }
    };

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiProbeReadout)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderProbeOverlay)).toBe(true);
  });

  it('marks session switches as UI, resource, and render invalidation', () => {
    const previous = createActiveState();
    const second = createSession('session-2');
    const next = {
      ...previous,
      sessions: [previous.sessions[0]!, second],
      activeSessionId: second.id,
      sessionState: second.state,
      interactionState: createInteractionState(second.state)
    };

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiOpenedImages)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.ResourcePrepare)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderImage)).toBe(true);
  });

  it('marks display-selection changes for resource prep and render invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessionState: {
        ...previous.sessionState,
        displaySelection: createChannelMonoSelection('R')
      }
    };

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiRgbGroupOptions)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.ResourcePrepare)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderImage)).toBe(true);
  });

  it('marks colormap-load completion as gradient invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      activeColormapLut: { id: '0', label: 'Default', entryCount: 2, rgba8: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }
    };

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiColormapGradient)).toBe(true);
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

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiColormapRange)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.RenderImage)).toBe(true);
  });

  it('marks empty-session transitions as clear-image invalidation', () => {
    const previous = createActiveState();
    const next = {
      ...previous,
      sessions: [],
      activeSessionId: null,
      sessionState: createInitialState(),
      interactionState: createInteractionState(createInitialState())
    };

    const flags = computeInvalidationFlags(createViewerAppSnapshot(previous), createViewerAppSnapshot(next));
    expect(hasFlag(flags, InvalidationFlags.UiClearPanels)).toBe(true);
    expect(hasFlag(flags, InvalidationFlags.ResourceClearImage)).toBe(true);
  });
});
