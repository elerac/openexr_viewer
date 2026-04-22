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
  serializeDisplaySelectionLuminanceKey,
  computeDisplaySelectionLuminanceRange
} from '../display-texture';
import { cloneDisplaySelection, type DisplaySelection } from '../display-model';
import { getFiniteChannelRange } from '../channel-storage';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerSessionState
} from '../types';
import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';

export interface PrepareActiveSessionResult {
  textureRevisionKey: string;
  textureDirty: boolean;
}

export interface RequestDisplayLuminanceRangeResult {
  displayLuminanceRange: DisplayLuminanceRange | null;
  pending: boolean;
}

export interface DisplayLuminanceRangeResolvedEvent {
  sessionId: string;
  activeLayer: number;
  displaySelection: DisplaySelection | null;
  displayLuminanceRange: DisplayLuminanceRange | null;
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

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;

export interface RenderCacheWindowLike {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

interface PendingDisplayLuminanceRangeJob {
  sessionId: string;
  revisionKey: string;
  activeLayer: number;
  displaySelection: DisplaySelection | null;
  width: number;
  height: number;
  layer: DecodedLayer;
}

const DISPLAY_LUMINANCE_RANGE_IDLE_TIMEOUT_MS = 250;
const DISPLAY_LUMINANCE_RANGE_IDLE_FALLBACK_DELAY_MS = 64;

export interface RenderCacheServiceDependencies {
  ui: RenderCacheUi;
  renderer: RenderCacheRenderer;
  getActiveSessionId?: () => string | null;
  onDisplayLuminanceRangeResolved?: (event: DisplayLuminanceRangeResolvedEvent) => void;
  windowLike?: RenderCacheWindowLike | null;
}

export class RenderCacheService implements Disposable {
  private readonly ui: RenderCacheUi;
  private readonly renderer: RenderCacheRenderer;
  private readonly getActiveSessionId: () => string | null;
  private readonly onDisplayLuminanceRangeResolved: (event: DisplayLuminanceRangeResolvedEvent) => void;
  private readonly windowLike: RenderCacheWindowLike | null;

  private readonly entries = new Map<string, SessionResourceEntry>();
  private readonly pendingDisplayLuminanceRangeJobs = new Map<string, Map<string, PendingDisplayLuminanceRangeJob>>();
  private readonly queuedDisplayLuminanceRangeJobs: PendingDisplayLuminanceRangeJob[] = [];
  private readonly abortController = new AbortController();
  private budgetMb = readStoredDisplayCacheBudgetMb();
  private boundSessionId: string | null = null;
  private boundLayerIndex: number | null = null;
  private boundChannelNames = new Set<string>();
  private boundTextureRevisionKey = '';
  private nextAccessToken = 1;
  private processingPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(dependencies: RenderCacheServiceDependencies) {
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.getActiveSessionId = dependencies.getActiveSessionId ?? (() => null);
    this.onDisplayLuminanceRangeResolved = dependencies.onDisplayLuminanceRangeResolved ?? (() => undefined);
    this.windowLike = dependencies.windowLike ?? resolveWindowLike();

    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  prepareActiveSession(session: OpenedImageSession, state: ViewerSessionState): PrepareActiveSessionResult {
    if (this.disposed) {
      return {
        textureRevisionKey: '',
        textureDirty: false
      };
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        textureRevisionKey: '',
        textureDirty: false
      };
    }

    const entry = this.getOrCreateEntry(session.id);
    const textureRevisionKey = buildDisplayTextureRevisionKey(state);
    const binding = buildDisplaySourceBinding(layer, state.displaySelection);
    const requiredChannelNames = getDisplaySourceBindingChannelNames(binding).filter((channelName) => {
      return layer.channelStorage.channelIndexByName[channelName] !== undefined;
    });
    const protectedBinding = this.createProtectedBinding(session.id, state.activeLayer, requiredChannelNames);
    const residentLayer = this.getOrCreateResidentLayerEntry(entry, state.activeLayer);
    const missingChannelNames = requiredChannelNames.filter((channelName) => {
      return !residentLayer.residentChannels.has(channelName);
    });
    const textureDirty =
      missingChannelNames.length > 0 ||
      this.boundSessionId !== session.id ||
      this.boundTextureRevisionKey !== textureRevisionKey;

    if (missingChannelNames.length > 0) {
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
      this.setBoundTextureTracking(protectedBinding, textureRevisionKey);
    }

    this.enforceResidencyBudget({
      protectedBinding
    });
    this.syncDisplayCacheUsageUi();

    return {
      textureRevisionKey,
      textureDirty
    };
  }

