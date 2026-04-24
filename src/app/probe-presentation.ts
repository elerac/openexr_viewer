import { samplePixelValuesForDisplay } from '../display-texture';
import {
  buildProbeColorPreview,
  resolveActiveProbePixel,
  resolveProbeMode
} from '../probe';
import type { ColormapLut } from '../colormaps';
import type { ProbeReadoutModel } from './viewer-app-types';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerInteractionState,
  ViewerSessionState
} from '../types';

export interface BuildProbePresentationArgs {
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  sessionState: ViewerSessionState;
  interactionState: ViewerInteractionState;
  activeColormapLut: ColormapLut | null;
  activeDisplayLuminanceRange: DisplayLuminanceRange | null;
}

export function buildProbeReadoutModel(args: BuildProbePresentationArgs): ProbeReadoutModel {
  const mode = resolveProbeMode(args.sessionState.lockedPixel);
  const imageSize = args.activeSession
    ? {
        width: args.activeSession.decoded.width,
        height: args.activeSession.decoded.height
      }
    : null;

  if (!args.activeSession || !args.activeLayer) {
    return {
      mode,
      sample: null,
      colorPreview: null,
      imageSize
    };
  }

  const targetPixel = resolveActiveProbePixel(
    args.sessionState.lockedPixel,
    args.interactionState.hoveredPixel
  );
  if (!targetPixel) {
    return {
      mode,
      sample: null,
      colorPreview: null,
      imageSize
    };
  }

  const sample = samplePixelValuesForDisplay(
    args.activeLayer,
    args.activeSession.decoded.width,
    args.activeSession.decoded.height,
    targetPixel,
    args.sessionState.displaySelection,
    args.sessionState.visualizationMode
  );

  return {
    mode,
    sample,
    colorPreview: buildProbeColorPreview(sample, args.sessionState.displaySelection, args.sessionState.exposureEv, {
      mode: args.sessionState.visualizationMode,
      colormapRange: args.sessionState.colormapRange ?? args.activeDisplayLuminanceRange,
      colormapLut: args.activeColormapLut,
      stokesDegreeModulation: args.sessionState.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: args.sessionState.stokesAolpDegreeModulationMode
    }),
    imageSize
  };
}
