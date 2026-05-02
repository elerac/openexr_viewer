import { computeDisplaySelectionRoiStats } from '../analysis/roi-stats';
import type { RoiReadoutModel } from './viewer-app-types';
import type {
  DecodedLayer,
  OpenedImageSession,
  ViewerSessionState
} from '../types';

export interface BuildRoiPresentationArgs {
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  sessionState: ViewerSessionState;
}

export function buildRoiReadoutModel(args: BuildRoiPresentationArgs): RoiReadoutModel {
  const roi = args.sessionState.roi;
  if (!args.activeSession || !args.activeLayer || !roi) {
    return {
      roi: null,
      stats: null
    };
  }

  return {
    roi,
    stats: computeDisplaySelectionRoiStats(
      args.activeLayer,
      args.activeSession.decoded.width,
      args.activeSession.decoded.height,
      roi,
      args.sessionState.displaySelection,
      args.sessionState.visualizationMode
    )
  };
}
