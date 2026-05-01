import {
  shouldPreserveStokesColormapState
} from '../colormap-range';
import {
  DEFAULT_COLORMAP_ID,
  findColormapIdByLabel,
  getColormapAsset,
  loadColormapLut,
  loadColormapRegistry,
  type ColormapLut
} from '../colormaps';
import {
  cloneDisplaySelection,
  isStokesSelection,
  type DisplaySelection
} from '../display-model';
import {
  AsyncOperationGate,
  createAbortError,
  isAbortError,
  throwIfAborted,
  type AsyncOperationGuard,
  type Disposable
} from '../lifecycle';
import {
  cloneStokesColormapDefaultSetting,
  createDefaultStokesColormapDefaultSettings,
  getStokesColormapDefaultGroup,
  getStokesDisplayColormapDefault,
  type StokesColormapDefaultGroup,
  type StokesColormapDefaultSetting
} from '../stokes';
import {
  readStoredStokesColormapDefaults,
  saveStoredStokesColormapDefaults
} from '../stokes-colormap-settings';
import { ViewerAppCore } from '../app/viewer-app-core';
import {
  selectActiveSession,
  selectColormapLutById
} from '../app/viewer-app-selectors';
import type { RestorableVisualizationState } from '../app/viewer-app-types';
import type {
  DisplayLuminanceRange,
  StokesAolpDegreeModulationMode,
  ViewerMode,
  VisualizationMode
} from '../types';

export interface DisplayControllerDependencies {
  core: ViewerAppCore;
}

export class DisplayController implements Disposable {
  private readonly core: ViewerAppCore;
  private readonly abortController = new AbortController();
  private readonly selectionTransitionGate = new AsyncOperationGate();
  private readonly colormapLoadGate = new AsyncOperationGate();
  private readonly manualColormapOverrideTransitionIds = new Set<number>();
  private disposed = false;

  constructor(dependencies: DisplayControllerDependencies) {
    this.core = dependencies.core;
  }

  async initialize(): Promise<void> {
    try {
      this.throwIfStopped();
      const registry = await loadColormapRegistry(this.abortController.signal);
      this.throwIfStopped();
      this.core.dispatch({
        type: 'colormapRegistryResolved',
        registry
      });
      this.core.dispatch({
        type: 'stokesColormapDefaultsSet',
        settings: readStoredStokesColormapDefaults(registry)
      });

      const requestId = this.core.issueRequestId();
      this.core.dispatch({
        type: 'colormapLoadStarted',
        requestId,
        colormapId: registry.defaultId
      });
      const guard = this.colormapLoadGate.begin();
      const lut = await loadColormapLut(registry, registry.defaultId, guard.signal);
      this.throwIfStopped();
      guard.throwIfStale();
      this.core.dispatch({
        type: 'colormapLoadResolved',
        requestId,
        colormapId: registry.defaultId,
        lut
      });
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    }
  }

