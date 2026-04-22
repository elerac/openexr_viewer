import { samePixel, sameRoi, sameViewState } from '../view-state';
import { ViewerInteractionCoordinator } from '../interaction-coordinator';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import { ViewerAppCore } from './viewer-app-core';
import type { ViewerStateTransition } from './viewer-app-types';

export function applySessionResourceEffects(
  transition: ViewerStateTransition,
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  thumbnailService: ThumbnailService
): void {
  switch (transition.intent.type) {
    case 'sessionLoaded': {
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.session.id, transition.intent.session.state);
      return;
    }
    case 'sessionReloaded': {
      renderCache.discard(transition.intent.sessionId);
      thumbnailService.discard(transition.intent.sessionId);
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.sessionId, transition.intent.session.state);
      return;
    }
    case 'sessionClosed': {
      renderCache.discard(transition.intent.sessionId);
      thumbnailService.discard(transition.intent.sessionId);
      return;
    }
    case 'allSessionsClosed': {
      renderCache.clear();
      thumbnailService.clear();
      return;
    }
    default:
      return;
  }
}

export function syncInteractionCoordinator(
  interactionCoordinator: ViewerInteractionCoordinator,
  transition: ViewerStateTransition
): void {
  const coordinatorState = interactionCoordinator.getState();
  const nextInteractionState = transition.state.interactionState;
  if (
    sameViewState(coordinatorState.view, nextInteractionState.view) &&
    samePixel(coordinatorState.hoveredPixel, nextInteractionState.hoveredPixel) &&
    sameRoi(coordinatorState.draftRoi, nextInteractionState.draftRoi)
  ) {
    return;
  }

  interactionCoordinator.syncSessionState(transition.state.sessionState, {
    clearHover: nextInteractionState.hoveredPixel === null
  });
}

function scheduleThumbnailGeneration(
  core: ViewerAppCore,
  thumbnailService: ThumbnailService,
  sessionId: string,
  stateSnapshot: ViewerStateTransition['state']['sessionState']
): void {
  const token = core.issueRequestId();
  core.dispatch({
    type: 'thumbnailRequested',
    sessionId,
    token
  });
  void thumbnailService.enqueue(sessionId, stateSnapshot, token).catch(() => undefined);
}
