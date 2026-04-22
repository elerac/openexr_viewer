import { GlImageRenderer } from './rendering/gl-image-renderer';
import { OverlayRenderer } from './rendering/overlay-renderer';
import { ProbeOverlayRenderer } from './rendering/probe-overlay-renderer';
import type { ExportImagePixels } from './export-image';
import type { Disposable } from './lifecycle';
import type { DisplaySourceBinding } from './display-texture';
import type { DecodedLayer, ViewerRenderState, ViewerState, ViewportInfo } from './types';
import type { ReadExportPixelsArgs } from './rendering/gl-image-renderer';

export class WebGlExrRenderer implements Disposable {
  private readonly imageRenderer: GlImageRenderer;
  private readonly overlayRenderer: OverlayRenderer;
  private readonly probeOverlayRenderer: ProbeOverlayRenderer;
  private disposed = false;

  constructor(
    glCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    probeOverlayCanvas: HTMLCanvasElement
  ) {
    this.imageRenderer = new GlImageRenderer(glCanvas);
    this.overlayRenderer = new OverlayRenderer(overlayCanvas);
    this.probeOverlayRenderer = new ProbeOverlayRenderer(probeOverlayCanvas);
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
    this.probeOverlayRenderer.resize(viewport.width, viewport.height);
  }

  ensureLayerChannelsResident(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    channelNames: string[]
  ): string[] {
    if (this.disposed) {
      return [];
    }

    return this.imageRenderer.ensureLayerChannelsResident(sessionId, layerIndex, width, height, layer, channelNames);
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
    this.probeOverlayRenderer.setImagePresent(true);
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

  discardLayerSourceTextures(sessionId: string, layerIndex: number): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardLayerSourceTextures(sessionId, layerIndex);
  }

  discardChannelSourceTexture(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardChannelSourceTexture(sessionId, layerIndex, channelName);
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.clearImage();
    this.overlayRenderer.clearImage();
    this.probeOverlayRenderer.clearImage();
  }

  render(state: ViewerRenderState): void {
    if (this.disposed) {
      return;
    }

    this.renderImage(state);
    this.renderValueOverlay(state);
    this.renderProbeOverlay(state);
  }

  renderImage(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.render(state);
  }

  renderValueOverlay(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.overlayRenderer.renderValues(state);
  }

  renderProbeOverlay(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.probeOverlayRenderer.render(state);
  }

  readExportPixels(args: ReadExportPixelsArgs): ExportImagePixels {
    if (this.disposed) {
      throw new Error('Renderer has been disposed.');
    }

    return this.imageRenderer.readExportPixels(args);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.probeOverlayRenderer.dispose();
    this.overlayRenderer.dispose();
    this.imageRenderer.dispose();
  }
}
