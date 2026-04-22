import { getChannelDenseArray } from '../channel-storage';
import {
  DISPLAY_SOURCE_SLOT_COUNT,
  createEmptyDisplaySourceBinding,
  type DisplaySourceBinding,
  type DisplaySourceMode
} from '../display-texture';
import { isStokesDegreeModulationEnabled } from '../stokes';
import type { DecodedLayer, ViewerState, ViewportInfo } from '../types';
import type { Disposable } from '../lifecycle';
import imageFragmentSource from './shaders/exr-image.frag.glsl?raw';
import panoramaFragmentSource from './shaders/panorama-image.frag.glsl?raw';
import vertexSource from './shaders/fullscreen-triangle.vert.glsl?raw';

const COLORMAP_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT;
const REQUIRED_TEXTURE_UNITS = DISPLAY_SOURCE_SLOT_COUNT + 1;

interface CommonUniforms {
  viewport: WebGLUniformLocation;
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
  width: number;
  height: number;
  textureBytes: number;
  textureByChannel: Map<string, WebGLTexture>;
}

export class GlImageRenderer implements Disposable {
  private readonly glCanvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly zeroTexture: WebGLTexture;
  private readonly colormapTexture: WebGLTexture;
  private readonly imageProgram: ProgramBundle<ImageUniforms>;
  private readonly panoramaProgram: ProgramBundle<PanoramaUniforms>;
  private readonly layerTexturesBySession = new Map<string, Map<number, LayerSourceTextures>>();
  private viewport: ViewportInfo = { width: 1, height: 1 };
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

  resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };

    this.glCanvas.width = this.viewport.width;
    this.glCanvas.height = this.viewport.height;
    this.gl.viewport(0, 0, this.viewport.width, this.viewport.height);
  }

  ensureLayerSourceTextures(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer
  ): number {
    if (this.disposed) {
      return 0;
    }

    let sessionLayers = this.layerTexturesBySession.get(sessionId);
    if (!sessionLayers) {
      sessionLayers = new Map<number, LayerSourceTextures>();
      this.layerTexturesBySession.set(sessionId, sessionLayers);
    }

    const existingLayerTextures = sessionLayers.get(layerIndex);
    if (existingLayerTextures) {
      return existingLayerTextures.textureBytes;
    }

    const textureByChannel = new Map<string, WebGLTexture>();
    for (const channelName of layer.channelNames) {
      if (!channelName) {
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
      textureByChannel.set(channelName, texture);
    }

    const textureBytes =
      width * height * textureByChannel.size * Float32Array.BYTES_PER_ELEMENT;
    sessionLayers.set(layerIndex, {
      width,
      height,
      textureBytes,
      textureByChannel
    });
    return textureBytes;
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

    for (const texture of layerTextures.textureByChannel.values()) {
      this.gl.deleteTexture(texture);
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
  }

  render(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    const gl = this.gl;
    if (state.viewerMode === 'panorama') {
      const program = this.panoramaProgram;
      gl.useProgram(program.program);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

      this.setCommonUniforms(program.uniforms, state);
      gl.uniform1f(program.uniforms.panoramaYawDeg, state.panoramaYawDeg);
      gl.uniform1f(program.uniforms.panoramaPitchDeg, state.panoramaPitchDeg);
      gl.uniform1f(program.uniforms.panoramaHfovDeg, state.panoramaHfovDeg);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    const program = this.imageProgram;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

    this.setCommonUniforms(program.uniforms, state);
    gl.uniform2f(program.uniforms.pan, state.panX, state.panY);
    gl.uniform1f(program.uniforms.zoom, state.zoom);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
      useImageAlpha: getRequiredUniformLocation(this.gl, program, 'uUseImageAlpha')
    };
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
    state: ViewerState
  ): void {
    const gl = this.gl;
    gl.uniform2f(uniforms.viewport, this.viewport.width, this.viewport.height);

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
    case 'stokesRgbLuminance':
      return 4;
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
