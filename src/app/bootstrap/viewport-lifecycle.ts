import { preserveImagePanOnViewportChange, type ViewportClientRect } from '../../interaction/image-geometry';
import { ViewerInteraction } from '../../interaction/viewer-interaction';
import { mergeRenderState } from '../../view-state';
import { selectActiveSession } from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { ViewerInteractionCoordinator } from '../../interaction-coordinator';
import type { ViewerUi } from '../../ui/viewer-ui';
import type { WebGlExrRenderer } from '../../renderer';

interface CreateViewerInteractionArgs {
  core: ViewerAppCore;
  ui: ViewerUi;
  renderer: WebGlExrRenderer;
  interactionCoordinator: ViewerInteractionCoordinator;
}

interface InitializeViewportLifecycleArgs {
  core: ViewerAppCore;
  ui: ViewerUi;
  renderer: WebGlExrRenderer;
  interactionCoordinator: ViewerInteractionCoordinator;
  isDisposed: () => boolean;
}

export function createViewerInteraction({
  core,
  ui,
  renderer,
  interactionCoordinator
}: CreateViewerInteractionArgs): ViewerInteraction {
  return new ViewerInteraction(ui.viewerContainer, {
    getState: () => mergeRenderState(core.getState().sessionState, core.getState().interactionState),
    getViewport: () => renderer.getViewport(),
    getImageSize: () => {
      const activeSession = selectActiveSession(core.getState());
      if (!activeSession) {
        return null;
      }

      return {
        width: activeSession.decoded.width,
        height: activeSession.decoded.height
      };
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
    onDraftRoi: (roi) => {
      interactionCoordinator.enqueueDraftRoi(roi);
    },
    onCommitRoi: (roi) => {
      core.dispatch({
        type: 'roiSet',
        roi
      });
    },
    getScreenshotSelection: () => ui.getScreenshotSelectionInteractionState(),
    onScreenshotSelectionRectChange: (update) => {
      ui.setScreenshotSelectionRect(update.rect, { squareSnapped: update.squareSnapped });
    },
    onScreenshotSelectionHandleHover: (handle) => {
      ui.setScreenshotSelectionHandle(handle);
    },
    onScreenshotSelectionResizeActiveChange: (active) => {
      ui.setScreenshotSelectionResizeActive(active);
    },
    onScreenshotSelectionSquareSnapChange: (active) => {
      ui.setScreenshotSelectionSquareSnapActive(active);
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
  let viewerContainerRect: ViewportClientRect | null = null;

  const renderCurrentView = (): void => {
    if (selectActiveSession(core.getState())) {
      renderer.render(mergeRenderState(core.getState().sessionState, interactionCoordinator.getState()));
    } else {
      renderer.clearImage();
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    if (isDisposed()) {
      return;
    }

    const rect = readViewportClientRect(ui.viewerContainer);
    const interactionState = interactionCoordinator.getState();
    if (viewerContainerRect && core.getState().sessionState.viewerMode === 'image') {
      const nextPan = preserveImagePanOnViewportChange(interactionState.view, viewerContainerRect, rect);
      if (nextPan.panX !== interactionState.view.panX || nextPan.panY !== interactionState.view.panY) {
        interactionCoordinator.enqueueViewPatch(nextPan);
      }
    }
    viewerContainerRect = rect;
    renderer.resize(rect.width, rect.height, rect.left, rect.top);
    renderCurrentView();
  });

  resizeObserver.observe(ui.viewerContainer);

  const rect = readViewportClientRect(ui.viewerContainer);
  viewerContainerRect = rect;
  renderer.resize(rect.width, rect.height, rect.left, rect.top);
  renderCurrentView();

  return resizeObserver;
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
