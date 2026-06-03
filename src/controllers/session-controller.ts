import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import {
  errorResource,
  isPendingMatch,
  pendingResource,
  successResource,
  type AsyncResource
} from '../async-resource';
import { ViewerAppCore } from '../app/viewer-app-core';
import { buildLoadedSession, buildReloadedSession } from '../app/session-resource';
import { selectActiveSession } from '../app/viewer-app-selectors';
import { LoadQueueService, type LoadQueueOptions, type LoadQueuePriority } from '../services/load-queue';
import type { DecodeBytesOptions } from '../exr-decode-context';
import { buildSessionDisplayName, normalizeSessionDisplayName } from '../session-state';
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
  PendingOpenedImageReservation,
  SessionSource,
  ViewerMode,
  ViewportInfo,
  ViewportInsets
} from '../types';
import type { ViewerPanePath } from '../viewer-pane-layout';
import { presentDesktopError, type DesktopFileEntry, type PathFileProvider } from '../platform';

interface GalleryImage {
  id: string;
  label: string;
  filename: string;
  url?: string;
  viewerMode?: ViewerMode;
}

const DESKTOP_CBOX_RGB_URL = 'https://raw.githubusercontent.com/elerac/prismifold/main/public/cbox_rgb.exr';
const DESKTOP_MIDDLEBURY_CHESS1_RGB_Z_URL =
  'https://raw.githubusercontent.com/elerac/prismifold/main/public/middlebury_chess1_rgb_z.exr';
const POLANALYSER_STOKES_BASE_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/';
const KAIST_HYPERSPECTRAL_BASE_URL =
  'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/';
const POLY_HAVEN_HDRI_BASE_URL = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/';
const POLY_HAVEN_GALLERY_FILES: readonly [string, string][] = [
  ['polyhaven-artist-workshop-1k', 'artist_workshop_1k.exr'],
  ['brown-photostudio-02-1k', 'brown_photostudio_02_1k.exr'],
  ['polyhaven-symmetrical-garden-02-1k', 'symmetrical_garden_02_1k.exr']
];
const POLANALYSER_STOKES_FILENAMES = [
  'avocado.exr',
  'bean.exr',
  'camera.exr',
  'carps.exr',
  'dragon.exr',
  'fruits.exr',
  'lp000.exr',
  'lp045.exr',
  'lp090.exr',
  'lp135.exr',
  'orange.exr',
  'owl_spheres.exr',
  'plastic.exr',
  'spheres1.exr',
  'spheres2.exr',
  'spoons.exr'
] as const;
const KAIST_HYPERSPECTRAL_FILENAMES = [
  'scene01_reflectance.exr',
  'scene02_reflectance.exr',
  'scene03_reflectance.exr',
  'scene04_reflectance.exr',
  'scene05_reflectance.exr',
  'scene06_reflectance.exr',
  'scene07_reflectance.exr',
  'scene08_reflectance.exr',
  'scene09_reflectance.exr',
  'scene10_reflectance.exr',
  'scene11_reflectance.exr',
  'scene12_reflectance.exr',
  'scene13_reflectance.exr',
  'scene14_reflectance.exr',
  'scene15_reflectance.exr',
  'scene16_reflectance.exr',
  'scene17_reflectance.exr',
  'scene18_reflectance.exr',
  'scene19_reflectance.exr',
  'scene20_reflectance.exr',
  'scene21_reflectance.exr',
  'scene22_reflectance.exr',
  'scene23_reflectance.exr',
  'scene24_reflectance.exr',
  'scene25_reflectance.exr',
  'scene26_reflectance.exr',
  'scene27_reflectance.exr',
  'scene28_reflectance.exr',
  'scene29_reflectance.exr',
  'scene30_reflectance.exr'
] as const;
const useRemotePackagedGallerySamples = import.meta.env.MODE === 'desktop' || import.meta.env.MODE === 'vscode';

const CBOX_RGB_GALLERY_IMAGE = useRemotePackagedGallerySamples
  ? {
      id: 'cbox-rgb',
      label: 'cbox_rgb.exr',
      filename: 'cbox_rgb.exr',
      url: DESKTOP_CBOX_RGB_URL
    }
  : {
      id: 'cbox-rgb',
      label: 'cbox_rgb.exr',
      filename: 'cbox_rgb.exr'
    };

const MIDDLEBURY_CHESS1_RGB_Z_GALLERY_IMAGE: GalleryImage = useRemotePackagedGallerySamples
  ? {
      id: 'middlebury-chess1-rgb-z',
      label: 'middlebury_chess1_rgb_z.exr',
      filename: 'middlebury_chess1_rgb_z.exr',
      url: DESKTOP_MIDDLEBURY_CHESS1_RGB_Z_URL,
      viewerMode: 'depth'
    }
  : {
      id: 'middlebury-chess1-rgb-z',
      label: 'middlebury_chess1_rgb_z.exr',
      filename: 'middlebury_chess1_rgb_z.exr',
      viewerMode: 'depth'
    };

