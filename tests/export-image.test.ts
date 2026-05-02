// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzlibSync } from 'fflate';
import { linearToSrgbByte } from '../src/color';
import {
  buildColormapExportPixels,
  buildExportImagePixels
} from '../src/export/export-pixels';
import {
  createPngBytesFromPixels,
  createPngDataUrlFromPixels,
  createPngBlobFromPixels,
  parsePngCompressionLevel,
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

  it('encodes valid compressed PNG bytes from the rgba buffer', async () => {
    const pixels = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        1, 2, 3, 255,
        7, 11, 13, 128,
        19, 23, 29, 64,
        31, 37, 41, 0
      ])
    };

    const bytes = createPngBytesFromPixels(pixels, { compressionLevel: 9 });
    const chunks = readPngChunks(bytes);
    const imageData = inflatePngImageData(chunks);
    const decodedPixels = decodeFilteredPngRgba(imageData, pixels.width, pixels.height);
    const blob = await createPngBlobFromPixels(pixels, { compressionLevel: 0 });

    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks[0].data[8]).toBe(8);
    expect(chunks[0].data[9]).toBe(6);
    expect(Array.from(decodedPixels)).toEqual(Array.from(pixels.data));
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 8)).toEqual(bytes.slice(0, 8));
  });

  it('parses PNG compression levels', () => {
    expect(parsePngCompressionLevel('0')).toBe(0);
    expect(parsePngCompressionLevel('9')).toBe(9);
    expect(parsePngCompressionLevel('')).toBeNull();
    expect(parsePngCompressionLevel('10')).toBeNull();
    expect(parsePngCompressionLevel('-1')).toBeNull();
    expect(parsePngCompressionLevel('1.5')).toBeNull();
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

interface PngChunk {
  type: string;
  data: Uint8Array;
}

function readPngChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const type = String.fromCharCode(...bytes.slice(typeOffset, dataOffset));
    chunks.push({
      type,
      data: bytes.slice(dataOffset, dataOffset + length)
    });
    offset = dataOffset + length + 4;
  }

  return chunks;
}

function inflatePngImageData(chunks: PngChunk[]): Uint8Array {
  const idatChunks = chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data);
  const byteLength = idatChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const compressed = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return unzlibSync(compressed);
}

function decodeFilteredPngRgba(imageData: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerPixel = 4;
  const rowByteLength = width * bytesPerPixel;
  const output = new Uint8Array(width * height * bytesPerPixel);

  for (let y = 0; y < height; y += 1) {
    const encodedRowStart = y * (rowByteLength + 1);
    const outputRowStart = y * rowByteLength;
    const filterType = imageData[encodedRowStart];

    for (let x = 0; x < rowByteLength; x += 1) {
      const filtered = imageData[encodedRowStart + 1 + x];
      const left = x >= bytesPerPixel ? output[outputRowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[outputRowStart - rowByteLength + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel
        ? output[outputRowStart - rowByteLength + x - bytesPerPixel]
        : 0;
      output[outputRowStart + x] = unfilterPngByte(filterType, filtered, left, up, upLeft);
    }
  }

  return output;
}

function unfilterPngByte(filterType: number, filtered: number, left: number, up: number, upLeft: number): number {
  switch (filterType) {
    case 1:
      return (filtered + left) & 0xff;
    case 2:
      return (filtered + up) & 0xff;
    case 3:
      return (filtered + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (filtered + paethPredictor(left, up, upLeft)) & 0xff;
    default:
      return filtered;
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}

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