  async applyDisplaySelection(selection: DisplaySelection): Promise<void> {
    if (this.disposed) {
      return;
    }

    const activeSession = selectActiveSession(this.core.getState());
    if (!activeSession) {
      this.selectionTransitionGate.invalidate('Display selection request was superseded.');
      this.core.dispatch({
        type: 'displaySelectionSet',
        displaySelection: cloneDisplaySelection(selection)
      });
      return;
    }

    const transitionGuard = this.selectionTransitionGate.begin('Display selection request was superseded.');
    const initialState = this.core.getState();
    const stokesDefaults = getStokesDisplayColormapDefault(selection, initialState.stokesColormapDefaults);
    const restoreState = captureRestorableVisualizationState(initialState.sessionState);
    if (!stokesDefaults) {
      this.core.dispatch({
        type: 'displaySelectionSet',
        displaySelection: cloneDisplaySelection(selection)
      });
      await this.ensureActiveColormapLutLoaded();
      return;
    }

    const transitionRequestId = this.core.issueRequestId();
    const transitionContext = captureActiveDisplayContext(initialState);
    this.core.dispatch({
      type: 'displaySelectionTransitionStarted',
      requestId: transitionRequestId
    });

    try {
      await waitForNextPaint(transitionGuard.signal);
      this.throwIfStopped();
      transitionGuard.throwIfStale();
      if (!this.isSelectionTransitionCurrent(transitionRequestId, transitionContext, transitionGuard)) {
        return;
      }

      const latestState = this.core.getState();
      const latestStokesDefaults = getStokesDisplayColormapDefault(
        selection,
        latestState.stokesColormapDefaults
      );
      const keepManualColormap = this.manualColormapOverrideTransitionIds.has(transitionRequestId);
      const keepGroupedColormap = shouldPreserveStokesColormapState(
        latestState.sessionState.displaySelection,
        selection
      );
      if (!latestStokesDefaults) {
        this.core.dispatch({
          type: 'displaySelectionSet',
          displaySelection: cloneDisplaySelection(selection),
          restoreState
        });
      } else if (keepManualColormap || keepGroupedColormap) {
        this.core.dispatch({
          type: 'displaySelectionSet',
          displaySelection: cloneDisplaySelection(selection),
          restoreState
        });
      } else if (latestState.colormapRegistry) {
        const colormapId = findColormapIdByLabel(latestState.colormapRegistry, latestStokesDefaults.colormapLabel);
        if (!colormapId) {
          this.core.dispatch({
            type: 'errorSet',
            message: `Required colormap not found: ${latestStokesDefaults.colormapLabel}`
          });
          return;
        }

        this.core.dispatch({
          type: 'activeColormapSet',
          colormapId
        });

        const colormapRequestId = this.core.issueRequestId();
        const colormapGuard = this.colormapLoadGate.begin();
        this.core.dispatch({
          type: 'colormapLoadStarted',
          requestId: colormapRequestId,
          colormapId
        });
        const lut = await loadColormapLut(latestState.colormapRegistry, colormapId, colormapGuard.signal);
        this.throwIfStopped();
        colormapGuard.throwIfStale();
        transitionGuard.throwIfStale();
        if (!this.isSelectionTransitionCurrent(transitionRequestId, transitionContext, transitionGuard)) {
          return;
        }

        this.core.dispatch({
          type: 'colormapLoadResolved',
          requestId: colormapRequestId,
          colormapId,
          lut
        });
        this.core.dispatch({
          type: 'displaySelectionSet',
          displaySelection: cloneDisplaySelection(selection),
          restoreState
        });
      }

    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        throw error;
      }
    } finally {
      this.manualColormapOverrideTransitionIds.delete(transitionRequestId);
      if (!this.disposed) {
        this.core.dispatch({
          type: 'displaySelectionTransitionFinished',
          requestId: transitionRequestId
        });
      }
    }
  }

  async setActiveColormap(colormapId: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const state = this.core.getState();
    if (state.pendingSelectionTransitionRequestId !== null) {
      this.manualColormapOverrideTransitionIds.add(state.pendingSelectionTransitionRequestId);
    }

    if (!state.colormapRegistry) {
      return;
    }

    if (!getColormapAsset(state.colormapRegistry, colormapId)) {
      this.core.dispatch({
        type: 'errorSet',
        message: `Unknown colormap: ${colormapId}`
      });
      return;
    }

    const loadedLut = selectColormapLutById(state, colormapId);
    if (state.sessionState.activeColormapId === colormapId && loadedLut) {
      return;
    }

    this.core.dispatch({
      type: 'activeColormapSet',
      colormapId
    });
    if (loadedLut) {
      return;
    }

    const requestId = this.core.issueRequestId();
    const guard = this.colormapLoadGate.begin();
    this.core.dispatch({
      type: 'colormapLoadStarted',
      requestId,
      colormapId
    });

    try {
      const lut = await loadColormapLut(state.colormapRegistry, colormapId, guard.signal);
      this.throwIfStopped();
      guard.throwIfStale();
      if (this.core.getState().sessionState.activeColormapId !== colormapId) {
        return;
      }
      this.core.dispatch({
        type: 'colormapLoadResolved',
        requestId,
        colormapId,
        lut
      });
    } catch (error) {
      if (
        !isAbortError(error) &&
        !this.disposed &&
        guard.isCurrent() &&
        this.core.getState().sessionState.activeColormapId === colormapId
      ) {
        this.core.dispatch({
          type: 'colormapLoadFailed',
          requestId,
          colormapId,
          error: error instanceof Error ? error : 'Failed to load colormap.'
        });
      }
    }
  }

  async setStokesColormapDefault(
    group: StokesColormapDefaultGroup,
    colormapId: string
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    const state = this.core.getState();
    if (!state.colormapRegistry) {
      return;
    }

    const asset = getColormapAsset(state.colormapRegistry, colormapId);
    if (!asset) {
      this.core.dispatch({
        type: 'errorSet',
        message: `Unknown colormap: ${colormapId}`
      });
      return;
    }

    await this.setStokesColormapDefaultSetting(group, {
      ...state.stokesColormapDefaults[group],
      colormapLabel: asset.label
    });
  }

  async setStokesColormapDefaultSetting(
    group: StokesColormapDefaultGroup,
    setting: StokesColormapDefaultSetting
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (!isValidStokesDefaultSetting(setting)) {
      this.core.dispatch({
        type: 'errorSet',
        message: 'Invalid Stokes colormap default setting.'
      });
      return;
    }

    const state = this.core.getState();
    const registry = state.colormapRegistry;
    if (!registry) {
      return;
    }

    const colormapId = findColormapIdByLabel(registry, setting.colormapLabel);
    if (!colormapId) {
      this.core.dispatch({
        type: 'errorSet',
        message: `Unknown colormap: ${setting.colormapLabel}`
      });
      return;
    }

    const asset = getColormapAsset(registry, colormapId);
    if (!asset) {
      this.core.dispatch({
        type: 'errorSet',
        message: `Unknown colormap: ${colormapId}`
      });
      return;
    }

    const normalizedSetting = cloneStokesColormapDefaultSetting({
      ...setting,
      colormapLabel: asset.label
    });
    const settings = {
      ...state.stokesColormapDefaults,
      [group]: normalizedSetting
    };
    saveStoredStokesColormapDefaults(settings);
    this.core.dispatch({
      type: 'stokesColormapDefaultSettingSet',
      group,
      setting: normalizedSetting
    });

    if (this.getActiveStokesColormapDefaultGroup() === group) {
      this.core.dispatch({
        type: 'stokesActiveColormapDefaultApplied',
        setting: normalizedSetting
      });
      await this.setActiveColormap(colormapId);
    }
  }

  async resetStokesColormapDefaults(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const defaults = createDefaultStokesColormapDefaultSettings();
    saveStoredStokesColormapDefaults(defaults);
    this.core.dispatch({
      type: 'stokesColormapDefaultsReset'
    });

    const activeGroup = this.getActiveStokesColormapDefaultGroup();
    const registry = this.core.getState().colormapRegistry;
    if (!activeGroup || !registry) {
      return;
    }

    const setting = defaults[activeGroup];
    const colormapLabel = setting.colormapLabel;
    const colormapId = findColormapIdByLabel(registry, colormapLabel);
    if (!colormapId) {
      this.core.dispatch({
        type: 'errorSet',
        message: `Required colormap not found: ${colormapLabel}`
      });
      return;
    }

    this.core.dispatch({
      type: 'stokesActiveColormapDefaultApplied',
      setting
    });
    await this.setActiveColormap(colormapId);
  }

  async ensureActiveColormapLutLoaded(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const state = this.core.getState();
    if (!state.colormapRegistry) {
      return;
    }

    if (
      state.colormapLutResource.status === 'pending' &&
      state.colormapLutResource.key === state.sessionState.activeColormapId
    ) {
      return;
    }

    if (selectColormapLutById(state, state.sessionState.activeColormapId)) {
      return;
    }

    await this.setActiveColormap(state.sessionState.activeColormapId);
  }

  setVisualizationMode(mode: VisualizationMode): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'visualizationModeRequested',
      visualizationMode: mode
    });
  }

  setViewerMode(mode: ViewerMode): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'viewerModeSet',
      viewerMode: mode
    });
  }

  setColormapRange(range: DisplayLuminanceRange): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'colormapRangeSet',
      range
    });
  }

  applyAutoColormapRange(): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'colormapAutoRangeToggled'
    });
  }

  toggleColormapZeroCenter(): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'colormapZeroCenteredToggled'
    });
  }

  toggleStokesDegreeModulation(): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'stokesDegreeModulationToggled'
    });
  }

  setStokesAolpDegreeModulationMode(mode: StokesAolpDegreeModulationMode): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'stokesAolpDegreeModulationModeSet',
      mode
    });
  }

  setActiveLayer(layerIndex: number): void {
    if (this.disposed) {
      return;
    }

    this.core.dispatch({
      type: 'activeLayerSet',
      activeLayer: layerIndex
    });
  }

  getDefaultColormapId(): string {
    return this.core.getState().defaultColormapId || DEFAULT_COLORMAP_ID;
  }

  getActiveColormapLutForState(colormapId: string): ColormapLut | null {
    return selectColormapLutById(this.core.getState(), colormapId);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Display controller has been disposed.'));
    this.selectionTransitionGate.dispose();
    this.colormapLoadGate.dispose();
  }

  private throwIfStopped(): void {
    if (this.disposed) {
      throw createAbortError('Display controller has been disposed.');
    }

    throwIfAborted(this.abortController.signal, 'Display controller has been disposed.');
  }

  private getActiveStokesColormapDefaultGroup(): StokesColormapDefaultGroup | null {
    const selection = this.core.getState().sessionState.displaySelection;
    return isStokesSelection(selection)
      ? getStokesColormapDefaultGroup(selection.parameter)
      : null;
  }

  private isSelectionTransitionCurrent(
    requestId: number,
    context: ActiveDisplayContext,
    guard: AsyncOperationGuard
  ): boolean {
    if (!guard.isCurrent()) {
      return false;
    }

    const state = this.core.getState();
    const activeSession = selectActiveSession(state);
    return (
      state.pendingSelectionTransitionRequestId === requestId &&
      activeSession?.id === context.sessionId &&
      state.sessionState.activeLayer === context.activeLayer
    );
  }
}

