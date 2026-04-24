import type {
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  ViewerState,
  ViewportInfo
} from '../types';
import {
  getPanoramaVerticalFovDeg,
  orbitPanorama,
  zoomPanorama
} from './panorama-geometry';
import { resolveHoverPixel } from './probe-mode';
import type {
  InteractionCallbacks,
  InteractionDependencies,
  PointerPosition
} from './shared';

const PANORAMA_KEYBOARD_ORBIT_STEP_RATIO = 0.05;
const PANORAMA_KEYBOARD_ORBIT_SPEED_PER_SECOND = 1.5;
const PANORAMA_KEYBOARD_ORBIT_MAX_FRAME_MS = 50;

type PanoramaViewChange = Pick<
  ViewerState,
  'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
>;

type PanoramaKeyboardOrbitCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getViewport' | 'getImageSize' | 'onViewChange' | 'onHoverPixel'
> & {
  getLastPointerInElement: () => PointerPosition | null;
};

export function orbitPanoramaFromDrag(
  state: ViewerState,
  viewport: ViewportInfo,
  deltaX: number,
  deltaY: number
): PanoramaViewChange {
  return orbitPanorama(state, viewport, deltaX, deltaY);
}

export function zoomPanoramaFromWheel(
  state: ViewerState,
  deltaY: number
): PanoramaViewChange {
  return zoomPanorama(state, deltaY);
}

export class PanoramaKeyboardOrbitController {
  private readonly callbacks: PanoramaKeyboardOrbitCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createPanoramaKeyboardOrbitInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: PanoramaKeyboardOrbitCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createPanoramaKeyboardOrbitInput();
    this.lastFrameTime = null;
  }

  handle(direction: PanoramaKeyboardOrbitDirection): void {
    this.applyInput(createPanoramaKeyboardOrbitInput(direction), PANORAMA_KEYBOARD_ORBIT_STEP_RATIO);
  }

  setInput(input: PanoramaKeyboardOrbitInput): void {
    const previousInput = this.input;
    const nextInput = clonePanoramaKeyboardOrbitInput(input);
    if (samePanoramaKeyboardOrbitInput(previousInput, nextInput)) {
      if (hasPanoramaKeyboardOrbitInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedPanoramaKeyboardOrbitInput(previousInput, nextInput);
    if (hasPanoramaKeyboardOrbitInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, PANORAMA_KEYBOARD_ORBIT_STEP_RATIO);
    }

    if (hasPanoramaKeyboardOrbitInput(nextInput)) {
      if (!hasPanoramaKeyboardOrbitInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: PanoramaKeyboardOrbitInput, viewportStepRatio: number): void {
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode !== 'panorama') {
      return;
    }

    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const { horizontalStep, verticalStep } = getPanoramaKeyboardOrbitStepSizes(
      state.panoramaHfovDeg,
      viewport,
      viewportStepRatio
    );
    const { deltaScreenX, deltaScreenY } = getPanoramaKeyboardOrbitDeltaForInput(
      input,
      horizontalStep,
      verticalStep
    );
    if (deltaScreenX === 0 && deltaScreenY === 0) {
      return;
    }

    const nextView = orbitPanorama(state, viewport, deltaScreenX, deltaScreenY);
    if (
      nextView.panoramaYawDeg === state.panoramaYawDeg &&
      nextView.panoramaPitchDeg === state.panoramaPitchDeg &&
      nextView.panoramaHfovDeg === state.panoramaHfovDeg
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
    if (this.frameId !== null || !hasPanoramaKeyboardOrbitInput(this.input)) {
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
    if (!hasPanoramaKeyboardOrbitInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        PANORAMA_KEYBOARD_ORBIT_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          PANORAMA_KEYBOARD_ORBIT_SPEED_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function getPanoramaKeyboardOrbitDeltaForInput(
  input: PanoramaKeyboardOrbitInput,
  horizontalStep: number,
  verticalStep: number
): { deltaScreenX: number; deltaScreenY: number } {
  const horizontalDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const verticalDirection = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  return {
    deltaScreenX: horizontalStep * horizontalDirection,
    deltaScreenY: verticalStep * verticalDirection
  };
}

function getPanoramaKeyboardOrbitStepSizes(
  horizontalFovDeg: number,
  viewport: ViewportInfo,
  viewportStepRatio: number
): { horizontalStep: number; verticalStep: number } {
  const verticalFovDeg = getPanoramaVerticalFovDeg(horizontalFovDeg, viewport);
  return {
    horizontalStep: horizontalFovDeg === 0
      ? 0
      : viewport.width * viewportStepRatio * (verticalFovDeg / horizontalFovDeg),
    verticalStep: viewport.height * viewportStepRatio
  };
}

function createPanoramaKeyboardOrbitInput(
  direction: PanoramaKeyboardOrbitDirection | null = null
): PanoramaKeyboardOrbitInput {
  return {
    up: direction === 'up',
    left: direction === 'left',
    down: direction === 'down',
    right: direction === 'right'
  };
}

function clonePanoramaKeyboardOrbitInput(
  input: PanoramaKeyboardOrbitInput
): PanoramaKeyboardOrbitInput {
  return {
    up: input.up,
    left: input.left,
    down: input.down,
    right: input.right
  };
}

function getNewlyPressedPanoramaKeyboardOrbitInput(
  previousInput: PanoramaKeyboardOrbitInput,
  nextInput: PanoramaKeyboardOrbitInput
): PanoramaKeyboardOrbitInput {
  return {
    up: nextInput.up && !previousInput.up,
    left: nextInput.left && !previousInput.left,
    down: nextInput.down && !previousInput.down,
    right: nextInput.right && !previousInput.right
  };
}

function hasPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function samePanoramaKeyboardOrbitInput(
  a: PanoramaKeyboardOrbitInput,
  b: PanoramaKeyboardOrbitInput
): boolean {
  return a.up === b.up && a.left === b.left && a.down === b.down && a.right === b.right;
}
