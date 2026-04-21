import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REC709_LUMINANCE_WEIGHTS,
  SRGB_TRANSFER,
  computeRec709Luminance,
  linearToSrgb,
  linearToSrgbByte
} from '../src/color';

const fragmentSource = readFileSync(
  new URL('../src/rendering/shaders/exr-image.frag.glsl', import.meta.url),
  'utf8'
);

describe('color utilities', () => {
  it('computes Rec.709 luminance from the shared weights', () => {
    expect(computeRec709Luminance(1, 0.5, 0.25)).toBeCloseTo(0.5883, 4);
    expect(computeRec709Luminance(1, 1, 1)).toBe(1);
  });

  it('encodes the linear sRGB segment through the cutoff', () => {
    const midpoint = SRGB_TRANSFER.cutoff / 2;

    expect(linearToSrgb(midpoint)).toBeCloseTo(midpoint * SRGB_TRANSFER.linearScale, 12);
    expect(linearToSrgb(SRGB_TRANSFER.cutoff)).toBeCloseTo(
      SRGB_TRANSFER.cutoff * SRGB_TRANSFER.linearScale,
      12
    );
  });

  it('encodes the nonlinear sRGB segment above the cutoff', () => {
    const value = 0.25;

    expect(linearToSrgb(value)).toBeCloseTo(
      SRGB_TRANSFER.encodedScale * Math.pow(value, 1 / SRGB_TRANSFER.gamma) - SRGB_TRANSFER.encodedOffset,
      12
    );
  });

  it('sanitizes negative and non-finite inputs to zero', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(linearToSrgb(value)).toBe(0);
      expect(linearToSrgbByte(value)).toBe(0);
    }
  });

  it('rounds and clamps sRGB bytes', () => {
    expect(linearToSrgbByte(0.25)).toBe(137);
    expect(linearToSrgbByte(0.5)).toBe(188);
    expect(linearToSrgbByte(10)).toBe(255);
  });
});

describe('shader color constants', () => {
  it('mirror the CPU constants exactly', () => {
    expect(readShaderFloatConstant('REC709_LUMINANCE_WEIGHT_R')).toBe(REC709_LUMINANCE_WEIGHTS.r);
    expect(readShaderFloatConstant('REC709_LUMINANCE_WEIGHT_G')).toBe(REC709_LUMINANCE_WEIGHTS.g);
    expect(readShaderFloatConstant('REC709_LUMINANCE_WEIGHT_B')).toBe(REC709_LUMINANCE_WEIGHTS.b);
    expect(readShaderFloatConstant('SRGB_TRANSFER_CUTOFF')).toBe(SRGB_TRANSFER.cutoff);
    expect(readShaderFloatConstant('SRGB_TRANSFER_LINEAR_SCALE')).toBe(SRGB_TRANSFER.linearScale);
    expect(readShaderFloatConstant('SRGB_TRANSFER_ENCODED_SCALE')).toBe(SRGB_TRANSFER.encodedScale);
    expect(readShaderFloatConstant('SRGB_TRANSFER_ENCODED_OFFSET')).toBe(SRGB_TRANSFER.encodedOffset);
    expect(readShaderFloatConstant('SRGB_TRANSFER_GAMMA')).toBe(SRGB_TRANSFER.gamma);
  });

  it('produces the same representative luminance and sRGB values as the CPU helpers', () => {
    const shaderWeights = {
      r: readShaderFloatConstant('REC709_LUMINANCE_WEIGHT_R'),
      g: readShaderFloatConstant('REC709_LUMINANCE_WEIGHT_G'),
      b: readShaderFloatConstant('REC709_LUMINANCE_WEIGHT_B')
    };
    const shaderTransfer = {
      cutoff: readShaderFloatConstant('SRGB_TRANSFER_CUTOFF'),
      linearScale: readShaderFloatConstant('SRGB_TRANSFER_LINEAR_SCALE'),
      encodedScale: readShaderFloatConstant('SRGB_TRANSFER_ENCODED_SCALE'),
      encodedOffset: readShaderFloatConstant('SRGB_TRANSFER_ENCODED_OFFSET'),
      gamma: readShaderFloatConstant('SRGB_TRANSFER_GAMMA')
    };

    for (const [r, g, b] of [
      [1, 0.5, 0.25],
      [0, 1, 0],
      [0.125, 0.25, 0.5]
    ]) {
      expect(computeShaderLuminance(shaderWeights, r, g, b)).toBeCloseTo(
        computeRec709Luminance(r, g, b),
        12
      );
    }

    for (const value of [0, shaderTransfer.cutoff / 2, shaderTransfer.cutoff, 0.25, 1, 10]) {
      expect(computeShaderLinearToSrgb(shaderTransfer, value)).toBeCloseTo(linearToSrgb(value), 12);
    }
  });
});

function readShaderFloatConstant(name: string): number {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fragmentSource.match(new RegExp(`const float ${escapedName} = ([\\d.eE+-]+);`));
  if (!match) {
    throw new Error(`Missing shader constant: ${name}`);
  }

  return Number(match[1]);
}

function computeShaderLuminance(
  weights: { r: number; g: number; b: number },
  r: number,
  g: number,
  b: number
): number {
  return weights.r * r + weights.g * g + weights.b * b;
}

function computeShaderLinearToSrgb(
  transfer: {
    cutoff: number;
    linearScale: number;
    encodedScale: number;
    encodedOffset: number;
    gamma: number;
  },
  value: number
): number {
  const linear = !Number.isFinite(value) || value <= 0 ? 0 : value;
  return linear <= transfer.cutoff
    ? linear * transfer.linearScale
    : transfer.encodedScale * Math.pow(linear, 1 / transfer.gamma) - transfer.encodedOffset;
}
