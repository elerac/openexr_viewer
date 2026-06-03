import { describe, expect, it, vi } from 'vitest';
import { AUTO_EXPOSURE_PERCENTILE } from '../src/auto-exposure';
import { getSuccessValue } from '../src/async-resource';
import { createDefaultChannelRecognitionNameRules } from '../src/channel-recognition-name-rules';
import { createDefaultChannelRecognitionSettings } from '../src/channel-recognition-settings';
import { DEFAULT_DISPLAY_GAMMA } from '../src/color';
import { DEFAULT_DEPTH_ZOOM } from '../src/depth';
import { applyEmbedViewerStateSnapshot } from '../src/embed/embed-state';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { DEFAULT_PANORAMA_HFOV_DEG } from '../src/interaction/panorama-geometry';
import { createInteractionState } from '../src/view-state';
import { collectViewerPaneLeaves } from '../src/viewer-pane-layout';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';
import type { DecodedExrImage, ImageStats, OpenedImageSession } from '../src/types';

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

const rulerFitInsets = {
  top: 24,
  right: 0,
  bottom: 0,
  left: 24
};

function createImageStats(): ImageStats {
  return {
    width: 2,
    height: 1,
    pixelCount: 2,
    channels: [
      {
        label: 'R',
        min: 0,
        mean: 0.5,
        max: 1,
        validPixelCount: 2,
        nanPixelCount: 0,
        negativeInfinityPixelCount: 0,
        positiveInfinityPixelCount: 0
      }
    ]
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

  it('toggles image rulers as application state', () => {
    const core = new ViewerAppCore();

    expect(core.getState().rulersVisible).toBe(false);

    core.dispatch({ type: 'rulersVisibleSet', enabled: true });
    expect(core.getState().rulersVisible).toBe(true);

    core.dispatch({ type: 'rulersVisibleSet', enabled: false });
    expect(core.getState().rulersVisible).toBe(false);
  });

  it('sets locked pixels deterministically without toggling matching pixels off', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    core.dispatch({ type: 'lockedPixelSet', pixel: { ix: 1, iy: 0 } });
    expect(core.getState().sessionState.lockedPixel).toEqual({ ix: 1, iy: 0 });

    core.dispatch({ type: 'lockedPixelSet', pixel: { ix: 1, iy: 0 } });
    expect(core.getState().sessionState.lockedPixel).toEqual({ ix: 1, iy: 0 });

    core.dispatch({ type: 'lockedPixelSet', pixel: null });
    expect(core.getState().sessionState.lockedPixel).toBeNull();
  });

  it('applies serialized depth settings and locked pixels deterministically', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession('session-1', createDecodedImage(['R', 'G', 'B', 'Z']))
    });

    const snapshot = {
      viewerMode: 'depth' as const,
      depthChannel: 'Z',
      depthFocalLengthPx: 960,
      depthPointSizePx: 2,
      lockedPixel: { ix: 1, iy: 0 },
      view: {
        depthYawDeg: -5.3,
        depthPitchDeg: 0.65,
        depthZoom: 2
      }
    };

    applyEmbedViewerStateSnapshot(core, snapshot);
    expect(core.getState().sessionState).toMatchObject({
      viewerMode: 'depth',
      depthChannel: 'Z',
      depthFocalLengthPx: 960,
      depthPointSizePx: 2,
      lockedPixel: { ix: 1, iy: 0 },
      depthYawDeg: -5.3,
      depthPitchDeg: 0.65,
      depthZoom: 2
    });

    applyEmbedViewerStateSnapshot(core, snapshot);
    expect(core.getState().sessionState.lockedPixel).toEqual({ ix: 1, iy: 0 });

    applyEmbedViewerStateSnapshot(core, { lockedPixel: null });
    expect(core.getState().sessionState.lockedPixel).toBeNull();
  });

  it('applies channel recognition settings and falls back from disabled candidates', () => {
    const core = new ViewerAppCore();
    core.dispatch({ type: 'sessionLoaded', session: createSession('session-1', createDecodedImage(['R', 'G', 'B', 'Y'])) });

    core.dispatch({
      type: 'channelRecognitionSettingsSet',
      settings: {
        ...createDefaultChannelRecognitionSettings(),
        'component.rgb': false
      }
    });

    expect(core.getState().channelRecognitionSettings['component.rgb']).toBe(false);
    expect(core.getState().sessionState.displaySelection).toEqual(createChannelMonoSelection('Y'));
  });

  it('uses depth recognition settings and name rules to maintain depth mode', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession('session-1', createDecodedImage(['R', 'G', 'B', 'Z', 'worldDepth']))
    });
    core.dispatch({ type: 'viewerModeSet', viewerMode: 'depth' });

    expect(core.getState().sessionState.viewerMode).toBe('depth');
    expect(core.getState().sessionState.depthChannel).toBe('Z');

    const customRules = createDefaultChannelRecognitionNameRules();
    customRules['depth.map'] = {
      pattern: '^(?<depth>worldDepth)$'
    };
    core.dispatch({ type: 'channelRecognitionNameRulesSet', rules: customRules });

    expect(core.getState().sessionState.viewerMode).toBe('depth');
    expect(core.getState().sessionState.depthChannel).toBe('worldDepth');

    core.dispatch({
      type: 'channelRecognitionSettingsSet',
      settings: {
        ...createDefaultChannelRecognitionSettings(),
        'depth.map': false
      }
    });

    expect(core.getState().sessionState.viewerMode).toBe('image');
    expect(core.getState().sessionState.depthChannel).toBeNull();
  });

  it('splits, activates, and resets viewer panes without changing view state', () => {
    const core = new ViewerAppCore();
    const initialView = {
      zoom: core.getState().sessionState.zoom,
      panX: core.getState().sessionState.panX,
      panY: core.getState().sessionState.panY,
      panoramaYawDeg: core.getState().sessionState.panoramaYawDeg,
      panoramaPitchDeg: core.getState().sessionState.panoramaPitchDeg,
      panoramaHfovDeg: core.getState().sessionState.panoramaHfovDeg
    };

    core.dispatch({ type: 'viewerPaneSplit', orientation: 'vertical' });
    expect(core.getState().viewerPaneLayout.activePanePath).toEqual([1]);

    core.dispatch({ type: 'viewerPaneSplit', orientation: 'horizontal' });
    expect(core.getState().viewerPaneLayout.activePanePath).toEqual([1, 1]);

    core.dispatch({ type: 'viewerPaneActivated', path: [0] });
    expect(core.getState().viewerPaneLayout.activePanePath).toEqual([0]);

    expect({
      zoom: core.getState().sessionState.zoom,
      panX: core.getState().sessionState.panX,
      panY: core.getState().sessionState.panY,
      panoramaYawDeg: core.getState().sessionState.panoramaYawDeg,
      panoramaPitchDeg: core.getState().sessionState.panoramaPitchDeg,
      panoramaHfovDeg: core.getState().sessionState.panoramaHfovDeg
    }).toEqual(initialView);

    core.dispatch({ type: 'viewerPaneReset' });
    expect(core.getState().viewerPaneLayout).toEqual({
      root: { type: 'leaf', sessionId: null },
      activePanePath: []
    });
  });

  it('toggles auto exposure and applies resolved exposure only while enabled in None mode', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    expect(core.getState().autoExposureEnabled).toBe(false);

    core.dispatch({ type: 'autoExposureSet', enabled: true });
    expect(core.getState().autoExposureEnabled).toBe(true);

    core.dispatch({
      type: 'autoExposureResolved',
      requestId: null,
      requestKey: `${session.id}:auto`,
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: core.getState().sessionState.displaySelection,
      autoExposure: {
        scalar: 4,
        exposureEv: -2,
        percentile: 99.5,
        source: 'rgbAbsMax'
      }
    });

    expect(core.getState().sessionState.exposureEv).toBe(-2);

    core.dispatch({ type: 'autoExposureSet', enabled: false });
    core.dispatch({
      type: 'autoExposureResolved',
      requestId: null,
      requestKey: `${session.id}:auto-disabled`,
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: core.getState().sessionState.displaySelection,
      autoExposure: {
        scalar: 8,
        exposureEv: -3,
        percentile: 99.5,
        source: 'rgbAbsMax'
      }
    });

    expect(core.getState().sessionState.exposureEv).toBe(-2);
  });

  it('stores auto exposure percentile and clears pending auto exposure requests when it changes', () => {
    const core = new ViewerAppCore();

    expect(core.getState().autoExposurePercentile).toBe(AUTO_EXPOSURE_PERCENTILE);

    core.dispatch({ type: 'autoExposureRequestStarted', requestId: 3, requestKey: 'session:old' });
    expect(core.getState().autoExposureResource).toMatchObject({
      status: 'pending',
      key: 'session:old',
      requestId: 3
    });

    core.dispatch({ type: 'autoExposurePercentileSet', percentile: 98.24 });

    expect(core.getState().autoExposurePercentile).toBe(98.2);
    expect(core.getState().autoExposureResource.status).toBe('idle');
  });

  it('applies preview auto exposure while keeping the exact request pending', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'autoExposureSet', enabled: true });

    const displaySelection = core.getState().sessionState.displaySelection;
    core.dispatch({ type: 'autoExposureRequestStarted', requestId: 3, requestKey: 'session-1:auto' });
    core.dispatch({
      type: 'autoExposurePreviewResolved',
      requestId: 3,
      requestKey: 'session-1:auto',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection,
      autoExposure: {
        scalar: 4,
        exposureEv: -2,
        percentile: 99.5,
        source: 'rgbAbsMax'
      }
    });

    expect(core.getState().sessionState.exposureEv).toBe(-2);
    expect(core.getState().autoExposureResource).toMatchObject({
      status: 'pending',
      key: 'session-1:auto',
      requestId: 3
    });

    core.dispatch({
      type: 'autoExposureResolved',
      requestId: 3,
      requestKey: 'session-1:auto',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection,
      autoExposure: {
        scalar: 8,
        exposureEv: -3,
        percentile: 99.5,
        source: 'rgbAbsMax'
      }
    });

    expect(core.getState().sessionState.exposureEv).toBe(-3);
    expect(core.getState().autoExposureResource).toMatchObject({
      status: 'success',
      key: 'session-1:auto'
    });
    expect(getSuccessValue(core.getState().autoExposureResource)).toMatchObject({
      scalar: 8,
      exposureEv: -3
    });
  });

  it('ignores stale preview auto exposure results', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'autoExposureSet', enabled: true });

    const displaySelection = core.getState().sessionState.displaySelection;
    core.dispatch({ type: 'autoExposureRequestStarted', requestId: 3, requestKey: 'session-1:auto' });
    core.dispatch({
      type: 'autoExposurePreviewResolved',
      requestId: 4,
      requestKey: 'session-1:auto',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection,
      autoExposure: {
        scalar: 4,
        exposureEv: -2,
        percentile: 99.5,
        source: 'rgbAbsMax'
      }
    });

    expect(core.getState().sessionState.exposureEv).toBe(0);
    expect(core.getState().autoExposureResource.status).toBe('pending');

    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({
      type: 'autoExposurePreviewResolved',
      requestId: 3,
      requestKey: 'session-1:auto',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection,
      autoExposure: {
        scalar: 8,
        exposureEv: -3,
        percentile: 99.5,
        source: 'rgbAbsMax'
      }
    });

    expect(core.getState().sessionState.exposureEv).toBe(0);
    expect(core.getState().autoExposureResource.status).toBe('idle');
  });

  it('applies matching image stats results and ignores stale stats callbacks', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    const initialSelection = core.getState().sessionState.displaySelection;
    const imageStats = createImageStats();

    core.dispatch({ type: 'imageStatsRequestStarted', requestId: 3, requestKey: 'session-1:stats' });
    core.dispatch({
      type: 'imageStatsResolved',
      requestId: 3,
      requestKey: 'session-1:stats',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: initialSelection,
      imageStats
    });

    expect(core.getState().imageStatsResource).toMatchObject({
      status: 'success',
      key: 'session-1:stats'
    });
    expect(getSuccessValue(core.getState().imageStatsResource)).toEqual(imageStats);

    core.dispatch({ type: 'imageStatsRequestStarted', requestId: 4, requestKey: 'session-1:stale' });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({
      type: 'imageStatsResolved',
      requestId: 4,
      requestKey: 'session-1:stale',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: initialSelection,
      imageStats
    });

    expect(core.getState().imageStatsResource.status).toBe('idle');
  });

  it('clears image stats context when the active session reloads or closes', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    const imageStats = createImageStats();
    core.dispatch({
      type: 'imageStatsResolved',
      requestId: null,
      requestKey: 'session-1:stats',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: core.getState().sessionState.displaySelection,
      imageStats
    });
    core.dispatch({ type: 'imageStatsRequestStarted', requestId: 5, requestKey: 'session-1:stats' });

    core.dispatch({ type: 'sessionReloaded', sessionId: session.id, session: createSession(session.id) });

    expect(core.getState().imageStatsResource.status).toBe('idle');

    core.dispatch({
      type: 'imageStatsResolved',
      requestId: null,
      requestKey: 'session-1:stats',
      sessionId: session.id,
      activeLayer: 0,
      visualizationMode: 'rgb',
      displaySelection: core.getState().sessionState.displaySelection,
      imageStats
    });
    core.dispatch({ type: 'imageStatsRequestStarted', requestId: 6, requestKey: 'session-1:stats' });

    core.dispatch({ type: 'sessionClosed', sessionId: session.id });

    expect(core.getState().imageStatsResource.status).toBe('idle');
  });

  it('renames a session display name without changing the original source identity', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    core.dispatch({
      type: 'sessionDisplayNameChanged',
      sessionId: session.id,
      displayName: '  Hero Plate.exr  '
    });

    const renamed = core.getState().sessions[0];
    expect(renamed).toMatchObject({
      id: session.id,
      filename: 'session-1.exr',
      displayName: 'Hero Plate.exr',
      displayNameIsCustom: true,
      source: { kind: 'url', url: '/session-1.exr' }
    });
  });

  it('ignores missing, blank, and unchanged session display-name updates', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    const previous = core.getState();
    core.dispatch({ type: 'sessionDisplayNameChanged', sessionId: 'missing', displayName: 'Other.exr' });
    expect(core.getState()).toBe(previous);

    core.dispatch({ type: 'sessionDisplayNameChanged', sessionId: session.id, displayName: '   ' });
    expect(core.getState()).toBe(previous);

    core.dispatch({ type: 'sessionDisplayNameChanged', sessionId: session.id, displayName: session.displayName });
    expect(core.getState()).toBe(previous);
  });

  it('updates thumbnail state from worker feedback and ignores stale tokens', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    core.dispatch({ type: 'thumbnailRequested', sessionId: session.id, token: 1 });
    core.dispatch({ type: 'thumbnailRequested', sessionId: session.id, token: 2 });
    core.dispatch({ type: 'thumbnailReady', sessionId: session.id, token: 1, thumbnailDataUrl: 'stale' });
    core.dispatch({ type: 'thumbnailReady', sessionId: session.id, token: 2, thumbnailDataUrl: 'fresh' });

    expect(core.getState().thumbnailsBySessionId[session.id]).toMatchObject({
      status: 'success',
      key: session.id,
      value: 'fresh'
    });
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

  it('clamps stale depth camera state on interaction publish, commit, and session switch', () => {
    const core = new ViewerAppCore();
    const first = createSession('first', createDecodedImage(['R', 'G', 'B', 'Z']));
    const second = createSession('second', createDecodedImage(['R', 'G', 'B', 'Z']));
    second.state = {
      ...second.state,
      depthYawDeg: 180,
      depthPitchDeg: -120,
      depthZoom: 100
    };

    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({
      type: 'interactionStatePublished',
      interactionState: {
        ...createInteractionState(core.getState().sessionState),
        view: {
          ...core.getState().interactionState.view,
          depthYawDeg: 180,
          depthPitchDeg: -120,
          depthZoom: 100
        }
      }
    });

    expect(core.getState().interactionState.view).toMatchObject({
      depthYawDeg: 89.9,
      depthPitchDeg: -89.9,
      depthZoom: 50
    });

    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        depthYawDeg: 180,
        depthPitchDeg: -120,
        depthZoom: 100
      }
    });

    expect(core.getState().sessionState).toMatchObject({
      depthYawDeg: 89.9,
      depthPitchDeg: -89.9,
      depthZoom: 50
    });

    core.dispatch({ type: 'sessionLoaded', session: second, activate: false });
    core.dispatch({ type: 'activeSessionSwitched', sessionId: second.id });

    expect(core.getState().sessionState).toMatchObject({
      depthYawDeg: 89.9,
      depthPitchDeg: -89.9,
      depthZoom: 50
    });
  });

  it('assigns selected images to the active split pane and switches when activating another pane', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');

    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'viewerPaneSplit', orientation: 'vertical' });
    core.dispatch({ type: 'sessionLoaded', session: second });

    expect(core.getState().activeSessionId).toBe(second.id);
    expect(collectViewerPaneLeaves(core.getState().viewerPaneLayout)).toEqual([
      { path: [0], sessionId: first.id, active: false },
      { path: [1], sessionId: second.id, active: true }
    ]);

    core.dispatch({ type: 'viewerPaneActivated', path: [0] });

    expect(core.getState().activeSessionId).toBe(first.id);
    expect(collectViewerPaneLeaves(core.getState().viewerPaneLayout)).toEqual([
      { path: [0], sessionId: first.id, active: true },
      { path: [1], sessionId: second.id, active: false }
    ]);
  });

  it('assigns dropped images to the target pane path', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');

    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'viewerPaneSplit', orientation: 'vertical' });
    core.dispatch({ type: 'sessionLoaded', session: second, activate: false });
    core.dispatch({ type: 'activeSessionSwitched', sessionId: second.id, panePath: [0] });

    expect(core.getState().activeSessionId).toBe(second.id);
    expect(collectViewerPaneLeaves(core.getState().viewerPaneLayout)).toEqual([
      { path: [0], sessionId: second.id, active: true },
      { path: [1], sessionId: first.id, active: false }
    ]);
  });

  it('assigns dragged opened images to inactive panes without activating them', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');

    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'viewerPaneSplit', orientation: 'vertical' });
    core.dispatch({ type: 'sessionLoaded', session: second, activate: false });
    core.dispatch({ type: 'viewerPaneSessionAssigned', sessionId: second.id, panePath: [0] });

    expect(core.getState().activeSessionId).toBe(first.id);
    expect(collectViewerPaneLeaves(core.getState().viewerPaneLayout)).toEqual([
      { path: [0], sessionId: second.id, active: false },
      { path: [1], sessionId: first.id, active: true }
    ]);
  });

  it('replaces closed pane assignments with the next active session fallback', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');

    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'viewerPaneSplit', orientation: 'vertical' });
    core.dispatch({ type: 'sessionLoaded', session: second });
    core.dispatch({ type: 'sessionClosed', sessionId: second.id });

    expect(core.getState().activeSessionId).toBe(first.id);
    expect(collectViewerPaneLeaves(core.getState().viewerPaneLayout)).toEqual([
      { path: [0], sessionId: first.id, active: false },
      { path: [1], sessionId: first.id, active: true }
    ]);
  });

  it('appends inactive loaded sessions without switching the active image', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'viewStateCommitted', view: {
      zoom: 3,
      panX: 4,
      panY: 5,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    } });

    core.dispatch({ type: 'sessionLoaded', session: second, activate: false });

    expect(core.getState().sessions.map((session) => session.id)).toEqual([first.id, second.id]);
    expect(core.getState().activeSessionId).toBe(first.id);
    expect(core.getState().sessionState).toMatchObject({
      zoom: 3,
      panX: 4,
      panY: 5
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

  it('fits selected images inside supplied insets when auto-fit is enabled', () => {
    const core = new ViewerAppCore();
    const first = createSession('first');
    const second = createSession('second');
    core.dispatch({ type: 'sessionLoaded', session: first });
    core.dispatch({ type: 'sessionLoaded', session: second });
    core.dispatch({ type: 'autoFitImageOnSelectSet', enabled: true });

    core.dispatch({
      type: 'activeSessionSwitched',
      sessionId: first.id,
      viewport: { width: 80, height: 80 },
      fitInsets: rulerFitInsets
    });

    expect(core.getState().sessionState.zoom).toBe(28);
    expect(core.getState().sessionState.panX).toBeCloseTo(4 / 7);
    expect(core.getState().sessionState.panY).toBeCloseTo(1 / 14);
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
      activeColormapId: null,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      colormapReversed: false,
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
    const requestKey = `${session.id}:range-old`;

    core.dispatch({ type: 'displayRangeRequestStarted', requestId: 1, requestKey });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({
      type: 'displayLuminanceRangeResolved',
      requestId: 1,
      requestKey,
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
      colormapExposureEv: core.getState().sessionState.colormapExposureEv,
      colormapGamma: core.getState().sessionState.colormapGamma,
      colormapRange: core.getState().sessionState.colormapRange,
      colormapRangeMode: core.getState().sessionState.colormapRangeMode,
      colormapZeroCentered: core.getState().sessionState.colormapZeroCentered,
      colormapReversed: true
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
    expect(core.getState().sessionState.activeColormapId).toBeNull();
    expect(core.getState().sessionState.colormapReversed).toBe(true);
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

  it('resets Display controls without changing channel selection or view state', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1', createDecodedImage());
    const currentView = {
      zoom: 3,
      panX: 20,
      panY: 30,
      panoramaYawDeg: 21,
      panoramaPitchDeg: -3,
      panoramaHfovDeg: 80,
      depthYawDeg: 12,
      depthPitchDeg: -4,
      depthZoom: 1.5
    };

    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'exposureSet', exposureEv: 2 });
    core.dispatch({ type: 'exposureCommitted' });
    core.dispatch({ type: 'displayGammaSet', displayGamma: 1.5 });
    core.dispatch({ type: 'displayGammaCommitted' });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({ type: 'activeColormapSet', colormapId: '2' });
    core.dispatch({ type: 'colormapExposureSet', exposureEv: 3 });
    core.dispatch({ type: 'colormapGammaSet', gamma: 1.8 });
    core.dispatch({ type: 'colormapRangeSet', range: { min: 0.25, max: 0.75 } });
    core.dispatch({ type: 'colormapZeroCenteredToggled' });
    core.dispatch({ type: 'colormapReverseToggled' });
    core.dispatch({ type: 'lockedPixelToggled', pixel: { ix: 1, iy: 0 } });
    core.dispatch({ type: 'roiSet', roi: { x0: 0, y0: 0, x1: 1, y1: 0 } });
    core.dispatch({ type: 'viewStateCommitted', view: currentView });
    core.dispatch({
      type: 'interactionStatePublished',
      interactionState: {
        ...createInteractionState(core.getState().sessionState),
        view: currentView,
        hoveredPixel: { ix: 1, iy: 0 }
      }
    });

    core.dispatch({ type: 'activeSessionDisplayReset' });

    expect(core.getState().sessionState).toMatchObject({
      ...currentView,
      exposureEv: 0,
      channelThumbnailExposureEv: 0,
      displayGamma: DEFAULT_DISPLAY_GAMMA,
      channelThumbnailDisplayGamma: DEFAULT_DISPLAY_GAMMA,
      visualizationMode: 'rgb',
      activeColormapId: null,
      colormapExposureEv: 0,
      colormapGamma: 1,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      colormapReversed: false,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 0 },
      roi: { x0: 0, y0: 0, x1: 1, y1: 0 }
    });
    expect(core.getState().interactionState.view).toEqual(currentView);
    expect(core.getState().interactionState.hoveredPixel).toEqual({ ix: 1, iy: 0 });
    expect(core.getState().sessions[0]?.state).toMatchObject({
      ...currentView,
      exposureEv: 0,
      activeColormapId: null,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 0 },
      roi: { x0: 0, y0: 0, x1: 1, y1: 0 }
    });
  });

  it('resets the active image to a fit view inside supplied insets', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });

    core.dispatch({
      type: 'activeSessionReset',
      viewport: { width: 80, height: 80 },
      fitInsets: rulerFitInsets
    });

    expect(core.getState().sessionState.zoom).toBe(28);
    expect(core.getState().sessionState.panX).toBeCloseTo(4 / 7);
    expect(core.getState().sessionState.panY).toBeCloseTo(1 / 14);
  });

  it('resets only view state to fitted and default camera values', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1', createDecodedImage());
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'exposureSet', exposureEv: 2 });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({ type: 'viewerModeSet', viewerMode: 'panorama' });
    core.dispatch({ type: 'roiSet', roi: { x0: 0, y0: 0, x1: 1, y1: 0 } });
    core.dispatch({ type: 'lockedPixelToggled', pixel: { ix: 1, iy: 0 } });
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 20,
        panY: 30,
        panoramaYawDeg: 15,
        panoramaPitchDeg: 5,
        panoramaHfovDeg: 80,
        depthYawDeg: 12,
        depthPitchDeg: -8,
        depthZoom: 3
      }
    });
    core.dispatch({
      type: 'interactionStatePublished',
      interactionState: {
        view: {
          ...core.getState().interactionState.view,
          zoom: 4,
          panX: 40,
          panY: 50
        },
        hoveredPixel: { ix: 1, iy: 0 },
        draftRoi: null,
        roiInteraction: core.getState().interactionState.roiInteraction
      }
    });

    core.dispatch({
      type: 'activeSessionViewReset',
      viewport: { width: 80, height: 80 },
      fitInsets: rulerFitInsets
    });

    expect(core.getState().sessionState).toMatchObject({
      viewerMode: 'panorama',
      zoom: 28,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: DEFAULT_DEPTH_ZOOM,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 0 },
      roi: { x0: 0, y0: 0, x1: 1, y1: 0 }
    });
    expect(core.getState().sessionState.panX).toBeCloseTo(4 / 7);
    expect(core.getState().sessionState.panY).toBeCloseTo(1 / 14);
    expect(core.getState().interactionState.view).toMatchObject({
      zoom: 28,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: DEFAULT_DEPTH_ZOOM
    });
    expect(core.getState().interactionState.view.panX).toBeCloseTo(4 / 7);
    expect(core.getState().interactionState.view.panY).toBeCloseTo(1 / 14);
    expect(core.getState().interactionState.hoveredPixel).toBeNull();
    expect(core.getState().sessions[0]?.state).toMatchObject({
      zoom: 28,
      panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
      exposureEv: 2
    });
    expect(core.getState().sessions[0]?.state.panX).toBeCloseTo(4 / 7);
    expect(core.getState().sessions[0]?.state.panY).toBeCloseTo(1 / 14);
  });

  it('ignores view state reset without an active image', () => {
    const core = new ViewerAppCore();
    const previous = core.getState();

    core.dispatch({
      type: 'activeSessionViewReset',
      viewport: { width: 80, height: 80 }
    });

    expect(core.getState()).toBe(previous);
  });

  it('fits the active image to the viewport while preserving non-view session state', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1', createDecodedImage());
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'exposureSet', exposureEv: 2 });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({ type: 'roiSet', roi: { x0: 0, y0: 0, x1: 1, y1: 0 } });
    core.dispatch({ type: 'lockedPixelToggled', pixel: { ix: 1, iy: 0 } });
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 20,
        panY: 30,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      }
    });

    core.dispatch({
      type: 'activeSessionFitToViewport',
      viewport: { width: 40, height: 40 }
    });

    expect(core.getState().sessionState).toMatchObject({
      zoom: 20,
      panX: 1,
      panY: 0.5,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      roi: { x0: 0, y0: 0, x1: 1, y1: 0 },
      lockedPixel: { ix: 1, iy: 0 }
    });
    expect(core.getState().interactionState.view).toMatchObject({
      zoom: 20,
      panX: 1,
      panY: 0.5
    });
    expect(core.getState().interactionState.hoveredPixel).toBeNull();
  });

  it('fits the active image inside supplied insets', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1', createDecodedImage());
    core.dispatch({ type: 'sessionLoaded', session });

    core.dispatch({
      type: 'activeSessionFitToViewport',
      viewport: { width: 80, height: 80 },
      fitInsets: rulerFitInsets
    });

    expect(core.getState().sessionState.zoom).toBe(28);
    expect(core.getState().sessionState.panX).toBeCloseTo(4 / 7);
    expect(core.getState().sessionState.panY).toBeCloseTo(1 / 14);
    expect(core.getState().interactionState.view.zoom).toBe(28);
    expect(core.getState().interactionState.view.panX).toBeCloseTo(4 / 7);
    expect(core.getState().interactionState.view.panY).toBeCloseTo(1 / 14);
  });

  it('applies edited viewer state with clamps while preserving non-view state', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1', createDecodedImage());
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'exposureSet', exposureEv: 2 });
    core.dispatch({ type: 'displaySelectionSet', displaySelection: createChannelMonoSelection('R') });
    core.dispatch({ type: 'roiSet', roi: { x0: 0, y0: 0, x1: 1, y1: 0 } });
    const stats = createImageStats();
    core.dispatch({
      type: 'imageStatsResolved',
      requestId: null,
      requestKey: `${session.id}:stats`,
      sessionId: session.id,
      activeLayer: core.getState().sessionState.activeLayer,
      visualizationMode: core.getState().sessionState.visualizationMode,
      displaySelection: core.getState().sessionState.displaySelection,
      imageStats: stats
    });
    core.dispatch({
      type: 'interactionStatePublished',
      interactionState: {
        view: {
          ...core.getState().interactionState.view,
          zoom: 3,
          panX: 20,
          panY: 30
        },
        hoveredPixel: { ix: 1, iy: 0 },
        draftRoi: null,
        roiInteraction: core.getState().interactionState.roiInteraction
      }
    });

    core.dispatch({
      type: 'viewerStateEdited',
      patch: {
        zoom: 999,
        panX: 12.25,
        panY: -4.5,
        panoramaYawDeg: 190,
        panoramaPitchDeg: -120,
        panoramaHfovDeg: 0
      }
    });

    expect(core.getState().sessionState).toMatchObject({
      zoom: 512,
      panX: 12.25,
      panY: -4.5,
      panoramaYawDeg: -170,
      panoramaPitchDeg: -90,
      panoramaHfovDeg: 1,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      roi: { x0: 0, y0: 0, x1: 1, y1: 0 }
    });
    expect(core.getState().interactionState.view).toMatchObject({
      zoom: 512,
      panX: 12.25,
      panY: -4.5,
      panoramaYawDeg: -170,
      panoramaPitchDeg: -90,
      panoramaHfovDeg: 1
    });
    expect(core.getState().interactionState.hoveredPixel).toBeNull();
    expect(getSuccessValue(core.getState().imageStatsResource)).toBe(stats);
    expect(core.getState().sessions[0]?.state.zoom).toBe(512);
  });

  it('ignores invalid edited viewer state values and no-ops without an active image', () => {
    const core = new ViewerAppCore();
    const previous = core.getState();
    core.dispatch({ type: 'viewerStateEdited', patch: { zoom: 2 } });
    expect(core.getState()).toBe(previous);

    const session = createSession('session-1', createDecodedImage());
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({
      type: 'viewerStateEdited',
      patch: {
        zoom: Number.NaN,
        panX: 7
      }
    });

    expect(core.getState().sessionState.zoom).toBe(session.state.zoom);
    expect(core.getState().sessionState.panX).toBe(7);
  });

  it('does not fit the active image while in panorama mode', () => {
    const core = new ViewerAppCore();
    const session = createSession('session-1');
    core.dispatch({ type: 'sessionLoaded', session });
    core.dispatch({ type: 'viewerModeSet', viewerMode: 'panorama' });
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 20,
        panY: 30,
        panoramaYawDeg: 15,
        panoramaPitchDeg: 5,
        panoramaHfovDeg: 80
      }
    });

    core.dispatch({
      type: 'activeSessionFitToViewport',
      viewport: { width: 40, height: 40 }
    });

    expect(core.getState().sessionState).toMatchObject({
      viewerMode: 'panorama',
      zoom: 3,
      panX: 20,
      panY: 30,
      panoramaYawDeg: 15,
      panoramaPitchDeg: 5,
      panoramaHfovDeg: 80
    });
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
