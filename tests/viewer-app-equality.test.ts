import { describe, expect, it } from 'vitest';
import { sameOpenedImageOptions, sameViewerSessionState, sameProbeReadout } from '../src/app/viewer-app-equality';
import { createViewerSessionState } from './helpers/state-fixtures';

describe('viewer app equality helpers', () => {
  it('compares opened-image thumbnail loading state', () => {
    const base = [{
      id: 'session-1',
      label: 'image.exr',
      sizeBytes: 3,
      sourceDetail: 'shots/image.exr',
      thumbnailDataUrl: null,
      thumbnailAspectRatio: 1,
      thumbnailLoading: false,
      selectable: true
    }];

    expect(sameOpenedImageOptions(base, [{ ...base[0] }])).toBe(true);
    expect(sameOpenedImageOptions(base, [{ ...base[0], thumbnailLoading: true }])).toBe(false);
  });

  it('compares viewer session state structurally', () => {
    const base = createViewerSessionState();
    const same = createViewerSessionState();
    const changed = createViewerSessionState({ panX: 2 });

    expect(sameViewerSessionState(base, same)).toBe(true);
    expect(sameViewerSessionState(base, changed)).toBe(false);
  });

  it('compares probe readouts structurally without stringify-based equality', () => {
    const previous = {
      mode: 'Hover' as const,
      sample: {
        x: 1,
        y: 2,
        values: {
          R: 1,
          G: 0.5
        }
      },
      colorPreview: {
        cssColor: 'rgb(255, 0, 0)',
        displayValues: [
          { label: 'R', value: '1.00' },
          { label: 'G', value: '0.500' }
        ]
      },
      imageSize: { width: 10, height: 20 }
    };
    const same = {
      mode: 'Hover' as const,
      sample: {
        x: 1,
        y: 2,
        values: {
          R: 1,
          G: 0.5
        }
      },
      colorPreview: {
        cssColor: 'rgb(255, 0, 0)',
        displayValues: [
          { label: 'R', value: '1.00' },
          { label: 'G', value: '0.500' }
        ]
      },
      imageSize: { width: 10, height: 20 }
    };
    const changed = {
      ...same,
      sample: {
        ...same.sample,
        values: {
          ...same.sample.values,
          G: 0.75
        }
      }
    };

    expect(sameProbeReadout(previous, same)).toBe(true);
    expect(sameProbeReadout(previous, changed)).toBe(false);
  });
});
