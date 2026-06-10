import {
  DepthProbeProjectionCache,
  resolveDepthSourceForLayer
} from '../../depth';
import {
  createAdaptiveDepthPointBudgetResolver,
  type DepthPointBudgetResolver
} from '../../depth-point-budget';
import {
  computeFitView,
  isFitViewForViewport,
  preserveImagePanOnViewportChange,
  type ViewportClientRect
} from '../../interaction/image-geometry';
import { resolveDisplayImageSize } from '../../display-size';
import { ViewerInteraction } from '../../interaction/viewer-interaction';
import { mergeRenderState } from '../../view-state';
import { resolveRulerFitInsets } from '../../ruler-layout';
import { selectActiveSession } from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { ViewerInteractionCoordinator } from '../../interaction-coordinator';
import type { ViewerViewState, ViewportInfo } from '../../types';
import type { ViewerRuntimeUi } from '../../ui/viewer-runtime-ui';
import type { WebGlExrRenderer } from '../../renderer';

interface CreateViewerInteractionArgs {
  core: ViewerAppCore;
  ui: ViewerRuntimeUi;
  interactionCoordinator: ViewerInteractionCoordinator;
  depthPointBudgetResolver?: DepthPointBudgetResolver;
}

interface InitializeViewportLifecycleArgs {
  core: ViewerAppCore;
  ui: ViewerRuntimeUi;
  renderer: WebGlExrRenderer;
  interactionCoordinator: ViewerInteractionCoordinator;
  isDisposed: () => boolean;
}

export function createViewerInteraction({
  core,
  ui,
  interactionCoordinator,
  depthPointBudgetResolver = createAdaptiveDepthPointBudgetResolver()
}: CreateViewerInteractionArgs): ViewerInteraction {
  const depthProbeProjectionCache = new DepthProbeProjectionCache();
  return new ViewerInteraction(ui.viewerContainer, {
    getState: () => {
      const state = core.getState();
      return mergeRenderState(state.sessionState, state.interactionState, {
        viewerBackground: state.viewerBackground,
        maskInvalidStokesVectors: state.maskInvalidStokesVectors,
        spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
        channelRecognitionSettings: state.channelRecognitionSettings,
        channelRecognitionNameRules: state.channelRecognitionNameRules,
        invalidValueWarningEnabled: state.invalidValueWarningEnabled
      });
    },
    getViewport: () => ui.getActiveViewerPane().viewport,
    getActivePane: () => ui.getActiveViewerPane(),
    resolvePaneAtPoint: (point) => ui.resolveViewerPaneAtPoint(point),
    onActivePaneChange: (path) => {
      core.dispatch({
        type: 'viewerPaneActivated',
        path
      });
    },
    getImageSize: () => {
      const appState = core.getState();
      const activeSession = selectActiveSession(appState);
      if (!activeSession) {
        return null;
      }

      return resolveDisplayImageSize(
        activeSession.decoded.width,
        activeSession.decoded.height,
        appState.sessionState.displaySelection
      );
    },
    resolveDepthProbePixel: (point, state, viewport) => {
      if (ui.probeEnabled === false) {
        return null;
      }
      if (state.viewerMode !== '3d') {
        return null;
      }

      const appState = core.getState();
      const activeSession = selectActiveSession(appState);
      const activeLayer = activeSession?.decoded.layers[state.activeLayer] ?? null;
      if (!activeSession || !activeLayer) {
        return null;
      }

      const depthSource = resolveDepthSourceForLayer(
        activeLayer.channelNames,
        state.depthChannel,
        {
          allowArbitraryZSuffix: true,
          channelRecognitionSettings: appState.channelRecognitionSettings,
          channelRecognitionNameRules: appState.channelRecognitionNameRules
        }
      );
      return depthProbeProjectionCache.pick(point, {
        layer: activeLayer,
        width: activeSession.decoded.width,
        height: activeSession.decoded.height,
        source: depthSource,
        viewport,
        depthFocalLengthPx: state.depthFocalLengthPx,
        depthYawDeg: state.depthYawDeg,
        depthPitchDeg: state.depthPitchDeg,
        depthZoom: state.depthZoom,
        depthTargetX: state.depthTargetX,
        depthTargetY: state.depthTargetY,
        depthTargetZ: state.depthTargetZ,
        depthPointSizePx: state.depthPointSizePx,
        maxPoints: depthPointBudgetResolver({
          ...viewport,
          pointSizePx: state.depthPointSizePx
        })
      });
    },
    onViewChange: (next) => {
      interactionCoordinator.enqueueViewPatch(next);
    },
    onHoverPixel: (pixel) => {
      interactionCoordinator.enqueueHoverPixel(pixel);
    },
    onToggleLockPixel: (pixel) => {
      core.dispatch({
        type: 'lockedPixelToggled',
        pixel
      });
    },
    isProbeEnabled: () => ui.probeEnabled !== false,
    onDraftRoi: (roi) => {
      interactionCoordinator.enqueueDraftRoi(roi);
    },
    onCommitRoi: (roi) => {
      core.dispatch({
        type: 'roiSet',
        roi
      });
    },
    onRoiInteractionState: (state) => {
      interactionCoordinator.enqueueRoiInteractionState(state);
    },
    getScreenshotSelection: () => ui.getScreenshotSelectionInteractionState(),
    onScreenshotSelectionRectChange: (update) => {
      ui.setScreenshotSelectionRect(update.rect, {
        squareSnapped: update.squareSnapped,
        snapGuide: update.snapGuide
      });
    },
    onScreenshotSelectionActiveRegionChange: (regionId) => {
      ui.setScreenshotSelectionActiveRegion(regionId);
    },
    onScreenshotSelectionHandleHover: (handle) => {
      ui.setScreenshotSelectionHandle(handle);
    },
    onScreenshotSelectionResizeActiveChange: (active) => {
      ui.setScreenshotSelectionResizeActive(active);
    },
    onScreenshotSelectionSquareSnapChange: (active) => {
      ui.setScreenshotSelectionSquareSnapActive(active);
    },
    onScreenshotSelectionSnapGuideChange: (guide) => {
      ui.setScreenshotSelectionSnapGuide(guide);
    }
  });
}

