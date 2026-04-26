import type {
  ImagePixel,
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  ViewerKeyboardNavigationDirection,
  ViewerKeyboardNavigationInput,
  ViewportInfo,
  ViewerState
} from '../types';
import { imageToScreen } from './image-geometry';
import { ImageKeyboardPanController, panImageFromDrag, zoomImageFromWheel } from './image-mode';
import { orbitPanoramaFromDrag, PanoramaKeyboardOrbitController, zoomPanoramaFromWheel } from './panorama-mode';
import { getPanoramaProjectionDiameter } from './panorama-geometry';
import { resolveProbePixel } from './probe-mode';
import {
  commitRoiFromDrag,
  createDraftRoiFromAnchor,
  resolveRoiAnchorPixel,
  updateDraftRoiFromDrag
} from './roi-mode';
import {
  createEmptySnapGuide,
  resolveScreenshotSelectionHandle,
  updateScreenshotSelectionRectFromDrag,
  type ScreenshotSelectionDrag,
  type ScreenshotSelectionEdgeSnapTargets
} from './screenshot-selection';
import type { InteractionCallbacks, InteractionDependencies, PointerPosition } from './shared';

export type { InteractionCallbacks, InteractionDependencies } from './shared';

type DragMode = 'pan' | 'roi' | 'screenshot' | null;

export class ViewerInteraction {
  private readonly element: HTMLElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly imageKeyboardPan: ImageKeyboardPanController;
  private readonly panoramaKeyboardOrbit: PanoramaKeyboardOrbitController;
  private dragging = false;
  private movedDuringDrag = false;
  private dragMode: DragMode = null;
  private previousPointer: PointerPosition | null = null;
  private lastPointerInElement: PointerPosition | null = null;
  private roiAnchorPixel: ImagePixel | null = null;
  private screenshotDrag: ScreenshotSelectionDrag | null = null;

  constructor(
    element: HTMLElement,
    callbacks: InteractionCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.imageKeyboardPan = new ImageKeyboardPanController({
      getState: callbacks.getState,
      getViewport: callbacks.getViewport,
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: callbacks.onHoverPixel,
      getLastPointerInElement: () => this.lastPointerInElement
    }, dependencies);
    this.panoramaKeyboardOrbit = new PanoramaKeyboardOrbitController({
      getState: callbacks.getState,
      getViewport: callbacks.getViewport,
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: callbacks.onHoverPixel,
      getLastPointerInElement: () => this.lastPointerInElement
    }, dependencies);

    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointerleave', this.onPointerLeave);
  }

  destroy(): void {
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.imageKeyboardPan.destroy();
    this.panoramaKeyboardOrbit.destroy();
  }

  handlePanoramaKeyboardOrbit(direction: PanoramaKeyboardOrbitDirection): void {
    this.panoramaKeyboardOrbit.handle(direction);
  }

  setPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): void {
    this.panoramaKeyboardOrbit.setInput(input);
  }

  handleViewerKeyboardNavigation(direction: ViewerKeyboardNavigationDirection): void {
    const state = this.callbacks.getState();
    if (state.viewerMode === 'image') {
      this.imageKeyboardPan.handle(direction);
      return;
    }

    if (state.viewerMode === 'panorama') {
      this.panoramaKeyboardOrbit.handle(direction);
    }
  }

  setViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): void {
    const state = this.callbacks.getState();
    if (state.viewerMode === 'image') {
      this.panoramaKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
      this.imageKeyboardPan.setInput(input);
      return;
    }

    if (state.viewerMode === 'panorama') {
      this.imageKeyboardPan.setInput(createViewerKeyboardNavigationInput());
      this.panoramaKeyboardOrbit.setInput(input);
      return;
    }

    this.imageKeyboardPan.setInput(createViewerKeyboardNavigationInput());
    this.panoramaKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    if (this.getScreenshotSelection().active) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const point = this.getLocalPoint(event);
    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();

    if (state.viewerMode === 'panorama') {
      const nextView = zoomPanoramaFromWheel(state, event.deltaY);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.callbacks.onHoverPixel(resolveProbePixel(point, nextState, viewport, imageSize));
      return;
    }

    const nextView = zoomImageFromWheel(state, viewport, point, event.deltaY);
    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(resolveProbePixel(point, nextState, viewport, imageSize));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      if (event.target instanceof Element && event.target.closest('.screenshot-selection-controls')) {
        return;
      }
      this.callbacks.onHoverPixel(null);
      const handle = screenshotSelection.rect
        ? resolveScreenshotSelectionHandle(point, screenshotSelection.rect)
        : null;
      this.callbacks.onScreenshotSelectionHandleHover?.(handle);
      if (!screenshotSelection.rect || !handle) {
        return;
      }

      this.dragging = true;
      this.dragMode = 'screenshot';
      this.movedDuringDrag = false;
      this.previousPointer = point;
      this.screenshotDrag = {
        handle,
        startPoint: point,
        startRect: screenshotSelection.rect
      };
      this.callbacks.onScreenshotSelectionResizeActiveChange?.(handle !== 'move');
      if (handle === 'move') {
        this.callbacks.onScreenshotSelectionSquareSnapChange?.(false);
      }
      this.element.setPointerCapture(event.pointerId);
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();
    if (state.viewerMode === 'image' && event.shiftKey) {
      const anchorPixel = resolveRoiAnchorPixel(point, state, viewport, imageSize);
      if (!anchorPixel) {
        return;
      }

      this.dragging = true;
      this.dragMode = 'roi';
      this.movedDuringDrag = false;
      this.roiAnchorPixel = anchorPixel;
      this.previousPointer = point;
      this.callbacks.onDraftRoi(createDraftRoiFromAnchor(anchorPixel));
      this.element.setPointerCapture(event.pointerId);
      return;
    }

    this.dragging = true;
    this.dragMode = 'pan';
    this.movedDuringDrag = false;
    this.previousPointer = point;
    this.element.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      this.callbacks.onHoverPixel(null);
      if (this.dragging && this.dragMode === 'screenshot' && this.screenshotDrag) {
        const deltaX = point.x - this.previousPointer!.x;
        const deltaY = point.y - this.previousPointer!.y;
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
          this.movedDuringDrag = true;
        }
        const update = updateScreenshotSelectionRectFromDrag(
          this.screenshotDrag,
          point,
          this.callbacks.getViewport(),
          {
            preserveAspectRatio: event.shiftKey,
            resizeFromCenter: this.screenshotDrag.handle !== 'move' && event.ctrlKey,
            ...this.resolveScreenshotSelectionSnapTargets()
          }
        );
        this.callbacks.onScreenshotSelectionRectChange?.(update);
        this.callbacks.onScreenshotSelectionSquareSnapChange?.(update.squareSnapped);
        this.callbacks.onScreenshotSelectionHandleHover?.(this.screenshotDrag.handle);
        this.previousPointer = point;
        return;
      }

      const handle = screenshotSelection.rect
        ? resolveScreenshotSelectionHandle(point, screenshotSelection.rect)
        : null;
      this.callbacks.onScreenshotSelectionHandleHover?.(handle);
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.callbacks.onHoverPixel(null);
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();
    let hoverState: ViewerState = state;

    if (this.dragging && this.previousPointer) {
      const deltaX = point.x - this.previousPointer.x;
      const deltaY = point.y - this.previousPointer.y;

      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        this.movedDuringDrag = true;
      }

      if (this.dragMode === 'roi' && this.roiAnchorPixel) {
        this.callbacks.onDraftRoi(
          updateDraftRoiFromDrag(this.roiAnchorPixel, point, state, viewport, imageSize)
        );
      } else if (state.viewerMode === 'panorama') {
        const nextView = orbitPanoramaFromDrag(state, viewport, deltaX, deltaY);
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
      } else {
        const nextView = panImageFromDrag(state, deltaX, deltaY);
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
      }

      this.previousPointer = point;
    }

    this.callbacks.onHoverPixel(resolveProbePixel(point, hoverState, viewport, imageSize));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      if (this.dragging && this.dragMode === 'screenshot') {
        const rect = this.getScreenshotSelection().rect;
        this.clearDrag(event.pointerId);
        this.callbacks.onScreenshotSelectionHandleHover?.(
          rect ? resolveScreenshotSelectionHandle(point, rect) : null
        );
        return;
      }

      this.callbacks.onHoverPixel(null);
      this.callbacks.onScreenshotSelectionHandleHover?.(
        screenshotSelection.rect ? resolveScreenshotSelectionHandle(point, screenshotSelection.rect) : null
      );
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.clearDrag(event.pointerId);
      return;
    }

    if (this.dragging && this.dragMode === 'roi' && this.roiAnchorPixel) {
      const state = this.callbacks.getState();
      const viewport = this.callbacks.getViewport();
      this.callbacks.onDraftRoi(null);
      this.callbacks.onCommitRoi(
        commitRoiFromDrag(this.roiAnchorPixel, point, state, viewport, imageSize)
      );
      this.clearDrag(event.pointerId);
      return;
    }

    if (this.dragging && !this.movedDuringDrag) {
      const state = this.callbacks.getState();
      const viewport = this.callbacks.getViewport();
      this.callbacks.onToggleLockPixel(resolveProbePixel(point, state, viewport, imageSize));
    }

    this.clearDrag(event.pointerId);
  };

  private readonly onPointerLeave = (): void => {
    this.lastPointerInElement = null;
    this.callbacks.onHoverPixel(null);
    if (this.getScreenshotSelection().active && !this.dragging) {
      this.callbacks.onScreenshotSelectionHandleHover?.(null);
    }
  };

  private clearDrag(pointerId: number): void {
    const wasScreenshotResize = this.dragMode === 'screenshot' && this.screenshotDrag?.handle !== 'move';
    const wasScreenshotDrag = this.dragMode === 'screenshot';
    if (this.dragging && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
    this.dragging = false;
    this.dragMode = null;
    this.movedDuringDrag = false;
    this.previousPointer = null;
    this.roiAnchorPixel = null;
    this.screenshotDrag = null;
    if (wasScreenshotDrag) {
      this.callbacks.onScreenshotSelectionSquareSnapChange?.(false);
      this.callbacks.onScreenshotSelectionSnapGuideChange?.(createEmptySnapGuide());
    }
    if (wasScreenshotResize) {
      this.callbacks.onScreenshotSelectionResizeActiveChange?.(false);
    }
  }

  private getLocalPoint(event: MouseEvent): PointerPosition {
    const rect = this.element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  private resolveScreenshotSelectionSnapTargets(): {
    centerSnapTarget: PointerPosition | null;
    edgeSnapTargets: ScreenshotSelectionEdgeSnapTargets | null;
  } {
    const viewport = this.callbacks.getViewport();
    if (!isValidViewport(viewport)) {
      return { centerSnapTarget: null, edgeSnapTargets: null };
    }

    const state = this.callbacks.getState();
    if (state.viewerMode === 'panorama') {
      const projectionDiameter = getPanoramaProjectionDiameter(viewport, state.panoramaHfovDeg);
      const halfProjectionDiameter = projectionDiameter * 0.5;
      return {
        centerSnapTarget: {
          x: viewport.width * 0.5,
          y: viewport.height * 0.5
        },
        edgeSnapTargets: {
          x: filterViewportCoordinates([
            viewport.width * 0.5 - halfProjectionDiameter,
            viewport.width * 0.5 + halfProjectionDiameter
          ], viewport.width),
          y: filterViewportCoordinates([
            viewport.height * 0.5 - halfProjectionDiameter,
            viewport.height * 0.5 + halfProjectionDiameter
          ], viewport.height)
        }
      };
    }

    if (state.viewerMode !== 'image') {
      return { centerSnapTarget: null, edgeSnapTargets: null };
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
      return { centerSnapTarget: null, edgeSnapTargets: null };
    }

    const centerTarget = imageToScreen(imageSize.width * 0.5, imageSize.height * 0.5, state, viewport);
    const topLeft = imageToScreen(0, 0, state, viewport);
    const bottomRight = imageToScreen(imageSize.width, imageSize.height, state, viewport);
    return {
      centerSnapTarget: isPointInsideViewport(centerTarget, viewport) ? centerTarget : null,
      edgeSnapTargets: {
        x: filterViewportCoordinates([topLeft.x, bottomRight.x], viewport.width),
        y: filterViewportCoordinates([topLeft.y, bottomRight.y], viewport.height)
      }
    };
  }

  private getScreenshotSelection() {
    return this.callbacks.getScreenshotSelection?.() ?? { active: false, rect: null };
  }
}

function isValidViewport(viewport: ViewportInfo): boolean {
  return viewport.width > 0 && viewport.height > 0;
}

function isPointInsideViewport(point: PointerPosition, viewport: ViewportInfo): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= viewport.width &&
    point.y >= 0 &&
    point.y <= viewport.height
  );
}

function filterViewportCoordinates(values: number[], max: number): number[] {
  return values.filter((value) => Number.isFinite(value) && value >= 0 && value <= max);
}

function createViewerKeyboardNavigationInput(): ViewerKeyboardNavigationInput {
  return {
    up: false,
    left: false,
    down: false,
    right: false
  };
}
