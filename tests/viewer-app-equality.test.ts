import { describe, expect, it } from 'vitest';
import {
  sameExportBatchTarget,
  sameOpenedImageOptions,
  sameProbeReadout,
  sameSpectralPlotReadout,
  sameViewerSessionState
} from '../src/app/viewer-app-equality';
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

  it('ignores unused file thumbnail data while comparing export batch targets', () => {
    const selection = {
      kind: 'channelRgb' as const,
      r: 'R',
      g: 'G',
      b: 'B',
      alpha: null
    };
    const base = {
      archiveFilename: 'openexr-export.zip',
      activeSessionId: 'session-1',
      files: [{
        sessionId: 'session-1',
        filename: 'image.exr',
        label: 'image.exr',
        sourcePath: 'image.exr',
        thumbnailDataUrl: null,
        activeLayer: 0,
        displaySelection: selection,
        channels: [{
          value: 'group:',
          label: 'RGB',
          selectionKey: 'channelRgb:R:G:B:',
          selection,
          swatches: ['#ff6570', '#6bd66f', '#51aefe'],
          mergedOrder: 0,
          splitOrder: 0
        }]
      }]
    };

    expect(sameExportBatchTarget(base, {
      ...base,
      files: [{
        ...base.files[0],
        thumbnailDataUrl: 'data:image/png;base64,AAAA'
      }]
    })).toBe(true);
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

  it('compares spectral plot y-axis metadata', () => {
    const base = {
      visible: true,
      mode: 'Hover' as const,
      pixel: { x: 0, y: 0 },
      imageSize: { width: 2, height: 1 },
      channels: [
        { channelName: 'S1/S0.400nm', wavelength: 400, seriesKey: 'S1/S0', seriesLabel: 'S1/S0' }
      ],
      points: [
        { channelName: 'S1/S0.400nm', wavelength: 400, seriesKey: 'S1/S0', seriesLabel: 'S1/S0', intensity: 0.5 }
      ],
      yAxis: {
        range: { min: -1, max: 1 },
        zeroCentered: true
      }
    };

    expect(sameSpectralPlotReadout(base, { ...base })).toBe(true);
    expect(sameSpectralPlotReadout(base, {
      ...base,
      yAxis: {
        range: { min: -0.5, max: 0.5 },
        zeroCentered: true
      }
    })).toBe(false);
  });
});
