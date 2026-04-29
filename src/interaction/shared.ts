import type { ImagePixel, ViewerRoiInteractionState, ViewerState, ViewportInfo, ViewportRect } from '../types';
import type {
  ScreenshotSelectionDragUpdate,
  ScreenshotSelectionHandle,
  ScreenshotSelectionSnapGuide
} from './screenshot-selection';

export interface ImageSize {
  width: number;
  height: number;
}

export interface PointerPosition {
  x: number;
  y: number;
}

export interface ScreenshotSelectionInteractionState {
  active: boolean;
  rect: ViewportRect | null;
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
  onRoiInteractionState?: (state: ViewerRoiInteractionState) => void;
  getScreenshotSelection?: () => ScreenshotSelectionInteractionState;
  onScreenshotSelectionRectChange?: (update: ScreenshotSelectionDragUpdate) => void;
  onScreenshotSelectionHandleHover?: (handle: ScreenshotSelectionHandle | null) => void;
  onScreenshotSelectionResizeActiveChange?: (active: boolean) => void;
  onScreenshotSelectionSquareSnapChange?: (active: boolean) => void;
  onScreenshotSelectionSnapGuideChange?: (guide: ScreenshotSelectionSnapGuide) => void;
}

export interface InteractionDependencies {
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}
