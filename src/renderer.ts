import { GlImageRenderer } from './rendering/gl-image-renderer';
import type { Disposable } from './lifecycle';
import { OverlayRenderer } from './rendering/overlay-renderer';
import type { ViewerState, ViewportInfo } from './types';

export class WebGlExrRenderer implements Disposable {
  private readonly imageRenderer: GlImageRenderer;
  private readonly overlayRenderer: OverlayRenderer;
  private disposed = false;

  constructor(glCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) {
    this.imageRenderer = new GlImageRenderer(glCanvas);
    this.overlayRenderer = new OverlayRenderer(overlayCanvas);
  }

  getViewport(): ViewportInfo {
    return this.imageRenderer.getViewport();
  }

  getImageSize(): { width: number; height: number } | null {
    return this.imageRenderer.getImageSize();
  }

  resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.resize(width, height);
    const viewport = this.imageRenderer.getViewport();
    this.overlayRenderer.resize(viewport.width, viewport.height);
  }

  setDisplayTexture(width: number, height: number, rgbaTexture: Float32Array): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setDisplayTexture(width, height, rgbaTexture);
    this.overlayRenderer.setDisplayTexture(width, height, rgbaTexture);
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setColormapTexture(entryCount, rgba8);
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.clearImage();
    this.overlayRenderer.clearImage();
  }

  render(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.render(state);
    this.overlayRenderer.render(state);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.overlayRenderer.dispose();
    this.imageRenderer.dispose();
  }
}
