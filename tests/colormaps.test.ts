import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLORMAP_ID,
  findColormapIdByLabel,
  getColormapAsset,
  getColormapOptions,
  mapValueToColormapRgbBytes,
  parseColormapManifest,
  parseNpyColormap,
  sampleColormapRgbBytes,
  type ColormapLut
} from '../src/colormaps';

describe('NumPy colormap LUT parsing', () => {
  it('derives palette ids from manifest order', () => {
    const registry = parseColormapManifest({
      colormaps: [
        { label: 'Red / Black / Green', file: 'red_black_green.npy' },
        { label: 'Blue / Yellow', file: 'blue_yellow.npy' }
      ]
    });

    expect(getColormapOptions(registry)).toEqual([
      { id: '0', label: 'Red / Black / Green' },
      { id: '1', label: 'Blue / Yellow' }
    ]);
    expect(DEFAULT_COLORMAP_ID).toBe('0');
    expect(registry.defaultId).toBe('0');
    expect(getColormapAsset(registry, '0')?.label).toBe('Red / Black / Green');
    expect(getColormapAsset(registry, '0')?.file).toBe('colormaps/red_black_green.npy');
    expect(getColormapAsset(registry, '1')?.label).toBe('Blue / Yellow');
    expect(getColormapAsset(registry, 'blue-yellow')).toBeNull();
    expect(findColormapIdByLabel(registry, 'blue / yellow')).toBe('1');
  });

  it('rejects invalid manifest entries', () => {
    expect(() => parseColormapManifest([])).toThrow(/object/);
    expect(() => parseColormapManifest({ colormaps: [] })).toThrow(/at least one colormap/);
    expect(() => parseColormapManifest({ colormaps: [{ label: '', file: 'a.npy' }] })).toThrow(/label/);
    expect(() => parseColormapManifest({ colormaps: [{ label: 'A', file: '../a.npy' }] })).toThrow(/relative/);
  });

  it('parses float32 RGB LUTs', () => {
    const lut = parseNpyColormap(
      buildNpy('<f4', [3, 3], [
        1, 0, 0,
        0, 0, 0,
        0, 1, 0
      ]),
      { id: 'rbg', label: 'RBG' }
    );

    expect(lut.id).toBe('rbg');
    expect(lut.entryCount).toBe(3);
    expect(Array.from(lut.rgba8)).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 255,
      0, 255, 0, 255
    ]);
  });

  it('parses float64 RGBA LUTs', () => {
    const lut = parseNpyColormap(
      buildNpy('<f8', [2, 4], [
        0, 0.5, 1, 0.25,
        1, 0.5, 0, 1
      ])
    );

    expect(lut.entryCount).toBe(2);
    expect(Array.from(lut.rgba8)).toEqual([
      0, 128, 255, 64,
      255, 128, 0, 255
    ]);
  });

  it('parses uint8 RGB LUTs', () => {
    const lut = parseNpyColormap(
      buildNpy('|u1', [2, 3], [
        0, 32, 255,
        255, 128, 0
      ])
    );

    expect(Array.from(lut.rgba8)).toEqual([
      0, 32, 255, 255,
      255, 128, 0, 255
    ]);
  });

  it('rejects invalid magic bytes', () => {
    const bytes = new Uint8Array(buildNpy('<f4', [2, 3], [0, 0, 0, 1, 1, 1]));
    bytes[0] = 0;

    expect(() => parseNpyColormap(bytes)).toThrow(/magic/);
  });

  it('rejects unsupported versions', () => {
    expect(() => parseNpyColormap(buildNpy('<f4', [2, 3], [0, 0, 0, 1, 1, 1], { major: 4 }))).toThrow(
      /Unsupported/
    );
  });

  it('rejects unsupported dtypes', () => {
    expect(() => parseNpyColormap(buildNpy('<i4', [2, 3], [0, 0, 0, 1, 1, 1]))).toThrow(/dtype/);
  });

  it('rejects Fortran-order arrays', () => {
    expect(() =>
      parseNpyColormap(buildNpy('<f4', [2, 3], [0, 0, 0, 1, 1, 1], { fortranOrder: true }))
    ).toThrow(/Fortran/);
  });

  it('rejects invalid shapes', () => {
    expect(() => parseNpyColormap(buildNpy('<f4', [6], [0, 0, 0, 1, 1, 1]))).toThrow(/shape/);
    expect(() => parseNpyColormap(buildNpy('<f4', [2, 2], [0, 0, 1, 1]))).toThrow(/shape/);
  });

  it('rejects LUTs with too few entries', () => {
    expect(() => parseNpyColormap(buildNpy('<f4', [1, 3], [0, 0, 0]))).toThrow(/at least 2/);
  });

  it('rejects mismatched byte lengths', () => {
    const bytes = new Uint8Array(buildNpy('<f4', [2, 3], [0, 0, 0, 1, 1, 1]));

    expect(() => parseNpyColormap(bytes.subarray(0, bytes.length - 1))).toThrow(/data length/);
  });
});

