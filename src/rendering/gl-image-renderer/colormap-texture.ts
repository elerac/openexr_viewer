import { COLORMAP_TEXTURE_UNIT } from './constants';
import type { GlImageRendererState } from './types';

export function createColormapTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const colormapTexture = gl.createTexture();
  if (!colormapTexture) {
    throw new Error('Failed to create colormap texture.');
  }

  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, colormapTexture);
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

  return colormapTexture;
}

export function setColormapTexture(
  state: GlImageRendererState,
  entryCount: number,
  rgba8: Uint8Array
): void {
  if (!Number.isInteger(entryCount) || entryCount < 2) {
    throw new Error('Colormap texture requires at least 2 entries.');
  }

  const maxTextureSize = state.gl.getParameter(state.gl.MAX_TEXTURE_SIZE) as number;
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

  state.colormapTextureSize = { width, height };
  state.colormapEntryCount = entryCount;
  state.gl.activeTexture(state.gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  state.gl.bindTexture(state.gl.TEXTURE_2D, state.colormapTexture);
  state.gl.texImage2D(
    state.gl.TEXTURE_2D,
    0,
    state.gl.RGBA8,
    width,
    height,
    0,
    state.gl.RGBA,
    state.gl.UNSIGNED_BYTE,
    uploadData
  );
}
