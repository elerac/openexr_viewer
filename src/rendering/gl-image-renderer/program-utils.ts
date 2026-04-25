import { DISPLAY_SOURCE_SLOT_COUNT } from '../../display-texture';
import { COLORMAP_TEXTURE_UNIT } from './constants';
import type { CommonUniforms } from './types';

export function getRequiredUniformLocation(
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

export function getCommonUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): CommonUniforms {
  return {
    viewport: getRequiredUniformLocation(gl, program, 'uViewport'),
    viewportOrigin: getRequiredUniformLocation(gl, program, 'uViewportOrigin'),
    outputSize: getRequiredUniformLocation(gl, program, 'uOutputSize'),
    screenOrigin: getRequiredUniformLocation(gl, program, 'uScreenOrigin'),
    imageSize: getRequiredUniformLocation(gl, program, 'uImageSize'),
    exposure: getRequiredUniformLocation(gl, program, 'uExposure'),
    useColormap: getRequiredUniformLocation(gl, program, 'uUseColormap'),
    colormapMin: getRequiredUniformLocation(gl, program, 'uColormapMin'),
    colormapMax: getRequiredUniformLocation(gl, program, 'uColormapMax'),
    colormapTextureSize: getRequiredUniformLocation(gl, program, 'uColormapTextureSize'),
    colormapEntryCount: getRequiredUniformLocation(gl, program, 'uColormapEntryCount'),
    displayMode: getRequiredUniformLocation(gl, program, 'uDisplayMode'),
    stokesParameter: getRequiredUniformLocation(gl, program, 'uStokesParameter'),
    useStokesDegreeModulation: getRequiredUniformLocation(gl, program, 'uUseStokesDegreeModulation'),
    stokesDegreeModulationMode: getRequiredUniformLocation(gl, program, 'uStokesDegreeModulationMode'),
    useImageAlpha: getRequiredUniformLocation(gl, program, 'uUseImageAlpha'),
    compositeCheckerboard: getRequiredUniformLocation(gl, program, 'uCompositeCheckerboard'),
    alphaOutputMode: getRequiredUniformLocation(gl, program, 'uAlphaOutputMode')
  };
}

export function configureProgramSamplers(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  gl.useProgram(program);
  gl.uniform1iv(
    getRequiredUniformLocation(gl, program, 'uSourceTextures[0]'),
    Int32Array.from({ length: DISPLAY_SOURCE_SLOT_COUNT }, (_, index) => index)
  );
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uColormapTexture'),
    COLORMAP_TEXTURE_UNIT
  );
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShaderSource: string,
  fragmentShaderSource: string
): WebGLProgram {
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
