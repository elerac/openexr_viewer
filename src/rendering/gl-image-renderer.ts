import { discardMaterializedChannel, getChannelDenseArray } from '../channel-storage';
import {
  DISPLAY_SOURCE_SLOT_COUNT,
  createEmptyDisplaySourceBinding,
  type DisplaySourceBinding,
  type DisplaySourceMode
} from '../display-texture';
import type { ExportImagePixels } from '../export-image';
import { isStokesDegreeModulationEnabled } from '../stokes';
import type { DecodedLayer, ViewerState, ViewportInfo } from '../types';
import type { Disposable } from '../lifecycle';
import imageFragmentSource from './shaders/exr-image.frag.glsl?raw';
import panoramaFragmentSource from './shaders/panorama-image.frag.glsl?raw';
import vertexSource from './shaders/fullscreen-triangle.vert.glsl?raw';

const COLORMAP_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT;
const REQUIRED_TEXTURE_UNITS = DISPLAY_SOURCE_SLOT_COUNT + 1;
const ALPHA_OUTPUT_OPAQUE = 0;
const ALPHA_OUTPUT_STRAIGHT = 1;
const ALPHA_OUTPUT_PREMULTIPLIED = 2;

interface CommonUniforms {
  viewport: WebGLUniformLocation;
  viewportOrigin: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  useColormap: WebGLUniformLocation;
  colormapMin: WebGLUniformLocation;
  colormapMax: WebGLUniformLocation;
  colormapTextureSize: WebGLUniformLocation;
  colormapEntryCount: WebGLUniformLocation;
  displayMode: WebGLUniformLocation;
  stokesParameter: WebGLUniformLocation;
  useStokesDegreeModulation: WebGLUniformLocation;
  useImageAlpha: WebGLUniformLocation;
  compositeCheckerboard: WebGLUniformLocation;
  alphaOutputMode: WebGLUniformLocation;
}

interface ImageUniforms extends CommonUniforms {
  pan: WebGLUniformLocation;
  zoom: WebGLUniformLocation;
}

interface PanoramaUniforms extends CommonUniforms {
  panoramaYawDeg: WebGLUniformLocation;
  panoramaPitchDeg: WebGLUniformLocation;
  panoramaHfovDeg: WebGLUniformLocation;
}

interface ProgramBundle<TUniforms extends CommonUniforms> {
  program: WebGLProgram;
  uniforms: TUniforms;
}

interface LayerSourceTextures {
  layer: DecodedLayer;
  width: number;
  height: number;
  textureByChannel: Map<string, WebGLTexture>;
}

interface ExportSurface {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface RenderPassOptions {
  compositeCheckerboard: boolean;
  alphaOutputMode: AlphaOutputMode;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportLeft?: number;
  viewportTop?: number;
}

type AlphaOutputMode = 'opaque' | 'straight' | 'premultiplied';

export interface ReadExportPixelsArgs {
  state: ViewerState;
  sourceWidth: number;
  sourceHeight: number;
}

const DEFAULT_RENDER_PASS_OPTIONS: RenderPassOptions = {
  compositeCheckerboard: true,
  alphaOutputMode: 'opaque'
};

export class GlImageRenderer implements Disposable {
  private readonly glCanvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly zeroTexture: WebGLTexture;
  private readonly colormapTexture: WebGLTexture;
  private readonly imageProgram: ProgramBundle<ImageUniforms>;
  private readonly panoramaProgram: ProgramBundle<PanoramaUniforms>;
  private readonly layerTexturesBySession = new Map<string, Map<number, LayerSourceTextures>>();
  private exportSourceSurface: ExportSurface | null = null;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private viewportOrigin = { left: 0, top: 0 };
  private imageSize: { width: number; height: number } | null = null;
  private colormapTextureSize = { width: 1, height: 1 };
  private colormapEntryCount = 0;
  private activeBinding: DisplaySourceBinding = createEmptyDisplaySourceBinding();
  private disposed = false;