interface ActiveDisplayContext {
  sessionId: string | null;
  activeLayer: number;
}

function isValidStokesDefaultSetting(setting: StokesColormapDefaultSetting): boolean {
  return (
    setting.colormapLabel.trim().length > 0 &&
    Number.isFinite(setting.range.min) &&
    Number.isFinite(setting.range.max) &&
    setting.range.min < setting.range.max
  );
}

function waitForNextPaint(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  throwIfAborted(signal, 'Display controller has been disposed.');
  return new Promise((resolve, reject) => {
    let firstHandle = 0;
    let secondHandle = 0;
    const onAbort = () => {
      if (firstHandle && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(firstHandle);
      }
      if (secondHandle && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(secondHandle);
      }
      reject(signal.reason instanceof Error ? signal.reason : createAbortError('Display controller has been disposed.'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    firstHandle = window.requestAnimationFrame(() => {
      firstHandle = 0;
      secondHandle = window.requestAnimationFrame(() => {
        secondHandle = 0;
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  });
}

function captureRestorableVisualizationState(state: {
  visualizationMode: RestorableVisualizationState['visualizationMode'];
  activeColormapId: string;
  colormapRange: RestorableVisualizationState['colormapRange'];
  colormapRangeMode: RestorableVisualizationState['colormapRangeMode'];
  colormapZeroCentered: boolean;
}): RestorableVisualizationState {
  return {
    visualizationMode: state.visualizationMode,
    activeColormapId: state.activeColormapId,
    colormapRange: state.colormapRange ? { ...state.colormapRange } : null,
    colormapRangeMode: state.colormapRangeMode,
    colormapZeroCentered: state.colormapZeroCentered
  };
}

function captureActiveDisplayContext(state: {
  activeSessionId: string | null;
  sessionState: {
    activeLayer: number;
  };
}): ActiveDisplayContext {
  return {
    sessionId: state.activeSessionId,
    activeLayer: state.sessionState.activeLayer
  };
}
