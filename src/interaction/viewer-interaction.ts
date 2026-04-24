import type {
  ImagePixel,
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  ViewerState
} from '../types';
import { panImageFromDrag, zoomImageFromWheel } from './image-mode';
import { orbitPanoramaFromDrag, PanoramaKeyboardOrbitController, zoomPanoramaFromWheel } from './panorama-mode';
import { resolveProbePixel } from './probe-mode';
import {
  commitRoiFromDrag,
  createDraftRoiFromAnchor,
  resolveRoiAnchorPixel,
  updateDraftRoiFromDrag
} from './roi-mode';
import type { InteractionCallbacks, InteractionDependencies, PointerPosition } from './shared';

export type { InteractionCallbacks, InteractionDependencies } from './shared';

type DragMode = 'pan' | 'roi' | null;

export class ViewerInteraction {
  private readonly element: HTMLElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly panoramaKeyboardOrbit: PanoramaKeyboardOrbitController;
  private dragging = false;
  private movedDuringDrag = false;
  private dragMode: DragMode = null;
  private previousPointer: PointerPosition | null = null;
  private lastPointerInElement: PointerPosition | null = null;
  private roiAnchorPixel: ImagePixel | null = null;

  constructor(
    element: HTMLElement,
    callbacks: InteractionCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
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
    this.panoramaKeyboardOrbit.destroy();
  }

  handlePanoramaKeyboardOrbit(direction: PanoramaKeyboardOrbitDirection): void {
    this.panoramaKeyboardOrbit.handle(direction);
  }

  setPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): void {
    this.panoramaKeyboardOrbit.setInput(input);
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();

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
  };

  private clearDrag(pointerId: number): void {
    if (this.dragging && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
    this.dragging = false;
    this.dragMode = null;
    this.movedDuringDrag = false;
    this.previousPointer = null;
    this.roiAnchorPixel = null;
  }

  private getLocalPoint(event: MouseEvent): PointerPosition {
    const rect = this.element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }
}
