import {
  clampDisplayCacheBudgetMb,
  createSessionResourceEntry,
  displayCacheBudgetMbToBytes,
  getTrackedResidentTextureBytes,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb,
  type SessionResourceEntry
} from '../display-cache';
import {
  buildDisplaySourceBinding,
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture,
  computeDisplaySelectionLuminanceRange
} from '../display-texture';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerSessionState
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
  ) => number;
  setDisplaySelectionBindings: (
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    selection: ViewerSessionState['displaySelection'],
    textureRevisionKey: string,
    binding: ReturnType<typeof buildDisplaySourceBinding>
  ) => void;
  discardLayerSourceTextures: (sessionId: string, layerIndex: number) => void;
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
  private readonly getActiveSessionId: () => string | null;

  private readonly entries = new Map<string, SessionResourceEntry>();
  private budgetMb = readStoredDisplayCacheBudgetMb();
  private boundSessionId: string | null = null;
  private boundTextureRevisionKey = '';
  private nextAccessToken = 1;
  private disposed = false;

  constructor(dependencies: RenderCacheServiceDependencies) {
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.getActiveSessionId = dependencies.getActiveSessionId ?? (() => null);

    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  prepareActiveSession(session: OpenedImageSession, state: ViewerSessionState): PrepareActiveSessionResult {
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

    const entry = this.getOrCreateEntry(session.id);
    const textureRevisionKey = buildDisplayTextureRevisionKey(state);
    const layerResident = entry.residentLayers.has(state.activeLayer);
    const textureDirty =
      !layerResident ||
      this.boundSessionId !== session.id ||
      this.boundTextureRevisionKey !== textureRevisionKey;

    if (!layerResident) {
      this.enforceResidencyBudget({
        reservedBytes: predictLayerTextureBytes(session.decoded.width, session.decoded.height, layer),
        protectedSessionIds: new Set([session.id])
      });

      const textureBytes = this.renderer.ensureLayerSourceTextures(
        session.id,
        state.activeLayer,
        session.decoded.width,
        session.decoded.height,
        layer
      );
      entry.residentLayers.set(state.activeLayer, {
        textureBytes: Math.max(0, Math.floor(textureBytes)),
        lastAccessToken: this.takeAccessToken()
      });

      this.enforceResidencyBudget({
        protectedSessionIds: new Set([session.id])
      });
    } else {
      this.touchResidentLayer(entry, state.activeLayer);
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

    const luminanceRangeDirty = !entry.luminanceRangeByRevision.has(textureRevisionKey);
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
    state: Pick<ViewerSessionState, 'activeLayer' | 'displaySelection'>
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
    state: Pick<ViewerSessionState, 'activeLayer' | 'displaySelection'>
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
    this.enforceResidencyBudget();
    saveStoredDisplayCacheBudgetMb(this.budgetMb);
    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  discard(sessionId: string): void {
    if (this.disposed) {
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
    this.nextAccessToken = 1;
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
    this.nextAccessToken = 1;
  }

  setSessionPinned(sessionId: string, pinned: boolean): void {
    if (this.disposed) {
      return;
    }

    if (!pinned && !this.entries.has(sessionId)) {
      return;
    }

    const entry = this.getOrCreateEntry(sessionId);
    entry.pinned = pinned;
    if (!pinned) {
      this.enforceResidencyBudget();
    }
    this.syncDisplayCacheUsageUi();
  }

  isSessionPinned(sessionId: string): boolean {
    if (this.disposed) {
      return false;
    }

    return this.entries.get(sessionId)?.pinned ?? false;
  }

  private getOrCreateEntry(sessionId: string): SessionResourceEntry {
    const existing = this.entries.get(sessionId);
    if (existing) {
      return existing;
    }

    const entry = createSessionResourceEntry(sessionId);
    this.entries.set(sessionId, entry);
    return entry;
  }

  private syncDisplayCacheUsageUi(): void {
    this.ui.setDisplayCacheUsage(
      getTrackedResidentTextureBytes([...this.entries.values()]),
      displayCacheBudgetMbToBytes(this.budgetMb)
    );
  }

  private clearBoundTextureTracking(sessionId: string): void {
    if (this.boundSessionId === sessionId) {
      this.boundSessionId = null;
      this.boundTextureRevisionKey = '';
    }
  }

  private touchResidentLayer(entry: SessionResourceEntry, layerIndex: number): void {
    const layer = entry.residentLayers.get(layerIndex);
    if (!layer) {
      return;
    }

    layer.lastAccessToken = this.takeAccessToken();
  }

  private takeAccessToken(): number {
    const token = this.nextAccessToken;
    this.nextAccessToken += 1;
    return token;
  }

  private enforceResidencyBudget(options: {
    reservedBytes?: number;
    protectedSessionIds?: ReadonlySet<string>;
  } = {}): void {
    const reservedBytes = Math.max(0, Math.floor(options.reservedBytes ?? 0));
    const budgetBytes = displayCacheBudgetMbToBytes(this.budgetMb);
    let trackedBytes = getTrackedResidentTextureBytes([...this.entries.values()]);
    if (trackedBytes + reservedBytes <= budgetBytes) {
      return;
    }

    const protectedSessionIds = this.buildProtectedSessionIds(options.protectedSessionIds);
    for (const candidate of this.getEvictionCandidates(protectedSessionIds)) {
      if (trackedBytes + reservedBytes <= budgetBytes) {
        break;
      }
      trackedBytes -= this.evictResidentLayer(candidate.sessionId, candidate.layerIndex);
    }
  }

  private buildProtectedSessionIds(extraProtectedSessionIds?: ReadonlySet<string>): Set<string> {
    const protectedSessionIds = new Set(extraProtectedSessionIds ?? []);
    const activeSessionId = this.getActiveSessionId();
    if (activeSessionId) {
      protectedSessionIds.add(activeSessionId);
    }

    for (const [sessionId, entry] of this.entries) {
      if (entry.pinned) {
        protectedSessionIds.add(sessionId);
      }
    }

    return protectedSessionIds;
  }

  private getEvictionCandidates(
    protectedSessionIds: ReadonlySet<string>
  ): Array<{ sessionId: string; layerIndex: number; lastAccessToken: number }> {
    const candidates: Array<{ sessionId: string; layerIndex: number; lastAccessToken: number }> = [];

    for (const [sessionId, entry] of this.entries) {
      if (protectedSessionIds.has(sessionId)) {
        continue;
      }

      for (const [layerIndex, layer] of entry.residentLayers) {
        candidates.push({
          sessionId,
          layerIndex,
          lastAccessToken: layer.lastAccessToken
        });
      }
    }

    candidates.sort((left, right) => {
      if (left.lastAccessToken !== right.lastAccessToken) {
        return left.lastAccessToken - right.lastAccessToken;
      }
      if (left.sessionId !== right.sessionId) {
        return left.sessionId.localeCompare(right.sessionId);
      }
      return left.layerIndex - right.layerIndex;
    });
    return candidates;
  }

  private evictResidentLayer(sessionId: string, layerIndex: number): number {
    const entry = this.entries.get(sessionId);
    const layer = entry?.residentLayers.get(layerIndex);
    if (!entry || !layer) {
      return 0;
    }

    entry.residentLayers.delete(layerIndex);
    this.renderer.discardLayerSourceTextures(sessionId, layerIndex);
    return Math.max(0, Math.floor(layer.textureBytes));
  }
}

function predictLayerTextureBytes(width: number, height: number, layer: DecodedLayer): number {
  const validChannelCount = layer.channelNames.reduce((count, channelName) => {
    if (!channelName) {
      return count;
    }
    return layer.channelStorage.channelIndexByName[channelName] === undefined ? count : count + 1;
  }, 0);

  return Math.max(0, width * height * validChannelCount * Float32Array.BYTES_PER_ELEMENT);
}
