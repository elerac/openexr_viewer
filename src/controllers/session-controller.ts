import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import { ViewerAppCore } from '../app/viewer-app-core';
import { buildLoadedSession, buildReloadedSession } from '../app/session-resource';
import { selectActiveSession } from '../app/viewer-app-selectors';
import { LoadQueueService, type LoadQueueOptions } from '../services/load-queue';
import type { DecodeBytesOptions } from '../exr-decode-context';
import {
  DEFAULT_FOLDER_LOAD_LIMITS,
  createFolderLoadAdmission,
  formatByteCount,
  getFolderExrFiles,
  getFolderLoadStats
} from '../folder-load-limits';
import type {
  DecodedExrImage,
  OpenedImageDropPlacement,
  OpenedImageSession,
  SessionSource,
  ViewportInfo,
  ViewportInsets
} from '../types';

const GALLERY_IMAGES = [
  {
    id: 'cbox-rgb',
    label: 'cbox_rgb.exr',
    filename: 'cbox_rgb.exr'
  }
] as const;

const LOAD_CATEGORY_OPEN_FILES = 'open-files';
const LOAD_CATEGORY_FOLDER = 'folder';
const LOAD_CATEGORY_GALLERY = 'gallery';
const LOAD_CATEGORY_RELOAD_SESSION = 'reload-session';
const LOAD_CATEGORY_RELOAD_ALL = 'reload-all';

export interface FolderLoadOptions {
  overrideLimits?: boolean;
}

export interface SessionControllerDependencies {
  core: ViewerAppCore;
  loadQueue: LoadQueueService;
  decodeBytes: (bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>;
  getViewport: () => ViewportInfo;
  getFitInsets: () => ViewportInsets | undefined;
}

export class SessionController implements Disposable {
  private readonly core: ViewerAppCore;
  private readonly loadQueue: LoadQueueService;
  private readonly decodeBytes: SessionControllerDependencies['decodeBytes'];
  private readonly getViewport: SessionControllerDependencies['getViewport'];
  private readonly getFitInsets: SessionControllerDependencies['getFitInsets'];

  private readonly abortController = new AbortController();
  private queuedLoadCount = 0;
  private nextLoadGroupId = 1;
  private disposed = false;

  constructor(dependencies: SessionControllerDependencies) {
    this.core = dependencies.core;
    this.loadQueue = dependencies.loadQueue;
    this.decodeBytes = dependencies.decodeBytes;
    this.getViewport = dependencies.getViewport;
    this.getFitInsets = dependencies.getFitInsets;
  }

  enqueueFiles(files: File[]): Promise<void> {
    if (this.disposed || files.length === 0) {
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.enqueueLoadTask(async (signal) => {
      this.throwIfStopped(signal);
      for (const file of files) {
        await this.loadFile(file, signal);
      }
    }, {
      priority: 'foreground',
      category: LOAD_CATEGORY_OPEN_FILES
    });
  }

  enqueueFolderFiles(files: File[], options: FolderLoadOptions = {}): Promise<void> {
    if (this.disposed || files.length === 0) {
      return Promise.resolve();
    }

    const exrFiles = getFolderExrFiles(files);
    if (exrFiles.length === 0) {
      this.core.dispatch({
        type: 'errorSet',
        message: 'No OpenEXR files found in the selected folder.'
      });
      return Promise.resolve();
    }

    const admission = createFolderLoadAdmission(getFolderLoadStats(exrFiles), DEFAULT_FOLDER_LOAD_LIMITS);
    if (admission.exceeded && !options.overrideLimits) {
      this.core.dispatch({
        type: 'errorSet',
        message: formatFolderLimitMessage(admission.reasons)
      });
      return Promise.resolve();
    }

    const groupId = this.takeLoadGroupId('folder');
    return this.enqueueLoadTask(async (signal) => {
      this.throwIfStopped(signal);
      for (const file of exrFiles) {
        await this.loadFile(file, signal);
      }
    }, {
      priority: 'background',
      category: LOAD_CATEGORY_FOLDER,
      groupId
    });
  }

  enqueueGalleryImage(galleryId: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.enqueueLoadTask(async (signal) => {
      this.throwIfStopped(signal);
      await this.loadGalleryImage(galleryId, signal);
    }, {
      priority: 'foreground',
      category: LOAD_CATEGORY_GALLERY
    });
  }

  reloadSession(sessionId: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.enqueueLoadTask(async (signal) => {
      this.throwIfStopped(signal);
      const error = await this.reloadSessionByIdInternal(sessionId, signal);
      if (error) {
        this.core.dispatch({ type: 'errorSet', message: `Reload failed: ${error}` });
      }
    }, {
      priority: 'foreground',
      category: LOAD_CATEGORY_RELOAD_SESSION,
      sessionId
    });
  }

  reloadAllSessions(): Promise<void> {
    if (this.disposed || this.getSessions().length === 0) {
      return Promise.resolve();
    }

    const groupId = this.takeLoadGroupId('reload-all');
    const failures: string[] = [];
    const reloadTargets = this.getSessions().map((session) => ({
      id: session.id,
      label: session.displayName
    }));
    const promises = reloadTargets.map((target, index) => {
      return this.enqueueLoadTask(async (signal) => {
        this.throwIfStopped(signal);
        const currentSession = this.getSessions().find((session) => session.id === target.id);
        if (!currentSession) {
          return;
        }

        const error = await this.reloadSessionByIdInternal(target.id, signal);
        if (error) {
          failures.push(`${target.label}: ${error}`);
        }
      }, {
        priority: 'background',
        category: LOAD_CATEGORY_RELOAD_ALL,
        sessionId: target.id,
        groupId
      }, index === 0);
    });

    return Promise.all(promises).then(() => {
      if (this.disposed || this.getSessions().length === 0 || failures.length === 0) {
        return;
      }

      const preview = failures.slice(0, 3).join(' | ');
      const suffix = failures.length > 3 ? ` (+${failures.length - 3} more)` : '';
      this.core.dispatch({
        type: 'errorSet',
        message: `Reload all finished with ${failures.length} failure(s): ${preview}${suffix}`
      });
    });
  }

  switchActiveSession(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.loadQueue.promoteWhere((entry) => {
      return entry.category === LOAD_CATEGORY_RELOAD_ALL && entry.sessionId === sessionId;
    });
    const state = this.core.getState();
    this.core.dispatch({
      type: 'activeSessionSwitched',
      sessionId,
      viewport: state.autoFitImageOnSelect ? this.getViewport() : undefined,
      fitInsets: state.autoFitImageOnSelect ? this.getFitInsets() : undefined
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

  renameSessionDisplayName(sessionId: string, displayName: string): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'sessionDisplayNameChanged',
      sessionId,
      displayName
    });
  }

  closeSession(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.loadQueue.cancelWhere((entry) => {
      return (
        entry.sessionId === sessionId &&
        (entry.category === LOAD_CATEGORY_RELOAD_SESSION || entry.category === LOAD_CATEGORY_RELOAD_ALL)
      );
    }, 'Session load was cancelled.');
    this.core.dispatch({
      type: 'sessionClosed',
      sessionId
    });
  }

  closeAllSessions(): void {
    if (this.disposed) {
      return;
    }

    this.loadQueue.cancelAll('All session loads were cancelled.');
    if (this.getSessions().length === 0) {
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
      viewport: this.getViewport(),
      fitInsets: this.getFitInsets()
    });
  }