export function initializeViewportLifecycle({
  core,
  ui,
  renderer,
  interactionCoordinator,
  isDisposed
}: InitializeViewportLifecycleArgs): ResizeObserver {
  let activePaneClientRect: ViewportClientRect | null = null;

  const renderCurrentView = (): void => {
    if (selectActiveSession(core.getState())) {
      const state = core.getState();
      renderer.render(mergeRenderState(state.sessionState, interactionCoordinator.getState(), {
        viewerBackground: state.viewerBackground,
        maskInvalidStokesVectors: state.maskInvalidStokesVectors,
        spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
        channelRecognitionSettings: state.channelRecognitionSettings,
        channelRecognitionNameRules: state.channelRecognitionNameRules,
        invalidValueWarningEnabled: state.invalidValueWarningEnabled
      }));
    } else {
      renderer.clearImage();
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    if (isDisposed()) {
      return;
    }

    const rect = readViewportClientRect(ui.viewerContainer);
    const previousActivePaneClientRect = activePaneClientRect;
    const interactionState = interactionCoordinator.getState();
    const state = core.getState();
    const activeSession = selectActiveSession(state);
    const fitInsets = resolveRulerFitInsets(state.rulersVisible);
    ui.setViewerViewportRect(rect);
    activePaneClientRect = resolveActivePaneClientRect(ui, rect);
    if (previousActivePaneClientRect && state.sessionState.viewerMode === 'image') {
      const displaySize = activeSession
        ? resolveDisplayImageSize(
            activeSession.decoded.width,
            activeSession.decoded.height,
            state.sessionState.displaySelection
          )
        : null;
      const nextViewPatch = activeSession && displaySize && isFitViewForViewport(
        interactionState.view,
        viewportInfoFromClientRect(previousActivePaneClientRect),
        displaySize.width,
        displaySize.height,
        fitInsets
      )
        ? computeFitView(
            viewportInfoFromClientRect(activePaneClientRect),
            displaySize.width,
            displaySize.height,
            fitInsets
          )
        : preserveImagePanOnViewportChange(interactionState.view, previousActivePaneClientRect, activePaneClientRect);
      if (hasImageViewPatchChanged(interactionState.view, nextViewPatch)) {
        interactionCoordinator.enqueueViewPatch(nextViewPatch);
      }
    }
    renderer.resize(rect.width, rect.height, rect.left, rect.top);
    renderer.setViewerPanes(ui.getViewerPaneRenderInfos());
    renderCurrentView();
  });

  resizeObserver.observe(ui.viewerContainer);

  const rect = readViewportClientRect(ui.viewerContainer);
  ui.setViewerViewportRect(rect);
  activePaneClientRect = resolveActivePaneClientRect(ui, rect);
  renderer.resize(rect.width, rect.height, rect.left, rect.top);
  renderer.setViewerPanes(ui.getViewerPaneRenderInfos());
  renderCurrentView();

  return resizeObserver;
}

function resolveActivePaneClientRect(ui: ViewerRuntimeUi, containerRect: ViewportClientRect): ViewportClientRect {
  const activePane = ui.getActiveViewerPane();
  return {
    left: containerRect.left + activePane.rect.x,
    top: containerRect.top + activePane.rect.y,
    width: activePane.rect.width,
    height: activePane.rect.height
  };
}

export function readViewportClientRect(element: HTMLElement): ViewportClientRect {
  const rect = element.getBoundingClientRect();
  return {
    left: Number.isFinite(rect.left) ? rect.left : 0,
    top: Number.isFinite(rect.top) ? rect.top : 0,
    width: Number.isFinite(rect.width) ? rect.width : 0,
    height: Number.isFinite(rect.height) ? rect.height : 0
  };
}

function viewportInfoFromClientRect(rect: ViewportClientRect): ViewportInfo {
  return {
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height))
  };
}

function hasImageViewPatchChanged(
  current: Pick<ViewerViewState, 'zoom' | 'panX' | 'panY'>,
  patch: Partial<Pick<ViewerViewState, 'zoom' | 'panX' | 'panY'>>
): boolean {
  return (
    (patch.zoom !== undefined && patch.zoom !== current.zoom) ||
    (patch.panX !== undefined && patch.panX !== current.panX) ||
    (patch.panY !== undefined && patch.panY !== current.panY)
  );
}
