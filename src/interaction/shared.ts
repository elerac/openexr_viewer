import type { ImagePixel, ViewerState, ViewportInfo } from '../types';

export interface ImageSize {
  width: number;
  height: number;
}

export interface PointerPosition {
  x: number;
  y: number;
}

export interface InteractionCallbacks {
  getState: () => ViewerState;
  getViewport: () => ViewportInfo;
  getImageSize: () => ImageSize | null;
  onViewChange: (
    next: Partial<Pick<
      ViewerState,
      'zoom' | 'panX' | 'panY' | 'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
    >>
  ) => void;
  onHoverPixel: (pixel: ImagePixel | null) => void;
  onToggleLockPixel: (pixel: ImagePixel | null) => void;
  onDraftRoi: (roi: ViewerState['draftRoi']) => void;
  onCommitRoi: (roi: ViewerState['roi']) => void;
}

export interface InteractionDependencies {
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}
