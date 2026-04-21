import { isChannelSelection } from '../display-model';
import { isStokesDegreeModulationEnabled } from '../stokes';
import type { ViewerState, ViewportInfo } from '../types';
import imageFragmentSource from './shaders/exr-image.frag.glsl?raw';
import panoramaFragmentSource from './shaders/panorama-image.frag.glsl?raw';
import vertexSource from './shaders/fullscreen-triangle.vert.glsl?raw';

interface CommonUniforms {
  viewport: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  useColormap: WebGLUniformLocation;
  colormapMin: WebGLUniformLocation;
  colormapMax: WebGLUniformLocation;
  colormapTextureSize: WebGLUniformLocation;
  colormapEntryCount: WebGLUniformLocation;
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

export class GlImageRenderer {
  private readonly glCanvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private readonly colormapTexture: WebGLTexture;
  private readonly imageProgram: ProgramBundle<ImageUniforms>;
  private readonly panoramaProgram: ProgramBundle<PanoramaUniforms>;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private imageSize: { width: number; height: number } | null = null;
  private colormapTextureSize = { width: 1, height: 1 };
  private colormapEntryCount = 0;

  constructor(glCanvas: HTMLCanvasElement) {
    const gl = glCanvas.getContext('webgl2', { antialias: false });
    if (!gl) {
      throw new Error('WebGL2 is required for this viewer.');
    }

    this.glCanvas = glCanvas;
    this.gl = gl;

    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error('Failed to create vertex array object.');
    }
    this.vao = vao;

    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create texture.');
    }
    this.texture = texture;

    const colormapTexture = gl.createTexture();
    if (!colormapTexture) {
      throw new Error('Failed to create colormap texture.');
    }
    this.colormapTexture = colormapTexture;

    this.imageProgram = this.createImageProgram();
    this.panoramaProgram = this.createPanoramaProgram();

    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE1);
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
    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };

    this.glCanvas.width = this.viewport.width;
    this.glCanvas.height = this.viewport.height;
    this.gl.viewport(0, 0, this.viewport.width, this.viewport.height);
  }

  setDisplayTexture(width: number, height: number, rgbaTexture: Float32Array): void {
    const sameSize = this.imageSize?.width === width && this.imageSize?.height === height;
    this.imageSize = { width, height };
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    if (sameSize) {
      this.gl.texSubImage2D(
        this.gl.TEXTURE_2D,
        0,
        0,
        0,
        width,
        height,
        this.gl.RGBA,
        this.gl.FLOAT,
        rgbaTexture
      );
    } else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA32F,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.FLOAT,
        rgbaTexture
      );
    }
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
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
    this.gl.activeTexture(this.gl.TEXTURE1);
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

  clearImage(): void {
    this.imageSize = null;
  }

  render(state: ViewerState): void {
    const gl = this.gl;
    const program = state.viewerMode === 'panorama' ? this.panoramaProgram : this.imageProgram;

    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

    this.setCommonUniforms(program.uniforms, state);

    if (state.viewerMode === 'panorama') {
      gl.uniform1f(program.uniforms.panoramaYawDeg, state.panoramaYawDeg);
      gl.uniform1f(program.uniforms.panoramaPitchDeg, state.panoramaPitchDeg);
      gl.uniform1f(program.uniforms.panoramaHfovDeg, state.panoramaHfovDeg);
    } else {
      gl.uniform2f(program.uniforms.pan, state.panX, state.panY);
      gl.uniform1f(program.uniforms.zoom, state.zoom);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
      useStokesDegreeModulation: getRequiredUniformLocation(this.gl, program, 'uUseStokesDegreeModulation'),
      useImageAlpha: getRequiredUniformLocation(this.gl, program, 'uUseImageAlpha')
    };
  }

  private configureProgramSamplers(program: WebGLProgram): void {
    this.gl.useProgram(program);
    this.gl.uniform1i(this.gl.getUniformLocation(program, 'uTexture'), 0);
    this.gl.uniform1i(this.gl.getUniformLocation(program, 'uColormapTexture'), 1);
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
    gl.uniform1i(
      uniforms.useStokesDegreeModulation,
      isStokesDegreeModulationEnabled(state.displaySelection, state.stokesDegreeModulation) ? 1 : 0
    );
    gl.uniform1i(uniforms.useImageAlpha, isChannelSelection(state.displaySelection) ? 1 : 0);
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
