import { createEmptyDisplaySourceBinding } from '../../display/bindings';
import { REQUIRED_TEXTURE_UNITS } from './constants';
import { createColormapTexture } from './colormap-texture';
import { createImageProgram } from './image-program';
import { createPanoramaProgram } from './panorama-program';
import { configureProgramSamplers } from './program-utils';
import { createZeroTexture } from './texture-store';
import type { GlImageRendererState, LayerSourceTextures } from './types';

export function createGlImageRendererState(glCanvas: HTMLCanvasElement): GlImageRendererState {
  const gl = glCanvas.getContext('webgl2', { antialias: false });
  if (!gl) {
    throw new Error('WebGL2 is required for this viewer.');
  }

  const maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  if (maxTextureUnits < REQUIRED_TEXTURE_UNITS) {
    throw new Error(`WebGL2 must expose at least ${REQUIRED_TEXTURE_UNITS} texture units.`);
  }

  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error('Failed to create vertex array object.');
  }

  const imageProgram = createImageProgram(gl);
  const panoramaProgram = createPanoramaProgram(gl);

  gl.bindVertexArray(vao);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const zeroTexture = createZeroTexture(gl);
  const colormapTexture = createColormapTexture(gl);

  configureProgramSamplers(gl, imageProgram.program);
  configureProgramSamplers(gl, panoramaProgram.program);

  return {
    glCanvas,
    gl,
    vao,
    zeroTexture,
    colormapTexture,
    imageProgram,
    panoramaProgram,
    layerTexturesBySession: new Map<string, Map<number, LayerSourceTextures>>(),
    exportSourceSurface: null,
    viewport: { width: 1, height: 1 },
    viewportOrigin: { left: 0, top: 0 },
    imageSize: null,
    colormapTextureSize: { width: 1, height: 1 },
    colormapEntryCount: 0,
    activeBinding: createEmptyDisplaySourceBinding(),
    disposed: false
  };
}
