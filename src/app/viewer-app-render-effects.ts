import { WebGlExrRenderer } from '../renderer';
import { RenderCacheService } from '../services/render-cache-service';
import { buildDisplayLuminanceRevisionKey } from '../display-texture';
import { ViewerUi } from '../ui/viewer-ui';
import { ViewerAppCore } from './viewer-app-core';
import { ViewerRenderInvalidationFlags } from './viewer-app-render';
import { selectActiveDisplayLuminanceRange } from './viewer-app-selectors';
import type { ViewerRenderTransition } from './viewer-app-types';

export function applyRenderEffects(
  core: ViewerAppCore,
  ui: ViewerUi,
  renderer: WebGlExrRenderer,
  renderCache: RenderCacheService,
  transition: ViewerRenderTransition
): void {
  const { snapshot, invalidation, state } = transition;
  const activeSession = snapshot.activeSession;

  if ((invalidation & ViewerRenderInvalidationFlags.ColormapTexture) && snapshot.activeColormapLut) {
    renderer.setColormapTexture(snapshot.activeColormapLut.entryCount, snapshot.activeColormapLut.rgba8);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ProbeReadout) {
    ui.setProbeReadout(
      snapshot.probeReadout.mode,
      snapshot.probeReadout.sample,
      snapshot.probeReadout.colorPreview,
      snapshot.probeReadout.imageSize
    );
  }

  if (invalidation & ViewerRenderInvalidationFlags.RoiReadout) {
    ui.setRoiReadout(snapshot.roiReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ViewerStateReadout) {
    ui.setViewerStateReadout(snapshot.viewerStateReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ImageStatsReadout) {
    ui.setImageStats(snapshot.imageStatsReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ResourceClearImage) {
    renderer.clearImage();
  }

  if (invalidation & ViewerRenderInvalidationFlags.RenderRulerOverlay) {
    renderer.setRulersVisible(snapshot.rulersVisible);
  }

  if ((invalidation & ViewerRenderInvalidationFlags.ResourcePrepare) && activeSession) {
    renderCache.prepareActiveSession(activeSession, state.sessionState);
    synchronizeCachedDisplayRange(core, renderCache, activeSession.id, state.sessionState);
  }

  if (
    (invalidation & ViewerRenderInvalidationFlags.ResourceRequestDisplayRange) &&
    activeSession &&
    snapshot.displayRangeRequest
  ) {
    const requestId = core.issueRequestId();
    const result = renderCache.requestDisplayLuminanceRange(activeSession, snapshot.displayRangeRequest, requestId);
    if (result.pending) {
      core.dispatch({
        type: 'displayRangeRequestStarted',
        requestId,
        requestKey: snapshot.displayRangeRequest.requestKey
      });
    } else {
      core.dispatch({
        type: 'displayLuminanceRangeResolved',
        requestId,
        requestKey: snapshot.displayRangeRequest.requestKey,
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        displaySelection: state.sessionState.displaySelection,
        displayLuminanceRange: result.displayLuminanceRange
      });
    }
  }

  if (
    (invalidation & ViewerRenderInvalidationFlags.ResourceRequestImageStats) &&
    activeSession &&
    snapshot.imageStatsRequest
  ) {
    const requestId = core.issueRequestId();
    const result = renderCache.requestImageStats(activeSession, snapshot.imageStatsRequest, requestId);
    if (result.pending) {
      core.dispatch({
        type: 'imageStatsRequestStarted',
        requestId,
        requestKey: snapshot.imageStatsRequest.requestKey
      });
    } else {
      core.dispatch({
        type: 'imageStatsResolved',
        requestId: null,
        requestKey: snapshot.imageStatsRequest.requestKey,
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        visualizationMode: state.sessionState.visualizationMode,
        displaySelection: state.sessionState.displaySelection,
        imageStats: result.imageStats
      });
    }
  }

  if (
    (invalidation & ViewerRenderInvalidationFlags.ResourceRequestAutoExposure) &&
    activeSession &&
    snapshot.autoExposureRequest
  ) {
    const requestId = core.issueRequestId();
    const result = renderCache.requestAutoExposure(
      activeSession,
      snapshot.autoExposureRequest,
      requestId,
      snapshot.autoExposureRequest.percentile
    );
    if (result.pending) {
      core.dispatch({
        type: 'autoExposureRequestStarted',
        requestId,
        requestKey: snapshot.autoExposureRequest.requestKey
      });
    } else {
      core.dispatch({
        type: 'autoExposureResolved',
        requestId: null,
        requestKey: snapshot.autoExposureRequest.requestKey,
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        visualizationMode: state.sessionState.visualizationMode,
        displaySelection: state.sessionState.displaySelection,
        autoExposure: result.autoExposure
      });
    }
  }

  if (!activeSession) {
    if (invalidation & ViewerRenderInvalidationFlags.RenderRulerOverlay) {
      renderer.renderRulerOverlay(snapshot.renderState);
    }
    return;
  }

  if (invalidation & ViewerRenderInvalidationFlags.RenderImage) {
    renderer.renderImage(snapshot.renderState);
  }

  if (invalidation & ViewerRenderInvalidationFlags.RenderValueOverlay) {
    renderer.renderValueOverlay(snapshot.renderState);
  }

  if (invalidation & ViewerRenderInvalidationFlags.RenderProbeOverlay) {
    renderer.renderProbeOverlay(snapshot.renderState);
  }

  if (invalidation & ViewerRenderInvalidationFlags.RenderRulerOverlay) {
    renderer.renderRulerOverlay(snapshot.renderState);
  }
}

function synchronizeCachedDisplayRange(
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  sessionId: string,
  sessionState: ViewerRenderTransition['state']['sessionState']
): void {
  const cachedRange = renderCache.getCachedLuminanceRange(sessionId, sessionState);
  const activeRange = selectActiveDisplayLuminanceRange(core.getState());
  if (
    cachedRange?.min === activeRange?.min &&
    cachedRange?.max === activeRange?.max
  ) {
    return;
  }

  core.dispatch({
    type: 'displayLuminanceRangeResolved',
    requestId: null,
    requestKey: `${sessionId}:${buildDisplayLuminanceRevisionKey(sessionState)}`,
    sessionId,
    activeLayer: sessionState.activeLayer,
    displaySelection: sessionState.displaySelection,
    displayLuminanceRange: cachedRange
  });
}
