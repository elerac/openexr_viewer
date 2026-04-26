import { describe, expect, it, vi } from 'vitest';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { createInteractionState } from '../src/view-state';
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
  it('toggles auto-fit selected images as application state', () => {
    const core = new ViewerAppCore();

    expect(core.getState().autoFitImageOnSelect).toBe(false);

    core.dispatch({ type: 'autoFitImageOnSelectSet', enabled: true });
    expect(core.getState().autoFitImageOnSelect).toBe(true);

    core.dispatch({ type: 'autoFitImageOnSelectSet', enabled: false });
    expect(core.getState().autoFitImageOnSelect).toBe(false);
  });

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

  it('fits the selected image on active session switches when auto-fit is enabled and a viewport is supplied', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'sessionLoaded', session: second });
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 4,
        panY: 5,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      }
    });
    core.dispatch({ type: 'autoFitImageOnSelectSet', enabled: true });

    core.dispatch({
      type: 'activeSessionSwitched',
      sessionId: first.id,
      viewport: { width: 20, height: 20 }
    });

    expect(core.getState().sessionState).toMatchObject({
      zoom: 10,
      panX: 1,
      panY: 0.5
    });
  });

  it('does not apply image auto-fit while switching sessions in panorama mode', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'sessionLoaded', session: second });
    core.dispatch({ type: 'autoFitImageOnSelectSet', enabled: true });
    core.dispatch({ type: 'viewerModeSet', viewerMode: 'panorama' });
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 4,
        panY: 5,
        panoramaYawDeg: 30,
        panoramaPitchDeg: 10,
        panoramaHfovDeg: 90
      }
    });

    core.dispatch({
      type: 'activeSessionSwitched',
      sessionId: first.id,
      viewport: { width: 20, height: 20 }
    });

    expect(core.getState().sessionState).toMatchObject({
      viewerMode: 'panorama',
      zoom: first.state.zoom,
      panX: first.state.panX,
      panY: first.state.panY,
      panoramaYawDeg: 30,
      panoramaPitchDeg: 10,
      panoramaHfovDeg: 90
    });
  });

  it('does not carry colormap state when session switching falls back to a different channel', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second', createDecodedImage(['R', 'G', 'B', 'mask']));
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'sessionLoaded', session: second });

    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('mask') });
    core.dispatch({ type: 'activeColormapSet', colormapId: '2' });
    core.dispatch({ type: 'colormapRangeSet', range: { min: 0.2, max: 0.8 } });
    core.dispatch({ type: 'visualizationModeRequested', visualizationMode: 'colormap' });

    core.dispatch({ type: 'activeSessionSwitched', sessionId: first.id });

    expect(core.getState().sessionState).toMatchObject({
      visualizationMode: 'rgb',
      activeColormapId: '0',
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
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

  it('keeps ROI on layer switches and carries the current ROI across session switches', () => {
    const core = new ViewerAppCore();
    const layeredDecoded: DecodedExrImage = {
      width: 2,
      height: 1,
      layers: [
        createLayerFromChannels({ R: [1, 0], G: [1, 0], B: [1, 0] }, 'beauty'),
        createLayerFromChannels({ R: [0, 1], G: [0, 1], B: [0, 1] }, 'alt')
      ]
    };
    const first = createSession('first', layeredDecoded);
    const second = createSession('second');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'roiSet', roi: { x0: 0, y0: 0, x1: 1, y1: 0 } });
    core.dispatch({ type: 'activeLayerSet', activeLayer: 1 });

    expect(core.getState().sessionState.roi).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });

    core.dispatch({ type: 'sessionLoaded', session: second });
    core.dispatch({ type: 'roiSet', roi: { x0: 1, y0: 0, x1: 1, y1: 0 } });
    core.dispatch({ type: 'activeSessionSwitched', sessionId: first.id });

    expect(core.getState().sessionState.roi).toEqual({ x0: 1, y0: 0, x1: 1, y1: 0 });

    core.dispatch({ type: 'activeSessionSwitched', sessionId: second.id });

    expect(core.getState().sessionState.roi).toEqual({ x0: 1, y0: 0, x1: 1, y1: 0 });
  });

  it('clears ROI on reset because reset rebuilds the active session state from defaults', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'roiSet', roi: { x0: 0, y0: 0, x1: 1, y1: 0 } });

    core.dispatch({
      type: 'activeSessionReset',
      viewport: { width: 640, height: 480 }
    });

    expect(core.getState().sessionState.roi).toBeNull();
  });

  it('routes hover-only interaction publishes through the render lane without broad UI churn', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    const stateListener = vi.fn();
    const uiListener = vi.fn();
    const renderListener = vi.fn();
    core.subscribeState(stateListener);
    core.subscribeUi(uiListener);
    core.subscribeRender(renderListener);

    core.dispatch({
      type: 'interactionStatePublished',
      interactionState: {
        ...createInteractionState(session.state),
        hoveredPixel: { ix: 1, iy: 0 }
      }
    });

    expect(stateListener).toHaveBeenCalledTimes(1);
    expect(uiListener).not.toHaveBeenCalled();
    expect(renderListener).toHaveBeenCalledTimes(1);
  });

  it('persists committed view state without notifying the UI or render lanes', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({
      type: 'interactionStatePublished',
      interactionState: {
        ...createInteractionState(session.state),
        view: {
          ...createInteractionState(session.state).view,
          zoom: 3,
          panX: 4,
          panY: 5
        }
      }
    });

    const stateListener = vi.fn();
    const uiListener = vi.fn();
    const renderListener = vi.fn();
    core.subscribeState(stateListener);
    core.subscribeUi(uiListener);
    core.subscribeRender(renderListener);

    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 4,
        panY: 5,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      }
    });

    expect(stateListener).toHaveBeenCalledTimes(1);
    expect(uiListener).not.toHaveBeenCalled();
    expect(renderListener).not.toHaveBeenCalled();
  });
});
