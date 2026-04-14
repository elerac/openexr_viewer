import { describe, expect, it } from 'vitest';
import { buildOverlayValueLines } from '../src/renderer';

describe('renderer overlay value helpers', () => {
  it('uses one mono line for colormap RGB displays', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'colormap',
        displayR: 'R',
        displayG: 'G',
        displayB: 'B'
      },
      1,
      0.5,
      0.25
    );

    expect(lines).toEqual([
      {
        color: 'rgba(255, 255, 255, 0.95)',
        value: '0.588'
      }
    ]);
  });

  it('keeps three channel lines for non-colormap RGB displays', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'rgb',
        displayR: 'R',
        displayG: 'G',
        displayB: 'B'
      },
      1,
      0.5,
      0.25
    );

    expect(lines.map((line) => line.value)).toEqual(['1.00', '0.500', '0.250']);
    expect(lines).toHaveLength(3);
  });

  it('keeps one channel-colored line for repeated-channel RGB displays', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'rgb',
        displayR: 'R',
        displayG: 'R',
        displayB: 'R'
      },
      0.25,
      0.25,
      0.25
    );

    expect(lines).toEqual([
      {
        color: 'rgba(255, 120, 120, 0.96)',
        value: '0.250'
      }
    ]);
  });
});
