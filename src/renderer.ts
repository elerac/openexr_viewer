import { GlImageRenderer } from './rendering/gl-image-renderer';
import { OverlayRenderer } from './rendering/overlay-renderer';
import type { ViewerState, ViewportInfo } from './types';

export class WebGlExrRenderer {
  private readonly imageRenderer: GlImageRenderer;
  private readonly overlayRenderer: OverlayRenderer;

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
    this.imageRenderer.resize(width, height);
    const viewport = this.imageRenderer.getViewport();
    this.overlayRenderer.resize(viewport.width, viewport.height);
  }

  setDisplayTexture(width: number, height: number, rgbaTexture: Float32Array): void {
    this.imageRenderer.setDisplayTexture(width, height, rgbaTexture);
    this.overlayRenderer.setDisplayTexture(width, height, rgbaTexture);
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    this.imageRenderer.setColormapTexture(entryCount, rgba8);
  }

  clearImage(): void {
    this.imageRenderer.clearImage();
    this.overlayRenderer.clearImage();
  }

  render(state: ViewerState): void {
    this.imageRenderer.render(state);
    this.overlayRenderer.render(state);
  }
}
