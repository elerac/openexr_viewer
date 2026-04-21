import { GlImageRenderer } from './rendering/gl-image-renderer';
import { OverlayRenderer } from './rendering/overlay-renderer';
import type { Disposable } from './lifecycle';
import type { DisplaySourceBinding } from './display-texture';
import type { DecodedLayer, ViewerState, ViewportInfo } from './types';

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

  ensureLayerSourceTextures(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer
  ): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.ensureLayerSourceTextures(sessionId, layerIndex, width, height, layer);
  }

  setDisplaySelectionBindings(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    selection: ViewerState['displaySelection'],
    _textureRevisionKey: string,
    binding: DisplaySourceBinding
  ): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setDisplaySelectionBindings(sessionId, layerIndex, width, height, binding);
    this.overlayRenderer.setDisplaySelectionContext(width, height, layer, selection);
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setColormapTexture(entryCount, rgba8);
  }

  discardSessionTextures(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardSessionTextures(sessionId);
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
