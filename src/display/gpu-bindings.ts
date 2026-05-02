import type { DisplaySourceBinding, DisplaySourceMode } from './bindings';

export const DISPLAY_MODE_EMPTY = 0;
export const DISPLAY_MODE_CHANNEL_RGB = 1;
export const DISPLAY_MODE_CHANNEL_MONO = 2;
export const DISPLAY_MODE_STOKES_DIRECT = 3;
export const DISPLAY_MODE_STOKES_RGB = 4;
export const DISPLAY_MODE_STOKES_RGB_LUMINANCE = 5;

export const ALPHA_OUTPUT_OPAQUE = 0;
export const ALPHA_OUTPUT_STRAIGHT = 1;
export const ALPHA_OUTPUT_PREMULTIPLIED = 2;

export type AlphaOutputMode = 'opaque' | 'straight' | 'premultiplied';

export function resolveDisplaySourceModeUniformValue(mode: DisplaySourceMode): number {
  switch (mode) {
    case 'empty':
      return DISPLAY_MODE_EMPTY;
    case 'channelRgb':
      return DISPLAY_MODE_CHANNEL_RGB;
    case 'channelMono':
      return DISPLAY_MODE_CHANNEL_MONO;
    case 'stokesDirect':
      return DISPLAY_MODE_STOKES_DIRECT;
    case 'stokesRgb':
      return DISPLAY_MODE_STOKES_RGB;
    case 'stokesRgbLuminance':
      return DISPLAY_MODE_STOKES_RGB_LUMINANCE;
  }
}

export function resolveStokesParameterUniformValue(parameter: DisplaySourceBinding['stokesParameter']): number {
  switch (parameter) {
    case 'aolp':
      return 0;
    case 'dolp':
      return 1;
    case 'dop':
      return 2;
    case 'docp':
      return 3;
    case 'cop':
      return 4;
    case 'top':
      return 5;
    case 's1_over_s0':
      return 6;
    case 's2_over_s0':
      return 7;
    case 's3_over_s0':
      return 8;
    case null:
      return -1;
  }
}

export function resolveAlphaOutputModeUniformValue(mode: AlphaOutputMode): number {
  switch (mode) {
    case 'opaque':
      return ALPHA_OUTPUT_OPAQUE;
    case 'straight':
      return ALPHA_OUTPUT_STRAIGHT;
    case 'premultiplied':
      return ALPHA_OUTPUT_PREMULTIPLIED;
  }
}
