import { buildChannelViewItems } from '../channel-view-items';
import {
  serializeChannelThumbnailContextKey,
  serializeChannelThumbnailRequestKey
} from '../channel-thumbnail-keys';
import { samePixel, sameRoi, sameViewState } from '../view-state';
import { ViewerInteractionCoordinator } from '../interaction-coordinator';
import { ChannelThumbnailService } from '../services/channel-thumbnail-service';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import { ViewerAppCore } from './viewer-app-core';
import type { ViewerStateTransition } from './viewer-app-types';
import { selectActiveSession } from './viewer-app-selectors';

export function applySessionResourceEffects(
  transition: ViewerStateTransition,
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  thumbnailService: ThumbnailService
): void {
  switch (transition.intent.type) {
    case 'sessionLoaded': {
      renderCache.trackSession(transition.intent.session);
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.session.id, transition.intent.session.state);
      return;
    }
    case 'sessionReloaded': {
      renderCache.discard(transition.intent.sessionId);
      renderCache.trackSession(transition.intent.session);
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

export function applyChannelThumbnailEffects(
  transition: ViewerStateTransition,
  core: ViewerAppCore,
  channelThumbnailService: ChannelThumbnailService
): void {
  switch (transition.intent.type) {
    case 'sessionReloaded': {
      channelThumbnailService.discardSession(transition.intent.sessionId);
      if (transition.state.activeSessionId === transition.intent.sessionId) {
        scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
      }
      return;
    }
    case 'sessionClosed': {
      channelThumbnailService.discardSession(transition.intent.sessionId);
      if (transition.state.activeSessionId) {
        scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
      }
      return;
    }
    case 'allSessionsClosed': {
      channelThumbnailService.clear();
      return;
    }
    case 'sessionLoaded': {
      scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
      return;
    }
    default:
      break;
  }

  if (!shouldRefreshActiveChannelThumbnails(transition)) {
    return;
  }

  scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
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

function scheduleActiveChannelThumbnailGeneration(
  core: ViewerAppCore,
  channelThumbnailService: ChannelThumbnailService
): void {
  const state = core.getState();
  const activeSession = selectActiveSession(state);
  if (!activeSession) {
    return;
  }

  const layer = activeSession.decoded.layers[state.sessionState.activeLayer] ?? null;
  if (!layer) {
    return;
  }

  for (const item of buildChannelViewItems(layer.channelNames)) {
    const requestKey = serializeChannelThumbnailRequestKey({
      sessionId: activeSession.id,
      activeLayer: state.sessionState.activeLayer,
      selection: item.selection,
      exposureEv: state.sessionState.exposureEv,
      stokesDegreeModulation: state.sessionState.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: state.sessionState.stokesAolpDegreeModulationMode
    });
    if (
      Object.prototype.hasOwnProperty.call(state.channelThumbnailsByRequestKey, requestKey) ||
      Object.prototype.hasOwnProperty.call(state.pendingChannelThumbnailTokensByRequestKey, requestKey)
    ) {
      continue;
    }

    const token = core.issueRequestId();
    core.dispatch({
      type: 'channelThumbnailRequested',
      requestKey,
      token
    });
    void channelThumbnailService.enqueue({
      sessionId: activeSession.id,
      requestKey,
      contextKey: serializeChannelThumbnailContextKey(
        activeSession.id,
        state.sessionState.activeLayer,
        item.selectionKey
      ),
      token,
      stateSnapshot: state.sessionState,
      selection: item.selection
    }).catch(() => undefined);
  }
}

function shouldRefreshActiveChannelThumbnails(transition: ViewerStateTransition): boolean {
  if (!transition.state.activeSessionId) {
    return false;
  }

  return (
    transition.previousState.activeSessionId !== transition.state.activeSessionId ||
    transition.previousState.sessionState.activeLayer !== transition.state.sessionState.activeLayer ||
    transition.previousState.sessionState.exposureEv !== transition.state.sessionState.exposureEv ||
    transition.previousState.sessionState.stokesDegreeModulation.aolp !== transition.state.sessionState.stokesDegreeModulation.aolp ||
    transition.previousState.sessionState.stokesDegreeModulation.cop !== transition.state.sessionState.stokesDegreeModulation.cop ||
    transition.previousState.sessionState.stokesDegreeModulation.top !== transition.state.sessionState.stokesDegreeModulation.top ||
    transition.previousState.sessionState.stokesAolpDegreeModulationMode !== transition.state.sessionState.stokesAolpDegreeModulationMode
  );
}
