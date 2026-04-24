import { WebGlExrRenderer } from '../renderer';
import { RenderCacheService } from '../services/render-cache-service';
import { ViewerUi } from '../ui/viewer-ui';
import { ViewerAppCore } from './viewer-app-core';
import { ViewerRenderInvalidationFlags } from './viewer-app-render';
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

  if (invalidation & ViewerRenderInvalidationFlags.ResourceClearImage) {
    renderer.clearImage();
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
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        displaySelection: state.sessionState.displaySelection,
        displayLuminanceRange: result.displayLuminanceRange
      });
    }
  }

  if (!activeSession) {
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
}

function synchronizeCachedDisplayRange(
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  sessionId: string,
  sessionState: ViewerRenderTransition['state']['sessionState']
): void {
  const cachedRange = renderCache.getCachedLuminanceRange(sessionId, sessionState);
  if (
    cachedRange?.min === core.getState().activeDisplayLuminanceRange?.min &&
    cachedRange?.max === core.getState().activeDisplayLuminanceRange?.max
  ) {
    return;
  }

  core.dispatch({
    type: 'displayLuminanceRangeResolved',
    requestId: null,
    sessionId,
    activeLayer: sessionState.activeLayer,
    displaySelection: sessionState.displaySelection,
    displayLuminanceRange: cachedRange
  });
}
