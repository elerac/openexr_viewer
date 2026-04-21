import { describe, expect, it } from 'vitest';
import { linearToSrgbByte } from '../src/color';
import { buildExportImagePixels } from '../src/export-image';
import { createDefaultStokesDegreeModulation } from '../src/stokes';

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
        stokesDegreeModulation: createDefaultStokesDegreeModulation()
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
        stokesDegreeModulation: createDefaultStokesDegreeModulation()
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
        stokesDegreeModulation: createDefaultStokesDegreeModulation()
      },
      colormapLut: null
    });

    expect(Array.from(pixels.data)).toEqual([255, 0, 0, 64]);
  });
});
