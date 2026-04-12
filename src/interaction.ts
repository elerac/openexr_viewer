import { ImagePixel, ViewerState, ViewportInfo } from './types';

export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 512;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function exposureToScale(exposureEv: number): number {
  return 2 ** exposureEv;
}

export function screenToImage(
  screenX: number,
  screenY: number,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): ImagePixel | null {
  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  const ix = Math.floor(imageX);
  const iy = Math.floor(imageY);

  if (ix < 0 || iy < 0 || ix >= imageWidth || iy >= imageHeight) {
    return null;
  }

  return { ix, iy };
}

export function imageToScreen(
  imageX: number,
  imageY: number,
  state: ViewerState,
  viewport: ViewportInfo
): { x: number; y: number } {
  return {
    x: (imageX - state.panX) * state.zoom + viewport.width * 0.5,
    y: (imageY - state.panY) * state.zoom + viewport.height * 0.5
  };
}

export function zoomAroundPoint(
  state: ViewerState,
  viewport: ViewportInfo,
  screenX: number,
  screenY: number,
  requestedZoom: number
): { zoom: number; panX: number; panY: number } {
  const zoom = clampZoom(requestedZoom);
  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  return {
    zoom,
    panX: imageX - (screenX - viewport.width * 0.5) / zoom,
    panY: imageY - (screenY - viewport.height * 0.5) / zoom
  };
}

export interface InteractionCallbacks {
  getState: () => ViewerState;
  getViewport: () => ViewportInfo;
  getImageSize: () => { width: number; height: number } | null;
  onViewChange: (next: { zoom: number; panX: number; panY: number }) => void;
  onHoverPixel: (pixel: ImagePixel | null) => void;
  onToggleLockPixel: (pixel: ImagePixel | null) => void;
}

interface PointerPosition {
  x: number;
  y: number;
}

export class ViewerInteraction {
  private readonly element: HTMLElement;
  private readonly callbacks: InteractionCallbacks;
  private dragging = false;
  private movedDuringDrag = false;
  private previousPointer: PointerPosition | null = null;

  constructor(element: HTMLElement, callbacks: InteractionCallbacks) {
    this.element = element;
    this.callbacks = callbacks;

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
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const point = this.getLocalPoint(event);
    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();

    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const requestedZoom = state.zoom * zoomFactor;
    const next = zoomAroundPoint(state, viewport, point.x, point.y, requestedZoom);

    this.callbacks.onViewChange(next);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    this.dragging = true;
    this.movedDuringDrag = false;
    this.previousPointer = this.getLocalPoint(event);
    this.element.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.getLocalPoint(event);
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.callbacks.onHoverPixel(null);
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();

    if (this.dragging && this.previousPointer) {
      const dx = point.x - this.previousPointer.x;
      const dy = point.y - this.previousPointer.y;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.movedDuringDrag = true;
      }

      this.callbacks.onViewChange({
        zoom: state.zoom,
        panX: state.panX - dx / state.zoom,
        panY: state.panY - dy / state.zoom
      });

      this.previousPointer = point;
    }

    const currentState = this.callbacks.getState();
    const hoverPixel = screenToImage(
      point.x,
      point.y,
      currentState,
      viewport,
      imageSize.width,
      imageSize.height
    );
    this.callbacks.onHoverPixel(hoverPixel);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.clearDrag(event.pointerId);
      return;
    }

    if (this.dragging && !this.movedDuringDrag) {
      const state = this.callbacks.getState();
      const viewport = this.callbacks.getViewport();

      const pixel = screenToImage(
        point.x,
        point.y,
        state,
        viewport,
        imageSize.width,
        imageSize.height
      );
      this.callbacks.onToggleLockPixel(pixel);
    }

    this.clearDrag(event.pointerId);
  };

  private onPointerLeave = (): void => {
    this.callbacks.onHoverPixel(null);
  };

  private clearDrag(pointerId: number): void {
    if (this.dragging && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
    this.dragging = false;
    this.movedDuringDrag = false;
    this.previousPointer = null;
  }

  private getLocalPoint(event: MouseEvent): PointerPosition {
    const rect = this.element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }
}
