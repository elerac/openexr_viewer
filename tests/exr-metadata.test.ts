import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CompressionMethod,
  ExrEncoder,
  initSync,
  SamplePrecision
} from '../src/vendor/exrs_raw_wasm_bindgen.js';
import { parseExrMetadata } from '../src/exr-metadata';
import { ExrMetadataEntry } from '../src/types';

const testDir = path.dirname(fileURLToPath(import.meta.url));
let exrEncoderInitialized = false;

describe('EXR metadata parsing', () => {
  it('formats common single-part header attributes in curated order', () => {
    const bytes = createSinglePartMultichannelExr();
    const [metadata] = parseExrMetadata(bytes);
    const byKey = metadataByKey(metadata ?? []);

    expect(metadata?.map((entry) => entry.key).slice(0, 7)).toEqual([
      'compression',
      'pixelAspectRatio',
      'dataWindow',
      'displayWindow',
      'lineOrder',
      'channels',
      'type'
    ]);
    expect(byKey.get('compression')).toBe('ZIP');
    expect(byKey.get('pixelAspectRatio')).toBe('1.000');
    expect(byKey.get('dataWindow')).toBe('[0,0]-[511,319]');
    expect(byKey.get('displayWindow')).toBe('[0,0]-[511,319]');
    expect(byKey.get('lineOrder')).toBe('INCREASING_Y');
    expect(byKey.get('channels')).toContain('18 (R, G, B, A');
    expect(byKey.get('channels')).toContain('albedo.{R,G,B}');
    expect(byKey.get('channels')).toContain('normal.{R,G,B}');
    expect(byKey.get('type')).toBe('scanlineimage');
  });

  it('keeps parseable extras and omits internal multipart counters', () => {
    const bytes = readFixture('cbox_rgb.exr');
    const [metadata] = parseExrMetadata(bytes);
    const byKey = metadataByKey(metadata ?? []);

    expect(byKey.get('compression')).toBe('PIZ');
    expect(byKey.get('channels')).toBe('3 (R, G, B)');
    expect(byKey.get('generatedBy')).toBe('Mitsuba version 3.8.0');
    expect(byKey.get('screenWindowCenter')).toBe('(0.0, 0.0)');
    expect(byKey.get('screenWindowWidth')).toBe('1.0');
    expect(byKey.has('chunkCount')).toBe(false);
  });

  it('maps multipart header metadata by part order', () => {
    const parts = parseExrMetadata(createMultipartExr());
    const first = metadataByKey(parts[0] ?? []);
    const second = metadataByKey(parts[1] ?? []);

    expect(parts).toHaveLength(2);
    expect(first.get('name')).toBe('beauty');
    expect(first.get('compression')).toBe('ZIP');
    expect(first.get('channels')).toBe('3 (R, G, B)');
    expect(first.has('chunkCount')).toBe(false);
    expect(second.get('name')).toBe('depth');
    expect(second.get('channels')).toBe('1 (Z)');
  });
});

function readFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(path.resolve(testDir, `../public/${filename}`)));
}

function metadataByKey(metadata: ExrMetadataEntry[]): Map<string, string> {
  return new Map(metadata.map((entry) => [entry.key, entry.value]));
}

function createSinglePartMultichannelExr(): Uint8Array {
  ensureExrEncoderInitialized();
  const width = 512;
  const height = 320;
  const channelNames = [
    'R',
    'G',
    'B',
    'A',
    'depth',
    'depth_variance',
    'normal.R',
    'normal.G',
    'normal.B',
    'albedo.R',
    'albedo.G',
    'albedo.B',
    'roughness',
    'metallic',
    '400nm',
    '500nm',
    '600nm',
    '700nm'
  ];
  const encoder = new ExrEncoder(width, height);
  try {
    encoder.addLayer(
      null,
      channelNames,
      new Float32Array(width * height * channelNames.length),
      SamplePrecision.F32,
      CompressionMethod.Zip16
    );
    return encoder.encode();
  } finally {
    encoder.free();
  }
}

function createMultipartExr(): Uint8Array {
  ensureExrEncoderInitialized();
  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      'beauty',
      ['R', 'G', 'B'],
      new Float32Array(12),
      SamplePrecision.F32,
      CompressionMethod.Zip16
    );
    encoder.addLayer(
      'depth',
      ['Z'],
      new Float32Array(4),
      SamplePrecision.F32,
      CompressionMethod.Zip16
    );
    return encoder.encode();
  } finally {
    encoder.free();
  }
}

function ensureExrEncoderInitialized(): void {
  if (exrEncoderInitialized) {
    return;
  }

  const wasmBytes = readFileSync(new URL('../src/vendor/exrs_raw_wasm_bindgen_bg.wasm', import.meta.url));
  initSync({ module: wasmBytes });
  exrEncoderInitialized = true;
}
