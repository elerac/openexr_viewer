import { zlibSync } from 'fflate';
import type { ExportImagePixels } from './export/export-pixels';
import {
  DEFAULT_PNG_COMPRESSION_LEVEL,
  type PngCompressionLevel
} from './types';

export {
  buildColormapExportPixels,
  buildExportImagePixels,
  type BuildColormapExportPixelsArgs,
  type BuildExportImagePixelsArgs,
  type ExportImagePixels
} from './export/export-pixels';

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_BYTES_PER_PIXEL = 4;
const PNG_COLOR_TYPE_RGBA = 6;
const PNG_BIT_DEPTH_8 = 8;
const PNG_COMPRESSION_METHOD_DEFLATE = 0;
const PNG_FILTER_METHOD_ADAPTIVE = 0;
const PNG_INTERLACE_NONE = 0;

export interface CreatePngBlobFromPixelsOptions {
  compressionLevel?: PngCompressionLevel;
}

export function renderPixelsToCanvas(canvas: HTMLCanvasElement, pixels: ExportImagePixels): void {
  canvas.width = pixels.width;
  canvas.height = pixels.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a 2D canvas context for export.');
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
}

export function createPngDataUrlFromPixels(pixels: ExportImagePixels): string {
  if (typeof document === 'undefined') {
    throw new Error('Image export previews are only available in a browser environment.');
  }

  const canvas = document.createElement('canvas');
  renderPixelsToCanvas(canvas, pixels);
  return canvas.toDataURL('image/png');
}

export async function createPngBlobFromPixels(
  pixels: ExportImagePixels,
  options: CreatePngBlobFromPixelsOptions = {}
): Promise<Blob> {
  const pngBytes = createPngBytesFromPixels(pixels, options);
  const pngBuffer = pngBytes.buffer.slice(
    pngBytes.byteOffset,
    pngBytes.byteOffset + pngBytes.byteLength
  ) as ArrayBuffer;
  return new Blob([pngBuffer], { type: 'image/png' });
}

export function createPngBytesFromPixels(
  pixels: ExportImagePixels,
  options: CreatePngBlobFromPixelsOptions = {}
): Uint8Array {
  assertValidPngPixels(pixels);

  const compressionLevel = options.compressionLevel ?? DEFAULT_PNG_COMPRESSION_LEVEL;
  const imageData = createFilteredPngScanlines(pixels);
  const compressedImageData = zlibSync(imageData, { level: compressionLevel });
  const chunks = [
    PNG_SIGNATURE,
    createPngChunk('IHDR', createPngIhdrData(pixels.width, pixels.height)),
    createPngChunk('IDAT', compressedImageData),
    createPngChunk('IEND', new Uint8Array())
  ];
  const totalByteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const pngBytes = new Uint8Array(totalByteLength);
  let outputOffset = 0;
  for (const chunk of chunks) {
    pngBytes.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }

  return pngBytes;
}

export function parsePngCompressionLevel(value: string): PngCompressionLevel | null {
  const trimmed = value.trim();
  if (!/^[0-9]$/.test(trimmed)) {
    return null;
  }

  return Number(trimmed) as PngCompressionLevel;
}

function assertValidPngPixels(pixels: ExportImagePixels): void {
  if (!Number.isInteger(pixels.width) || pixels.width <= 0) {
    throw new Error('PNG export width must be a positive integer.');
  }

  if (!Number.isInteger(pixels.height) || pixels.height <= 0) {
    throw new Error('PNG export height must be a positive integer.');
  }

  const expectedLength = pixels.width * pixels.height * PNG_BYTES_PER_PIXEL;
  if (pixels.data.length !== expectedLength) {
    throw new Error('PNG export pixel data does not match the image dimensions.');
  }
}

function createPngIhdrData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = PNG_BIT_DEPTH_8;
  data[9] = PNG_COLOR_TYPE_RGBA;
  data[10] = PNG_COMPRESSION_METHOD_DEFLATE;
  data[11] = PNG_FILTER_METHOD_ADAPTIVE;
  data[12] = PNG_INTERLACE_NONE;
  return data;
}

function createFilteredPngScanlines(pixels: ExportImagePixels): Uint8Array {
  const rowByteLength = pixels.width * PNG_BYTES_PER_PIXEL;
  const output = new Uint8Array(pixels.height * (rowByteLength + 1));
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(rowByteLength));

  for (let y = 0; y < pixels.height; y += 1) {
    const rowStart = y * rowByteLength;
    let bestFilterType = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let filterType = 0; filterType < candidates.length; filterType += 1) {
      const candidate = candidates[filterType];
      let score = 0;

      for (let x = 0; x < rowByteLength; x += 1) {
        const raw = pixels.data[rowStart + x];
        const left = x >= PNG_BYTES_PER_PIXEL ? pixels.data[rowStart + x - PNG_BYTES_PER_PIXEL] : 0;
        const up = y > 0 ? pixels.data[rowStart - rowByteLength + x] : 0;
        const upLeft = y > 0 && x >= PNG_BYTES_PER_PIXEL
          ? pixels.data[rowStart - rowByteLength + x - PNG_BYTES_PER_PIXEL]
          : 0;
        const filtered = filterPngByte(filterType, raw, left, up, upLeft);
        candidate[x] = filtered;
        score += Math.abs(toSignedByte(filtered));
      }

      if (score < bestScore) {
        bestScore = score;
        bestFilterType = filterType;
      }
    }

    const outputRowStart = y * (rowByteLength + 1);
    output[outputRowStart] = bestFilterType;
    output.set(candidates[bestFilterType], outputRowStart + 1);
  }

  return output;
}

function filterPngByte(filterType: number, raw: number, left: number, up: number, upLeft: number): number {
  switch (filterType) {
    case 1:
      return (raw - left) & 0xff;
    case 2:
      return (raw - up) & 0xff;
    case 3:
      return (raw - Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (raw - paethPredictor(left, up, upLeft)) & 0xff;
    default:
      return raw;
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

function toSignedByte(value: number): number {
  return value < 128 ? value : value - 256;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  const typeBytes = createPngChunkTypeBytes(type);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, computeCrc32(chunk, 4, 4 + data.byteLength));
  return chunk;
}

function createPngChunkTypeBytes(type: string): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) {
    throw new Error(`Invalid PNG chunk type: ${type}`);
  }

  return Uint8Array.from(type, (character) => character.charCodeAt(0));
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function computeCrc32(bytes: Uint8Array, offset = 0, length = bytes.byteLength): number {
  let crc = 0xffffffff;
  for (let index = offset; index < offset + length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
