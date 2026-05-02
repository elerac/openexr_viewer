import { isStokesDegreeModulationEnabled, resolveStokesDegreeModulationMode } from '../../stokes';
import {
  resolveAlphaOutputModeUniformValue,
  resolveDisplaySourceModeUniformValue,
  resolveStokesParameterUniformValue
} from '../../display/gpu-bindings';
import { clampPanoramaProjectionPitch } from '../../interaction/panorama-geometry';
import type { ViewerState } from '../../types';
import {
  COLORMAP_TEXTURE_UNIT,
  DEFAULT_RENDER_PASS_OPTIONS
} from './constants';
import type {
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
  gl.uniform1f(
    program.uniforms.panoramaPitchDeg,
    clampPanoramaProjectionPitch(viewerState.panoramaPitchDeg)
  );
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
  gl.uniform2f(
    uniforms.outputSize,
    options.outputWidth ?? options.viewportWidth ?? state.viewport.width,
    options.outputHeight ?? options.viewportHeight ?? state.viewport.height
  );
  gl.uniform2f(
    uniforms.screenOrigin,
    options.screenOriginX ?? 0,
    options.screenOriginY ?? 0
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
