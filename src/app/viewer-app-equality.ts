import { sameDisplayLuminanceRange } from '../colormap-range';
import { sameDisplaySelection } from '../display-model';
import type { ProbeColorPreview, ProbeDisplayValue } from '../probe';
import type { PixelSample, ViewerSessionState } from '../types';
import { samePixel, sameViewState } from '../view-state';
import type {
  ProbeReadoutModel,
  StokesDegreeModulationControlModel,
  ViewerDisplayRangeRequest,
  ViewerLayerOption,
  ViewerOpenedImageOption,
  ViewerResourceTarget
} from './viewer-app-types';

export function sameViewerSessionState(a: ViewerSessionState, b: ViewerSessionState): boolean {
  return (
    a.exposureEv === b.exposureEv &&
    a.viewerMode === b.viewerMode &&
    a.visualizationMode === b.visualizationMode &&
    a.activeColormapId === b.activeColormapId &&
    sameDisplayLuminanceRange(a.colormapRange, b.colormapRange) &&
    a.colormapRangeMode === b.colormapRangeMode &&
    a.colormapZeroCentered === b.colormapZeroCentered &&
    a.stokesDegreeModulation.aolp === b.stokesDegreeModulation.aolp &&
    a.stokesDegreeModulation.cop === b.stokesDegreeModulation.cop &&
    a.stokesDegreeModulation.top === b.stokesDegreeModulation.top &&
    sameViewState(a, b) &&
    a.activeLayer === b.activeLayer &&
    sameDisplaySelection(a.displaySelection, b.displaySelection) &&
    samePixel(a.lockedPixel, b.lockedPixel)
  );
}

export function sameOpenedImageOptions(a: ViewerOpenedImageOption[], b: ViewerOpenedImageOption[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => {
    const other = b[index];
    return Boolean(other)
      && item.id === other.id
      && item.label === other.label
      && item.sizeBytes === other.sizeBytes
      && item.sourceDetail === other.sourceDetail
      && item.thumbnailDataUrl === other.thumbnailDataUrl;
  });
}

export function sameLayerOptions(a: ViewerLayerOption[], b: ViewerLayerOption[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => {
    const other = b[index];
    return Boolean(other)
      && item.index === other.index
      && item.label === other.label
      && item.channelCount === other.channelCount;
  });
}

export function sameColormapOptions(
  a: Array<{ id: string; label: string }>,
  b: Array<{ id: string; label: string }>
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item.id === b[index]?.id && item.label === b[index]?.label);
}

export function sameExportTarget(
  a: { filename: string } | null,
  b: { filename: string } | null
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.filename === b.filename;
}

export function sameStokesControl(
  a: StokesDegreeModulationControlModel | null,
  b: StokesDegreeModulationControlModel | null
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.label === b.label && a.enabled === b.enabled;
}

export function sameMetadata(
  a: Array<{ key: string; value: string }> | null,
  b: Array<{ key: string; value: string }> | null
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item.key === b[index]?.key && item.value === b[index]?.value);
}

export function sameProbeReadout(a: ProbeReadoutModel, b: ProbeReadoutModel): boolean {
  return (
    a.mode === b.mode &&
    samePixel(
      a.sample ? { ix: a.sample.x, iy: a.sample.y } : null,
      b.sample ? { ix: b.sample.x, iy: b.sample.y } : null
    ) &&
    samePixelSample(a.sample, b.sample) &&
    sameProbeColorPreview(a.colorPreview, b.colorPreview) &&
    sameImageSize(a.imageSize, b.imageSize)
  );
}

export function sameResourceTarget(a: ViewerResourceTarget | null, b: ViewerResourceTarget | null): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return (
    a.sessionId === b.sessionId &&
    a.activeLayer === b.activeLayer &&
    sameDisplaySelection(a.displaySelection, b.displaySelection)
  );
}

export function sameDisplayRangeRequest(
  a: ViewerDisplayRangeRequest | null,
  b: ViewerDisplayRangeRequest | null
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.requestKey === b.requestKey && sameResourceTarget(a, b);
}

function sameProbeColorPreview(a: ProbeColorPreview | null, b: ProbeColorPreview | null): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.cssColor === b.cssColor && sameProbeDisplayValues(a.displayValues, b.displayValues);
}

function sameProbeDisplayValues(a: ProbeDisplayValue[], b: ProbeDisplayValue[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item.label === b[index]?.label && item.value === b[index]?.value);
}

function samePixelSample(a: PixelSample | null, b: PixelSample | null): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  if (a.x !== b.x || a.y !== b.y) {
    return false;
  }

  return sameSampleValues(a.values, b.values);
}

function sameSampleValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key) => b[key] === a[key]);
}

function sameImageSize(
  a: { width: number; height: number } | null,
  b: { width: number; height: number } | null
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.width === b.width && a.height === b.height;
}