  requestDisplayLuminanceRange(
    session: OpenedImageSession,
    state: Pick<ViewerSessionState, 'activeLayer' | 'displaySelection'>
  ): RequestDisplayLuminanceRangeResult {
    if (this.disposed) {
      return {
        displayLuminanceRange: null,
        pending: false
      };
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        displayLuminanceRange: null,
        pending: false
      };
    }

    const entry = this.getOrCreateEntry(session.id);
    const revisionKey = buildDisplayLuminanceRevisionKey(state);
    if (entry.luminanceRangeByRevision.has(revisionKey)) {
      return {
        displayLuminanceRange: entry.luminanceRangeByRevision.get(revisionKey) ?? null,
        pending: false
      };
    }

    const pendingJobs = this.getOrCreatePendingDisplayLuminanceRangeJobs(session.id);
    if (pendingJobs.has(revisionKey)) {
      return {
        displayLuminanceRange: null,
        pending: true
      };
    }

    const job: PendingDisplayLuminanceRangeJob = {
      sessionId: session.id,
      revisionKey,
      activeLayer: state.activeLayer,
      displaySelection: cloneDisplaySelection(state.displaySelection),
      width: session.decoded.width,
      height: session.decoded.height,
      layer
    };
    pendingJobs.set(revisionKey, job);
    this.queuedDisplayLuminanceRangeJobs.push(job);
    void this.processDisplayLuminanceRangeJobs();

    return {
      displayLuminanceRange: null,
      pending: true
    };
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

    this.removePendingDisplayLuminanceRangeJobsForSession(sessionId);
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
    this.pendingDisplayLuminanceRangeJobs.clear();
    this.queuedDisplayLuminanceRangeJobs.length = 0;
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
    this.abortController.abort(createAbortError('Render cache service has been disposed.'));
    this.pendingDisplayLuminanceRangeJobs.clear();
    this.queuedDisplayLuminanceRangeJobs.length = 0;
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

  private async processDisplayLuminanceRangeJobs(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      try {
        while (this.queuedDisplayLuminanceRangeJobs.length > 0) {
          throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

          const job = this.queuedDisplayLuminanceRangeJobs.shift();
          if (!job) {
            continue;
          }

          await this.waitForNextPaint();
          throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');
          await this.waitForIdleSlot(DISPLAY_LUMINANCE_RANGE_IDLE_TIMEOUT_MS);
          throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

          if (!this.hasPendingDisplayLuminanceRangeJob(job)) {
            continue;
          }

          const range = this.getOrComputeDisplayLuminanceRange(
            job.layer,
            job.width,
            job.height,
            job.displaySelection
          );

          if (!this.hasPendingDisplayLuminanceRangeJob(job)) {
            continue;
          }

          const entry = this.entries.get(job.sessionId);
          this.removePendingDisplayLuminanceRangeJob(job.sessionId, job.revisionKey);
          if (!entry) {
            continue;
          }

          entry.luminanceRangeByRevision.set(job.revisionKey, range);
          this.onDisplayLuminanceRangeResolved({
            sessionId: job.sessionId,
            activeLayer: job.activeLayer,
            displaySelection: cloneDisplaySelection(job.displaySelection),
            displayLuminanceRange: range
          });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        this.processingPromise = null;
        if (!this.disposed && this.queuedDisplayLuminanceRangeJobs.length > 0) {
          void this.processDisplayLuminanceRangeJobs();
        }
      }
    })();

    return this.processingPromise;
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

  private getOrCreatePendingDisplayLuminanceRangeJobs(
    sessionId: string
  ): Map<string, PendingDisplayLuminanceRangeJob> {
    const existing = this.pendingDisplayLuminanceRangeJobs.get(sessionId);
    if (existing) {
      return existing;
    }

    const pendingJobs = new Map<string, PendingDisplayLuminanceRangeJob>();
    this.pendingDisplayLuminanceRangeJobs.set(sessionId, pendingJobs);
    return pendingJobs;
  }

