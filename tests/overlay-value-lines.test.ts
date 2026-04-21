import { describe, expect, it } from 'vitest';
import { buildOverlayValueLines } from '../src/rendering/overlay-value-lines';
import { createChannelMonoSelection, createChannelRgbSelection } from './helpers/state-fixtures';

describe('renderer overlay value helpers', () => {
  it('uses one mono line for colormap RGB displays', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'colormap',
        displaySelection: createChannelRgbSelection('R', 'G', 'B')
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
        displaySelection: createChannelRgbSelection('R', 'G', 'B')
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
        displaySelection: createChannelMonoSelection('R')
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

  it('appends alpha for non-colormap RGB displays with active alpha', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'rgb',
        displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A')
      },
      1,
      0.5,
      0.25,
      0.125
    );

    expect(lines.map((line) => line.value)).toEqual(['1.00', '0.500', '0.250', '0.125']);
    expect(lines).toHaveLength(4);
  });

  it('appends alpha for repeated-channel RGB displays with active alpha', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'rgb',
        displaySelection: createChannelMonoSelection('mask', 'A')
      },
      0.25,
      0.25,
      0.25,
      0.75
    );

    expect(lines).toEqual([
      {
        color: 'rgba(255, 255, 255, 0.95)',
        value: '0.250'
      },
      {
        color: 'rgba(255, 255, 255, 0.95)',
        value: '0.750'
      }
    ]);
  });

  it('appends alpha for colormap RGB displays with active alpha', () => {
    const lines = buildOverlayValueLines(
      {
        visualizationMode: 'colormap',
        displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A')
      },
      1,
      0.5,
      0.25,
      0.875
    );

    expect(lines).toEqual([
      {
        color: 'rgba(255, 255, 255, 0.95)',
        value: '0.588'
      },
      {
        color: 'rgba(255, 255, 255, 0.95)',
        value: '0.875'
      }
    ]);
  });
});
