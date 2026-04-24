import panoramaFragmentSource from '../shaders/panorama-image.frag.glsl?raw';
import vertexSource from '../shaders/fullscreen-triangle.vert.glsl?raw';
import { createProgram, getCommonUniforms, getRequiredUniformLocation } from './program-utils';
import type { PanoramaUniforms, ProgramBundle } from './types';

export function createPanoramaProgram(gl: WebGL2RenderingContext): ProgramBundle<PanoramaUniforms> {
  const program = createProgram(gl, vertexSource, panoramaFragmentSource);
  return {
    program,
    uniforms: {
      ...getCommonUniforms(gl, program),
      panoramaYawDeg: getRequiredUniformLocation(gl, program, 'uPanoramaYawDeg'),
      panoramaPitchDeg: getRequiredUniformLocation(gl, program, 'uPanoramaPitchDeg'),
      panoramaHfovDeg: getRequiredUniformLocation(gl, program, 'uPanoramaHfovDeg')
    }
  };
}
