import { DISPLAY_SOURCE_SLOT_COUNT } from '../../display/bindings';
import type { RenderPassOptions } from './types';

export const COLORMAP_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT;
export const REQUIRED_TEXTURE_UNITS = DISPLAY_SOURCE_SLOT_COUNT + 1;

export const DEFAULT_RENDER_PASS_OPTIONS: RenderPassOptions = {
  compositeCheckerboard: true,
  alphaOutputMode: 'opaque'
};
