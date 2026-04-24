import type { DisplaySourceBinding } from '../../display-texture';
import type { ExportImagePixels } from '../../export-image';
import type { DecodedLayer, ViewerState, ViewportInfo } from '../../types';

export interface CommonUniforms {
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
  stokesDegreeModulationMode: WebGLUniformLocation;
  useImageAlpha: WebGLUniformLocation;
  compositeCheckerboard: WebGLUniformLocation;
  alphaOutputMode: WebGLUniformLocation;
}

export interface ImageUniforms extends CommonUniforms {
  pan: WebGLUniformLocation;
  zoom: WebGLUniformLocation;
}

export interface PanoramaUniforms extends CommonUniforms {
  panoramaYawDeg: WebGLUniformLocation;
  panoramaPitchDeg: WebGLUniformLocation;
  panoramaHfovDeg: WebGLUniformLocation;
}

export interface ProgramBundle<TUniforms extends CommonUniforms> {
  program: WebGLProgram;
  uniforms: TUniforms;
}

export interface LayerSourceTextures {
  layer: DecodedLayer;
  width: number;
  height: number;
  textureByChannel: Map<string, WebGLTexture>;
}

export interface ExportSurface {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export type AlphaOutputMode = 'opaque' | 'straight' | 'premultiplied';

export interface RenderPassOptions {
  compositeCheckerboard: boolean;
  alphaOutputMode: AlphaOutputMode;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportLeft?: number;
  viewportTop?: number;
}

export interface ReadExportPixelsArgs {
  state: ViewerState;
  sourceWidth: number;
  sourceHeight: number;
}

export interface GlImageRendererState {
  glCanvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  zeroTexture: WebGLTexture;
  colormapTexture: WebGLTexture;
  imageProgram: ProgramBundle<ImageUniforms>;
  panoramaProgram: ProgramBundle<PanoramaUniforms>;
  layerTexturesBySession: Map<string, Map<number, LayerSourceTextures>>;
  exportSourceSurface: ExportSurface | null;
  viewport: ViewportInfo;
  viewportOrigin: { left: number; top: number };
  imageSize: { width: number; height: number } | null;
  colormapTextureSize: { width: number; height: number };
  colormapEntryCount: number;
  activeBinding: DisplaySourceBinding;
  disposed: boolean;
}

export type { ExportImagePixels };
