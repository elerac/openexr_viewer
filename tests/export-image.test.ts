// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { linearToSrgbByte } from '../src/color';
import {
  buildColormapExportPixels,
  buildExportImagePixels
} from '../src/export/export-pixels';
import {
  createPngDataUrlFromPixels,
  createPngBlobFromPixels,
  renderPixelsToCanvas
} from '../src/export-image';
import { createDefaultStokesDegreeModulation } from '../src/stokes';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('export image pixels', () => {
  it('applies exposure and sRGB encoding for rgb exports', () => {
    const pixels = buildExportImagePixels({
      displayTexture: new Float32Array([0.25, 0.5, 1, 1]),
      width: 1,
      height: 1,
      state: {
        exposureEv: 1,
        visualizationMode: 'rgb',
        colormapRange: null,
        displaySelection: {
          kind: 'channelRgb',
          r: 'R',
          g: 'G',
          b: 'B',
          alpha: null
        },
        stokesDegreeModulation: createDefaultStokesDegreeModulation(),
        stokesAolpDegreeModulationMode: 'value'
      },
      colormapLut: null
    });

    expect(Array.from(pixels.data)).toEqual([
      linearToSrgbByte(0.5),
      linearToSrgbByte(1),
      linearToSrgbByte(2),
      255
    ]);
  });

  it('maps luminance through the active colormap range', () => {
    const pixels = buildExportImagePixels({
      displayTexture: new Float32Array([0.25, 0.25, 0.25, 1]),
      width: 1,
      height: 1,
      state: {
        exposureEv: 0,
        visualizationMode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        displaySelection: {
          kind: 'channelMono',
          channel: 'Y',
          alpha: null
        },
        stokesDegreeModulation: createDefaultStokesDegreeModulation(),
        stokesAolpDegreeModulationMode: 'value'
      },
      colormapLut: {
        id: '0',
        label: 'Test',
        entryCount: 2,
        rgba8: new Uint8Array([0, 0, 255, 255, 255, 0, 0, 255])
      }
    });

    expect(Array.from(pixels.data)).toEqual([64, 0, 191, 255]);
  });

  it('preserves source alpha instead of compositing against the checkerboard', () => {
    const pixels = buildExportImagePixels({
      displayTexture: new Float32Array([1, 0, 0, 0.25]),
      width: 1,
      height: 1,
      state: {
        exposureEv: 0,
        visualizationMode: 'rgb',
        colormapRange: null,
        displaySelection: {
          kind: 'channelRgb',
          r: 'R',
          g: 'G',
          b: 'B',
          alpha: 'A'
        },
        stokesDegreeModulation: createDefaultStokesDegreeModulation(),
        stokesAolpDegreeModulationMode: 'value'
      },
      colormapLut: null
    });

    expect(Array.from(pixels.data)).toEqual([255, 0, 0, 64]);
  });

  it('modulates AoLP colormap export saturation when requested', () => {
    const pixels = buildExportImagePixels({
      displayTexture: new Float32Array([0, 0, 0, 0.5]),
      width: 1,
      height: 1,
      state: {
        exposureEv: 0,
        visualizationMode: 'colormap',
        colormapRange: { min: 0, max: 1 },
        displaySelection: {
          kind: 'stokesAngle',
          parameter: 'aolp',
          source: { kind: 'scalar' }
        },
        stokesDegreeModulation: { aolp: true, cop: true, top: true },
        stokesAolpDegreeModulationMode: 'saturation'
      },
      colormapLut: {
        id: '0',
        label: 'Test',
        entryCount: 2,
        rgba8: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
      }
    });

    expect(Array.from(pixels.data)).toEqual([255, 128, 128, 255]);
  });

  it('encodes pngs from the existing rgba buffer without copying it', async () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(callback: BlobCallback | null) {
      callback?.(new Blob(['png'], { type: 'image/png' }));
    });
    const imageData = vi.fn(function(this: object, data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    });
    vi.stubGlobal('ImageData', imageData as unknown as typeof ImageData);

    const pixels = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4])
    };

    const blob = await createPngBlobFromPixels(pixels);

    expect(imageData).toHaveBeenCalledWith(pixels.data, 1, 1);
    expect(putImageData).toHaveBeenCalledWith(
      expect.objectContaining({ data: pixels.data, width: 1, height: 1 }),
      0,
      0
    );
    expect(blob.type).toBe('image/png');
  });

  it('renders pixels into an existing canvas before encoding', () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData
    } as never);
    const imageData = vi.fn(function(this: object, data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    });
    vi.stubGlobal('ImageData', imageData as unknown as typeof ImageData);

    const canvas = document.createElement('canvas');
    const pixels = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8])
    };

    renderPixelsToCanvas(canvas, pixels);

    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(1);
    expect(imageData).toHaveBeenCalledWith(pixels.data, 2, 1);
    expect(putImageData).toHaveBeenCalledWith(
      expect.objectContaining({ data: pixels.data, width: 2, height: 1 }),
      0,
      0
    );
  });

  it('encodes preview pixels as a PNG data URL', () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,preview');
    vi.stubGlobal('ImageData', function(this: object, data: Uint8ClampedArray, width: number, height: number) {
      return { data, width, height };
    } as unknown as typeof ImageData);

    expect(createPngDataUrlFromPixels({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4])
    })).toBe('data:image/png;base64,preview');
    expect(putImageData).toHaveBeenCalledTimes(1);
  });
});

describe('colormap export pixels', () => {
  const lut = {
    id: 'test',
    label: 'Test',
    entryCount: 2,
    rgba8: new Uint8Array([
      0, 0, 255, 255,
      255, 0, 0, 255
    ])
  };

  it('renders horizontal gradients from left to right', () => {
    const pixels = buildColormapExportPixels({
      lut,
      width: 3,
      height: 1,
      orientation: 'horizontal'
    });

    expect(Array.from(pixels.data)).toEqual([
      0, 0, 255, 255,
      128, 0, 128, 255,
      255, 0, 0, 255
    ]);
  });

  it('renders vertical gradients from bottom to top', () => {
    const pixels = buildColormapExportPixels({
      lut,
      width: 1,
      height: 3,
      orientation: 'vertical'
    });

    expect(Array.from(pixels.data)).toEqual([
      255, 0, 0, 255,
      128, 0, 128, 255,
      0, 0, 255, 255
    ]);
  });

  it('uses the low end of the gradient when the gradient axis is a single pixel', () => {
    const horizontal = buildColormapExportPixels({
      lut,
      width: 1,
      height: 2,
      orientation: 'horizontal'
    });
    const vertical = buildColormapExportPixels({
      lut,
      width: 2,
      height: 1,
      orientation: 'vertical'
    });

    expect(Array.from(horizontal.data)).toEqual([
      0, 0, 255, 255,
      0, 0, 255, 255
    ]);
    expect(Array.from(vertical.data)).toEqual([
      0, 0, 255, 255,
      0, 0, 255, 255
    ]);
  });
});
