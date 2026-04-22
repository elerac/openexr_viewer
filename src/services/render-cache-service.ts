import {
  clampDisplayCacheBudgetMb,
  createSessionResourceEntry,
  displayCacheBudgetMbToBytes,
  getTrackedResidentTextureBytes,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb,
  type ResidentLayerResourceEntry,
  type SessionResourceEntry
} from '../display-cache';
import {
  buildDisplayLuminanceRevisionKey,
  buildDisplaySourceBinding,
  getDisplaySourceBindingChannelNames,
  buildDisplayTextureRevisionKey,
  buildSelectedDisplayTexture,
  serializeDisplaySelectionLuminanceKey,
  computeDisplaySelectionLuminanceRange
} from '../display-texture';
import { getFiniteChannelRange } from '../channel-storage';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  DisplaySelection,
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
  ensureLayerChannelsResident: (
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    channelNames: string[]
  ) => string[];
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
  discardChannelSourceTexture: (sessionId: string, layerIndex: number, channelName: string) => void;
  discardLayerSourceTextures: (sessionId: string, layerIndex: number) => void;
  discardSessionTextures: (sessionId: string) => void;
}

interface ProtectedBinding {
  sessionId: string;
  layerIndex: number;
  channelNames: Set<string>;
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
  private boundLayerIndex: number | null = null;
  private boundChannelNames = new Set<string>();
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
    const luminanceRevisionKey = buildDisplayLuminanceRevisionKey(state);
    const binding = buildDisplaySourceBinding(layer, state.displaySelection);
    const requiredChannelNames = getDisplaySourceBindingChannelNames(binding).filter((channelName) => {
      return layer.channelStorage.channelIndexByName[channelName] !== undefined;
    });
    const residentLayer = this.getOrCreateResidentLayerEntry(entry, state.activeLayer);
    const missingChannelNames = requiredChannelNames.filter((channelName) => {
      return !residentLayer.residentChannels.has(channelName);
    });
    const textureDirty =
      missingChannelNames.length > 0 ||
      this.boundSessionId !== session.id ||
      this.boundTextureRevisionKey !== textureRevisionKey;

    if (missingChannelNames.length > 0) {
      const protectedBinding: ProtectedBinding = {
        sessionId: session.id,
        layerIndex: state.activeLayer,
        channelNames: new Set(requiredChannelNames)
      };
      this.enforceResidencyBudget({
        reservedBytes: predictChannelTextureBytes(
          session.decoded.width,
          session.decoded.height,
          missingChannelNames.length
        ),
        protectedBinding
      });

      const residentChannelNames = this.renderer.ensureLayerChannelsResident(
        session.id,
        state.activeLayer,
        session.decoded.width,
        session.decoded.height,
        layer,
        missingChannelNames
      );
      const textureBytes = predictChannelTextureBytes(session.decoded.width, session.decoded.height, 1);
      for (const channelName of residentChannelNames) {
        residentLayer.residentChannels.set(channelName, {
          textureBytes,
          lastAccessToken: this.takeAccessToken()
        });
      }

      this.enforceResidencyBudget({
        protectedBinding
      });
    }
    this.touchResidentChannels(residentLayer, requiredChannelNames);

    if (textureDirty) {
      this.renderer.setDisplaySelectionBindings(
        session.id,
        state.activeLayer,
        session.decoded.width,
        session.decoded.height,
        layer,
        state.displaySelection,
        textureRevisionKey,
        binding
      );
      this.boundSessionId = session.id;
      this.boundLayerIndex = state.activeLayer;
      this.boundChannelNames = new Set(requiredChannelNames);
      this.boundTextureRevisionKey = textureRevisionKey;
    }

    const luminanceRangeDirty = !entry.luminanceRangeByRevision.has(luminanceRevisionKey);
    if (luminanceRangeDirty) {
      entry.luminanceRangeByRevision.set(luminanceRevisionKey, this.getOrComputeDisplayLuminanceRange(
        layer,
        session.decoded.width,
        session.decoded.height,
        state.displaySelection
      ));
    }

    this.syncDisplayCacheUsageUi();

