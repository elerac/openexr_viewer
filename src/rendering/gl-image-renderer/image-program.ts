import imageFragmentSource from '../shaders/exr-image.frag.glsl?raw';
import vertexSource from '../shaders/fullscreen-triangle.vert.glsl?raw';
import { createProgram, getCommonUniforms, getRequiredUniformLocation } from './program-utils';
import type { ImageUniforms, ProgramBundle } from './types';

export function createImageProgram(gl: WebGL2RenderingContext): ProgramBundle<ImageUniforms> {
  const program = createProgram(gl, vertexSource, imageFragmentSource);
  return {
    program,
    uniforms: {
      ...getCommonUniforms(gl, program),
      pan: getRequiredUniformLocation(gl, program, 'uPan'),
      zoom: getRequiredUniformLocation(gl, program, 'uZoom')
    }
  };
}
