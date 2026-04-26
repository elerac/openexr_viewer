import type {
  ViewerKeyboardNavigationDirection,
  ViewerKeyboardNavigationInput,
  ViewerState,
  ViewportInfo
} from '../types';
import type { PointerPosition } from './shared';
import type {
  InteractionCallbacks,
  InteractionDependencies
} from './shared';
import { zoomAroundPoint } from './image-geometry';
import { resolveHoverPixel } from './probe-mode';

const IMAGE_KEYBOARD_PAN_STEP_RATIO = 0.025;
const IMAGE_KEYBOARD_PAN_SPEED_PER_SECOND = 1.5;
const IMAGE_KEYBOARD_PAN_MAX_FRAME_MS = 50;

type ImageKeyboardPanCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getViewport' | 'getImageSize' | 'onViewChange' | 'onHoverPixel'
> & {
  getLastPointerInElement: () => PointerPosition | null;
};

export function zoomImageFromWheel(
  state: ViewerState,
  viewport: ViewportInfo,
  point: PointerPosition,
  deltaY: number
): Pick<ViewerState, 'zoom' | 'panX' | 'panY'> {
  const zoomFactor = Math.exp(-deltaY * 0.0015);
  const requestedZoom = state.zoom * zoomFactor;
  return zoomAroundPoint(state, viewport, point.x, point.y, requestedZoom);
}

export function panImageFromDrag(
  state: ViewerState,
  deltaX: number,
  deltaY: number
): Pick<
  ViewerState,
  'zoom' | 'panX' | 'panY' | 'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
> {
  return {
    zoom: state.zoom,
    panX: state.panX - deltaX / state.zoom,
    panY: state.panY - deltaY / state.zoom,
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: state.panoramaHfovDeg
  };
}

export class ImageKeyboardPanController {
  private readonly callbacks: ImageKeyboardPanCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createViewerKeyboardNavigationInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: ImageKeyboardPanCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createViewerKeyboardNavigationInput();
    this.lastFrameTime = null;
  }

  handle(direction: ViewerKeyboardNavigationDirection): void {
    this.applyInput(createViewerKeyboardNavigationInput(direction), IMAGE_KEYBOARD_PAN_STEP_RATIO);
  }

  setInput(input: ViewerKeyboardNavigationInput): void {
    const previousInput = this.input;
    const nextInput = cloneViewerKeyboardNavigationInput(input);
    if (sameViewerKeyboardNavigationInput(previousInput, nextInput)) {
      if (hasViewerKeyboardNavigationInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedViewerKeyboardNavigationInput(previousInput, nextInput);
    if (hasViewerKeyboardNavigationInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, IMAGE_KEYBOARD_PAN_STEP_RATIO);
    }

    if (hasViewerKeyboardNavigationInput(nextInput)) {
      if (!hasViewerKeyboardNavigationInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: ViewerKeyboardNavigationInput, viewportStepRatio: number): void {
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode !== 'image') {
      return;
    }

    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const { deltaScreenX, deltaScreenY } = getImageKeyboardPanDeltaForInput(
      input,
      viewport.width * viewportStepRatio,
      viewport.height * viewportStepRatio
    );
    if (deltaScreenX === 0 && deltaScreenY === 0) {
      return;
    }

    const nextView = panImageFromDrag(state, deltaScreenX, deltaScreenY);
    if (
      nextView.zoom === state.zoom &&
      nextView.panX === state.panX &&
      nextView.panY === state.panY
    ) {
      return;
    }

    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(
      resolveHoverPixel(this.callbacks.getLastPointerInElement(), nextState, viewport, imageSize)
    );
  }

  private ensureScheduledFrame(): void {
    if (this.frameId !== null || !hasViewerKeyboardNavigationInput(this.input)) {
      return;
    }

    this.frameId = this.scheduleFrame(this.onFrame);
  }

  private cancelScheduledFrame(): void {
    if (this.frameId === null) {
      return;
    }

    this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameId = null;
    if (!hasViewerKeyboardNavigationInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        IMAGE_KEYBOARD_PAN_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          IMAGE_KEYBOARD_PAN_SPEED_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function getImageKeyboardPanDeltaForInput(
  input: ViewerKeyboardNavigationInput,
  horizontalStep: number,
  verticalStep: number
): { deltaScreenX: number; deltaScreenY: number } {
  const horizontalDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const verticalDirection = (input.up ? 1 : 0) - (input.down ? 1 : 0);

  return {
    deltaScreenX: horizontalStep * horizontalDirection,
    deltaScreenY: verticalStep * verticalDirection
  };
}

function createViewerKeyboardNavigationInput(
  direction: ViewerKeyboardNavigationDirection | null = null
): ViewerKeyboardNavigationInput {
  return {
    up: direction === 'up',
    left: direction === 'left',
    down: direction === 'down',
    right: direction === 'right'
  };
}

function cloneViewerKeyboardNavigationInput(
  input: ViewerKeyboardNavigationInput
): ViewerKeyboardNavigationInput {
  return {
    up: input.up,
    left: input.left,
    down: input.down,
    right: input.right
  };
}

function getNewlyPressedViewerKeyboardNavigationInput(
  previousInput: ViewerKeyboardNavigationInput,
  nextInput: ViewerKeyboardNavigationInput
): ViewerKeyboardNavigationInput {
  return {
    up: nextInput.up && !previousInput.up,
    left: nextInput.left && !previousInput.left,
    down: nextInput.down && !previousInput.down,
    right: nextInput.right && !previousInput.right
  };
}

function hasViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function sameViewerKeyboardNavigationInput(
  a: ViewerKeyboardNavigationInput,
  b: ViewerKeyboardNavigationInput
): boolean {
  return a.up === b.up && a.left === b.left && a.down === b.down && a.right === b.right;
}