  fitActiveSessionToViewport(): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'activeSessionFitToViewport',
      viewport: this.getViewport(),
      fitInsets: this.getFitInsets()
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
    this.loadQueue.cancelAll('Session controller has been disposed.');
  }

  private enqueueLoadTask(
    task: (signal: AbortSignal) => Promise<void>,
    options: LoadQueueOptions,
    clearError = true
  ): Promise<void> {
    this.beginQueuedLoad(clearError);
    return this.loadQueue.enqueue(task, options).catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    }).finally(() => {
      this.finishQueuedLoad();
    });
  }

  private beginQueuedLoad(clearError: boolean): void {
    this.queuedLoadCount += 1;
    if (this.queuedLoadCount === 1) {
      this.core.dispatch({ type: 'loadingSet', loading: true });
    }
    if (clearError) {
      this.core.dispatch({ type: 'errorSet', message: null });
    }
  }

  private finishQueuedLoad(): void {
    this.queuedLoadCount = Math.max(0, this.queuedLoadCount - 1);
    if (this.queuedLoadCount === 0) {
      this.core.dispatch({ type: 'loadingSet', loading: false });
    }
  }

  private cancelBackgroundLoads(message: string): void {
    this.loadQueue.cancelWhere((entry) => entry.priority === 'background', message);
  }

  private takeLoadGroupId(prefix: string): string {
    const id = `${prefix}-${this.nextLoadGroupId}`;
    this.nextLoadGroupId += 1;
    return id;
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
      const response = await fetch(galleryImageUrl, { signal });
      if (!response.ok) {
        throw new Error(`Failed to load ${galleryImageUrl} (${response.status})`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      this.throwIfStopped(signal);
      const decoded = await this.decodeBytes(bytes, {
        signal,
        filename: galleryImage.filename
      });
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
      const decoded = await this.decodeBytes(bytes, {
        signal,
        filename: getFileDecodeName(file)
      });
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
      fitInsets: this.getFitInsets(),
      currentSessionState: currentState.sessionState,
      hasActiveSession: Boolean(activeSession),
      previousImage: activeSession?.decoded ?? null,
      autoFitImageOnSelect: currentState.autoFitImageOnSelect
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
      const decoded = await decodeExrFromSessionSource(session.source, session.filename, this.decodeBytes, signal);
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
      const currentState = this.core.getState();
      if (currentState.autoFitImageOnSelect && currentState.activeSessionId === sessionId) {
        this.fitActiveSessionToViewport();
      }
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
  filename: string,
  decodeBytes: (bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>,
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
    return decodeBytes(bytes, { signal, filename });
  }

  const bytes = new Uint8Array(await source.file.arrayBuffer());
  if (signal) {
    throwIfAborted(signal, 'Session reload was aborted.');
  }
  return decodeBytes(bytes, {
    signal,
    filename: getFileDecodeName(source.file) || filename
  });
}

function getFileDecodeName(file: File): string {
  const relativePath = file.webkitRelativePath.trim();
  return relativePath || file.name;
}

function formatFolderLimitMessage(reasons: string[]): string {
  const limits = DEFAULT_FOLDER_LOAD_LIMITS;
  const reasonText = reasons.length > 0 ? ` ${reasons.join('; ')}.` : '';
  return `Folder load blocked.${reasonText} Limit: ${limits.maxFileCount} EXR files or ${formatByteCount(limits.maxTotalBytes)}.`;
}
