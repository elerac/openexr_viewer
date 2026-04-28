import type {
  ImagePixel,
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  ViewerKeyboardNavigationDirection,
  ViewerKeyboardNavigationInput,
  ViewerKeyboardZoomDirection,
  ViewerKeyboardZoomInput,
  ViewportInfo,
  ViewerState
} from '../types';
import { imageToScreen } from './image-geometry';
import {
  ImageKeyboardPanController,
  panImageFromDrag,
  zoomImageByKeyboardStep,
  zoomImageFromKeyboard,
  zoomImageFromWheel
} from './image-mode';
import {
  orbitPanoramaFromDrag,
  PanoramaKeyboardOrbitController,
  zoomPanoramaByKeyboardStep,
  zoomPanoramaFromKeyboard,
  zoomPanoramaFromWheel
} from './panorama-mode';
import { getPanoramaProjectionDiameter } from './panorama-geometry';
import { resolveHoverPixel, resolveProbePixel } from './probe-mode';
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
const KEYBOARD_ZOOM_SPEED_STEPS_PER_SECOND = 3;
const KEYBOARD_ZOOM_MAX_FRAME_MS = 50;

export class ViewerInteraction {
  private readonly element: HTMLElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly imageKeyboardPan: ImageKeyboardPanController;
  private readonly panoramaKeyboardOrbit: PanoramaKeyboardOrbitController;
  private readonly keyboardZoom: ViewerKeyboardZoomController;
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
    this.keyboardZoom = new ViewerKeyboardZoomController({
      getState: callbacks.getState,
      getViewport: callbacks.getViewport,
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: callbacks.onHoverPixel,
      getLastPointerInElement: () => this.lastPointerInElement,
      isBlocked: () => this.getScreenshotSelection().active
    }, dependencies);

    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointerleave', this.onPointerLeave);
    this.element.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy(): void {
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.imageKeyboardPan.destroy();
    this.panoramaKeyboardOrbit.destroy();
    this.keyboardZoom.destroy();
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

  handleViewerKeyboardZoom(direction: ViewerKeyboardZoomDirection): void {
    if (this.getScreenshotSelection().active) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    if (state.viewerMode === 'panorama') {
      const nextView = zoomPanoramaFromKeyboard(state, direction);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.callbacks.onHoverPixel(
        resolveHoverPixel(this.lastPointerInElement, nextState, viewport, imageSize)
      );
      return;
    }

    if (state.viewerMode !== 'image') {
      return;
    }

    const point = this.lastPointerInElement ?? {
      x: viewport.width * 0.5,
      y: viewport.height * 0.5
    };
    const nextView = zoomImageFromKeyboard(state, viewport, point, direction);
    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(resolveProbePixel(point, nextState, viewport, imageSize));
  }

  setViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): void {
    this.keyboardZoom.setInput(input);
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
    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      if (!isScreenshotSelectionDragButton(event)) {
        return;
      }

      const point = this.getLocalPoint(event);
      this.lastPointerInElement = point;
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

    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
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
    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      const point = this.getLocalPoint(event);
      this.lastPointerInElement = point;
      if (this.dragging && this.dragMode === 'screenshot') {
        const rect = this.getScreenshotSelection().rect;
        this.clearDrag(event.pointerId);
        this.callbacks.onScreenshotSelectionHandleHover?.(
          rect ? resolveScreenshotSelectionHandle(point, rect) : null
        );
        return;
      }

      if (event.button !== 0) {
        return;
      }

      this.callbacks.onHoverPixel(null);
      this.callbacks.onScreenshotSelectionHandleHover?.(
        screenshotSelection.rect ? resolveScreenshotSelectionHandle(point, screenshotSelection.rect) : null
      );
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
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

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (
      !this.getScreenshotSelection().active ||
      (event.target instanceof Element && event.target.closest('.screenshot-selection-controls'))
    ) {
      return;
    }

    event.preventDefault();
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

type ViewerKeyboardZoomCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getViewport' | 'getImageSize' | 'onViewChange' | 'onHoverPixel'
> & {
  getLastPointerInElement: () => PointerPosition | null;
  isBlocked: () => boolean;
};

class ViewerKeyboardZoomController {
  private readonly callbacks: ViewerKeyboardZoomCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createViewerKeyboardZoomInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: ViewerKeyboardZoomCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createViewerKeyboardZoomInput();
    this.lastFrameTime = null;
  }

  setInput(input: ViewerKeyboardZoomInput): void {
    const previousInput = this.input;
    const nextInput = cloneViewerKeyboardZoomInput(input);
    if (sameViewerKeyboardZoomInput(previousInput, nextInput)) {
      if (hasViewerKeyboardZoomInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedViewerKeyboardZoomInput(previousInput, nextInput);
    if (hasViewerKeyboardZoomInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, 1);
    }

    if (hasViewerKeyboardZoomInput(nextInput)) {
      if (!hasViewerKeyboardZoomInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: ViewerKeyboardZoomInput, stepRatio: number): void {
    if (this.callbacks.isBlocked()) {
      return;
    }

    const signedDirection = (input.zoomIn ? 1 : 0) - (input.zoomOut ? 1 : 0);
    if (signedDirection === 0) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    if (state.viewerMode === 'panorama') {
      const nextView = zoomPanoramaByKeyboardStep(state, signedDirection * stepRatio);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.callbacks.onHoverPixel(
        resolveHoverPixel(this.callbacks.getLastPointerInElement(), nextState, viewport, imageSize)
      );
      return;
    }

    if (state.viewerMode !== 'image') {
      return;
    }

    const point = this.callbacks.getLastPointerInElement() ?? {
      x: viewport.width * 0.5,
      y: viewport.height * 0.5
    };
    const nextView = zoomImageByKeyboardStep(state, viewport, point, signedDirection * stepRatio);
    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(resolveProbePixel(point, nextState, viewport, imageSize));
  }

  private ensureScheduledFrame(): void {
    if (this.frameId !== null || !hasViewerKeyboardZoomInput(this.input)) {
      return;
    }

    this.frameId = this.scheduleFrame(this.onFrame);
  }

  private cancelScheduledFrame(): void {
    if (this.frameId === null) {
      return;
    }

    this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameId = null;
    if (!hasViewerKeyboardZoomInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        KEYBOARD_ZOOM_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          KEYBOARD_ZOOM_SPEED_STEPS_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function createViewerKeyboardZoomInput(): ViewerKeyboardZoomInput {
  return {
    zoomIn: false,
    zoomOut: false
  };
}

function cloneViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): ViewerKeyboardZoomInput {
  return {
    zoomIn: input.zoomIn,
    zoomOut: input.zoomOut
  };
}

function getNewlyPressedViewerKeyboardZoomInput(
  previousInput: ViewerKeyboardZoomInput,
  nextInput: ViewerKeyboardZoomInput
): ViewerKeyboardZoomInput {
  return {
    zoomIn: nextInput.zoomIn && !previousInput.zoomIn,
    zoomOut: nextInput.zoomOut && !previousInput.zoomOut
  };
}

function hasViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): boolean {
  return input.zoomIn || input.zoomOut;
}

function sameViewerKeyboardZoomInput(
  a: ViewerKeyboardZoomInput,
  b: ViewerKeyboardZoomInput
): boolean {
  return a.zoomIn === b.zoomIn && a.zoomOut === b.zoomOut;
}

function isScreenshotSelectionDragButton(event: PointerEvent): boolean {
  return event.button === 0 || (event.button === 2 && event.ctrlKey);
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
