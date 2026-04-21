import {
  clampDisplayCacheBudgetMb,
  createSessionResourceEntry,
  displayCacheBudgetMbToBytes,
  getTrackedSessionCpuBytes,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb,
  type SessionResourceEntry
} from '../display-cache';
import { shouldRefreshDisplayLuminanceRange } from '../colormap-range';
import {
  buildDisplaySourceBinding,
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture,
  computeDisplaySelectionLuminanceRange
} from '../display-texture';
import type {
  DecodedExrImage,
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerState
} from '../types';
import type { Disposable } from '../lifecycle';

export interface PrepareActiveSessionResult {
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
  ensureLayerSourceTextures: (
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer
  ) => void;
  setDisplaySelectionBindings: (
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    selection: ViewerState['displaySelection'],
    textureRevisionKey: string,
    binding: ReturnType<typeof buildDisplaySourceBinding>
  ) => void;
  discardSessionTextures: (sessionId: string) => void;
}

export interface RenderCacheServiceDependencies {
  ui: RenderCacheUi;
  renderer: RenderCacheRenderer;
  getActiveSessionId?: () => string | null;
}

export class RenderCacheService implements Disposable {
  private readonly ui: RenderCacheUi;
  private readonly renderer: RenderCacheRenderer;

  private readonly entries = new Map<string, SessionResourceEntry>();
  private budgetMb = readStoredDisplayCacheBudgetMb();
  private boundSessionId: string | null = null;
  private boundTextureRevisionKey = '';
  private disposed = false;

  constructor(dependencies: RenderCacheServiceDependencies) {
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;

    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  prepareActiveSession(session: OpenedImageSession, state: ViewerState): PrepareActiveSessionResult {
    if (this.disposed) {
      return {
        displayLuminanceRange: null,
        textureRevisionKey: '',
        textureDirty: false,
        luminanceRangeDirty: false
      };
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        displayLuminanceRange: null,
        textureRevisionKey: '',
        textureDirty: false,
        luminanceRangeDirty: false
      };
    }

    const entry = this.getOrCreateEntry(session);
    const textureRevisionKey = buildDisplayTextureRevisionKey(state);
    const textureDirty =
      this.boundSessionId !== session.id ||
      this.boundTextureRevisionKey !== textureRevisionKey;

    if (!entry.layerUploads.has(state.activeLayer)) {
      this.renderer.ensureLayerSourceTextures(
        session.id,
        state.activeLayer,
        session.decoded.width,
        session.decoded.height,
        layer
      );
      entry.layerUploads.add(state.activeLayer);
    }

    if (textureDirty) {
      this.renderer.setDisplaySelectionBindings(
        session.id,
        state.activeLayer,
        session.decoded.width,
        session.decoded.height,
        layer,
        state.displaySelection,
        textureRevisionKey,
        buildDisplaySourceBinding(layer, state.displaySelection)
      );
      this.boundSessionId = session.id;
      this.boundTextureRevisionKey = textureRevisionKey;
    }

    entry.activeTextureRevisionKey = textureRevisionKey;

    const luminanceRangeDirty = shouldRefreshDisplayLuminanceRange(
      state.visualizationMode,
      textureRevisionKey,
      entry.luminanceRangeByRevision.has(textureRevisionKey) ? textureRevisionKey : '',
      true
    );

    if (luminanceRangeDirty) {
      entry.luminanceRangeByRevision.set(
        textureRevisionKey,
        computeDisplaySelectionLuminanceRange(
          layer,
          session.decoded.width,
          session.decoded.height,
          state.displaySelection
        )
      );
    }

    this.syncDisplayCacheUsageUi();

    return {
      displayLuminanceRange: entry.luminanceRangeByRevision.get(textureRevisionKey) ?? null,
      textureRevisionKey,
      textureDirty,
      luminanceRangeDirty
    };
  }

  getTextureForSnapshot(
    session: OpenedImageSession,
    state: Pick<ViewerState, 'activeLayer' | 'displaySelection'>
  ): Float32Array | null {
    if (this.disposed) {
      return null;
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

  getCachedLuminanceRange(
    sessionId: string,
    state: Pick<ViewerState, 'activeLayer' | 'displaySelection'>
  ): DisplayLuminanceRange | null {
    if (this.disposed) {
      return null;
    }

    const entry = this.entries.get(sessionId);
    if (!entry) {
      return null;
    }

    return entry.luminanceRangeByRevision.get(buildDisplayTextureRevisionKey(state)) ?? null;
  }

  setBudgetMb(valueMb: number): void {
    if (this.disposed) {
      return;
    }

    this.budgetMb = clampDisplayCacheBudgetMb(valueMb);
    saveStoredDisplayCacheBudgetMb(this.budgetMb);
    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  discard(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    if (!this.entries.has(sessionId)) {
      return;
    }

    this.entries.delete(sessionId);
    this.renderer.discardSessionTextures(sessionId);
    this.clearBoundTextureTracking(sessionId);
    this.syncDisplayCacheUsageUi();
  }

  clear(): void {
    if (this.disposed) {
      return;
    }

    for (const sessionId of this.entries.keys()) {
      this.renderer.discardSessionTextures(sessionId);
    }
    this.entries.clear();
    this.boundSessionId = null;
    this.boundTextureRevisionKey = '';
    this.syncDisplayCacheUsageUi();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const sessionId of this.entries.keys()) {
      this.renderer.discardSessionTextures(sessionId);
    }
    this.entries.clear();
    this.boundSessionId = null;
    this.boundTextureRevisionKey = '';
  }

  private getOrCreateEntry(session: OpenedImageSession): SessionResourceEntry {
    const existing = this.entries.get(session.id);
    if (existing) {
      return existing;
    }

    const entry = createSessionResourceEntry(session.id, getDecodedImageByteSize(session.decoded));
    this.entries.set(session.id, entry);
    return entry;
  }

  private syncDisplayCacheUsageUi(): void {
    this.ui.setDisplayCacheUsage(
      getTrackedSessionCpuBytes([...this.entries.values()]),
      displayCacheBudgetMbToBytes(this.budgetMb)
    );
  }

  private clearBoundTextureTracking(sessionId: string): void {
    if (this.boundSessionId === sessionId) {
      this.boundSessionId = null;
      this.boundTextureRevisionKey = '';
    }
  }
}

function getDecodedImageByteSize(decoded: DecodedExrImage): number {
  return decoded.layers.reduce((total, layer) => total + layer.channelStorage.pixels.byteLength, 0);
}
