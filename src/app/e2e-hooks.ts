import type { ViewerAppState } from './viewer-app-types';
import type { ViewerAppCore } from './viewer-app-core';

interface E2EStateSnapshot {
  appReady: boolean;
  activeSessionId: string | null;
  errorMessage: string | null;
  isLoading: boolean;
  pendingOpenedImageCount: number;
  selectionTransitionPending: boolean;
  sessionCount: number;
  thumbnailPendingCount: number;
  viewerMode: ViewerAppState['sessionState']['viewerMode'];
}

interface E2EHooks {
  snapshot(): E2EStateSnapshot;
  waitForAppReady(timeoutMs?: number): Promise<E2EStateSnapshot>;
  waitForLoadingIdle(timeoutMs?: number): Promise<E2EStateSnapshot>;
  waitForRenderIdle(timeoutMs?: number): Promise<E2EStateSnapshot>;
  waitForSessionCount(count: number, timeoutMs?: number): Promise<E2EStateSnapshot>;
  waitForThumbnailIdle(timeoutMs?: number): Promise<E2EStateSnapshot>;
  waitForFrames(count?: number): Promise<void>;
}

declare global {
  interface Window {
    __openExrViewerE2E?: E2EHooks;
  }
}

type SnapshotPredicate = (snapshot: E2EStateSnapshot) => boolean;
type E2EWaiter = {
  predicate: SnapshotPredicate;
  resolve: (snapshot: E2EStateSnapshot) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

const DEFAULT_TIMEOUT_MS = 30000;

export function installE2EHooks(core: ViewerAppCore): () => void {
  if (import.meta.env.VITE_E2E !== 'true') {
    return () => {};
  }

  let appReady = true;
  const waiters = new Set<E2EWaiter>();

  const snapshot = (): E2EStateSnapshot => createSnapshot(core.getState(), appReady);
  const notify = () => {
    const currentSnapshot = snapshot();
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(currentSnapshot)) {
        continue;
      }

      window.clearTimeout(waiter.timeoutId);
      waiters.delete(waiter);
      waiter.resolve(currentSnapshot);
    }
  };

  const waitFor = (predicate: SnapshotPredicate, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<E2EStateSnapshot> => {
    const currentSnapshot = snapshot();
    if (predicate(currentSnapshot)) {
      return Promise.resolve(currentSnapshot);
    }

    return new Promise((resolve, reject) => {
      const waiter: E2EWaiter = {
        predicate,
        resolve,
        reject,
        timeoutId: 0
      };
      waiter.timeoutId = window.setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`Timed out waiting for Prismifold E2E state: ${JSON.stringify(snapshot())}`));
      }, timeoutMs);
      waiters.add(waiter);
    });
  };

  const unsubscribe = core.subscribeState(() => notify());

  window.__openExrViewerE2E = {
    snapshot,
    waitForAppReady: (timeoutMs) => waitFor((state) => state.appReady, timeoutMs),
    waitForLoadingIdle: (timeoutMs) => waitFor((state) => !state.isLoading && state.pendingOpenedImageCount === 0, timeoutMs),
    waitForRenderIdle: async (timeoutMs) => {
      const state = await waitFor((snapshotState) => (
        snapshotState.appReady &&
        !snapshotState.isLoading &&
        snapshotState.pendingOpenedImageCount === 0 &&
        !snapshotState.selectionTransitionPending
      ), timeoutMs);
      await waitForFrames(2);
      return state;
    },
    waitForSessionCount: (count, timeoutMs) => waitFor((state) => (
      state.sessionCount >= count &&
      !state.isLoading &&
      state.pendingOpenedImageCount === 0
    ), timeoutMs),
    waitForThumbnailIdle: async (timeoutMs) => {
      const state = await waitFor((snapshotState) => (
        snapshotState.thumbnailPendingCount === 0 &&
        !snapshotState.isLoading &&
        snapshotState.pendingOpenedImageCount === 0
      ), timeoutMs);
      await waitForFrames(2);
      return state;
    },
    waitForFrames
  };
  notify();

  return () => {
    appReady = false;
    unsubscribe();
    for (const waiter of waiters) {
      window.clearTimeout(waiter.timeoutId);
      waiter.reject(new Error('Prismifold E2E hooks were disposed.'));
    }
    waiters.clear();
    if (window.__openExrViewerE2E?.snapshot === snapshot) {
      delete window.__openExrViewerE2E;
    }
  };
}

function createSnapshot(state: ViewerAppState, appReady: boolean): E2EStateSnapshot {
  return {
    appReady,
    activeSessionId: state.activeSessionId,
    errorMessage: state.errorMessage,
    isLoading: state.isLoading,
    pendingOpenedImageCount: state.pendingOpenedImages.length,
    selectionTransitionPending: state.pendingSelectionTransitionRequestId !== null,
    sessionCount: state.sessions.length,
    thumbnailPendingCount: countPendingThumbnails(state),
    viewerMode: state.sessionState.viewerMode
  };
}

function countPendingThumbnails(state: ViewerAppState): number {
  return [
    ...Object.values(state.thumbnailsBySessionId),
    ...Object.values(state.channelThumbnailsByRequestKey)
  ].filter((resource) => resource.status === 'pending' || resource.status === 'stale').length;
}

async function waitForFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}
