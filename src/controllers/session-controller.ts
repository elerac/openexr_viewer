import { DEFAULT_PANORAMA_HFOV_DEG, clampZoom } from '../interaction';
import { cloneDisplayLuminanceRange } from '../colormap-range';
import {
  buildSessionDisplayName,
  pickNextSessionIndexAfterRemoval,
  persistActiveSessionState
} from '../session-state';
import { cloneDisplaySelection } from '../display-model';
import { createDefaultStokesDegreeModulation } from '../stokes';
import { buildDefaultExportFilename, ViewerUi } from '../ui';
import { buildViewerStateForLayer } from '../viewer-store';
import { LoadQueueService } from '../services/load-queue';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import {
  DecodedExrImage,
  ImagePixel,
  OpenedImageSession,
  SessionSource,
  ViewerState,
  ViewportInfo
} from '../types';

const GALLERY_IMAGES = [
  {
    id: 'cbox-rgb',
    label: 'cbox_rgb.exr',
    filename: 'cbox_rgb.exr'
  }
] as const;

type SessionUi = Pick<
  ViewerUi,
  | 'setError'
  | 'setExportTarget'
  | 'setLoading'
  | 'setOpenedImageOptions'
>;

export interface SessionControllerDependencies {
  ui: SessionUi;
  loadQueue: LoadQueueService;
  thumbnailService: ThumbnailService;
  renderCache: RenderCacheService;
  decodeBytes: (bytes: Uint8Array) => Promise<DecodedExrImage>;
  getCurrentState: () => ViewerState;
  setState: (next: Partial<ViewerState>) => void;
  getViewport: () => ViewportInfo;
  getDefaultColormapId: () => string;
  clearRendererImage: () => void;
  onSessionClosed?: (sessionId: string) => void;
  onAllSessionsClosed?: () => void;
}

export class SessionController {
  private readonly ui: SessionUi;
  private readonly loadQueue: LoadQueueService;
  private readonly thumbnailService: ThumbnailService;
  private readonly renderCache: RenderCacheService;
  private readonly decodeBytes: SessionControllerDependencies['decodeBytes'];
  private readonly getCurrentState: SessionControllerDependencies['getCurrentState'];
  private readonly setState: SessionControllerDependencies['setState'];
  private readonly getViewport: SessionControllerDependencies['getViewport'];
  private readonly getDefaultColormapId: SessionControllerDependencies['getDefaultColormapId'];
  private readonly clearRendererImage: SessionControllerDependencies['clearRendererImage'];
  private readonly onSessionClosed: SessionControllerDependencies['onSessionClosed'];
  private readonly onAllSessionsClosed: SessionControllerDependencies['onAllSessionsClosed'];

  private sessions: OpenedImageSession[] = [];
  private activeSessionId: string | null = null;
  private sessionCounter = 0;

  constructor(dependencies: SessionControllerDependencies) {
    this.ui = dependencies.ui;
    this.loadQueue = dependencies.loadQueue;
    this.thumbnailService = dependencies.thumbnailService;
    this.renderCache = dependencies.renderCache;
    this.decodeBytes = dependencies.decodeBytes;
    this.getCurrentState = dependencies.getCurrentState;
    this.setState = dependencies.setState;
    this.getViewport = dependencies.getViewport;
    this.getDefaultColormapId = dependencies.getDefaultColormapId;
    this.clearRendererImage = dependencies.clearRendererImage;
    this.onSessionClosed = dependencies.onSessionClosed;
    this.onAllSessionsClosed = dependencies.onAllSessionsClosed;
  }

  enqueueFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async () => {
      for (const file of files) {
        await this.loadFile(file);
      }
    });
  }

  enqueueGalleryImage(galleryId: string): Promise<void> {
    return this.loadQueue.enqueue(async () => {
      await this.loadGalleryImage(galleryId);
    });
  }

  reloadSession(sessionId: string): Promise<void> {
    return this.loadQueue.enqueue(async () => {
      await this.reloadSessionWithUi(sessionId);
    });
  }

  reloadAllSessions(): Promise<void> {
    if (this.sessions.length === 0) {
      return Promise.resolve();
    }

    return this.loadQueue.enqueue(async () => {
      await this.reloadAllSessionsWithUi();
    });
  }

  switchActiveSession(sessionId: string): void {
    const nextSession = this.sessions.find((session) => session.id === sessionId);
    if (!nextSession || this.activeSessionId === nextSession.id) {
      return;
    }

    const currentState = this.getCurrentState();
    const nextState = buildSwitchedSessionState(nextSession, currentState, this.getActiveSession()?.decoded ?? null);

    this.activeSessionId = nextSession.id;
    this.syncOpenedImageOptions();
    this.syncActiveSessionExportTarget();

    this.setState(nextState);
  }

  reorderSessions(draggedSessionId: string, targetSessionId: string): void {
    if (this.sessions.length <= 1 || draggedSessionId === targetSessionId) {
      return;
    }

    const draggedIndex = this.sessions.findIndex((session) => session.id === draggedSessionId);
    const targetIndex = this.sessions.findIndex((session) => session.id === targetSessionId);
    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const reordered = [...this.sessions];
    const [draggedSession] = reordered.splice(draggedIndex, 1);
    if (!draggedSession) {
      return;
    }

    reordered.splice(targetIndex, 0, draggedSession);
    this.sessions = reordered;
    this.syncOpenedImageOptions();
  }

  closeSession(sessionId: string): void {
    const removeIndex = this.sessions.findIndex((session) => session.id === sessionId);
    if (removeIndex < 0) {
      return;
    }

    const removingActiveSession = this.activeSessionId === sessionId;
    const removedSession = this.sessions[removeIndex] ?? null;
    this.sessions = this.sessions.filter((session) => session.id !== sessionId);
    this.thumbnailService.discard(sessionId);
    this.renderCache.discard(sessionId);
    this.onSessionClosed?.(sessionId);

    if (!removingActiveSession) {
      this.syncOpenedImageOptions();
      this.syncActiveSessionExportTarget();
      return;
    }

    if (this.sessions.length === 0) {
      this.clearAllSessionsState();
      return;
    }

    const nextIndex = pickNextSessionIndexAfterRemoval(removeIndex, this.sessions.length);
    if (nextIndex < 0) {
      return;
    }

    const nextSession = this.sessions[nextIndex];
    const currentState = this.getCurrentState();
    const nextState = buildSwitchedSessionState(nextSession, currentState, removedSession?.decoded ?? null);
    this.activeSessionId = nextSession.id;

    this.syncOpenedImageOptions();
    this.syncActiveSessionExportTarget();
    this.setState(nextState);
  }

  closeAllSessions(): void {
    if (this.sessions.length === 0) {
      return;
    }

    this.clearAllSessionsState();
  }

  resetActiveSessionState(): void {
    const defaultColormapId = this.getDefaultColormapId();
    const activeSession = this.getActiveSession();
    const currentState = this.getCurrentState();

    if (!activeSession) {
      this.setState(createClearedViewerState(defaultColormapId));
      return;
    }

    const fitView = this.computeFitView(activeSession.decoded.width, activeSession.decoded.height);
    const nextState = buildViewerStateForLayer(
      {
        ...createClearedViewerState(defaultColormapId),
        viewerMode: currentState.viewerMode,
        zoom: fitView.zoom,
        panX: fitView.panX,
        panY: fitView.panY
      },
      activeSession.decoded,
      0
    );

    activeSession.state = nextState;

    this.setState(nextState);
  }

  handleStoreChange(state: ViewerState): void {
    persistActiveSessionState(this.sessions, this.activeSessionId, state);
  }

  getSessions(): OpenedImageSession[] {
    return this.sessions;
  }

  getActiveSession(): OpenedImageSession | null {
    if (!this.activeSessionId) {
      return null;
    }

    return this.sessions.find((session) => session.id === this.activeSessionId) ?? null;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  syncOpenedImageOptions(): void {
    this.ui.setOpenedImageOptions(
      this.sessions.map((session) => ({
        id: session.id,
        label: session.displayName,
        sizeBytes: session.fileSizeBytes,
        sourceDetail: getSessionSourceDetail(session.source, session.filename),
        thumbnailDataUrl: this.thumbnailService.getThumbnailDataUrl(session.id),
        pinned: this.renderCache.isPinned(session.id)
      })),
      this.activeSessionId
    );
  }

  syncActiveSessionExportTarget(): void {
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      this.ui.setExportTarget(null);
      return;
    }

    this.ui.setExportTarget({
      filename: buildDefaultExportFilename(activeSession.displayName),
      sourceWidth: activeSession.decoded.width,
      sourceHeight: activeSession.decoded.height
    });
  }

  private async loadGalleryImage(galleryId: string): Promise<void> {
    this.ui.setLoading(true);
    this.ui.setError(null);

    const galleryImage = GALLERY_IMAGES.find((item) => item.id === galleryId);
    if (!galleryImage) {
      this.ui.setError(`Unknown gallery image: ${galleryId}`);
      this.ui.setLoading(false);
      return;
    }

    const galleryImageUrl = `${import.meta.env.BASE_URL}${galleryImage.filename}`;

    try {
      const response = await fetch(galleryImageUrl);
      if (!response.ok) {
        throw new Error(`Failed to load ${galleryImageUrl} (${response.status})`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      await this.applyDecodedImage(await this.decodeBytes(bytes), galleryImage.filename, bytes.byteLength, {
        kind: 'url',
        url: galleryImageUrl
      });
    } catch (error) {
      this.ui.setError(error instanceof Error ? error.message : `Unknown error while loading ${galleryImage.label}`);
    } finally {
      this.ui.setLoading(false);
    }
  }

  private async loadFile(file: File): Promise<void> {
    this.ui.setLoading(true);
    this.ui.setError(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await this.decodeBytes(bytes);
      await this.applyDecodedImage(decoded, file.name, file.size, {
        kind: 'file',
        file
      });
    } catch (error) {
      this.ui.setError(error instanceof Error ? `Load failed: ${error.message}` : 'Load failed.');
    } finally {
      this.ui.setLoading(false);
    }
  }

  private async applyDecodedImage(
    decoded: DecodedExrImage,
    filename: string,
    fileSizeBytes: number | null,
    source: SessionSource
  ): Promise<void> {
    const sessionId = `session-${++this.sessionCounter}`;
    const displayName = buildSessionDisplayName(
      filename,
      this.sessions.map((session) => session.filename)
    );

    const fitView = this.computeFitView(decoded.width, decoded.height);
    const initialExposureEv = this.activeSessionId ? this.getCurrentState().exposureEv : 0;
    const sessionState = buildViewerStateForLayer(
      {
        ...createClearedViewerState(this.getDefaultColormapId()),
        exposureEv: initialExposureEv,
        zoom: fitView.zoom,
        panX: fitView.panX,
        panY: fitView.panY
      },
      decoded,
      0
    );

    const session: OpenedImageSession = {
      id: sessionId,
      filename,
      displayName,
      fileSizeBytes,
      source,
      decoded,
      state: sessionState
    };

    this.sessions = [...this.sessions, session];
    this.activeSessionId = session.id;
    this.syncOpenedImageOptions();
    this.syncActiveSessionExportTarget();

    this.setState(session.state);
    await this.thumbnailService.enqueue(session.id, session.state);
  }

  private async reloadSessionWithUi(sessionId: string): Promise<void> {
    this.ui.setLoading(true);
    this.ui.setError(null);

    try {
      const error = await this.reloadSessionByIdInternal(sessionId);
      if (error) {
        this.ui.setError(`Reload failed: ${error}`);
      }
    } finally {
      this.ui.setLoading(false);
    }
  }

  private async reloadAllSessionsWithUi(): Promise<void> {
    const reloadIds = this.sessions.map((session) => session.id);
    const failures: string[] = [];

    this.ui.setLoading(true);
    this.ui.setError(null);

    try {
      for (const sessionId of reloadIds) {
        const label = this.sessions.find((session) => session.id === sessionId)?.displayName ?? sessionId;
        const error = await this.reloadSessionByIdInternal(sessionId);
        if (error) {
          failures.push(`${label}: ${error}`);
        }
      }

      if (failures.length > 0) {
        const preview = failures.slice(0, 3).join(' | ');
        const suffix = failures.length > 3 ? ` (+${failures.length - 3} more)` : '';
        this.ui.setError(`Reload all finished with ${failures.length} failure(s): ${preview}${suffix}`);
      }
    } finally {
      this.ui.setLoading(false);
    }
  }

  private async reloadSessionByIdInternal(sessionId: string): Promise<string | null> {
    const sessionIndex = this.sessions.findIndex((session) => session.id === sessionId);
    if (sessionIndex < 0) {
      return 'Session not found.';
    }

    const session = this.sessions[sessionIndex];
    if (!session) {
      return 'Session not found.';
    }

    try {
      const decoded = await decodeExrFromSessionSource(session.source, this.decodeBytes);
      const baseState = this.activeSessionId === sessionId ? this.getCurrentState() : session.state;
      const nextState = buildReloadedSessionState(baseState, session.decoded, decoded);
      this.renderCache.discard(sessionId, { preservePinned: true });
      this.thumbnailService.discard(sessionId, { preserveDataUrl: true });
      const reloadedSession: OpenedImageSession = {
        ...session,
        decoded,
        state: nextState
      };

      this.sessions = this.sessions.map((current) => (current.id === sessionId ? reloadedSession : current));
      this.syncOpenedImageOptions();
      this.syncActiveSessionExportTarget();

      if (this.activeSessionId === sessionId) {
        this.setState(nextState);
      }

      await this.thumbnailService.enqueue(sessionId, nextState);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown error.';
    }
  }

  private clearAllSessionsState(): void {
    for (const session of this.sessions) {
      this.thumbnailService.discard(session.id);
    }
    this.sessions = [];
    this.thumbnailService.clear();
    this.renderCache.clear();
    this.activeSessionId = null;

    this.onAllSessionsClosed?.();
    this.clearRendererImage();
    this.setState(createClearedViewerState(this.getDefaultColormapId()));

    this.syncOpenedImageOptions();
    this.syncActiveSessionExportTarget();
  }

  private computeFitView(width: number, height: number): { zoom: number; panX: number; panY: number } {
    const viewport = this.getViewport();
    const fitZoom = clampZoom(Math.min(viewport.width / width, viewport.height / height));

    return {
      zoom: fitZoom,
      panX: width * 0.5,
      panY: height * 0.5
    };
  }
}

async function decodeExrFromSessionSource(
  source: SessionSource,
  decodeBytes: (bytes: Uint8Array) => Promise<DecodedExrImage>
): Promise<DecodedExrImage> {
  if (source.kind === 'url') {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to load ${source.url} (${response.status})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return await decodeBytes(bytes);
  }

  const bytes = new Uint8Array(await source.file.arrayBuffer());
  return await decodeBytes(bytes);
}

function createClearedViewerState(defaultColormapId: string): ViewerState {
  return {
    exposureEv: 0,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: defaultColormapId,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
    activeLayer: 0,
    displaySelection: null,
    hoveredPixel: null,
    lockedPixel: null
  };
}

function getSessionSourceDetail(source: SessionSource, fallbackName: string): string {
  if (source.kind === 'url') {
    return source.url;
  }

  const relativePath = source.file.webkitRelativePath.trim();
  return relativePath || source.file.name || fallbackName;
}

function buildReloadedSessionState(
  currentState: ViewerState,
  previousImage: DecodedExrImage,
  decoded: DecodedExrImage
): ViewerState {
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, decoded.width, decoded.height)
    : null;
  const hoveredPixel = currentState.hoveredPixel
    ? clampPixelToImageBounds(currentState.hoveredPixel, decoded.width, decoded.height)
    : null;
  const nextImageCamera = currentState.viewerMode === 'image'
    ? {
        zoom: currentState.zoom,
        ...remapPanToImageCenterAnchor(
          currentState.panX,
          currentState.panY,
          previousImage,
          decoded
        )
      }
    : {
        zoom: currentState.zoom,
        panX: currentState.panX,
        panY: currentState.panY
      };

  return buildViewerStateForLayer(
    {
      ...currentState,
      ...nextImageCamera,
      hoveredPixel,
      lockedPixel
    },
    decoded,
    currentState.activeLayer
  );
}

