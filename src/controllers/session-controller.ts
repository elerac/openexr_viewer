import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import { ViewerAppCore } from '../app/viewer-app-core';
import { buildLoadedSession, buildReloadedSession } from '../app/session-resource';
import { selectActiveSession } from '../app/viewer-app-selectors';
import { LoadQueueService } from '../services/load-queue';
import type { DecodedExrImage, OpenedImageDropPlacement, OpenedImageSession, SessionSource, ViewportInfo } from '../types';

const GALLERY_IMAGES = [
  {
    id: 'cbox-rgb',
    label: 'cbox_rgb.exr',
    filename: 'cbox_rgb.exr'
  }
] as const;

export interface SessionControllerDependencies {
  core: ViewerAppCore;
  loadQueue: LoadQueueService;
  decodeBytes: (bytes: Uint8Array) => Promise<DecodedExrImage>;
  getViewport: () => ViewportInfo;
}

export class SessionController implements Disposable {
  private readonly core: ViewerAppCore;
  private readonly loadQueue: LoadQueueService;
  private readonly decodeBytes: SessionControllerDependencies['decodeBytes'];
  private readonly getViewport: SessionControllerDependencies['getViewport'];

  private readonly abortController = new AbortController();
  private disposed = false;

  constructor(dependencies: SessionControllerDependencies) {
    this.core = dependencies.core;
    this.loadQueue = dependencies.loadQueue;
    this.decodeBytes = dependencies.decodeBytes;
    this.getViewport = dependencies.getViewport;
  }

