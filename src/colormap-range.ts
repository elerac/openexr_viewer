import {
  getStokesColormapDefaultGroup,
  getStokesDisplayColormapDefault
} from './stokes';
import {
  DisplayLuminanceRange,
  DisplaySelection,
  ViewerState
} from './types';

export function cloneDisplayLuminanceRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
  return range ? { min: range.min, max: range.max } : null;
}

export function sameDisplayLuminanceRange(
  a: DisplayLuminanceRange | null,
  b: DisplayLuminanceRange | null
): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.min === b.min && a.max === b.max;
}

export function buildZeroCenteredColormapRange(
  range: DisplayLuminanceRange | null,
  fallbackMagnitude = 1
): DisplayLuminanceRange | null {
  if (!range) {
    return null;
  }

  const magnitude = Math.max(Math.abs(range.min), Math.abs(range.max));
  const fallback = Number.isFinite(fallbackMagnitude) && fallbackMagnitude > 0 ? fallbackMagnitude : 1;
  const value = Number.isFinite(magnitude) && magnitude > 0 ? magnitude : fallback;
  return { min: -value, max: value };
}

export function resolveColormapAutoRange(
  selection: DisplaySelection | null,
  imageRange: DisplayLuminanceRange | null,
  zeroCentered: boolean
): DisplayLuminanceRange | null {
  const stokesDefault = getStokesDisplayColormapDefault(selection);
  const sourceRange = stokesDefault?.range ?? imageRange;

  return zeroCentered
    ? buildZeroCenteredColormapRange(sourceRange)
    : cloneDisplayLuminanceRange(sourceRange);
}

export function shouldPreserveStokesColormapState(
  previous: DisplaySelection | null,
  next: DisplaySelection | null
): boolean {
  if (!previous || !next || previous.kind === 'channelRgb' || previous.kind === 'channelMono') {
    return false;
  }

  if (next.kind === 'channelRgb' || next.kind === 'channelMono') {
    return false;
  }

  return getStokesColormapDefaultGroup(previous.parameter) ===
    getStokesColormapDefaultGroup(next.parameter);
}

export function computeDisplayTextureLuminanceRange(
  displayTexture: Float32Array
): DisplayLuminanceRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    if (luminance < min) {
      min = luminance;
    }
    if (luminance > max) {
      max = luminance;
    }
  }

  if (finiteCount === 0) {
    return null;
  }

  return { min, max };
}

export function shouldRefreshDisplayLuminanceRange(
  visualizationMode: ViewerState['visualizationMode'],
  textureRevisionKey: string,
  displayLuminanceRangeRevisionKey: string,
  hasDisplayTexture: boolean
): boolean {
  return (
    visualizationMode === 'colormap' &&
    hasDisplayTexture &&
    displayLuminanceRangeRevisionKey !== textureRevisionKey
  );
}
