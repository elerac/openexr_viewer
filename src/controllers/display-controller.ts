import {
  DEFAULT_COLORMAP_ID,
  findColormapIdByLabel,
  getColormapAsset,
  loadColormapLut,
  loadColormapRegistry,
  type ColormapLut
} from '../colormaps';
import { cloneDisplaySelection, type DisplaySelection } from '../display-model';
import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';
import { getStokesDisplayColormapDefault } from '../stokes';
import { ViewerAppCore } from '../app/viewer-app-core';
import { selectActiveSession } from '../app/viewer-app-selectors';
import type { RestorableVisualizationState } from '../app/viewer-app-types';
import type { DisplayLuminanceRange, ViewerMode, VisualizationMode } from '../types';

const MIN_RGB_VIEW_LOADING_MS = 120;

export interface DisplayControllerDependencies {
  core: ViewerAppCore;
}

export class DisplayController implements Disposable {
  private readonly core: ViewerAppCore;
  private readonly abortController = new AbortController();
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

      const requestId = this.core.issueRequestId();
      this.core.dispatch({
        type: 'colormapLoadStarted',
        requestId
      });
      const lut = await loadColormapLut(registry, registry.defaultId, this.abortController.signal);
      this.throwIfStopped();
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
      this.core.dispatch({
        type: 'displaySelectionSet',
        displaySelection: cloneDisplaySelection(selection)
      });
      return;
    }

    const stokesDefaults = getStokesDisplayColormapDefault(selection);
    const restoreState = captureRestorableVisualizationState(this.core.getState().sessionState);
    if (!stokesDefaults) {
      this.core.dispatch({
        type: 'displaySelectionSet',
        displaySelection: cloneDisplaySelection(selection)
      });
      return;
    }

    const transitionRequestId = this.core.issueRequestId();
    const startedAt = performance.now();
    this.core.dispatch({
      type: 'displaySelectionTransitionStarted',
      requestId: transitionRequestId
    });

    try {
      await waitForNextPaint(this.abortController.signal);
      this.throwIfStopped();
      if (this.core.getState().pendingSelectionTransitionRequestId !== transitionRequestId) {
        return;
      }

      const latestState = this.core.getState();
      if (!stokesDefaults) {
        this.core.dispatch({
          type: 'displaySelectionSet',
          displaySelection: cloneDisplaySelection(selection),
          restoreState
        });
      } else if (latestState.colormapRegistry) {
        const colormapId = findColormapIdByLabel(latestState.colormapRegistry, stokesDefaults.colormapLabel);
        if (!colormapId) {
          this.core.dispatch({
            type: 'errorSet',
            message: `Required colormap not found: ${stokesDefaults.colormapLabel}`
          });
          return;
        }

        this.core.dispatch({
          type: 'activeColormapSet',
          colormapId
        });

        const colormapRequestId = this.core.issueRequestId();
        this.core.dispatch({
          type: 'colormapLoadStarted',
          requestId: colormapRequestId
        });
        const lut = await loadColormapLut(latestState.colormapRegistry, colormapId, this.abortController.signal);
        this.throwIfStopped();
        if (this.core.getState().pendingSelectionTransitionRequestId !== transitionRequestId) {
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

      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs < MIN_RGB_VIEW_LOADING_MS) {
        await waitMs(MIN_RGB_VIEW_LOADING_MS - elapsedMs, this.abortController.signal);
      }
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        throw error;
      }
    } finally {
      this.core.dispatch({
        type: 'displaySelectionTransitionFinished',
        requestId: transitionRequestId
      });
    }
  }

  async setActiveColormap(colormapId: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const state = this.core.getState();
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

    if (
      state.sessionState.activeColormapId === colormapId &&
      (state.pendingColormapRequestId !== null || state.loadedColormapId === colormapId)
    ) {
      return;
    }

    this.core.dispatch({
      type: 'activeColormapSet',
      colormapId
    });

    const requestId = this.core.issueRequestId();
    this.core.dispatch({
      type: 'colormapLoadStarted',
      requestId
    });

    try {
      const lut = await loadColormapLut(state.colormapRegistry, colormapId, this.abortController.signal);
      this.throwIfStopped();
      this.core.dispatch({
        type: 'colormapLoadResolved',
        requestId,
        colormapId,
        lut
      });
    } catch (error) {
      if (!isAbortError(error) && !this.disposed) {
        this.core.dispatch({
          type: 'colormapLoadFailed',
          requestId,
          message: error instanceof Error ? error.message : 'Failed to load colormap.'
        });
      }
    }
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
    const state = this.core.getState();
    return state.loadedColormapId === colormapId ? state.activeColormapLut : null;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Display controller has been disposed.'));
  }

  private throwIfStopped(): void {
    if (this.disposed) {
      throw createAbortError('Display controller has been disposed.');
    }

    throwIfAborted(this.abortController.signal, 'Display controller has been disposed.');
  }
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

function waitMs(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, durationMs));
    });
  }

  throwIfAborted(signal, 'Display controller has been disposed.');
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (typeof window.clearTimeout === 'function') {
        window.clearTimeout(handle);
      }
      reject(signal.reason instanceof Error ? signal.reason : createAbortError('Display controller has been disposed.'));
    };
    const handle = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, durationMs));

    signal.addEventListener('abort', onAbort, { once: true });
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
