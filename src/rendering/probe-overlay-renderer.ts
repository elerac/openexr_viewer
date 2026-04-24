import { imageToScreen } from '../interaction/image-geometry';
import type { Disposable } from '../lifecycle';
import { resolveActiveProbePixel } from '../probe';
import type { ImagePixel, ImageRoi, ViewerState, ViewportInfo } from '../types';

export class ProbeOverlayRenderer implements Disposable {
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private hasImage = false;
  private disposed = false;

  constructor(overlayCanvas: HTMLCanvasElement) {
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      throw new Error('Unable to create probe overlay 2D canvas context.');
    }

    this.overlayCanvas = overlayCanvas;
    this.overlayContext = overlayContext;
  }

  resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.overlayCanvas.width = this.viewport.width;
    this.overlayCanvas.height = this.viewport.height;
  }

  setImagePresent(hasImage: boolean): void {
    if (this.disposed) {
      return;
    }

    this.hasImage = hasImage;
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.hasImage = false;
    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  render(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    const ctx = this.overlayContext;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    if (!this.hasImage || state.viewerMode === 'panorama') {
      return;
    }

    if (state.roi) {
      this.drawRoi(state, state.roi, 'rgba(255, 122, 89, 0.95)');
    }

    if (state.draftRoi) {
      this.drawRoi(state, state.draftRoi, 'rgba(75, 192, 255, 0.95)');
    }

    const probe = resolveActiveProbePixel(state.lockedPixel, state.hoveredPixel);
    if (!probe) {
      return;
    }

    this.drawProbeMarker(state, probe);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hasImage = false;
    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  private drawProbeMarker(state: ViewerState, pixel: ImagePixel): void {
    const ctx = this.overlayContext;
    const topLeft = imageToScreen(pixel.ix, pixel.iy, state, this.viewport);

    ctx.strokeStyle = state.lockedPixel ? 'rgba(255, 196, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, state.zoom, state.zoom);
  }

  private drawRoi(state: ViewerState, roi: ImageRoi, strokeStyle: string): void {
    const ctx = this.overlayContext;
    const topLeft = imageToScreen(roi.x0, roi.y0, state, this.viewport);
    const bottomRight = imageToScreen(roi.x1 + 1, roi.y1 + 1, state, this.viewport);

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }
}
