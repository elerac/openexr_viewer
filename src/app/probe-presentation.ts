import { samplePixelValuesForDisplay } from '../display-texture';
import {
  buildProbeColorPreview,
  resolveActiveProbePixel,
  resolveProbeMode
} from '../probe';
import type { ColormapLut } from '../colormaps';
import type { PendingColormapActivation, ProbePresentationModel } from './viewer-app-types';
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
  pendingColormapActivation: PendingColormapActivation | null;
}

export function buildProbePresentationModel(args: BuildProbePresentationArgs): ProbePresentationModel {
  const mode = resolveProbeMode(args.sessionState.lockedPixel);
  const imageSize = args.activeSession
    ? {
        width: args.activeSession.decoded.width,
        height: args.activeSession.decoded.height
      }
    : null;
  const metadata = args.activeLayer?.metadata ?? null;

  if (!args.activeSession || !args.activeLayer) {
    return {
      mode,
      sample: null,
      colorPreview: null,
      imageSize,
      metadata
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
      imageSize,
      metadata
    };
  }

  const sample = samplePixelValuesForDisplay(
    args.activeLayer,
    args.activeSession.decoded.width,
    args.activeSession.decoded.height,
    targetPixel,
    args.sessionState.displaySelection
  );

  return {
    mode,
    sample,
    colorPreview: buildProbeColorPreview(sample, args.sessionState.displaySelection, args.sessionState.exposureEv, {
      mode: args.sessionState.visualizationMode,
      colormapRange: args.sessionState.colormapRange ?? args.activeDisplayLuminanceRange,
      colormapLut: args.activeColormapLut,
      stokesDegreeModulation: args.sessionState.stokesDegreeModulation
    }),
    imageSize,
    metadata
  };
}
