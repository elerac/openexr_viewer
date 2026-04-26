import { DISPLAY_SOURCE_SLOT_COUNT } from '../../display-texture';
import type { RenderPassOptions } from './types';

export const COLORMAP_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT;
export const REQUIRED_TEXTURE_UNITS = DISPLAY_SOURCE_SLOT_COUNT + 1;

export const ALPHA_OUTPUT_OPAQUE = 0;
export const ALPHA_OUTPUT_STRAIGHT = 1;
export const ALPHA_OUTPUT_PREMULTIPLIED = 2;

export const DEFAULT_RENDER_PASS_OPTIONS: RenderPassOptions = {
  compositeCheckerboard: true,
  alphaOutputMode: 'opaque'
};
