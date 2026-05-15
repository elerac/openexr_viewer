import { describe, expect, it } from 'vitest';
import { buildSpectralPlotReadoutModel } from '../src/app/spectral-presentation';
import { createDefaultStokesColormapDefaultSettings } from '../src/stokes';
import type { OpenedImageSession } from '../src/types';
import {
  createChannelMonoSelection,
  createImage,
  createLayer,
  createLayerFromChannels,
  createStokesSelection,
  createViewerInteractionState,
  createViewerSessionState
} from './helpers/state-fixtures';

function createSession(layer = createLayerFromChannels({
  '400nm': [0.1, 0.2, 0.3, 0.4],
  '500nm': [1.1, 1.2, 1.3, 1.4],
  mask: [9, 9, 9, 9]
})): OpenedImageSession {
  const decoded = createImage([layer]);
  return {
    id: 'session-1',
    filename: 'spectral.exr',
    displayName: 'spectral.exr',
    fileSizeBytes: null,
    source: { kind: 'url', url: '/spectral.exr' },
    decoded,
    state: createViewerSessionState()
  };
}

describe('spectral readout presentation', () => {
  it('hides the panel when there is no active image', () => {
    const readout = buildSpectralPlotReadoutModel({
      activeSession: null,
      activeLayer: null,
      sessionState: createViewerSessionState(),
      interactionState: createViewerInteractionState()
    });

    expect(readout).toMatchObject({
      visible: false,
      pixel: null,
      channels: [],
      points: []
    });
  });

  it('hides the panel for non-spectral layers', () => {
    const layer = createLayer();
    const session = createSession(layer);
    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState(),
      interactionState: createViewerInteractionState({ hoveredPixel: { ix: 0, iy: 0 } })
    });

    expect(readout.visible).toBe(false);
    expect(readout.channels).toEqual([]);
    expect(readout.points).toEqual([]);
  });

  it('shows the panel with spectral channel domain before a probe pixel is active', () => {
    const session = createSession();
    const layer = session.decoded.layers[0] ?? null;
    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState(),
      interactionState: createViewerInteractionState()
    });

    expect(readout.visible).toBe(true);
    expect(readout.yAxis).toBeNull();
    expect(readout.pixel).toBeNull();
    expect(readout.channels).toEqual([
      { channelName: '400nm', wavelength: 400, seriesKey: '', seriesLabel: '' },
      { channelName: '500nm', wavelength: 500, seriesKey: '', seriesLabel: '' }
    ]);
    expect(readout.points).toEqual([]);
  });

  it('samples the spectral series matching the selected display channel family', () => {
    const layer = createLayerFromChannels({
      'hoge.414nm': [0.1, 0.2, 0.3, 0.4],
      'fuga.414nm': [1.1, 1.2, 1.3, 1.4],
      'hoge.453nm': [0.5, 0.6, 0.7, 0.8],
      'fuga.453nm': [1.5, 1.6, 1.7, 1.8]
    });
    const session = createSession(layer);
    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState({
        displaySelection: createChannelMonoSelection('fuga.414nm')
      }),
      interactionState: createViewerInteractionState({ hoveredPixel: { ix: 1, iy: 0 } })
    });

    expect(readout.visible).toBe(true);
    expect(readout.channels).toEqual([
      { channelName: 'fuga.414nm', wavelength: 414, seriesKey: 'fuga', seriesLabel: 'fuga' },
      { channelName: 'fuga.453nm', wavelength: 453, seriesKey: 'fuga', seriesLabel: 'fuga' }
    ]);
    expect(readout.points.map(({ channelName, wavelength, seriesKey, seriesLabel }) => ({
      channelName,
      wavelength,
      seriesKey,
      seriesLabel
    }))).toEqual([
      { channelName: 'fuga.414nm', wavelength: 414, seriesKey: 'fuga', seriesLabel: 'fuga' },
      { channelName: 'fuga.453nm', wavelength: 453, seriesKey: 'fuga', seriesLabel: 'fuga' }
    ]);
    expect(readout.points[0]?.intensity).toBeCloseTo(1.2, 6);
    expect(readout.points[1]?.intensity).toBeCloseTo(1.6, 6);
  });

  it('samples raw spectral intensities and lets locked pixels override hover', () => {
    const session = createSession();
    const layer = session.decoded.layers[0] ?? null;
    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState({ lockedPixel: { ix: 0, iy: 1 } }),
      interactionState: createViewerInteractionState({ hoveredPixel: { ix: 1, iy: 0 } })
    });

    expect(readout.visible).toBe(true);
    expect(readout.mode).toBe('Locked');
    expect(readout.pixel).toEqual({ x: 0, y: 1 });
    expect(readout.channels).toEqual([
      { channelName: '400nm', wavelength: 400, seriesKey: '', seriesLabel: '' },
      { channelName: '500nm', wavelength: 500, seriesKey: '', seriesLabel: '' }
    ]);
    expect(readout.points.map(({ channelName, wavelength }) => ({ channelName, wavelength }))).toEqual([
      { channelName: '400nm', wavelength: 400 },
      { channelName: '500nm', wavelength: 500 }
    ]);
    expect(readout.points[0]?.intensity).toBeCloseTo(0.3, 6);
    expect(readout.points[1]?.intensity).toBeCloseTo(1.3, 6);
    expect(readout.yAxis).toBeNull();
  });

  it('plots the selected spectral Stokes component across wavelengths', () => {
    const layer = createLayerFromChannels({
      'S0.400nm': [2, 2, 2, 2],
      'S1.400nm': [-1, -1, -1, -1],
      'S2.400nm': [0, 0, 0, 0],
      'S3.400nm': [0, 0, 0, 0],
      'S0.500nm': [4, 4, 4, 4],
      'S1.500nm': [1, 1, 1, 1],
      'S2.500nm': [0, 0, 0, 0],
      'S3.500nm': [0, 0, 0, 0]
    }, 'spectral-stokes');
    const session = createSession(layer);
    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState({
        displaySelection: createStokesSelection('s1_over_s0', 'stokesScalar', null, '500nm')
      }),
      interactionState: createViewerInteractionState({ hoveredPixel: { ix: 0, iy: 0 } })
    });

    expect(readout.visible).toBe(true);
    expect(readout.channels).toEqual([
      { channelName: 'S1/S0.400nm', wavelength: 400, seriesKey: 'S1/S0', seriesLabel: 'S1/S0' },
      { channelName: 'S1/S0.500nm', wavelength: 500, seriesKey: 'S1/S0', seriesLabel: 'S1/S0' }
    ]);
    expect(readout.points).toEqual([
      { channelName: 'S1/S0.400nm', wavelength: 400, seriesKey: 'S1/S0', seriesLabel: 'S1/S0', intensity: -0.5 },
      { channelName: 'S1/S0.500nm', wavelength: 500, seriesKey: 'S1/S0', seriesLabel: 'S1/S0', intensity: 0.25 }
    ]);
    expect(readout.yAxis).toEqual({
      range: { min: -1, max: 1 },
      zeroCentered: true
    });
  });

  it('plots spectral Stokes RGB selections across wavelengths', () => {
    const layer = createLayerFromChannels({
      'S0.400nm': [2],
      'S1.400nm': [-1],
      'S2.400nm': [0],
      'S3.400nm': [0],
      'S0.500nm': [4],
      'S1.500nm': [1],
      'S2.500nm': [0],
      'S3.500nm': [0]
    }, 'spectral-stokes');
    const session = createSession(layer);
    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState({
        displaySelection: createStokesSelection('s1_over_s0', 'stokesSpectralRgb')
      }),
      interactionState: createViewerInteractionState({ hoveredPixel: { ix: 0, iy: 0 } })
    });

    expect(readout.visible).toBe(true);
    expect(readout.channels).toEqual([
      { channelName: 'S1/S0.400nm', wavelength: 400, seriesKey: 'S1/S0', seriesLabel: 'S1/S0' },
      { channelName: 'S1/S0.500nm', wavelength: 500, seriesKey: 'S1/S0', seriesLabel: 'S1/S0' }
    ]);
    expect(readout.points).toEqual([
      { channelName: 'S1/S0.400nm', wavelength: 400, seriesKey: 'S1/S0', seriesLabel: 'S1/S0', intensity: -0.5 },
      { channelName: 'S1/S0.500nm', wavelength: 500, seriesKey: 'S1/S0', seriesLabel: 'S1/S0', intensity: 0.25 }
    ]);
  });

  it('uses saved Stokes defaults for spectral plot y-axis ranges', () => {
    const layer = createLayerFromChannels({
      'S0.400nm': [2],
      'S1.400nm': [1],
      'S2.400nm': [0],
      'S3.400nm': [0],
      'S0.500nm': [2],
      'S1.500nm': [0],
      'S2.500nm': [1],
      'S3.500nm': [0]
    }, 'spectral-stokes');
    const session = createSession(layer);
    const stokesColormapDefaults = createDefaultStokesColormapDefaultSettings();
    stokesColormapDefaults.normalized = {
      ...stokesColormapDefaults.normalized,
      range: { min: -0.2, max: 0.6 },
      zeroCentered: true
    };

    const readout = buildSpectralPlotReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState: createViewerSessionState({
        displaySelection: createStokesSelection('s2_over_s0', 'stokesScalar', null, '500nm')
      }),
      interactionState: createViewerInteractionState({ hoveredPixel: { ix: 0, iy: 0 } }),
      stokesColormapDefaults
    });

    expect(readout.yAxis).toEqual({
      range: { min: -0.6, max: 0.6 },
      zeroCentered: true
    });
  });
});
