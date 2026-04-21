import {
  clampDisplayCacheBudgetMb,
  createDisplayCacheEntry,
  displayCacheBudgetMbToBytes,
  getRetainedDisplayCacheBytes,
  pruneDisplayCachesToBudget,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb,
  clearSessionDisplayCache,
  type DisplayCacheEntry
} from '../display-cache';
import {
  computeDisplayTextureLuminanceRange,
  shouldRefreshDisplayLuminanceRange
} from '../colormap-range';
import {
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture
} from '../display-texture';
import type {
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerState
} from '../types';

export interface PrepareActiveSessionResult {
  displayTexture: Float32Array | null;
  displayLuminanceRange: DisplayLuminanceRange | null;
  textureRevisionKey: string;
  textureDirty: boolean;
  luminanceRangeDirty: boolean;
}

interface RenderCacheUi {
  setDisplayCacheBudget: (mb: number) => void;
  setDisplayCacheUsage: (usedBytes: number, budgetBytes: number) => void;
}

interface RenderCacheRenderer {
  setDisplayTexture: (width: number, height: number, rgbaTexture: Float32Array) => void;
}

export interface RenderCacheServiceDependencies {
  ui: RenderCacheUi;
  renderer: RenderCacheRenderer;
  getActiveSessionId: () => string | null;
}

export class RenderCacheService {
  private readonly ui: RenderCacheUi;
  private readonly renderer: RenderCacheRenderer;
  private readonly getActiveSessionId: RenderCacheServiceDependencies['getActiveSessionId'];

  private readonly entries = new Map<string, DisplayCacheEntry>();
  private budgetMb = readStoredDisplayCacheBudgetMb();
  private touchCounter = 0;
  private uploadedSessionId: string | null = null;
  private uploadedTextureRevisionKey = '';

  constructor(dependencies: RenderCacheServiceDependencies) {
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.getActiveSessionId = dependencies.getActiveSessionId;

    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  prepareActiveSession(session: OpenedImageSession, state: ViewerState): PrepareActiveSessionResult {
    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        displayTexture: null,
        displayLuminanceRange: null,
        textureRevisionKey: '',
        textureDirty: false,
        luminanceRangeDirty: false
      };
    }

    const entry = this.getOrCreateEntry(session.id);
    const textureRevisionKey = buildDisplayTextureRevisionKey(state);
    const textureDirty = textureRevisionKey !== entry.textureRevisionKey || !entry.displayTexture;
    if (textureDirty) {
      entry.displayTexture = buildSelectedDisplayTexture(
        layer,
        session.decoded.width,
        session.decoded.height,
        state.displaySelection,
        entry.displayTexture ?? undefined
      );
      entry.textureRevisionKey = textureRevisionKey;
    }

    const luminanceRangeDirty = shouldRefreshDisplayLuminanceRange(
      state.visualizationMode,
      textureRevisionKey,
      entry.displayLuminanceRangeRevisionKey,
      Boolean(entry.displayTexture)
    );

    if (luminanceRangeDirty && entry.displayTexture) {
      entry.displayLuminanceRange = computeDisplayTextureLuminanceRange(entry.displayTexture);
      entry.displayLuminanceRangeRevisionKey = textureRevisionKey;
    }

    if (entry.displayTexture) {
      entry.lastTouched = ++this.touchCounter;
      this.pruneToBudget();
      this.syncDisplayCacheUsageUi();
      this.uploadRetainedTexture(session, entry);
    }

    return {
      displayTexture: entry.displayTexture,
      displayLuminanceRange: entry.displayLuminanceRange,
      textureRevisionKey: entry.textureRevisionKey,
      textureDirty,
      luminanceRangeDirty
    };
  }

  getTextureForSnapshot(session: OpenedImageSession, state: Pick<ViewerState, 'activeLayer' | 'displaySelection'>): Float32Array | null {
    const textureRevisionKey = buildDisplayTextureRevisionKey(state);
    const retained = this.entries.get(session.id);
    if (retained?.displayTexture && retained.textureRevisionKey === textureRevisionKey) {
      return retained.displayTexture;
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return null;
    }

    return buildSelectedDisplayTexture(
      layer,
      session.decoded.width,
      session.decoded.height,
      state.displaySelection
    );
  }

  getCachedLuminanceRange(sessionId: string): DisplayLuminanceRange | null {
    return this.entries.get(sessionId)?.displayLuminanceRange ?? null;
  }

  isPinned(sessionId: string): boolean {
    return this.entries.get(sessionId)?.pinned ?? false;
  }

  setBudgetMb(valueMb: number): void {
    this.budgetMb = clampDisplayCacheBudgetMb(valueMb);
    saveStoredDisplayCacheBudgetMb(this.budgetMb);
    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.pruneToBudget();
    this.syncDisplayCacheUsageUi();
  }

  togglePin(sessionId: string): void {
    const entry = this.getOrCreateEntry(sessionId);
    entry.pinned = !entry.pinned;
    this.pruneToBudget();
    this.syncDisplayCacheUsageUi();
    this.maybeDeleteEmptyEntry(sessionId);
  }

  discard(sessionId: string, options: { preservePinned?: boolean } = {}): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return;
    }

    const { preservePinned = false } = options;
    const pinned = entry.pinned;

    this.clearUploadTracking(sessionId);

    if (preservePinned) {
      clearSessionDisplayCache(entry);
      entry.pinned = pinned;
    } else {
      this.entries.delete(sessionId);
    }

    this.syncDisplayCacheUsageUi();
  }

  clear(): void {
    this.entries.clear();
    this.uploadedSessionId = null;
    this.uploadedTextureRevisionKey = '';
    this.syncDisplayCacheUsageUi();
  }

  private getOrCreateEntry(sessionId: string): DisplayCacheEntry {
    const existing = this.entries.get(sessionId);
    if (existing) {
      return existing;
    }

    const entry = createDisplayCacheEntry(sessionId);
    this.entries.set(sessionId, entry);
    return entry;
  }

  private pruneToBudget(): void {
    pruneDisplayCachesToBudget(
      [...this.entries.values()],
      this.getActiveSessionId(),
      displayCacheBudgetMbToBytes(this.budgetMb)
    );

    for (const [sessionId, entry] of this.entries) {
      if (entry.displayTexture) {
        continue;
      }

      if (entry.pinned) {
        continue;
      }

      this.entries.delete(sessionId);
    }
  }

  private uploadRetainedTexture(session: OpenedImageSession, entry: DisplayCacheEntry): void {
    const needsUpload =
      this.uploadedSessionId !== session.id ||
      this.uploadedTextureRevisionKey !== entry.textureRevisionKey;

    if (!needsUpload || !entry.displayTexture) {
      return;
    }

    this.renderer.setDisplayTexture(
      session.decoded.width,
      session.decoded.height,
      entry.displayTexture
    );
    this.uploadedSessionId = session.id;
    this.uploadedTextureRevisionKey = entry.textureRevisionKey;
  }

  private syncDisplayCacheUsageUi(): void {
    this.ui.setDisplayCacheUsage(
      getRetainedDisplayCacheBytes([...this.entries.values()]),
      displayCacheBudgetMbToBytes(this.budgetMb)
    );
  }

  private clearUploadTracking(sessionId: string): void {
    if (this.uploadedSessionId === sessionId) {
      this.uploadedSessionId = null;
      this.uploadedTextureRevisionKey = '';
    }
  }

  private maybeDeleteEmptyEntry(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return;
    }

    if (entry.pinned || entry.displayTexture) {
      return;
    }

    this.entries.delete(sessionId);
  }
}