  constructor(glCanvas: HTMLCanvasElement) {
    const gl = glCanvas.getContext('webgl2', { antialias: false });
    if (!gl) {
      throw new Error('WebGL2 is required for this viewer.');
    }

    const maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    if (maxTextureUnits < REQUIRED_TEXTURE_UNITS) {
      throw new Error(`WebGL2 must expose at least ${REQUIRED_TEXTURE_UNITS} texture units.`);
    }

    this.glCanvas = glCanvas;
    this.gl = gl;

    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error('Failed to create vertex array object.');
    }
    this.vao = vao;

    const zeroTexture = gl.createTexture();
    if (!zeroTexture) {
      throw new Error('Failed to create zero texture.');
    }
    this.zeroTexture = zeroTexture;

    const colormapTexture = gl.createTexture();
    if (!colormapTexture) {
      throw new Error('Failed to create colormap texture.');
    }
    this.colormapTexture = colormapTexture;

    this.imageProgram = this.createImageProgram();
    this.panoramaProgram = this.createPanoramaProgram();

    gl.bindVertexArray(this.vao);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.zeroTexture);
    this.configureSourceTexture();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      1,
      1,
      0,
      gl.RED,
      gl.FLOAT,
      new Float32Array([0])
    );

    gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255])
    );

    this.configureProgramSamplers(this.imageProgram.program);
    this.configureProgramSamplers(this.panoramaProgram.program);
  }

  getViewport(): ViewportInfo {
    return this.viewport;
  }

  getImageSize(): { width: number; height: number } | null {
    return this.imageSize;
  }

  resize(width: number, height: number, left = 0, top = 0): void {
    if (this.disposed) {
      return;
    }

    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.viewportOrigin = {
      left: Number.isFinite(left) ? left : 0,
      top: Number.isFinite(top) ? top : 0
    };

    this.glCanvas.width = this.viewport.width;
    this.glCanvas.height = this.viewport.height;
    this.gl.viewport(0, 0, this.viewport.width, this.viewport.height);
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

    const layerTextures = this.getOrCreateLayerSourceTextures(sessionId, layerIndex, width, height, layer);
    const newlyResidentChannels: string[] = [];

    for (const channelName of channelNames) {
      if (!channelName || layerTextures.textureByChannel.has(channelName)) {
        continue;
      }

      if (layer.channelStorage.channelIndexByName[channelName] === undefined) {
        continue;
      }

      const denseChannel = getChannelDenseArray(layer, channelName);
      if (!denseChannel) {
        continue;
      }

      const texture = this.gl.createTexture();
      if (!texture) {
        throw new Error('Failed to create source texture.');
      }

      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.configureSourceTexture();
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.R32F,
        width,
        height,
        0,
        this.gl.RED,
        this.gl.FLOAT,
        denseChannel
      );
      layerTextures.textureByChannel.set(channelName, texture);
      newlyResidentChannels.push(channelName);
    }

    return newlyResidentChannels;
  }

  setDisplaySelectionBindings(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    binding: DisplaySourceBinding
  ): void {
    if (this.disposed) {
      return;
    }

    this.imageSize = { width, height };
    this.activeBinding = binding;

    const layerTextures = this.layerTexturesBySession.get(sessionId)?.get(layerIndex) ?? null;
    for (let slotIndex = 0; slotIndex < DISPLAY_SOURCE_SLOT_COUNT; slotIndex += 1) {
      const channelName = binding.slots[slotIndex];
      const texture = channelName
        ? layerTextures?.textureByChannel.get(channelName) ?? this.zeroTexture
        : this.zeroTexture;
      this.gl.activeTexture(this.gl.TEXTURE0 + slotIndex);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    }
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (this.disposed) {
      return;
    }

    if (!Number.isInteger(entryCount) || entryCount < 2) {
      throw new Error('Colormap texture requires at least 2 entries.');
    }

    const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    const width = Math.min(entryCount, maxTextureSize);
    const height = Math.ceil(entryCount / width);
    if (height > maxTextureSize) {
      throw new Error(`Colormap has too many entries for this GPU (${entryCount}).`);
    }

    const texelCount = width * height;
    const expectedLength = entryCount * 4;
    if (rgba8.length !== expectedLength) {
      throw new Error(`Invalid colormap data length: expected ${expectedLength}, got ${rgba8.length}.`);
    }

    const uploadData = texelCount === entryCount ? rgba8 : new Uint8Array(texelCount * 4);
    if (uploadData !== rgba8) {
      uploadData.set(rgba8);
      const lastColorOffset = (entryCount - 1) * 4;
      for (let index = entryCount; index < texelCount; index += 1) {
        const offset = index * 4;
        uploadData[offset + 0] = rgba8[lastColorOffset + 0];
        uploadData[offset + 1] = rgba8[lastColorOffset + 1];
        uploadData[offset + 2] = rgba8[lastColorOffset + 2];
        uploadData[offset + 3] = rgba8[lastColorOffset + 3];
      }
    }

    this.colormapTextureSize = { width, height };
    this.colormapEntryCount = entryCount;
    this.gl.activeTexture(this.gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.colormapTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA8,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      uploadData
    );
  }

  discardSessionTextures(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    const sessionLayers = this.layerTexturesBySession.get(sessionId);
    if (!sessionLayers) {
      return;
    }

    for (const layerIndex of [...sessionLayers.keys()]) {
      this.discardLayerSourceTextures(sessionId, layerIndex);
    }
  }

  discardLayerSourceTextures(sessionId: string, layerIndex: number): void {
    if (this.disposed) {
      return;
    }

    const sessionLayers = this.layerTexturesBySession.get(sessionId);
    if (!sessionLayers) {
      return;
    }

    const layerTextures = sessionLayers.get(layerIndex);
    if (!layerTextures) {
      return;
    }

    for (const channelName of [...layerTextures.textureByChannel.keys()]) {
      this.discardChannelSourceTexture(sessionId, layerIndex, channelName);
    }
  }

  discardChannelSourceTexture(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.disposed) {
      return;
    }

    const sessionLayers = this.layerTexturesBySession.get(sessionId);
    if (!sessionLayers) {
      return;
    }

    const layerTextures = sessionLayers.get(layerIndex);
    if (!layerTextures) {
      return;
    }

    const texture = layerTextures.textureByChannel.get(channelName);
    if (!texture) {
      return;
    }

    this.gl.deleteTexture(texture);
    layerTextures.textureByChannel.delete(channelName);
    discardMaterializedChannel(layerTextures.layer, channelName);

    if (layerTextures.textureByChannel.size > 0) {
      return;
    }

    sessionLayers.delete(layerIndex);
    if (sessionLayers.size === 0) {
      this.layerTexturesBySession.delete(sessionId);
    }
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.imageSize = null;
    this.activeBinding = createEmptyDisplaySourceBinding();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.viewport.width, this.viewport.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  readExportPixels({
    state,
    sourceWidth,
    sourceHeight
  }: ReadExportPixelsArgs): ExportImagePixels {
    if (this.disposed) {
      throw new Error('Renderer has been disposed.');
    }
    if (!this.imageSize || this.imageSize.width !== sourceWidth || this.imageSize.height !== sourceHeight) {
      throw new Error('No prepared image is active for export.');
    }
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error('Export dimensions must be positive.');
    }

    const gl = this.gl;
    const sourceSurface = this.getOrCreateExportSurface(this.exportSourceSurface, sourceWidth, sourceHeight);
    this.exportSourceSurface = sourceSurface;

    const preserveAlpha = this.activeBinding.usesImageAlpha;
    const exportState: ViewerState = {
      ...state,
      viewerMode: 'image',
      zoom: 1,
      panX: sourceWidth * 0.5,
      panY: sourceHeight * 0.5
    };

    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, sourceSurface.framebuffer);
      gl.viewport(0, 0, sourceWidth, sourceHeight);
      this.renderImagePass(exportState, {
        compositeCheckerboard: false,
        alphaOutputMode: preserveAlpha ? 'straight' : 'opaque',
        viewportWidth: sourceWidth,
        viewportHeight: sourceHeight,
        viewportLeft: 0,
        viewportTop: 0
      });

      const data = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceSurface.framebuffer);
      gl.readPixels(0, 0, sourceWidth, sourceHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);

      flipRgbaRowsInPlace(data, sourceWidth, sourceHeight);

      return {
        width: sourceWidth,
        height: sourceHeight,
        data
      };
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.viewport(0, 0, this.viewport.width, this.viewport.height);
    }
  }

  render(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    if (state.viewerMode === 'panorama') {
      this.renderPanoramaPass(state, DEFAULT_RENDER_PASS_OPTIONS);
      return;
    }

    this.renderImagePass(state, DEFAULT_RENDER_PASS_OPTIONS);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const sessionId of this.layerTexturesBySession.keys()) {
      this.discardSessionTextures(sessionId);
    }
    this.layerTexturesBySession.clear();
    this.imageSize = null;
    this.colormapEntryCount = 0;
    this.activeBinding = createEmptyDisplaySourceBinding();
    this.deleteExportSurface(this.exportSourceSurface);
    this.exportSourceSurface = null;
    this.gl.bindVertexArray(null);
    this.gl.useProgram(null);
    for (let slotIndex = 0; slotIndex < REQUIRED_TEXTURE_UNITS; slotIndex += 1) {
      this.gl.activeTexture(this.gl.TEXTURE0 + slotIndex);
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }
    this.gl.deleteTexture(this.zeroTexture);
    this.gl.deleteTexture(this.colormapTexture);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.imageProgram.program);
    this.gl.deleteProgram(this.panoramaProgram.program);
  }

  private createImageProgram(): ProgramBundle<ImageUniforms> {
    const program = createProgram(this.gl, vertexSource, imageFragmentSource);
    return {
      program,
      uniforms: {
        ...this.getCommonUniforms(program),
        pan: getRequiredUniformLocation(this.gl, program, 'uPan'),
        zoom: getRequiredUniformLocation(this.gl, program, 'uZoom')
      }
    };
  }

  private createPanoramaProgram(): ProgramBundle<PanoramaUniforms> {
    const program = createProgram(this.gl, vertexSource, panoramaFragmentSource);
    return {
      program,
      uniforms: {
        ...this.getCommonUniforms(program),
        panoramaYawDeg: getRequiredUniformLocation(this.gl, program, 'uPanoramaYawDeg'),
        panoramaPitchDeg: getRequiredUniformLocation(this.gl, program, 'uPanoramaPitchDeg'),
        panoramaHfovDeg: getRequiredUniformLocation(this.gl, program, 'uPanoramaHfovDeg')
      }
    };
  }

  private getCommonUniforms(program: WebGLProgram): CommonUniforms {
    return {
      viewport: getRequiredUniformLocation(this.gl, program, 'uViewport'),
      viewportOrigin: getRequiredUniformLocation(this.gl, program, 'uViewportOrigin'),
      imageSize: getRequiredUniformLocation(this.gl, program, 'uImageSize'),
      exposure: getRequiredUniformLocation(this.gl, program, 'uExposure'),
      useColormap: getRequiredUniformLocation(this.gl, program, 'uUseColormap'),
      colormapMin: getRequiredUniformLocation(this.gl, program, 'uColormapMin'),
      colormapMax: getRequiredUniformLocation(this.gl, program, 'uColormapMax'),
      colormapTextureSize: getRequiredUniformLocation(this.gl, program, 'uColormapTextureSize'),
      colormapEntryCount: getRequiredUniformLocation(this.gl, program, 'uColormapEntryCount'),
      displayMode: getRequiredUniformLocation(this.gl, program, 'uDisplayMode'),
      stokesParameter: getRequiredUniformLocation(this.gl, program, 'uStokesParameter'),
      useStokesDegreeModulation: getRequiredUniformLocation(this.gl, program, 'uUseStokesDegreeModulation'),
      useImageAlpha: getRequiredUniformLocation(this.gl, program, 'uUseImageAlpha'),
      compositeCheckerboard: getRequiredUniformLocation(this.gl, program, 'uCompositeCheckerboard'),
      alphaOutputMode: getRequiredUniformLocation(this.gl, program, 'uAlphaOutputMode')
    };
  }

  private renderImagePass(state: ViewerState, options: RenderPassOptions): void {
    const gl = this.gl;
    const program = this.imageProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

    this.setCommonUniforms(program.uniforms, state, options);
    gl.uniform2f(program.uniforms.pan, state.panX, state.panY);
    gl.uniform1f(program.uniforms.zoom, state.zoom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private renderPanoramaPass(state: ViewerState, options: RenderPassOptions): void {
    const gl = this.gl;
    const program = this.panoramaProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

    this.setCommonUniforms(program.uniforms, state, options);
    gl.uniform1f(program.uniforms.panoramaYawDeg, state.panoramaYawDeg);
    gl.uniform1f(program.uniforms.panoramaPitchDeg, state.panoramaPitchDeg);
    gl.uniform1f(program.uniforms.panoramaHfovDeg, state.panoramaHfovDeg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private configureSourceTexture(): void {
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
  }

  private configureProgramSamplers(program: WebGLProgram): void {
    this.gl.useProgram(program);
    this.gl.uniform1iv(
      getRequiredUniformLocation(this.gl, program, 'uSourceTextures[0]'),
      Int32Array.from({ length: DISPLAY_SOURCE_SLOT_COUNT }, (_, index) => index)
    );
    this.gl.uniform1i(
      getRequiredUniformLocation(this.gl, program, 'uColormapTexture'),
      COLORMAP_TEXTURE_UNIT
    );
  }

  private setCommonUniforms(
    uniforms: CommonUniforms,
    state: ViewerState,
    options: RenderPassOptions
  ): void {
    const gl = this.gl;
    gl.uniform2f(
      uniforms.viewport,
      options.viewportWidth ?? this.viewport.width,
      options.viewportHeight ?? this.viewport.height
    );
    gl.uniform2f(
      uniforms.viewportOrigin,
      options.viewportLeft ?? this.viewportOrigin.left,
      options.viewportTop ?? this.viewportOrigin.top
    );

    const width = this.imageSize?.width ?? 0;
    const height = this.imageSize?.height ?? 0;
    gl.uniform2f(uniforms.imageSize, width, height);
    gl.uniform1f(uniforms.exposure, state.exposureEv);
    gl.uniform1i(uniforms.useColormap, state.visualizationMode === 'colormap' ? 1 : 0);
    gl.uniform1f(uniforms.colormapMin, state.colormapRange?.min ?? 0);
    gl.uniform1f(uniforms.colormapMax, state.colormapRange?.max ?? 0);
    gl.uniform2i(
      uniforms.colormapTextureSize,
      this.colormapTextureSize.width,
      this.colormapTextureSize.height
    );
    gl.uniform1i(uniforms.colormapEntryCount, this.colormapEntryCount);
    gl.uniform1i(uniforms.displayMode, resolveDisplaySourceModeUniformValue(this.activeBinding.mode));
    gl.uniform1i(uniforms.stokesParameter, resolveStokesParameterUniformValue(this.activeBinding.stokesParameter));
    gl.uniform1i(
      uniforms.useStokesDegreeModulation,
      isStokesDegreeModulationEnabled(state.displaySelection, state.stokesDegreeModulation) ? 1 : 0
    );
    gl.uniform1i(uniforms.useImageAlpha, this.activeBinding.usesImageAlpha ? 1 : 0);
    gl.uniform1i(uniforms.compositeCheckerboard, options.compositeCheckerboard ? 1 : 0);
    gl.uniform1i(uniforms.alphaOutputMode, resolveAlphaOutputModeUniformValue(options.alphaOutputMode));
  }

  private getOrCreateExportSurface(
    existing: ExportSurface | null,
    width: number,
    height: number
  ): ExportSurface {
    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    this.deleteExportSurface(existing);

    this.gl.activeTexture(this.gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);

    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create export texture.');
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA8,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    const framebuffer = this.gl.createFramebuffer();
    if (!framebuffer) {
      this.gl.deleteTexture(texture);
      throw new Error('Failed to create export framebuffer.');
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0
    );
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.gl.deleteFramebuffer(framebuffer);
      this.gl.deleteTexture(texture);
      throw new Error('Failed to initialize export framebuffer.');
    }

    return {
      framebuffer,
      texture,
      width,
      height
    };
  }

  private deleteExportSurface(surface: ExportSurface | null): void {
    if (!surface) {
      return;
    }

    this.gl.deleteFramebuffer(surface.framebuffer);
    this.gl.deleteTexture(surface.texture);
  }

  private getOrCreateLayerSourceTextures(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer
  ): LayerSourceTextures {
    let sessionLayers = this.layerTexturesBySession.get(sessionId);
    if (!sessionLayers) {
      sessionLayers = new Map<number, LayerSourceTextures>();
      this.layerTexturesBySession.set(sessionId, sessionLayers);
    }

    const existingLayerTextures = sessionLayers.get(layerIndex);
    if (existingLayerTextures && existingLayerTextures.width === width && existingLayerTextures.height === height) {
      return existingLayerTextures;
    }

    if (existingLayerTextures) {
      this.discardLayerSourceTextures(sessionId, layerIndex);
    }

    const nextLayerTextures: LayerSourceTextures = {
      layer,
      width,
      height,
      textureByChannel: new Map<string, WebGLTexture>()
    };
    sessionLayers.set(layerIndex, nextLayerTextures);
    return nextLayerTextures;
  }
}

function resolveDisplaySourceModeUniformValue(mode: DisplaySourceMode): number {
  switch (mode) {
    case 'empty':
      return 0;
    case 'channelRgb':
      return 1;
    case 'channelMono':
      return 2;
    case 'stokesDirect':
      return 3;
    case 'stokesRgb':
      return 4;
    case 'stokesRgbLuminance':
      return 5;
  }
}

function resolveStokesParameterUniformValue(parameter: DisplaySourceBinding['stokesParameter']): number {
  switch (parameter) {
    case 'aolp':
      return 0;
    case 'dolp':
      return 1;
    case 'dop':
      return 2;
    case 'docp':
      return 3;
    case 'cop':
      return 4;
    case 'top':
      return 5;
    case 's1_over_s0':
      return 6;
    case 's2_over_s0':
      return 7;
    case 's3_over_s0':
      return 8;
    case null:
      return -1;
  }
}

function resolveAlphaOutputModeUniformValue(mode: AlphaOutputMode): number {
  switch (mode) {
    case 'opaque':
      return ALPHA_OUTPUT_OPAQUE;
    case 'straight':
      return ALPHA_OUTPUT_STRAIGHT;
    case 'premultiplied':
      return ALPHA_OUTPUT_PREMULTIPLIED;
  }
}

function flipRgbaRowsInPlace(data: Uint8ClampedArray, width: number, height: number): void {
  const rowStride = width * 4;
  const scratch = new Uint8ClampedArray(rowStride);
  const halfHeight = Math.floor(height / 2);

  for (let row = 0; row < halfHeight; row += 1) {
    const topOffset = row * rowStride;
    const bottomOffset = (height - row - 1) * rowStride;
    scratch.set(data.subarray(topOffset, topOffset + rowStride));
    data.copyWithin(topOffset, bottomOffset, bottomOffset + rowStride);
    data.set(scratch, bottomOffset);
  }
}

function getRequiredUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error('Failed to resolve shader uniforms.');
  }
  return location;
}

function createProgram(gl: WebGL2RenderingContext, vertexShaderSource: string, fragmentShaderSource: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to create shader program.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown shader link error.';
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(`Shader link failed: ${log}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to create shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error.';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }

  return shader;
}