    return {
      displayLuminanceRange: entry.luminanceRangeByRevision.get(luminanceRevisionKey) ?? null,
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

    return entry.luminanceRangeByRevision.get(buildDisplayLuminanceRevisionKey(state)) ?? null;
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
    this.boundLayerIndex = null;
    this.boundChannelNames.clear();
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
    this.boundLayerIndex = null;
    this.boundChannelNames.clear();
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
      this.boundLayerIndex = null;
      this.boundChannelNames.clear();
      this.boundTextureRevisionKey = '';
    }
  }

  private getOrCreateResidentLayerEntry(entry: SessionResourceEntry, layerIndex: number): ResidentLayerResourceEntry {
    const existing = entry.residentLayers.get(layerIndex);
    if (existing) {
      return existing;
    }

    const layer: ResidentLayerResourceEntry = {
      residentChannels: new Map()
    };
    entry.residentLayers.set(layerIndex, layer);
    return layer;
  }

  private touchResidentChannels(
    layer: ResidentLayerResourceEntry,
    channelNames: string[]
  ): void {
    if (channelNames.length === 0) {
      return;
    }

    for (const channelName of channelNames) {
      const channel = layer.residentChannels.get(channelName);
      if (!channel) {
        continue;
      }

      channel.lastAccessToken = this.takeAccessToken();
    }
  }

  private takeAccessToken(): number {
    const token = this.nextAccessToken;
    this.nextAccessToken += 1;
    return token;
  }

  private enforceResidencyBudget(options: {
    reservedBytes?: number;
    protectedBinding?: ProtectedBinding | null;
  } = {}): void {
    const reservedBytes = Math.max(0, Math.floor(options.reservedBytes ?? 0));
    const budgetBytes = displayCacheBudgetMbToBytes(this.budgetMb);
    let trackedBytes = getTrackedResidentTextureBytes([...this.entries.values()]);
    if (trackedBytes + reservedBytes <= budgetBytes) {
      return;
    }

    const protectedBinding = this.resolveProtectedBinding(options.protectedBinding);
    for (const candidate of this.getEvictionCandidates(protectedBinding)) {
      if (trackedBytes + reservedBytes <= budgetBytes) {
        break;
      }
      trackedBytes -= this.evictResidentChannel(candidate.sessionId, candidate.layerIndex, candidate.channelName);
    }
  }

  private resolveProtectedBinding(protectedBinding: ProtectedBinding | null | undefined): ProtectedBinding | null {
    if (protectedBinding) {
      return protectedBinding;
    }

    const activeSessionId = this.getActiveSessionId();
    if (!activeSessionId || activeSessionId !== this.boundSessionId || this.boundLayerIndex === null) {
      return null;
    }

    return {
      sessionId: this.boundSessionId,
      layerIndex: this.boundLayerIndex,
      channelNames: new Set(this.boundChannelNames)
    };
  }

  private getEvictionCandidates(
    protectedBinding: ProtectedBinding | null
  ): Array<{ sessionId: string; layerIndex: number; channelName: string; lastAccessToken: number }> {
    const candidates: Array<{ sessionId: string; layerIndex: number; channelName: string; lastAccessToken: number }> = [];

    for (const [sessionId, entry] of this.entries) {
      if (entry.pinned) {
        continue;
      }

      for (const [layerIndex, layer] of entry.residentLayers) {
        for (const [channelName, channel] of layer.residentChannels) {
          if (
            protectedBinding &&
            protectedBinding.sessionId === sessionId &&
            protectedBinding.layerIndex === layerIndex &&
            protectedBinding.channelNames.has(channelName)
          ) {
            continue;
          }

          candidates.push({
            sessionId,
            layerIndex,
            channelName,
            lastAccessToken: channel.lastAccessToken
          });
        }
      }
    }

    candidates.sort((left, right) => {
      if (left.lastAccessToken !== right.lastAccessToken) {
        return left.lastAccessToken - right.lastAccessToken;
      }
      if (left.sessionId !== right.sessionId) {
        return left.sessionId.localeCompare(right.sessionId);
      }
      if (left.layerIndex !== right.layerIndex) {
        return left.layerIndex - right.layerIndex;
      }
      return left.channelName.localeCompare(right.channelName);
    });
    return candidates;
  }

  private evictResidentChannel(sessionId: string, layerIndex: number, channelName: string): number {
    const entry = this.entries.get(sessionId);
    const layer = entry?.residentLayers.get(layerIndex);
    const channel = layer?.residentChannels.get(channelName);
    if (!entry || !layer || !channel) {
      return 0;
    }

    layer.residentChannels.delete(channelName);
    if (layer.residentChannels.size === 0) {
      entry.residentLayers.delete(layerIndex);
    }
    this.renderer.discardChannelSourceTexture(sessionId, layerIndex, channelName);
    return Math.max(0, Math.floor(channel.textureBytes));
  }

  private getOrComputeDisplayLuminanceRange(
    layer: DecodedLayer,
    width: number,
    height: number,
    selection: DisplaySelection | null
  ): DisplayLuminanceRange | null {
    const selectionKey = serializeDisplaySelectionLuminanceKey(selection);
    if (Object.prototype.hasOwnProperty.call(layer.analysis.displayLuminanceRangeBySelectionKey, selectionKey)) {
      return layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] ?? null;
    }

    let range: DisplayLuminanceRange | null;
    if (selection?.kind === 'channelMono') {
      if (Object.prototype.hasOwnProperty.call(layer.analysis.finiteRangeByChannel, selection.channel)) {
        range = layer.analysis.finiteRangeByChannel[selection.channel] ?? null;
      } else {
        range = getFiniteChannelRange(layer, selection.channel);
        layer.analysis.finiteRangeByChannel[selection.channel] = range;
      }
    } else {
      range = computeDisplaySelectionLuminanceRange(layer, width, height, selection);
    }

    layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] = range;
    return range;
  }
}

function predictChannelTextureBytes(width: number, height: number, channelCount: number): number {
  return Math.max(0, width * height * channelCount * Float32Array.BYTES_PER_ELEMENT);
}