describe('colormap LUT sampling', () => {
  const lut: ColormapLut = {
    id: 'test',
    label: 'Test',
    entryCount: 3,
    rgba8: new Uint8Array([
      0, 0, 255, 255,
      0, 0, 0, 255,
      255, 255, 0, 255
    ])
  };

  it('samples first, midpoint, last, and clamped colors', () => {
    expect(sampleColormapRgbBytes(lut, 0)).toEqual([0, 0, 255]);
    expect(sampleColormapRgbBytes(lut, 0.5)).toEqual([0, 0, 0]);
    expect(sampleColormapRgbBytes(lut, 1)).toEqual([255, 255, 0]);
    expect(sampleColormapRgbBytes(lut, -1)).toEqual([0, 0, 255]);
    expect(sampleColormapRgbBytes(lut, 2)).toEqual([255, 255, 0]);
  });

  it('linearly interpolates neighboring LUT entries', () => {
    expect(sampleColormapRgbBytes(lut, 0.25)).toEqual([0, 0, 128]);
    expect(sampleColormapRgbBytes(lut, 0.75)).toEqual([128, 128, 0]);
  });

  it('maps scalar ranges and renders collapsed ranges as black', () => {
    expect(mapValueToColormapRgbBytes(5, { min: 0, max: 10 }, lut)).toEqual([0, 0, 0]);
    expect(mapValueToColormapRgbBytes(5, { min: 5, max: 5 }, lut)).toEqual([0, 0, 0]);
  });
});

function buildNpy(
  descr: string,
  shape: number[],
  values: number[],
  options: { major?: number; minor?: number; fortranOrder?: boolean } = {}
): ArrayBuffer {
  const major = options.major ?? 1;
  const minor = options.minor ?? 0;
  const fortranOrder = options.fortranOrder ?? false;
  const shapeText = shape.length === 1 ? `${shape[0]},` : shape.join(', ');
  const header = `{'descr': '${descr}', 'fortran_order': ${fortranOrder ? 'True' : 'False'}, 'shape': (${shapeText}), }`;
  const preambleLength = major === 1 ? 10 : 12;
  const headerBytes = encodeAsciiWithPadding(header, preambleLength);
  const dataBytes = encodeNpyData(descr, values);
  const totalLength = preambleLength + headerBytes.length + dataBytes.length;
  const bytes = new Uint8Array(totalLength);

  bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, major, minor], 0);
  const view = new DataView(bytes.buffer);
  if (major === 1) {
    view.setUint16(8, headerBytes.length, true);
  } else {
    view.setUint32(8, headerBytes.length, true);
  }

  bytes.set(headerBytes, preambleLength);
  bytes.set(dataBytes, preambleLength + headerBytes.length);
  return bytes.buffer;
}

function encodeAsciiWithPadding(header: string, preambleLength: number): Uint8Array {
  const newlineLength = 1;
  const paddingLength = (16 - ((preambleLength + header.length + newlineLength) % 16)) % 16;
  const text = `${header}${' '.repeat(paddingLength)}\n`;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index);
  }
  return bytes;
}

function encodeNpyData(descr: string, values: number[]): Uint8Array {
  if (descr === '|u1') {
    return new Uint8Array(values);
  }

  const bytesPerValue = descr === '<f8' ? 8 : 4;
  const bytes = new Uint8Array(values.length * bytesPerValue);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const offset = index * bytesPerValue;
    if (descr === '<f8') {
      view.setFloat64(offset, value, true);
      return;
    }
    view.setFloat32(offset, value, true);
  });
  return bytes;
}