function buildSwitchedSessionState(
  nextSession: OpenedImageSession,
  currentState: ViewerState,
  previousImage: DecodedExrImage | null
): ViewerState {
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, nextSession.decoded.width, nextSession.decoded.height)
    : null;
  const hoveredPixel = !lockedPixel && currentState.hoveredPixel
    ? clampPixelToImageBounds(currentState.hoveredPixel, nextSession.decoded.width, nextSession.decoded.height)
    : null;
  const nextImageCamera = currentState.viewerMode === 'image'
    ? {
        zoom: currentState.zoom,
        ...remapPanToImageCenterAnchor(
          currentState.panX,
          currentState.panY,
          previousImage,
          nextSession.decoded
        )
      }
    : {
        zoom: nextSession.state.zoom,
        panX: nextSession.state.panX,
        panY: nextSession.state.panY
      };
  const nextPanoramaCamera = currentState.viewerMode === 'panorama'
    ? {
        panoramaYawDeg: currentState.panoramaYawDeg,
        panoramaPitchDeg: currentState.panoramaPitchDeg,
        panoramaHfovDeg: currentState.panoramaHfovDeg
      }
    : {
        panoramaYawDeg: nextSession.state.panoramaYawDeg,
        panoramaPitchDeg: nextSession.state.panoramaPitchDeg,
        panoramaHfovDeg: nextSession.state.panoramaHfovDeg
      };

  const nextState = buildViewerStateForLayer(
    {
      ...nextSession.state,
      viewerMode: currentState.viewerMode,
      ...nextImageCamera,
      ...nextPanoramaCamera,
      exposureEv: currentState.exposureEv,
      displaySelection: cloneDisplaySelection(currentState.displaySelection),
      visualizationMode: currentState.visualizationMode,
      activeColormapId: currentState.activeColormapId,
      colormapRange: cloneDisplayLuminanceRange(currentState.colormapRange),
      colormapRangeMode: currentState.colormapRangeMode,
      colormapZeroCentered: currentState.colormapZeroCentered,
      stokesDegreeModulation: { ...currentState.stokesDegreeModulation },
      hoveredPixel,
      lockedPixel
    },
    nextSession.decoded,
    nextSession.state.activeLayer
  );

  if (lockedPixel) {
    nextState.hoveredPixel = null;
  }

  return nextState;
}

function remapPanToImageCenterAnchor(
  panX: number,
  panY: number,
  previousImage: DecodedExrImage | null,
  nextImage: DecodedExrImage
): { panX: number; panY: number } {
  if (!previousImage) {
    return { panX, panY };
  }

  const previousCenterX = previousImage.width * 0.5;
  const previousCenterY = previousImage.height * 0.5;
  const nextCenterX = nextImage.width * 0.5;
  const nextCenterY = nextImage.height * 0.5;

  return {
    panX: nextCenterX + (panX - previousCenterX),
    panY: nextCenterY + (panY - previousCenterY)
  };
}

function clampPixelToImageBounds(pixel: ImagePixel, width: number, height: number): ImagePixel | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  return {
    ix: pixel.ix,
    iy: pixel.iy
  };
}