  private hasPendingDisplayLuminanceRangeJob(job: PendingDisplayLuminanceRangeJob): boolean {
    return this.pendingDisplayLuminanceRangeJobs.get(job.sessionId)?.get(job.revisionKey) === job;
  }

  private removePendingDisplayLuminanceRangeJob(sessionId: string, revisionKey: string): void {
    const pendingJobs = this.pendingDisplayLuminanceRangeJobs.get(sessionId);
    if (!pendingJobs) {
      return;
    }

    pendingJobs.delete(revisionKey);
    if (pendingJobs.size === 0) {
      this.pendingDisplayLuminanceRangeJobs.delete(sessionId);
    }
  }

  private removePendingDisplayLuminanceRangeJobsForSession(sessionId: string): void {
    this.pendingDisplayLuminanceRangeJobs.delete(sessionId);
    for (let index = this.queuedDisplayLuminanceRangeJobs.length - 1; index >= 0; index -= 1) {
      if (this.queuedDisplayLuminanceRangeJobs[index]?.sessionId === sessionId) {
        this.queuedDisplayLuminanceRangeJobs.splice(index, 1);
      }
    }
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

  private createProtectedBinding(sessionId: string, layerIndex: number, channelNames: Iterable<string>): ProtectedBinding {
    return {
      sessionId,
      layerIndex,
      channelNames: new Set(channelNames)
    };
  }

  private setBoundTextureTracking(protectedBinding: ProtectedBinding, textureRevisionKey: string): void {
    this.boundSessionId = protectedBinding.sessionId;
    this.boundLayerIndex = protectedBinding.layerIndex;
    this.boundChannelNames = new Set(protectedBinding.channelNames);
    this.boundTextureRevisionKey = textureRevisionKey;
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

    return this.createProtectedBinding(this.boundSessionId, this.boundLayerIndex, this.boundChannelNames);
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

  private waitForNextPaint(): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

    const windowLike = this.windowLike;
    if (!windowLike?.requestAnimationFrame) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let firstHandle = 0;
      let secondHandle = 0;
      const cleanupAbort = this.bindAbortRejection(() => {
        if (firstHandle && typeof windowLike.cancelAnimationFrame === 'function') {
          windowLike.cancelAnimationFrame(firstHandle);
        }
        if (secondHandle && typeof windowLike.cancelAnimationFrame === 'function') {
          windowLike.cancelAnimationFrame(secondHandle);
        }
      }, () => {
        resolve();
      });

      firstHandle = windowLike.requestAnimationFrame?.(() => {
        firstHandle = 0;
        secondHandle = windowLike.requestAnimationFrame?.(() => {
          secondHandle = 0;
          cleanupAbort();
          resolve();
        }) ?? 0;
      }) ?? 0;
    });
  }

  private waitForIdleSlot(timeoutMs: number): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

    const windowLike = this.windowLike;
    if (!windowLike) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (typeof windowLike.requestIdleCallback !== 'function') {
        const handle = windowLike.setTimeout(
          () => {
            cleanupAbort();
            resolve();
          },
          Math.max(0, Math.min(timeoutMs, DISPLAY_LUMINANCE_RANGE_IDLE_FALLBACK_DELAY_MS))
        );
        const cleanupAbort = this.bindAbortRejection(() => {
          windowLike.clearTimeout?.(handle);
        }, () => {
          resolve();
        });
        return;
      }

      const handle = windowLike.requestIdleCallback(() => {
        cleanupAbort();
        resolve();
      }, { timeout: timeoutMs });
      const cleanupAbort = this.bindAbortRejection(() => {
        windowLike.cancelIdleCallback?.(handle);
      }, () => {
        resolve();
      });
    });
  }

  private bindAbortRejection(cancel: () => void, complete: () => void): () => void {
    const signal = this.abortController.signal;
    const onAbort = () => {
      cancel();
      complete();
    };

    signal.addEventListener('abort', onAbort, { once: true });
    return () => {
      signal.removeEventListener('abort', onAbort);
    };
  }
}

function predictChannelTextureBytes(width: number, height: number, channelCount: number): number {
  return Math.max(0, width * height * channelCount * Float32Array.BYTES_PER_ELEMENT);
}

function resolveWindowLike(): RenderCacheWindowLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window;
}
