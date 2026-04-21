import {
  clampDisplayCacheBudgetMb,
  createDisplayCacheEntry,
  displayCacheBudgetMbToBytes,
  getRetainedDisplayCacheBytes,
  pruneDisplayCachesToBudget,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb,
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
import type { Disposable } from '../lifecycle';

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

export class RenderCacheService implements Disposable {
  private readonly ui: RenderCacheUi;
  private readonly renderer: RenderCacheRenderer;
  private readonly getActiveSessionId: RenderCacheServiceDependencies['getActiveSessionId'];

  private readonly entries = new Map<string, DisplayCacheEntry>();
  private budgetMb = readStoredDisplayCacheBudgetMb();
  private touchCounter = 0;
  private uploadedSessionId: string | null = null;
  private uploadedTextureRevisionKey = '';
  private disposed = false;

  constructor(dependencies: RenderCacheServiceDependencies) {
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.getActiveSessionId = dependencies.getActiveSessionId;

    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  prepareActiveSession(session: OpenedImageSession, state: ViewerState): PrepareActiveSessionResult {
    if (this.disposed) {
      return {
        displayTexture: null,
        displayLuminanceRange: null,
        textureRevisionKey: '',
        textureDirty: false,
        luminanceRangeDirty: false
      };
    }

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
    if (this.disposed) {
      return null;
    }

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
    if (this.disposed) {
      return null;
    }

    return this.entries.get(sessionId)?.displayLuminanceRange ?? null;
  }

  setBudgetMb(valueMb: number): void {
    if (this.disposed) {
      return;
    }

    this.budgetMb = clampDisplayCacheBudgetMb(valueMb);
    saveStoredDisplayCacheBudgetMb(this.budgetMb);
    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.pruneToBudget();
    this.syncDisplayCacheUsageUi();
  }

  discard(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    const entry = this.entries.get(sessionId);
    if (!entry) {
      return;
    }

    this.clearUploadTracking(sessionId);
    this.entries.delete(sessionId);

    this.syncDisplayCacheUsageUi();
  }

  clear(): void {
    if (this.disposed) {
      return;
    }

    this.entries.clear();
    this.uploadedSessionId = null;
    this.uploadedTextureRevisionKey = '';
    this.syncDisplayCacheUsageUi();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.entries.clear();
    this.uploadedSessionId = null;
    this.uploadedTextureRevisionKey = '';
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
}