const POLY_HAVEN_GALLERY_IMAGES: GalleryImage[] = POLY_HAVEN_GALLERY_FILES.map(([id, filename]) => ({
  id,
  label: filename,
  filename,
  url: `${POLY_HAVEN_HDRI_BASE_URL}${filename}`
}));

const POLANALYSER_GALLERY_IMAGES: GalleryImage[] = POLANALYSER_STOKES_FILENAMES.map((filename) => ({
  id: `polanalyser-${filename.replace(/\.exr$/, '').replaceAll('_', '-')}`,
  label: filename,
  filename,
  url: `${POLANALYSER_STOKES_BASE_URL}${filename}`
}));

const KAIST_GALLERY_IMAGES: GalleryImage[] = KAIST_HYPERSPECTRAL_FILENAMES.map((filename) => ({
  id: `kaist-${filename.replace(/\.exr$/, '').replaceAll('_', '-')}`,
  label: filename,
  filename,
  url: `${KAIST_HYPERSPECTRAL_BASE_URL}${filename}`
}));

const GALLERY_IMAGES: GalleryImage[] = [
  CBOX_RGB_GALLERY_IMAGE,
  {
    id: 'beachball-multipart-0001',
    label: 'multipart.0001.exr',
    filename: 'multipart.0001.exr',
    url: 'https://raw.githubusercontent.com/AcademySoftwareFoundation/openexr-images/main/Beachball/multipart.0001.exr'
  },
  MIDDLEBURY_CHESS1_RGB_Z_GALLERY_IMAGE
].concat(POLY_HAVEN_GALLERY_IMAGES, KAIST_GALLERY_IMAGES, POLANALYSER_GALLERY_IMAGES);

const LOAD_CATEGORY_OPEN_FILES = 'open-files';
const LOAD_CATEGORY_FOLDER = 'folder';
const LOAD_CATEGORY_GALLERY = 'gallery';
const LOAD_CATEGORY_RELOAD_SESSION = 'reload-session';
const LOAD_CATEGORY_RELOAD_ALL = 'reload-all';

interface PendingLoadResource {
  key: string;
  requestId: number;
}

interface ReservedFileLoad {
  file: File;
  reservation: PendingOpenedImageReservation;
}

interface ReservedPathLoad {
  entry: DesktopFileEntry;
  reservation: PendingOpenedImageReservation;
}

interface PendingOpenedImageReservationGroup {
  priority: LoadQueuePriority;
  category: string;
  sessionIds: string[];
}

type OrderedFileLoadResult =
  | {
      status: 'loaded';
      decoded: DecodedExrImage;
    }
  | {
      status: 'failed';
      error: unknown;
    };

interface OrderedFileLoadGroup {
  reservedLoads: ReservedFileLoad[];
  results: Array<OrderedFileLoadResult | null>;
  nextCommitIndex: number;
  activatedLoadedFile: boolean;
}

type OrderedPathLoadResult =
  | {
      status: 'loaded';
      decoded: DecodedExrImage;
    }
  | {
      status: 'failed';
      error: unknown;
    };

interface OrderedPathLoadGroup {
  reservedLoads: ReservedPathLoad[];
  results: Array<OrderedPathLoadResult | null>;
  nextCommitIndex: number;
  activatedLoadedFile: boolean;
}

export interface FolderLoadOptions {
  overrideLimits?: boolean;
}

export interface FileLoadOptions {
  displayName?: string;
}

export interface SessionControllerDependencies {
  core: ViewerAppCore;
  loadQueue: LoadQueueService;
  decodeBytes: (bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>;
  pathFileProvider?: PathFileProvider | null;
  onPathSessionLoaded?: (entry: DesktopFileEntry) => void;
  onPathSessionLoadFailed?: (entry: DesktopFileEntry, error: unknown) => void;
  getViewport: () => ViewportInfo;
  getFitInsets: () => ViewportInsets | undefined;
}

export class SessionController implements Disposable {
  private readonly core: ViewerAppCore;
  private readonly loadQueue: LoadQueueService;
  private readonly decodeBytes: SessionControllerDependencies['decodeBytes'];
  private readonly pathFileProvider: PathFileProvider | null;
  private readonly onPathSessionLoaded: NonNullable<SessionControllerDependencies['onPathSessionLoaded']>;
  private readonly onPathSessionLoadFailed: NonNullable<SessionControllerDependencies['onPathSessionLoadFailed']>;
  private readonly getViewport: SessionControllerDependencies['getViewport'];
  private readonly getFitInsets: SessionControllerDependencies['getFitInsets'];

