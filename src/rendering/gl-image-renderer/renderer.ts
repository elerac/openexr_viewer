import { createEmptyDisplaySourceBinding, type DisplaySourceBinding } from '../../display-texture';
import type { ExportImagePixels } from '../../export-image';
import type { Disposable } from '../../lifecycle';
import type { DecodedLayer, ViewerState, ViewportInfo } from '../../types';
import { REQUIRED_TEXTURE_UNITS } from './constants';
import { setColormapTexture } from './colormap-texture';
import { deleteExportSurface, readExportPixels } from './export-surface';
import { render } from './render-pass';
import { createGlImageRendererState } from './shared-state';
import {
  discardChannelSourceTexture,
  discardLayerSourceTextures,
  discardSessionTextures,
  ensureLayerChannelsResident,
  setDisplaySelectionBindings
} from './texture-store';
import type { GlImageRendererState, ReadExportPixelsArgs } from './types';

export class GlImageRenderer implements Disposable {
  private readonly state: GlImageRendererState;

  private get layerTexturesBySession() {
    return this.state.layerTexturesBySession;
  }

  constructor(glCanvas: HTMLCanvasElement) {
    this.state = createGlImageRendererState(glCanvas);
  }

  getViewport(): ViewportInfo {
    return this.state.viewport;
  }

  getImageSize(): { width: number; height: number } | null {
    return this.state.imageSize;
  }

  resize(width: number, height: number, left = 0, top = 0): void {
    if (this.state.disposed) {
      return;
    }

    this.state.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.state.viewportOrigin = {
      left: Number.isFinite(left) ? left : 0,
      top: Number.isFinite(top) ? top : 0
    };

    this.state.glCanvas.width = this.state.viewport.width;
    this.state.glCanvas.height = this.state.viewport.height;
    this.state.gl.viewport(0, 0, this.state.viewport.width, this.state.viewport.height);
  }

  ensureLayerChannelsResident(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    channelNames: string[]
  ): string[] {
    if (this.state.disposed) {
      return [];
    }

    return ensureLayerChannelsResident(this.state, sessionId, layerIndex, width, height, layer, channelNames);
  }

  setDisplaySelectionBindings(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    binding: DisplaySourceBinding
  ): void {
    if (this.state.disposed) {
      return;
    }

    setDisplaySelectionBindings(this.state, sessionId, layerIndex, width, height, binding);
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (this.state.disposed) {
      return;
    }

    setColormapTexture(this.state, entryCount, rgba8);
  }

  discardSessionTextures(sessionId: string): void {
    if (this.state.disposed) {
      return;
    }

    discardSessionTextures(this.state, sessionId);
  }

  discardLayerSourceTextures(sessionId: string, layerIndex: number): void {
    if (this.state.disposed) {
      return;
    }

    discardLayerSourceTextures(this.state, sessionId, layerIndex);
  }

  discardChannelSourceTexture(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.state.disposed) {
      return;
    }

    discardChannelSourceTexture(this.state, sessionId, layerIndex, channelName);
  }

  clearImage(): void {
    if (this.state.disposed) {
      return;
    }

    this.state.imageSize = null;
    this.state.activeBinding = createEmptyDisplaySourceBinding();
    this.state.gl.bindFramebuffer(this.state.gl.FRAMEBUFFER, null);
    this.state.gl.viewport(0, 0, this.state.viewport.width, this.state.viewport.height);
    this.state.gl.clearColor(0, 0, 0, 0);
    this.state.gl.clear(this.state.gl.COLOR_BUFFER_BIT);
  }

  readExportPixels(args: ReadExportPixelsArgs): ExportImagePixels {
    if (this.state.disposed) {
      throw new Error('Renderer has been disposed.');
    }

    return readExportPixels(this.state, args);
  }

  render(state: ViewerState): void {
    if (this.state.disposed) {
      return;
    }

    render(this.state, state);
  }

  dispose(): void {
    if (this.state.disposed) {
      return;
    }

    this.state.disposed = true;
    for (const sessionId of this.state.layerTexturesBySession.keys()) {
      discardSessionTextures(this.state, sessionId);
    }
    this.state.layerTexturesBySession.clear();
    this.state.imageSize = null;
    this.state.colormapEntryCount = 0;
    this.state.activeBinding = createEmptyDisplaySourceBinding();
    deleteExportSurface(this.state.gl, this.state.exportSourceSurface);
    this.state.exportSourceSurface = null;
    this.state.gl.bindVertexArray(null);
    this.state.gl.useProgram(null);
    for (let slotIndex = 0; slotIndex < REQUIRED_TEXTURE_UNITS; slotIndex += 1) {
      this.state.gl.activeTexture(this.state.gl.TEXTURE0 + slotIndex);
      this.state.gl.bindTexture(this.state.gl.TEXTURE_2D, null);
    }
    this.state.gl.deleteTexture(this.state.zeroTexture);
    this.state.gl.deleteTexture(this.state.colormapTexture);
    this.state.gl.deleteVertexArray(this.state.vao);
    this.state.gl.deleteProgram(this.state.imageProgram.program);
    this.state.gl.deleteProgram(this.state.panoramaProgram.program);
  }
}
