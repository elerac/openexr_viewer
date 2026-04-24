import { isStokesDegreeModulationEnabled, resolveStokesDegreeModulationMode } from '../../stokes';
import type { DisplaySourceBinding, DisplaySourceMode } from '../../display-texture';
import type { ViewerState } from '../../types';
import {
  ALPHA_OUTPUT_OPAQUE,
  ALPHA_OUTPUT_PREMULTIPLIED,
  ALPHA_OUTPUT_STRAIGHT,
  COLORMAP_TEXTURE_UNIT,
  DEFAULT_RENDER_PASS_OPTIONS
} from './constants';
import type {
  AlphaOutputMode,
  CommonUniforms,
  GlImageRendererState,
  RenderPassOptions
} from './types';

export function render(state: GlImageRendererState, viewerState: ViewerState): void {
  if (viewerState.viewerMode === 'panorama') {
    renderPanoramaPass(state, viewerState, DEFAULT_RENDER_PASS_OPTIONS);
    return;
  }

  renderImagePass(state, viewerState, DEFAULT_RENDER_PASS_OPTIONS);
}

export function renderImagePass(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions
): void {
  const gl = state.gl;
  const program = state.imageProgram;
  gl.useProgram(program.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.colormapTexture);

  setCommonUniforms(state, program.uniforms, viewerState, options);
  gl.uniform2f(program.uniforms.pan, viewerState.panX, viewerState.panY);
  gl.uniform1f(program.uniforms.zoom, viewerState.zoom);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function renderPanoramaPass(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions
): void {
  const gl = state.gl;
  const program = state.panoramaProgram;
  gl.useProgram(program.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.colormapTexture);

  setCommonUniforms(state, program.uniforms, viewerState, options);
  gl.uniform1f(program.uniforms.panoramaYawDeg, viewerState.panoramaYawDeg);
  gl.uniform1f(program.uniforms.panoramaPitchDeg, viewerState.panoramaPitchDeg);
  gl.uniform1f(program.uniforms.panoramaHfovDeg, viewerState.panoramaHfovDeg);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function setCommonUniforms(
  state: GlImageRendererState,
  uniforms: CommonUniforms,
  viewerState: ViewerState,
  options: RenderPassOptions
): void {
  const gl = state.gl;
  gl.uniform2f(
    uniforms.viewport,
    options.viewportWidth ?? state.viewport.width,
    options.viewportHeight ?? state.viewport.height
  );
  gl.uniform2f(
    uniforms.viewportOrigin,
    options.viewportLeft ?? state.viewportOrigin.left,
    options.viewportTop ?? state.viewportOrigin.top
  );

  const width = state.imageSize?.width ?? 0;
  const height = state.imageSize?.height ?? 0;
  gl.uniform2f(uniforms.imageSize, width, height);
  gl.uniform1f(uniforms.exposure, viewerState.exposureEv);
  gl.uniform1i(uniforms.useColormap, viewerState.visualizationMode === 'colormap' ? 1 : 0);
  gl.uniform1f(uniforms.colormapMin, viewerState.colormapRange?.min ?? 0);
  gl.uniform1f(uniforms.colormapMax, viewerState.colormapRange?.max ?? 0);
  gl.uniform2i(
    uniforms.colormapTextureSize,
    state.colormapTextureSize.width,
    state.colormapTextureSize.height
  );
  gl.uniform1i(uniforms.colormapEntryCount, state.colormapEntryCount);
  gl.uniform1i(uniforms.displayMode, resolveDisplaySourceModeUniformValue(state.activeBinding.mode));
  gl.uniform1i(uniforms.stokesParameter, resolveStokesParameterUniformValue(state.activeBinding.stokesParameter));
  gl.uniform1i(
    uniforms.useStokesDegreeModulation,
    isStokesDegreeModulationEnabled(viewerState.displaySelection, viewerState.stokesDegreeModulation) ? 1 : 0
  );
  gl.uniform1i(
    uniforms.stokesDegreeModulationMode,
    resolveStokesDegreeModulationMode(
      viewerState.displaySelection,
      viewerState.stokesAolpDegreeModulationMode
    ) === 'saturation' ? 1 : 0
  );
  gl.uniform1i(uniforms.useImageAlpha, state.activeBinding.usesImageAlpha ? 1 : 0);
  gl.uniform1i(uniforms.compositeCheckerboard, options.compositeCheckerboard ? 1 : 0);
  gl.uniform1i(uniforms.alphaOutputMode, resolveAlphaOutputModeUniformValue(options.alphaOutputMode));
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
