import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import {
  CompressionMethod,
  ExrEncoder,
  initSync,
  SamplePrecision
} from '../../src/vendor/exrs_raw_wasm_bindgen.js';

interface ColormapManifest {
  colormaps: Array<{
    label: string;
  }>;
}

const colormapManifest = JSON.parse(
  readFileSync(new URL('../../public/colormaps/manifest.json', import.meta.url), 'utf8')
) as ColormapManifest;

export const expectedColormapLabels = colormapManifest.colormaps.map((colormap) => colormap.label);

let exrEncoderInitialized = false;

export function buildScalarChannelExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['Z'],
      new Float32Array([
        0.25,
        0.5,
        0.75,
        1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildSpectralExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['400nm', '500nm', '600nm', '700nm'],
      new Float32Array([
        0.1, 0.2, 0.3, 0.4,
        0.2, 0.3, 0.4, 0.5,
        0.3, 0.4, 0.5, 0.6,
        0.4, 0.5, 0.6, 0.7
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildRgbAuxExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['R', 'G', 'B', 'A', 'mask'],
      new Float32Array([
        1, 0, 0, 0.25, 10,
        0, 1, 0, 0.5, 20,
        0, 0, 1, 0.75, 30,
        1, 1, 1, 1, 40
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildNamedRgbaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A'],
      new Float32Array([
        1, 0, 0, 0.25,
        0, 1, 0, 0.5,
        0, 0, 1, 0.75,
        1, 1, 1, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildNamedRgbBareAlphaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['beauty.R', 'beauty.G', 'beauty.B', 'A'],
      new Float32Array([
        1, 0, 0, 0.25,
        0, 1, 0, 0.5,
        0, 0, 1, 0.75,
        1, 1, 1, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildScalarAlphaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['Z', 'A'],
      new Float32Array([
        1, 0.25,
        0.5, 0.5,
        0.25, 0.75,
        0, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildDepthAlphaExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['depth.Z', 'depth.A'],
      new Float32Array([
        1, 0.25,
        0.5, 0.5,
        0.25, 0.75,
        0, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildScalarStokesExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      ['S0', 'S1', 'S2', 'S3'],
      new Float32Array([
        1, 1, 0, 0,
        1, 0, 1, 0,
        1, -1, 0, 0,
        1, 0, -1, 0
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildLandscapeRgbExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 1);
  try {
    encoder.addLayer(
      null,
      ['R', 'G', 'B'],
      new Float32Array([
        0, 0, 0,
        1, 1, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildPortraitRgbExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(1, 2);
  try {
    encoder.addLayer(
      null,
      ['R', 'G', 'B'],
      new Float32Array([
        0, 0, 0,
        1, 1, 1
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

export function buildRgbStokesExr(): Buffer {
  ensureExrEncoderInitialized();

  const encoder = new ExrEncoder(2, 2);
  try {
    encoder.addLayer(
      null,
      [
        'R', 'G', 'B',
        'S0.R', 'S0.G', 'S0.B',
        'S1.R', 'S1.G', 'S1.B',
        'S2.R', 'S2.G', 'S2.B',
        'S3.R', 'S3.G', 'S3.B'
      ],
      new Float32Array([
        0.8, 0.7, 0.6, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0,
        0.6, 0.7, 0.8, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0,
        0.4, 0.5, 0.6, 1, 1, 1, -1, 0, 0, 0, -1, 0, 0, 0, 0,
        0.2, 0.3, 0.4, 1, 1, 1, 0, -1, 0, -1, 0, 0, 0, 0, 0
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    return Buffer.from(encoder.encode());
  } finally {
    encoder.free();
  }
}

function ensureExrEncoderInitialized(): void {
  if (exrEncoderInitialized) {
    return;
  }

  const wasmBytes = readFileSync(new URL('../../src/vendor/exrs_raw_wasm_bindgen_bg.wasm', import.meta.url));
  initSync({ module: wasmBytes });
  exrEncoderInitialized = true;
}