  enqueueFiles(files: File[]): Promise<void> {
    if (this.disposed || files.length === 0) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async (signal) => {
      this.throwIfStopped(signal);
      this.core.dispatch({ type: 'loadingSet', loading: true });
      this.core.dispatch({ type: 'errorSet', message: null });
      try {
        for (const file of files) {
          await this.loadFile(file, signal);
        }
      } finally {
        this.core.dispatch({ type: 'loadingSet', loading: false });
      }
    }).catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
  }

  enqueueFolderFiles(files: File[]): Promise<void> {
    if (this.disposed || files.length === 0) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async (signal) => {
      this.throwIfStopped(signal);
      this.core.dispatch({ type: 'loadingSet', loading: true });
      this.core.dispatch({ type: 'errorSet', message: null });

      try {
        const exrFiles = files
          .filter((file) => isExrFilename(file.name))
          .sort((left, right) => getFolderFileSortKey(left).localeCompare(getFolderFileSortKey(right)));

        if (exrFiles.length === 0) {
          this.core.dispatch({
            type: 'errorSet',
            message: 'No OpenEXR files found in the selected folder.'
          });
          return;
        }

        for (const file of exrFiles) {
          await this.loadFile(file, signal);
        }
      } finally {
        this.core.dispatch({ type: 'loadingSet', loading: false });
      }
    }).catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
  }

  enqueueGalleryImage(galleryId: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async (signal) => {
      this.throwIfStopped(signal);
      this.core.dispatch({ type: 'loadingSet', loading: true });
      this.core.dispatch({ type: 'errorSet', message: null });
      try {
        await this.loadGalleryImage(galleryId, signal);
      } finally {
        this.core.dispatch({ type: 'loadingSet', loading: false });
      }
    }).catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
  }

  reloadSession(sessionId: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async (signal) => {
      this.throwIfStopped(signal);
      this.core.dispatch({ type: 'loadingSet', loading: true });
      this.core.dispatch({ type: 'errorSet', message: null });
      try {
        const error = await this.reloadSessionByIdInternal(sessionId, signal);
        if (error) {
          this.core.dispatch({ type: 'errorSet', message: `Reload failed: ${error}` });
        }
      } finally {
        this.core.dispatch({ type: 'loadingSet', loading: false });
      }
    }).catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
  }

  reloadAllSessions(): Promise<void> {
    if (this.disposed || this.getSessions().length === 0) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async (signal) => {
      this.throwIfStopped(signal);
      this.core.dispatch({ type: 'loadingSet', loading: true });
      this.core.dispatch({ type: 'errorSet', message: null });
      const failures: string[] = [];

      try {
        const reloadIds = this.getSessions().map((session) => session.id);
        for (const sessionId of reloadIds) {
          this.throwIfStopped(signal);
          const label = this.getSessions().find((session) => session.id === sessionId)?.displayName ?? sessionId;
          const error = await this.reloadSessionByIdInternal(sessionId, signal);
          if (error) {
            failures.push(`${label}: ${error}`);
          }
        }

        if (failures.length > 0) {
          const preview = failures.slice(0, 3).join(' | ');
          const suffix = failures.length > 3 ? ` (+${failures.length - 3} more)` : '';
          this.core.dispatch({
            type: 'errorSet',
            message: `Reload all finished with ${failures.length} failure(s): ${preview}${suffix}`
          });
        }
      } finally {
        this.core.dispatch({ type: 'loadingSet', loading: false });
      }
    }).catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
  }

  switchActiveSession(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'activeSessionSwitched',
      sessionId
    });
  }

  reorderSessions(
    draggedSessionId: string,
    targetSessionId: string,
    placement: OpenedImageDropPlacement
  ): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'sessionsReordered',
      draggedSessionId,
      targetSessionId,
      placement
    });
  }

  closeSession(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'sessionClosed',
      sessionId
    });
  }

  closeAllSessions(): void {
    if (this.disposed || this.getSessions().length === 0) {
      return;
    }

    this.core.dispatch({
      type: 'allSessionsClosed'
    });
  }

  resetActiveSessionState(): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'activeSessionReset',
      viewport: this.getViewport()
    });
  }

  getSessions(): OpenedImageSession[] {
    return this.core.getState().sessions;
  }

  getActiveSession(): OpenedImageSession | null {
    return selectActiveSession(this.core.getState());
  }

  getActiveSessionId(): string | null {
    return this.core.getState().activeSessionId;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Session controller has been disposed.'));
  }

  private async loadGalleryImage(galleryId: string, signal: AbortSignal): Promise<void> {
    this.throwIfStopped(signal);

    const galleryImage = GALLERY_IMAGES.find((item) => item.id === galleryId);
    if (!galleryImage) {
      this.core.dispatch({ type: 'errorSet', message: `Unknown gallery image: ${galleryId}` });
      return;
    }

    const galleryImageUrl = `${import.meta.env.BASE_URL}${galleryImage.filename}`;

    try {
      const response = await fetch(galleryImageUrl, { signal: this.abortController.signal });
      if (!response.ok) {
        throw new Error(`Failed to load ${galleryImageUrl} (${response.status})`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      this.throwIfStopped(signal);
      const decoded = await this.decodeBytes(bytes);
      this.throwIfStopped(signal);
      this.applyDecodedImage(decoded, galleryImage.filename, bytes.byteLength, {
        kind: 'url',
        url: galleryImageUrl
      });
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        this.core.dispatch({
          type: 'errorSet',
          message: error instanceof Error ? error.message : `Unknown error while loading ${galleryImage.label}`
        });
      }
    }
  }

  private async loadFile(file: File, signal: AbortSignal): Promise<void> {
    this.throwIfStopped(signal);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      this.throwIfStopped(signal);
      const decoded = await this.decodeBytes(bytes);
      this.throwIfStopped(signal);
      this.applyDecodedImage(decoded, file.name, file.size, {
        kind: 'file',
        file
      });
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        this.core.dispatch({
          type: 'errorSet',
          message: error instanceof Error ? `Load failed: ${error.message}` : 'Load failed.'
        });
      }
    }
  }

  private applyDecodedImage(
    decoded: DecodedExrImage,
    filename: string,
    fileSizeBytes: number | null,
    source: SessionSource
  ): void {
    const currentState = this.core.getState();
    const activeSession = selectActiveSession(currentState);
    const session = buildLoadedSession({
      sessionId: this.core.issueSessionId(),
      decoded,
      filename,
      fileSizeBytes,
      source,
      existingSessions: currentState.sessions,
      defaultColormapId: currentState.defaultColormapId,
      viewport: this.getViewport(),
      currentSessionState: currentState.sessionState,
      hasActiveSession: Boolean(activeSession),
      previousImage: activeSession?.decoded ?? null
    });

    this.core.dispatch({
      type: 'sessionLoaded',
      session
    });
  }

  private async reloadSessionByIdInternal(sessionId: string, signal: AbortSignal): Promise<string | null> {
    this.throwIfStopped(signal);

    const session = this.getSessions().find((current) => current.id === sessionId);
    if (!session) {
      return 'Session not found.';
    }

    try {
      const decoded = await decodeExrFromSessionSource(session.source, this.decodeBytes, this.abortController.signal);
      this.throwIfStopped(signal);
      const baseState = this.getActiveSessionId() === sessionId
        ? this.core.getState().sessionState
        : session.state;
      const reloadedSession = buildReloadedSession(session, decoded, baseState);
      this.core.dispatch({
        type: 'sessionReloaded',
        sessionId,
        session: reloadedSession
      });
      return null;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return error instanceof Error ? error.message : 'Unknown error.';
    }
  }

  private throwIfStopped(signal?: AbortSignal): void {
    if (this.disposed) {
      throw createAbortError('Session controller has been disposed.');
    }

    throwIfAborted(this.abortController.signal, 'Session controller has been disposed.');
    if (signal) {
      throwIfAborted(signal, 'Load queue has been disposed.');
    }
  }
}

async function decodeExrFromSessionSource(
  source: SessionSource,
  decodeBytes: (bytes: Uint8Array) => Promise<DecodedExrImage>,
  signal?: AbortSignal
): Promise<DecodedExrImage> {
  if (source.kind === 'url') {
    const response = await fetch(source.url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load ${source.url} (${response.status})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal) {
      throwIfAborted(signal, 'Session reload was aborted.');
    }
    return decodeBytes(bytes);
  }

  const bytes = new Uint8Array(await source.file.arrayBuffer());
  if (signal) {
    throwIfAborted(signal, 'Session reload was aborted.');
  }
  return decodeBytes(bytes);
}

function isExrFilename(filename: string): boolean {
  return /\.exr$/i.test(filename.trim());
}

function getFolderFileSortKey(file: File): string {
  const relativePath = file.webkitRelativePath.trim();
  return relativePath || file.name;
}
