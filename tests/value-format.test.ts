import { describe, expect, it } from 'vitest';
import { formatOverlayValue } from '../src/value-format';

describe('shared overlay-style value formatting', () => {
  it('formats representative in-range values with precision notation', () => {
    expect(formatOverlayValue(1)).toBe('1.00');
    expect(formatOverlayValue(0.25)).toBe('0.250');
    expect(formatOverlayValue(0.5883)).toBe('0.588');
    expect(formatOverlayValue(0)).toBe('0.00');
  });

  it('uses exponential notation for extreme magnitudes', () => {
    expect(formatOverlayValue(0.0005)).toBe('5.0e-4');
    expect(formatOverlayValue(1234)).toBe('1.2e+3');
  });

  it('passes through non-finite values unchanged', () => {
    expect(formatOverlayValue(Infinity)).toBe('Infinity');
    expect(formatOverlayValue(Number.NaN)).toBe('NaN');
  });
});
