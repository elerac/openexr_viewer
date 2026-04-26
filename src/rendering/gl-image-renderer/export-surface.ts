import type { ViewerState } from '../../types';
import { COLORMAP_TEXTURE_UNIT } from './constants';
import { renderImagePass, renderPanoramaPass } from './render-pass';
import type { ExportImagePixels, ExportSurface, GlImageRendererState, ReadExportPixelsArgs } from './types';

export function readExportPixels(
  state: GlImageRendererState,
  {
    state: viewerState,
    sourceWidth,
    sourceHeight,
    outputWidth: requestedOutputWidth,
    outputHeight: requestedOutputHeight,
    screenshot
  }: ReadExportPixelsArgs
): ExportImagePixels {
  if (!state.imageSize || state.imageSize.width !== sourceWidth || state.imageSize.height !== sourceHeight) {
    throw new Error('No prepared image is active for export.');
  }
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Export dimensions must be positive.');
  }

  const outputWidth = requestedOutputWidth ?? sourceWidth;
  const outputHeight = requestedOutputHeight ?? sourceHeight;
  if (!Number.isInteger(outputWidth) || !Number.isInteger(outputHeight) || outputWidth <= 0 || outputHeight <= 0) {
    throw new Error('Export output dimensions must be positive.');
  }

  const gl = state.gl;
  validateExportOutputSize(gl, outputWidth, outputHeight);
  if (screenshot) {
    validateScreenshotExportRegion(screenshot);
  }

  const sourceSurface = getOrCreateExportSurface(gl, state.exportSourceSurface, outputWidth, outputHeight);
  state.exportSourceSurface = sourceSurface;

  const preserveAlpha = Boolean(screenshot) || state.activeBinding.usesImageAlpha;
  const exportRender = screenshot
    ? buildScreenshotExportRender(viewerState, screenshot, outputWidth, outputHeight)
    : buildFullImageExportRender(viewerState, sourceWidth, sourceHeight, outputWidth, outputHeight);

  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sourceSurface.framebuffer);
    gl.viewport(0, 0, outputWidth, outputHeight);
    const options = {
      compositeCheckerboard: false,
      alphaOutputMode: preserveAlpha ? 'straight' : 'opaque',
      ...exportRender.options,
      viewportLeft: 0,
      viewportTop: 0
    } as const;
    if (exportRender.state.viewerMode === 'panorama') {
      renderPanoramaPass(state, exportRender.state, options);
    } else {
      renderImagePass(state, exportRender.state, options);
    }

    const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceSurface.framebuffer);
    gl.readPixels(0, 0, outputWidth, outputHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);

    flipRgbaRowsInPlace(data, outputWidth, outputHeight);

    return {
      width: outputWidth,
      height: outputHeight,
      data
    };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.viewport(0, 0, state.viewport.width, state.viewport.height);
  }
}

function buildFullImageExportRender(
  viewerState: ViewerState,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number
): {
  state: ViewerState;
  options: {
    viewportWidth: number;
    viewportHeight: number;
    outputWidth: number;
    outputHeight: number;
    screenOriginX: number;
    screenOriginY: number;
  };
} {
  const exportZoom = Math.min(outputWidth / sourceWidth, outputHeight / sourceHeight);
  return {
    state: {
      ...viewerState,
      viewerMode: 'image',
      zoom: exportZoom,
      panX: sourceWidth * 0.5,
      panY: sourceHeight * 0.5
    },
    options: {
      viewportWidth: outputWidth,
      viewportHeight: outputHeight,
      outputWidth,
      outputHeight,
      screenOriginX: 0,
      screenOriginY: 0
    }
  };
}

function buildScreenshotExportRender(
  viewerState: ViewerState,
  screenshot: NonNullable<ReadExportPixelsArgs['screenshot']>,
  outputWidth: number,
  outputHeight: number
): {
  state: ViewerState;
  options: {
    viewportWidth: number;
    viewportHeight: number;
    outputWidth: number;
    outputHeight: number;
    screenOriginX: number;
    screenOriginY: number;
  };
} {
  const scale = outputWidth / screenshot.rect.width;
  const viewportWidth = screenshot.sourceViewport.width * scale;
  const viewportHeight = screenshot.sourceViewport.height * scale;
  return {
    state: {
      ...viewerState,
      zoom: viewerState.zoom * scale
    },
    options: {
      viewportWidth,
      viewportHeight,
      outputWidth,
      outputHeight,
      screenOriginX: screenshot.rect.x * scale,
      screenOriginY: screenshot.rect.y * scale
    }
  };
}

function validateScreenshotExportRegion(
  screenshot: NonNullable<ReadExportPixelsArgs['screenshot']>
): void {
  const { rect, sourceViewport } = screenshot;
  if (
    !isPositiveFinite(sourceViewport.width) ||
    !isPositiveFinite(sourceViewport.height) ||
    !isPositiveFinite(rect.width) ||
    !isPositiveFinite(rect.height) ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > sourceViewport.width + 1e-6 ||
    rect.y + rect.height > sourceViewport.height + 1e-6
  ) {
    throw new Error('Screenshot export region must be inside the viewer.');
  }
}

function validateExportOutputSize(
  gl: WebGL2RenderingContext,
  outputWidth: number,
  outputHeight: number
): void {
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (
    Number.isFinite(maxTextureSize) &&
    maxTextureSize > 0 &&
    (outputWidth > maxTextureSize || outputHeight > maxTextureSize)
  ) {
    throw new Error(`Export output dimensions must be ${maxTextureSize} px or smaller.`);
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function deleteExportSurface(
  gl: WebGL2RenderingContext,
  surface: ExportSurface | null
): void {
  if (!surface) {
    return;
  }

  gl.deleteFramebuffer(surface.framebuffer);
  gl.deleteTexture(surface.texture);
}

function getOrCreateExportSurface(
  gl: WebGL2RenderingContext,
  existing: ExportSurface | null,
  width: number,
  height: number
): ExportSurface {
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }

  deleteExportSurface(gl, existing);

  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);

  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Failed to create export texture.');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    gl.deleteTexture(texture);
    throw new Error('Failed to create export framebuffer.');
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error('Failed to initialize export framebuffer.');
  }

  return {
    framebuffer,
    texture,
    width,
    height
  };
}

function flipRgbaRowsInPlace(data: Uint8ClampedArray, width: number, height: number): void {
  const rowStride = width * 4;
  const scratch = new Uint8ClampedArray(rowStride);
  const halfHeight = Math.floor(height / 2);

  for (let row = 0; row < halfHeight; row += 1) {
    const topOffset = row * rowStride;
    const bottomOffset = (height - row - 1) * rowStride;
    scratch.set(data.subarray(topOffset, topOffset + rowStride));
    data.copyWithin(topOffset, bottomOffset, bottomOffset + rowStride);
    data.set(scratch, bottomOffset);
  }
}
