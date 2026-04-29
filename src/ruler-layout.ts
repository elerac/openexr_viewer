import type { ViewportInsets } from './types';

export const RULER_SIZE_PX = 24;

export const RULER_FIT_INSETS: ViewportInsets = {
  top: RULER_SIZE_PX,
  right: 0,
  bottom: 0,
  left: RULER_SIZE_PX
};

export function resolveRulerFitInsets(rulersVisible: boolean): ViewportInsets | undefined {
  return rulersVisible ? RULER_FIT_INSETS : undefined;
}