  private readonly abortController = new AbortController();
  private readonly loadResourcesByKey = new Map<string, AsyncResource<void>>();
  private readonly pendingOpenedImageReservationGroups = new Map<string, PendingOpenedImageReservationGroup>();
  private nextLoadRequestId = 1;
  private nextLoadGroupId = 1;
  private nextPendingReservationGroupId = 1;
  private disposed = false;

  constructor(dependencies: SessionControllerDependencies) {
    this.core = dependencies.core;
    this.loadQueue = dependencies.loadQueue;
    this.decodeBytes = dependencies.decodeBytes;
    this.pathFileProvider = dependencies.pathFileProvider ?? null;
    this.onPathSessionLoaded = dependencies.onPathSessionLoaded ?? (() => {});
    this.onPathSessionLoadFailed = dependencies.onPathSessionLoadFailed ?? (() => {});
    this.getViewport = dependencies.getViewport;
    this.getFitInsets = dependencies.getFitInsets;
  }

  enqueueFiles(files: File[], options: FileLoadOptions = {}): Promise<void> {
    if (this.disposed || files.length === 0) {
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    const reservedLoads = this.reservePendingFileLoads(files, {
      priority: 'foreground',
      category: LOAD_CATEGORY_OPEN_FILES,
      displayName: files.length === 1 ? options.displayName : undefined
    });

    return this.enqueueOrderedFileLoadGroup(reservedLoads, {
      priority: 'foreground',
      category: LOAD_CATEGORY_OPEN_FILES
    });
  }

  enqueuePaths(paths: string[], options: FileLoadOptions = {}): Promise<void> {
    if (this.disposed || paths.length === 0) {
      return Promise.resolve();
    }
    if (!this.pathFileProvider) {
      this.core.dispatch({
        type: 'errorSet',
        message: 'Desktop path loading is unavailable.'
      });
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.resolvePathEntries(
      (signal) => this.pathFileProvider!.resolveExrPaths(paths, signal),
      true,
      (error) => {
        for (const path of paths) {
          this.onPathSessionLoadFailed({
            grantId: '',
            path,
            filename: inferFilenameFromUrl(path),
            displayPath: path,
            fileSizeBytes: 0
          }, error);
        }
      }
    ).then((entries) => {
      if (this.disposed) {
        return;
      }
      if (entries.length === 0) {
        this.core.dispatch({
          type: 'errorSet',
          message: 'No OpenEXR files found.'
        });
        return;
      }

      return this.enqueuePathEntries(entries, {
        priority: 'foreground',
        category: LOAD_CATEGORY_OPEN_FILES,
        displayName: entries.length === 1 ? options.displayName : undefined
      });
    });
  }

  enqueuePathEntries(
    entries: DesktopFileEntry[],
    options: FileLoadOptions & Partial<Pick<LoadQueueOptions, 'priority' | 'category' | 'groupId'>> = {}
  ): Promise<void> {
    if (this.disposed || entries.length === 0) {
      return Promise.resolve();
    }
    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.loadPathEntries(entries, {
      priority: options.priority ?? 'foreground',
      category: options.category ?? LOAD_CATEGORY_OPEN_FILES,
      groupId: options.groupId,
      displayName: entries.length === 1 ? options.displayName : undefined
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
    const reservedLoads = this.reservePendingFileLoads(exrFiles, {
      priority: 'background',
      category: LOAD_CATEGORY_FOLDER
    });

    return this.enqueueOrderedFileLoadGroup(reservedLoads, {
      priority: 'background',
      category: LOAD_CATEGORY_FOLDER,
      groupId
    });
  }

  enqueueFolderPath(path: string, options: FolderLoadOptions = {}): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (!this.pathFileProvider) {
      this.core.dispatch({
        type: 'errorSet',
        message: 'Desktop folder loading is unavailable.'
      });
      return Promise.resolve();
    }

    const groupId = this.takeLoadGroupId('folder');
    return this.resolvePathEntries(
      (signal) => this.pathFileProvider!.listExrFolder(path, signal),
      true
    ).then((entries) => {
      if (this.disposed) {
        return;
      }
      if (entries.length === 0) {
        this.core.dispatch({
          type: 'errorSet',
          message: 'No OpenEXR files found in the selected folder.'
        });
        return;
      }

      return this.loadPathEntries(entries, {
        priority: 'background',
        category: LOAD_CATEGORY_FOLDER,
        groupId,
        folderOptions: options
      });
    });
  }

  enqueueFolderPathEntries(entries: DesktopFileEntry[], options: FolderLoadOptions = {}): Promise<void> {
    if (this.disposed || entries.length === 0) {
      return Promise.resolve();
    }

    const groupId = this.takeLoadGroupId('folder');
    return this.loadPathEntries(entries, {
      priority: 'background',
      category: LOAD_CATEGORY_FOLDER,
      groupId,
      folderOptions: options
    });
  }

  enqueueGalleryImage(galleryId: string, options: { displayName?: string } = {}): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.enqueueLoadTask(async (signal) => {
      this.throwIfStopped(signal);
      await this.loadGalleryImage(galleryId, signal, {
        displayName: options.displayName
      });
    }, {
      priority: 'foreground',
      category: LOAD_CATEGORY_GALLERY
    });
  }

  enqueueUrl(url: string, options: { filename?: string; displayName?: string } = {}): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.cancelBackgroundLoads('Foreground load superseded background work.');
    return this.enqueueLoadTask(async (signal) => {
      this.throwIfStopped(signal);
      await this.loadUrlImage(url, {
        signal,
        filename: options.filename ?? inferFilenameFromUrl(url),
        displayName: options.displayName
      });
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
        this.core.dispatch({ type: 'errorSet', message: `Reload failed: ${error.message}` });
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
          failures.push(`${target.label}: ${error.message}`);
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

  switchActiveSession(
    sessionId: string,
    options: { panePath?: ViewerPanePath; viewport?: ViewportInfo } = {}
  ): void {
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
      panePath: options.panePath,
      viewport: state.autoFitImageOnSelect ? options.viewport ?? this.getViewport() : undefined,
      fitInsets: state.autoFitImageOnSelect ? this.getFitInsets() : undefined
    });
  }

  assignSessionToViewerPane(sessionId: string, panePath: ViewerPanePath): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'viewerPaneSessionAssigned',
      sessionId,
      panePath
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
    if (this.getSessions().length === 0 && this.core.getState().pendingOpenedImages.length === 0) {
      return;
    }
    this.clearAllPendingOpenedImageReservations();
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

  resetActiveSessionViewState(): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'activeSessionViewReset',
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
    this.clearAllPendingOpenedImageReservations();
  }

  private enqueueLoadTask(
    task: (signal: AbortSignal) => Promise<void>,
    options: LoadQueueOptions,
    clearError = true
  ): Promise<void> {
    const loadResource = this.beginQueuedLoad(clearError);
    return this.loadQueue.enqueue(task, options).then(() => {
      this.finishQueuedLoad(loadResource);
    }).catch((error) => {
      this.finishQueuedLoad(loadResource, error);
      if (isAbortError(error)) {
        return;
      }
      throw error;
    });
  }

  private enqueueOrderedFileLoadGroup(
    reservedLoads: ReservedFileLoad[],
    options: LoadQueueOptions
  ): Promise<void> {
    if (reservedLoads.length === 0) {
      return Promise.resolve();
    }

    const group: OrderedFileLoadGroup = {
      reservedLoads,
      results: reservedLoads.map(() => null),
      nextCommitIndex: 0,
      activatedLoadedFile: false
    };

    const promises = reservedLoads.map((load, index) => {
      return this.enqueueLoadTask(async (signal) => {
        this.throwIfStopped(signal);
        try {
          const decoded = await this.decodeFile(load.file, signal);
          this.throwIfStopped(signal);
          group.results[index] = {
            status: 'loaded',
            decoded
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          this.throwIfStopped(signal);
          group.results[index] = {
            status: 'failed',
            error
          };
        }

        this.commitReadyOrderedFileLoads(group);
      }, {
        ...options,
        sessionId: load.reservation.id
      }, index === 0);
    });

    return Promise.all(promises).then(() => undefined).finally(() => {
      this.clearPendingOpenedImageReservations(reservedLoads.map((load) => load.reservation.id));
    });
  }

  private async resolvePathEntries(
    resolve: (signal: AbortSignal) => Promise<DesktopFileEntry[]>,
    clearError: boolean,
    onError?: (error: unknown) => void
  ): Promise<DesktopFileEntry[]> {
    const loadResource = this.beginQueuedLoad(clearError);
    try {
      this.throwIfStopped(this.abortController.signal);
      const entries = await resolve(this.abortController.signal);
      this.throwIfStopped(this.abortController.signal);
      this.finishQueuedLoad(loadResource);
      return entries;
    } catch (error) {
      this.finishQueuedLoad(loadResource, error);
      if (isAbortError(error)) {
        return [];
      }
      onError?.(error);
      const { message } = presentDesktopError(error, 'Failed to inspect desktop paths.');
      this.core.dispatch({ type: 'errorSet', message });
      return [];
    }
  }

  private async loadPathEntries(
    entries: DesktopFileEntry[],
    options: LoadQueueOptions & {
      displayName?: string;
      folderOptions?: FolderLoadOptions;
    }
  ): Promise<void> {
    const dedupedEntries = this.filterDuplicatePathEntries(entries);
    if (dedupedEntries.length === 0) {
      return;
    }

    const priority = options.priority ?? 'foreground';
    const category = options.category ?? LOAD_CATEGORY_OPEN_FILES;

    if (category === LOAD_CATEGORY_FOLDER) {
      const admission = createFolderLoadAdmission(getPathLoadStats(dedupedEntries), DEFAULT_FOLDER_LOAD_LIMITS);
      if (admission.exceeded && !options.folderOptions?.overrideLimits) {
        this.core.dispatch({
          type: 'errorSet',
          message: formatFolderLimitMessage(admission.reasons)
        });
        return;
      }
    }

    const reservedLoads = this.reservePendingPathLoads(dedupedEntries, {
      priority,
      category,
      displayName: dedupedEntries.length === 1 ? options.displayName : undefined
    });

    await this.enqueueOrderedPathLoadGroup(reservedLoads, {
      priority,
      category,
      groupId: options.groupId
    });
  }

  private filterDuplicatePathEntries(entries: DesktopFileEntry[]): DesktopFileEntry[] {
    if (entries.length === 0) {
      return [];
    }

    const state = this.core.getState();
    const openGrantIds = new Set<string>();
    const openPaths = new Set<string>();
    for (const source of [
      ...state.sessions.map((session) => session.source),
      ...state.pendingOpenedImages.map((reservation) => reservation.source)
    ]) {
      if (source.kind !== 'path') {
        continue;
      }
      openGrantIds.add(source.grantId);
      openPaths.add(source.path);
    }

    const seenGrantIds = new Set<string>();
    const seenPaths = new Set<string>();
    return entries.filter((entry) => {
      if (
        openGrantIds.has(entry.grantId) ||
        openPaths.has(entry.path) ||
        seenGrantIds.has(entry.grantId) ||
        seenPaths.has(entry.path)
      ) {
        return false;
      }
      seenGrantIds.add(entry.grantId);
      seenPaths.add(entry.path);
      return true;
    });
  }

  private enqueueOrderedPathLoadGroup(
    reservedLoads: ReservedPathLoad[],
    options: LoadQueueOptions
  ): Promise<void> {
    if (reservedLoads.length === 0) {
      return Promise.resolve();
    }

    const group: OrderedPathLoadGroup = {
      reservedLoads,
      results: reservedLoads.map(() => null),
      nextCommitIndex: 0,
      activatedLoadedFile: false
    };

    const promises = reservedLoads.map((load, index) => {
      return this.enqueueLoadTask(async (signal) => {
        this.throwIfStopped(signal);
        try {
          const decoded = await this.decodePathEntry(load.entry, signal);
          this.throwIfStopped(signal);
          group.results[index] = {
            status: 'loaded',
            decoded
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          this.throwIfStopped(signal);
          group.results[index] = {
            status: 'failed',
            error
          };
        }

        this.commitReadyOrderedPathLoads(group);
      }, {
        ...options,
        sessionId: load.reservation.id
      }, index === 0);
    });

    return Promise.all(promises).then(() => undefined).finally(() => {
      this.clearPendingOpenedImageReservations(reservedLoads.map((load) => load.reservation.id));
    });
  }

  private commitReadyOrderedFileLoads(group: OrderedFileLoadGroup): void {
    while (group.nextCommitIndex < group.results.length) {
      const result = group.results[group.nextCommitIndex];
      if (!result) {
        return;
      }

      const load = group.reservedLoads[group.nextCommitIndex];
      group.nextCommitIndex += 1;
      if (!load) {
        continue;
      }

      if (result.status === 'loaded') {
        this.applyDecodedImage(result.decoded, load.file.name, load.file.size, {
          kind: 'file',
          file: load.file
        }, {
          activate: !group.activatedLoadedFile,
          sessionId: load.reservation.id,
          displayName: load.reservation.displayNameIsCustom ? load.reservation.displayName : undefined
        });
        group.activatedLoadedFile = true;
        this.clearPendingOpenedImageReservations([load.reservation.id]);
        continue;
      }

      this.clearPendingOpenedImageReservations([load.reservation.id]);
      if (!this.disposed) {
        this.core.dispatch({
          type: 'errorSet',
          message: `Load failed: ${presentDesktopError(result.error, 'Load failed.').message}`
        });
      }
    }
  }

  private commitReadyOrderedPathLoads(group: OrderedPathLoadGroup): void {
    while (group.nextCommitIndex < group.results.length) {
      const result = group.results[group.nextCommitIndex];
      if (!result) {
        return;
      }

      const load = group.reservedLoads[group.nextCommitIndex];
      group.nextCommitIndex += 1;
      if (!load) {
        continue;
      }

      if (result.status === 'loaded') {
        this.applyDecodedImage(result.decoded, load.entry.filename, load.entry.fileSizeBytes, {
          kind: 'path',
          grantId: load.entry.grantId,
          path: load.entry.path,
          filename: load.entry.filename,
          fileSizeBytes: load.entry.fileSizeBytes,
          ...(load.entry.displayPath ? { displayPath: load.entry.displayPath } : {}),
          ...(load.entry.relativePath ? { relativePath: load.entry.relativePath } : {})
        }, {
          activate: !group.activatedLoadedFile,
          sessionId: load.reservation.id,
          displayName: load.reservation.displayNameIsCustom ? load.reservation.displayName : undefined
        });
        group.activatedLoadedFile = true;
        this.onPathSessionLoaded(load.entry);
        this.clearPendingOpenedImageReservations([load.reservation.id]);
        continue;
      }

      this.onPathSessionLoadFailed(load.entry, result.error);
      this.clearPendingOpenedImageReservations([load.reservation.id]);
      if (!this.disposed) {
        this.core.dispatch({
          type: 'errorSet',
          message: `Load failed: ${presentDesktopError(result.error, 'Load failed.').message}`
        });
      }
    }
  }

  private beginQueuedLoad(clearError: boolean): PendingLoadResource {
    const requestId = this.nextLoadRequestId;
    this.nextLoadRequestId += 1;
    const key = `load:${requestId}`;
    const hadPendingLoads = this.hasPendingLoadResources();
    this.loadResourcesByKey.set(key, pendingResource(key, requestId));
    if (!hadPendingLoads) {
      this.core.dispatch({ type: 'loadingSet', loading: true });
    }
    if (clearError) {
      this.core.dispatch({ type: 'errorSet', message: null });
    }
    return { key, requestId };
  }

  private finishQueuedLoad(loadResource: PendingLoadResource, error?: unknown): void {
    const currentResource = this.loadResourcesByKey.get(loadResource.key);
    if (
      !currentResource ||
      !isPendingMatch(currentResource, loadResource.key, loadResource.requestId)
    ) {
      return;
    }

    this.loadResourcesByKey.set(
      loadResource.key,
      error === undefined
        ? successResource(loadResource.key, undefined)
        : errorResource(loadResource.key, error)
    );
    this.loadResourcesByKey.delete(loadResource.key);
    if (!this.hasPendingLoadResources()) {
      this.core.dispatch({ type: 'loadingSet', loading: false });
    }
  }

  private hasPendingLoadResources(): boolean {
    for (const resource of this.loadResourcesByKey.values()) {
      if (resource.status === 'pending') {
        return true;
      }
    }
    return false;
  }

  private cancelBackgroundLoads(message: string): void {
    this.loadQueue.cancelWhere((entry) => entry.priority === 'background', message);
    this.clearPendingOpenedImageReservationGroupsWhere((group) => group.priority === 'background');
  }

  private takeLoadGroupId(prefix: string): string {
    const id = `${prefix}-${this.nextLoadGroupId}`;
    this.nextLoadGroupId += 1;
    return id;
  }

  private reservePendingFileLoads(
    files: File[],
    options: { priority: LoadQueuePriority; category: string; displayName?: string }
  ): ReservedFileLoad[] {
    if (files.length === 0) {
      return [];
    }

    const customDisplayName = files.length === 1 ? normalizeSessionDisplayName(options.displayName) : null;
    const currentState = this.core.getState();
    const existingFilenames = [
      ...currentState.sessions.map((session) => session.filename),
      ...currentState.pendingOpenedImages.map((reservation) => reservation.filename)
    ];
    const reservedLoads = files.map((file) => {
      const filename = file.name;
      const reservation: PendingOpenedImageReservation = {
        id: this.core.issueSessionId(),
        filename,
        displayName: customDisplayName ?? buildSessionDisplayName(filename, existingFilenames),
        ...(customDisplayName ? { displayNameIsCustom: true } : {}),
        fileSizeBytes: file.size,
        source: {
          kind: 'file',
          file
        }
      };
      existingFilenames.push(filename);
      return {
        file,
        reservation
      };
    });

    const sessionIds = reservedLoads.map((load) => load.reservation.id);
    const groupId = this.takePendingReservationGroupId(options.category);
    this.pendingOpenedImageReservationGroups.set(groupId, {
      priority: options.priority,
      category: options.category,
      sessionIds
    });
    this.core.dispatch({
      type: 'pendingOpenedImagesReserved',
      reservations: reservedLoads.map((load) => load.reservation)
    });

    return reservedLoads;
  }

  private reservePendingPathLoads(
    entries: DesktopFileEntry[],
    options: { priority: LoadQueuePriority; category: string; displayName?: string }
  ): ReservedPathLoad[] {
    if (entries.length === 0) {
      return [];
    }

    const customDisplayName = entries.length === 1 ? normalizeSessionDisplayName(options.displayName) : null;
    const currentState = this.core.getState();
    const existingFilenames = [
      ...currentState.sessions.map((session) => session.filename),
      ...currentState.pendingOpenedImages.map((reservation) => reservation.filename)
    ];
    const reservedLoads = entries.map((entry) => {
      const filename = entry.filename;
      const reservation: PendingOpenedImageReservation = {
        id: this.core.issueSessionId(),
        filename,
        displayName: customDisplayName ?? buildSessionDisplayName(filename, existingFilenames),
        ...(customDisplayName ? { displayNameIsCustom: true } : {}),
        fileSizeBytes: entry.fileSizeBytes,
        source: {
          kind: 'path',
          grantId: entry.grantId,
          path: entry.path,
          filename: entry.filename,
          fileSizeBytes: entry.fileSizeBytes,
          ...(entry.displayPath ? { displayPath: entry.displayPath } : {}),
          ...(entry.relativePath ? { relativePath: entry.relativePath } : {})
        }
      };
      existingFilenames.push(filename);
      return {
        entry,
        reservation
      };
    });

    const sessionIds = reservedLoads.map((load) => load.reservation.id);
    const groupId = this.takePendingReservationGroupId(options.category);
    this.pendingOpenedImageReservationGroups.set(groupId, {
      priority: options.priority,
      category: options.category,
      sessionIds
    });
    this.core.dispatch({
      type: 'pendingOpenedImagesReserved',
      reservations: reservedLoads.map((load) => load.reservation)
    });

    return reservedLoads;
  }

  private takePendingReservationGroupId(prefix: string): string {
    const id = `pending-${prefix}-${this.nextPendingReservationGroupId}`;
    this.nextPendingReservationGroupId += 1;
    return id;
  }

  private clearPendingOpenedImageReservations(sessionIds: string[]): void {
    if (sessionIds.length === 0) {
      return;
    }

    const removeIds = new Set(sessionIds);
    for (const [groupId, group] of Array.from(this.pendingOpenedImageReservationGroups.entries())) {
      const remainingSessionIds = group.sessionIds.filter((sessionId) => !removeIds.has(sessionId));
      if (remainingSessionIds.length === group.sessionIds.length) {
        continue;
      }
      if (remainingSessionIds.length === 0) {
        this.pendingOpenedImageReservationGroups.delete(groupId);
        continue;
      }
      this.pendingOpenedImageReservationGroups.set(groupId, {
        ...group,
        sessionIds: remainingSessionIds
      });
    }

    this.core.dispatch({
      type: 'pendingOpenedImagesCleared',
      sessionIds
    });
  }

  private clearPendingOpenedImageReservationGroupsWhere(
    predicate: (group: PendingOpenedImageReservationGroup) => boolean
  ): void {
    const sessionIds: string[] = [];
    for (const [groupId, group] of Array.from(this.pendingOpenedImageReservationGroups.entries())) {
      if (!predicate(group)) {
        continue;
      }

      sessionIds.push(...group.sessionIds);
      this.pendingOpenedImageReservationGroups.delete(groupId);
    }

    if (sessionIds.length > 0) {
      this.core.dispatch({
        type: 'pendingOpenedImagesCleared',
        sessionIds
      });
    }
  }

  private clearAllPendingOpenedImageReservations(): void {
    if (this.pendingOpenedImageReservationGroups.size === 0 && this.core.getState().pendingOpenedImages.length === 0) {
      return;
    }

    this.pendingOpenedImageReservationGroups.clear();
    this.core.dispatch({
      type: 'pendingOpenedImagesCleared'
    });
  }

  private async loadGalleryImage(
    galleryId: string,
    signal: AbortSignal,
    options: { displayName?: string } = {}
  ): Promise<void> {
    this.throwIfStopped(signal);

    const galleryImage = GALLERY_IMAGES.find((item) => item.id === galleryId);
    if (!galleryImage) {
      this.core.dispatch({ type: 'errorSet', message: `Unknown gallery image: ${galleryId}` });
      return;
    }

    try {
      await this.loadUrlImage(getGalleryImageUrl(galleryImage), {
        signal,
        filename: galleryImage.filename,
        displayName: options.displayName
      });
      if (galleryImage.viewerMode) {
        this.core.dispatch({
          type: 'viewerModeSet',
          viewerMode: galleryImage.viewerMode
        });
      }
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        this.core.dispatch({
          type: 'errorSet',
          message: error instanceof Error ? error.message : `Unknown error while loading ${galleryImage.label}`
        });
      }
    }
  }

  private async loadUrlImage(
    url: string,
    options: { signal: AbortSignal; filename: string; displayName?: string }
  ): Promise<void> {
    this.throwIfStopped(options.signal);

    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) {
      throw new Error(`Failed to load ${url} (${response.status})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    this.throwIfStopped(options.signal);
    const decoded = await this.decodeBytes(bytes, {
      signal: options.signal,
      filename: options.filename
    });
    this.throwIfStopped(options.signal);
    this.applyDecodedImage(decoded, options.filename, bytes.byteLength, {
      kind: 'url',
      url
    }, {
      displayName: options.displayName
    });
  }

  private async decodeFile(
    file: File,
    signal: AbortSignal
  ): Promise<DecodedExrImage> {
    this.throwIfStopped(signal);

    const bytes = new Uint8Array(await file.arrayBuffer());
    this.throwIfStopped(signal);
    const decoded = await this.decodeBytes(bytes, {
      signal,
      filename: getFileDecodeName(file)
    });
    this.throwIfStopped(signal);
    return decoded;
  }

  private async decodePathEntry(
    entry: DesktopFileEntry,
    signal: AbortSignal
  ): Promise<DecodedExrImage> {
    if (!this.pathFileProvider) {
      throw new Error('Desktop path loading is unavailable.');
    }

    this.throwIfStopped(signal);
    const file = await this.pathFileProvider.readExrFile(entry.grantId, signal);
    this.throwIfStopped(signal);
    const decoded = await this.decodeBytes(file.bytes, {
      signal,
      filename: entry.relativePath || entry.filename
    });
    this.throwIfStopped(signal);
    return decoded;
  }

  private applyDecodedImage(
    decoded: DecodedExrImage,
    filename: string,
    fileSizeBytes: number | null,
    source: SessionSource,
    options: { activate?: boolean; sessionId?: string; displayName?: string } = {}
  ): void {
    const currentState = this.core.getState();
    const activeSession = selectActiveSession(currentState);
    const session = buildLoadedSession({
      sessionId: options.sessionId ?? this.core.issueSessionId(),
      decoded,
      filename,
      displayName: options.displayName,
      fileSizeBytes,
      source,
      existingSessions: currentState.sessions,
      defaultColormapId: currentState.defaultColormapId,
      viewport: this.getViewport(),
      fitInsets: this.getFitInsets(),
      currentSessionState: currentState.sessionState,
      hasActiveSession: Boolean(activeSession),
      previousImage: activeSession?.decoded ?? null,
      autoFitImageOnSelect: currentState.autoFitImageOnSelect,
      stokesParameterVisibility: currentState.stokesParameterVisibility,
      spectralRgbGroupingEnabled: currentState.spectralRgbGroupingEnabled,
      channelRecognitionSettings: currentState.channelRecognitionSettings,
      channelRecognitionNameRules: currentState.channelRecognitionNameRules
    });

    this.core.dispatch({
      type: 'sessionLoaded',
      session,
      activate: options.activate
    });
  }

  private async reloadSessionByIdInternal(sessionId: string, signal: AbortSignal): Promise<Error | null> {
    this.throwIfStopped(signal);

    const session = this.getSessions().find((current) => current.id === sessionId);
    if (!session) {
      return new Error('Session not found.');
    }

    try {
      const decoded = await decodeExrFromSessionSource(
        session.source,
        session.filename,
        this.decodeBytes,
        this.pathFileProvider,
        signal
      );
      this.throwIfStopped(signal);
      const baseState = this.getActiveSessionId() === sessionId
        ? this.core.getState().sessionState
        : session.state;
      const reloadedSession = buildReloadedSession(
        session,
        decoded,
        baseState,
        this.core.getState().stokesParameterVisibility,
        this.core.getState().spectralRgbGroupingEnabled,
        this.core.getState().channelRecognitionSettings,
        this.core.getState().channelRecognitionNameRules
      );
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
      return new Error(presentDesktopError(error, 'Unknown error.').message);
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

function getGalleryImageUrl(galleryImage: GalleryImage): string {
  return typeof galleryImage.url === 'string'
    ? galleryImage.url
    : `${import.meta.env.BASE_URL}${galleryImage.filename}`;
}

function inferFilenameFromUrl(url: string): string {
  try {
    const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
    const parsed = new URL(url, base);
    const pathname = parsed.pathname.split('/').filter(Boolean).pop()?.trim();
    return pathname || 'image.exr';
  } catch {
    const pathname = url.split(/[?#]/, 1)[0]?.split('/').filter(Boolean).pop()?.trim();
    return pathname || 'image.exr';
  }
}

async function decodeExrFromSessionSource(
  source: SessionSource,
  filename: string,
  decodeBytes: (bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>,
  pathFileProvider: PathFileProvider | null,
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

  if (source.kind === 'path') {
    if (!pathFileProvider) {
      throw new Error('Desktop path loading is unavailable.');
    }
    const file = await pathFileProvider.readExrFile(source.grantId, signal);
    if (signal) {
      throwIfAborted(signal, 'Session reload was aborted.');
    }
    return decodeBytes(file.bytes, {
      signal,
      filename: source.relativePath || source.filename || filename
    });
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

function getPathLoadStats(entries: DesktopFileEntry[]) {
  return {
    exrFileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.fileSizeBytes, 0),
    partial: false
  };
}

function formatFolderLimitMessage(reasons: string[]): string {
  const limits = DEFAULT_FOLDER_LOAD_LIMITS;
  const reasonText = reasons.length > 0 ? ` ${reasons.join('; ')}.` : '';
  return `Folder load blocked.${reasonText} Limit: ${limits.maxFileCount} EXR files or ${formatByteCount(limits.maxTotalBytes)}.`;
}
