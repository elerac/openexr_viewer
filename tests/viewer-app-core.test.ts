import { describe, expect, it } from 'vitest';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { buildLoadedSession } from '../src/app/session-resource';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';
import type { DecodedExrImage, OpenedImageSession } from '../src/types';

function createDecodedImage(channelNames: string[] = ['R', 'G', 'B']): DecodedExrImage {
  const channelValues: Record<string, Float32Array> = {};
  for (const channelName of channelNames) {
    channelValues[channelName] = new Float32Array([channelName.startsWith('S') ? 0.5 : 1, 0]);
  }

  return {
    width: 2,
    height: 1,
    layers: [createLayerFromChannels(channelValues, 'beauty')]
  };
}

function createSession(id: string, decoded = createDecodedImage()): OpenedImageSession {
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

describe('viewer app core', () => {
  it('updates thumbnail state from worker feedback and ignores stale tokens', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    core.dispatch({ type: 'thumbnailRequested', sessionId: session.id, token: 1 });
    core.dispatch({ type: 'thumbnailRequested', sessionId: session.id, token: 2 });
    core.dispatch({ type: 'thumbnailReady', sessionId: session.id, token: 1, thumbnailDataUrl: 'stale' });
    core.dispatch({ type: 'thumbnailReady', sessionId: session.id, token: 2, thumbnailDataUrl: 'fresh' });

    expect(core.getState().thumbnailsBySessionId[session.id]).toBe('fresh');
  });

  it('switches active sessions while carrying shared viewer state', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'sessionLoaded', session: second });

    core.dispatch({ type: 'viewStateCommitted', view: {
      zoom: 3,
      panX: 4,
      panY: 5,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    } });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({ type: 'lockedPixelToggled', pixel: { ix: 1, iy: 0 } });

    core.dispatch({ type: 'activeSessionSwitched', sessionId: first.id });

    expect(core.getState().sessionState).toMatchObject({
      zoom: 3,
      panX: 4,
      panY: 5,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 0 }
    });
  });

  it('inserts reordered sessions at explicit before and after boundaries', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');
    const third = createSession('third');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'sessionLoaded', session: second });
    core.dispatch({ type: 'sessionLoaded', session: third });

    core.dispatch({
      type: 'sessionsReordered',
      draggedSessionId: third.id,
      targetSessionId: second.id,
      placement: 'before'
    });
    expect(core.getState().sessions.map((session) => session.id)).toEqual([first.id, third.id, second.id]);

    core.dispatch({
      type: 'sessionsReordered',
      draggedSessionId: first.id,
      targetSessionId: third.id,
      placement: 'after'
    });
    expect(core.getState().sessions.map((session) => session.id)).toEqual([third.id, first.id, second.id]);
  });

  it('ignores stale luminance callbacks after the active selection changes', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'visualizationModeRequested', visualizationMode: 'colormap' });
    const previousSelection = core.getState().sessionState.displaySelection;

    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({
      type: 'displayLuminanceRangeResolved',
      requestId: 1,
      sessionId: session.id,
      activeLayer: 0,
      displaySelection: previousSelection,
      displayLuminanceRange: { min: 0, max: 1 }
    });

    expect(core.getState().sessionState.displaySelection).toEqual(createChannelMonoSelection('R'));
    expect(core.getState().sessionState.colormapRange).toBeNull();
  });

  it('restores the saved non-stokes visualization state when returning from stokes mode', () => {
    const core = new ViewerAppCore();
    const decoded = createDecodedImage(['R', 'G', 'B', 'S0', 'S1', 'S2', 'S3']);
    const session = createSession('session-1', decoded);
    core.dispatch({ type: 'sessionLoaded', session });
    const restoreState = {
      visualizationMode: core.getState().sessionState.visualizationMode,
      activeColormapId: core.getState().sessionState.activeColormapId,
      colormapRange: core.getState().sessionState.colormapRange,
      colormapRangeMode: core.getState().sessionState.colormapRangeMode,
      colormapZeroCentered: core.getState().sessionState.colormapZeroCentered
    };

    core.dispatch({
      type: 'colormapLoadResolved',
      requestId: null as never,
      colormapId: '1',
      lut: { id: '1', label: 'HSV', entryCount: 2, rgba8: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }
    });
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createStokesSelection('aolp'),
      restoreState
    });
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    });

    expect(core.getState().sessionState.visualizationMode).toBe('rgb');
    expect(core.getState().sessionState.activeColormapId).toBe('0');
  });

  it('resets all session state when every session closes', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'allSessionsClosed' });

    expect(core.getState().sessions).toEqual([]);
    expect(core.getState().activeSessionId).toBeNull();
    expect(core.getState().sessionState).toEqual(createInitialState());
  });
});
