import type { AppHandle } from '../app/bootstrap';
import type { ViewerBootstrapParams } from './embed-params';
import type { EmbedViewerStateSnapshot } from './embed-state';
import {
  EMBED_READY_MESSAGE,
  LOCAL_HANDOFF_READY_MESSAGE,
  deleteExpiredLocalFileHandoffs,
  isEmbedLoadFileMessage,
  isLocalFileHandoffFileMessage,
  loadStoredLocalFileHandoff,
  postEmbedDeferredLoad,
  storeLocalFileHandoff
} from './local-file-handoff';
import type { ViewerSessionState } from '../types';

export function registerEmbedMessageBridge(app: AppHandle): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window.parent || !isEmbedLoadFileMessage(event.data)) {
      return;
    }
    void app.loadFile(event.data.file, {
      name: event.data.name,
      state: event.data.state ?? null
    });
  };

  window.addEventListener('message', onMessage);
  if (window.parent !== window) {
    window.parent.postMessage({ type: EMBED_READY_MESSAGE }, '*');
  }
  return () => window.removeEventListener('message', onMessage);
}

export function initializeFullViewerHandoffReceiver(
  handoffId: string | null,
  app: AppHandle,
  fallbackState: EmbedViewerStateSnapshot | null
): () => void {
  if (!handoffId) {
    return () => {};
  }

  let handled = false;
  const expectedSource = window.opener ?? null;
  void deleteExpiredLocalFileHandoffs().catch(() => undefined);
  void loadStoredLocalFileHandoff(handoffId).then((stored) => {
    if (!stored || handled) {
      return;
    }
    handled = true;
    void app.loadFile(stored.file, {
      name: stored.name,
      state: stored.state ?? fallbackState
    });
  }).catch(() => undefined);

  const onMessage = (event: MessageEvent): void => {
    if (expectedSource && event.source !== expectedSource) {
      return;
    }
    if (event.origin !== window.location.origin || !isLocalFileHandoffFileMessage(event.data)) {
      return;
    }
    if (event.data.id !== handoffId || handled) {
      return;
    }

    handled = true;
    void storeLocalFileHandoff(
      event.data.id,
      event.data.file,
      event.data.state ?? fallbackState,
      event.data.name
    ).catch(() => undefined);
    void app.loadFile(event.data.file, {
      name: event.data.name,
      state: event.data.state ?? fallbackState
    });
  };

  window.addEventListener('message', onMessage);
  window.opener?.postMessage({
    type: LOCAL_HANDOFF_READY_MESSAGE,
    id: handoffId
  }, window.location.origin);

  return () => window.removeEventListener('message', onMessage);
}

export function runInitialBootstrapLoad(params: ViewerBootstrapParams, app: AppHandle): void {
  const state = mergeViewParam(params.state, params.view);
  if (params.handoffId) {
    return;
  }
  if (params.src) {
    const src = params.src;
    const loadSource = () => app.loadUrl(src, {
      name: params.name ?? undefined,
      state
    });
    if (params.uiMode === 'embed' && !params.autoLoad) {
      app.deferInitialLoad(loadSource);
      return;
    }
    void loadSource();
    return;
  }
  app.applyState(state);
  if (params.uiMode === 'embed' && !params.autoLoad) {
    app.deferInitialLoad(() => {
      postEmbedDeferredLoad();
    });
  }
}

function mergeViewParam(
  state: EmbedViewerStateSnapshot | null,
  view: ViewerSessionState['viewerMode'] | null
): EmbedViewerStateSnapshot | null {
  if (!view) {
    return state;
  }
  return {
    ...(state ?? {}),
    viewerMode: state?.viewerMode ?? view
  };
}
