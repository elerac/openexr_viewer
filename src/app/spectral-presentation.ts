import { buildZeroCenteredColormapRange, cloneDisplayLuminanceRange } from '../colormap-range';
import { isStokesSelection } from '../display-model';
import { samplePixelValues } from '../sampling/probe';
import {
  buildSpectralPlotPoints,
  buildSpectralStokesChannels,
  buildSpectralStokesPlotPoints,
  detectSpectralChannels,
  detectSpectralStokesChannelGroups,
  parseSpectralStokesSuffixWavelength
} from '../spectral';
import {
  createDefaultStokesColormapDefaultSettings,
  getStokesDisplayColormapDefault,
  type StokesColormapDefaultSettings
} from '../stokes';
import {
  resolveActiveProbePixel,
  resolveProbeMode
} from '../probe';
import type { SpectralPlotReadoutModel } from './viewer-app-types';
import type {
  DecodedLayer,
  OpenedImageSession,
  ViewerInteractionState,
  ViewerSessionState
} from '../types';

export interface BuildSpectralPresentationArgs {
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  sessionState: ViewerSessionState;
  interactionState: ViewerInteractionState;
  stokesColormapDefaults?: StokesColormapDefaultSettings;
}

export function buildSpectralPlotReadoutModel(args: BuildSpectralPresentationArgs): SpectralPlotReadoutModel {
  const mode = resolveProbeMode(args.sessionState.lockedPixel);
  const hiddenReadout = {
    visible: false,
    mode,
    pixel: null,
    imageSize: args.activeSession
      ? {
          width: args.activeSession.decoded.width,
          height: args.activeSession.decoded.height
        }
      : null,
    channels: [],
    points: [],
    yAxis: null
  };
  const imageSize = args.activeSession
    ? {
        width: args.activeSession.decoded.width,
        height: args.activeSession.decoded.height
      }
    : null;

  if (!args.activeSession || !args.activeLayer) {
    return hiddenReadout;
  }

  const spectralPlotSource = resolveSpectralPlotSource(args);
  if (!spectralPlotSource) {
    return hiddenReadout;
  }

  const targetPixel = resolveActiveProbePixel(
    args.sessionState.lockedPixel,
    args.interactionState.hoveredPixel
  );
  if (!targetPixel) {
    return {
      visible: true,
      mode,
      pixel: null,
      imageSize,
      channels: spectralPlotSource.channels,
      points: [],
      yAxis: spectralPlotSource.yAxis
    };
  }

  const sample = samplePixelValues(
    args.activeLayer,
    args.activeSession.decoded.width,
    args.activeSession.decoded.height,
    targetPixel
  );

  return {
    visible: true,
    mode,
    pixel: sample ? { x: sample.x, y: sample.y } : null,
    imageSize,
    channels: spectralPlotSource.channels,
    points: spectralPlotSource.buildPoints(sample),
    yAxis: spectralPlotSource.yAxis
  };
}

type SpectralPlotSource = Pick<SpectralPlotReadoutModel, 'channels' | 'yAxis'> & {
  buildPoints: (sample: ReturnType<typeof samplePixelValues>) => SpectralPlotReadoutModel['points'];
};

function resolveSpectralPlotSource(args: BuildSpectralPresentationArgs): SpectralPlotSource | null {
  const selection = args.sessionState.displaySelection;
  const selectedStokesWavelength = isStokesSelection(selection) && selection.source.kind === 'scalar'
    ? parseSpectralStokesSuffixWavelength(selection.source.suffix)
    : null;
  if (isStokesSelection(selection) && selectedStokesWavelength !== null) {
    const groups = detectSpectralStokesChannelGroups(args.activeLayer!.channelNames);
    if (groups.length >= 2 && groups.some((group) => group.wavelength === selectedStokesWavelength)) {
      const stokesDefaults = args.stokesColormapDefaults ?? createDefaultStokesColormapDefaultSettings();
      return {
        channels: buildSpectralStokesChannels(groups, selection.parameter),
        yAxis: resolveSpectralStokesYAxis(selection, stokesDefaults),
        buildPoints: (sample) => buildSpectralStokesPlotPoints(sample, groups, selection.parameter)
      };
    }
  }

  const preferredSpectralChannelName = selection?.kind === 'channelMono'
    ? selection.channel
    : null;
  const spectralChannels = detectSpectralChannels(args.activeLayer!.channelNames, preferredSpectralChannelName);
  return spectralChannels.length > 0
    ? {
        channels: spectralChannels,
        yAxis: null,
        buildPoints: (sample) => buildSpectralPlotPoints(sample, spectralChannels)
      }
    : null;
}

function resolveSpectralStokesYAxis(
  selection: ViewerSessionState['displaySelection'],
  stokesColormapDefaults: StokesColormapDefaultSettings
): SpectralPlotReadoutModel['yAxis'] {
  const stokesDefault = getStokesDisplayColormapDefault(selection, stokesColormapDefaults);
  if (!stokesDefault) {
    return null;
  }

  return {
    range: stokesDefault.zeroCentered
      ? buildZeroCenteredColormapRange(stokesDefault.range) ?? cloneDisplayLuminanceRange(stokesDefault.range)!
      : cloneDisplayLuminanceRange(stokesDefault.range)!,
    zeroCentered: stokesDefault.zeroCentered
  };
}
