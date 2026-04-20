import { ColormapLut, mapValueToColormapRgbBytes, modulateRgbBytesValue } from './colormaps';
import {
  clampStokesDegreeModulationValue,
  createDefaultStokesDegreeModulation,
  getStokesDegreeModulationDisplayValueLabel,
  getStokesDegreeModulationLabel,
  getStokesDisplayValueLabel,
  getStokesParameterLabel,
  isStokesDegreeModulationEnabled
} from './state';
import {
  DisplaySelection,
  DisplayLuminanceRange,
  ImagePixel,
  PixelSample,
  StokesDegreeModulationState,
  VisualizationMode,
  ZERO_CHANNEL
} from './types';

export interface ProbeColorPreview {
  cssColor: string;
  displayValues: ProbeDisplayValue[];
}

export interface ProbeDisplayValue {
  label: string;
  value: string;
}

export interface ProbeVisualizationOptions {
  mode: VisualizationMode;
  colormapRange: DisplayLuminanceRange | null;
  colormapLut?: ColormapLut | null;
  stokesDegreeModulation?: StokesDegreeModulationState;
}

export function resolveActiveProbePixel(
  lockedPixel: ImagePixel | null,
  hoveredPixel: ImagePixel | null
): ImagePixel | null {
  return lockedPixel ?? hoveredPixel;
}

export function resolveProbeMode(lockedPixel: ImagePixel | null): 'Hover' | 'Locked' {
  return lockedPixel ? 'Locked' : 'Hover';
}

export function buildProbeColorPreview(
  sample: PixelSample | null,
  selection: DisplaySelection,
  exposureEv: number,
  visualization: ProbeVisualizationOptions = { mode: 'rgb', colormapRange: null }
): ProbeColorPreview | null {
  if (!sample) {
    return null;
  }

  const [rawR, rawG, rawB] = readProbeDisplayValues(sample, selection);
  const rawA = readProbeDisplayAlpha(sample, selection);
  const exposureScale = 2 ** exposureEv;
  let bytes: [number, number, number];
  const monoValue = computeProbeLuminanceValue(rawR, rawG, rawB);
  let displayValues: ProbeDisplayValue[];
  if (visualization.mode === 'colormap') {
    bytes = mapValueToColormapRgbBytes(
      monoValue,
      visualization.colormapRange,
      visualization.colormapLut ?? null
    );
    displayValues = [{ label: 'Mono', value: formatProbeRgbValue(monoValue) }];

    const stokesDegreeModulation =
      visualization.stokesDegreeModulation ?? createDefaultStokesDegreeModulation();
    if (isStokesDegreeModulationEnabled(selection, stokesDegreeModulation)) {
      bytes = modulateRgbBytesValue(bytes, readProbeStokesDegreeModulationValue(sample, selection));
    }
  } else {
    bytes = [
      toSrgbByte(rawR * exposureScale),
      toSrgbByte(rawG * exposureScale),
      toSrgbByte(rawB * exposureScale)
    ];
    displayValues = isSingleChannelDisplay(selection)
      ? [{ label: 'Mono', value: formatProbeRgbValue(rawR) }]
      : [
          { label: 'R', value: formatProbeRgbValue(rawR) },
          { label: 'G', value: formatProbeRgbValue(rawG) },
          { label: 'B', value: formatProbeRgbValue(rawB) }
        ];
  }

  if (rawA !== null) {
    displayValues = [
      ...displayValues,
      { label: 'A', value: formatProbeRgbValue(rawA) }
    ];
  }

  return {
    cssColor: rawA === null
      ? `rgb(${bytes[0]}, ${bytes[1]}, ${bytes[2]})`
      : `rgba(${bytes[0]}, ${bytes[1]}, ${bytes[2]}, ${formatCssAlpha(rawA)})`,
    displayValues
  };
}

function computeProbeLuminanceValue(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isSingleChannelDisplay(selection: DisplaySelection): boolean {
  return selection.displayR === selection.displayG && selection.displayG === selection.displayB;
}

function readProbeDisplayValues(sample: PixelSample, selection: DisplaySelection): [number, number, number] {
  if (selection.displaySource !== 'channels' && selection.stokesParameter) {
    const value = readFirstProbeChannel(sample, [
      getStokesDisplayValueLabel(selection),
      getStokesParameterLabel(selection.stokesParameter)
    ]);
    return [value, value, value];
  }

  return [
    readProbeChannel(sample, selection.displayR),
    readProbeChannel(sample, selection.displayG),
    readProbeChannel(sample, selection.displayB)
  ];
}

function readProbeDisplayAlpha(sample: PixelSample, selection: DisplaySelection): number | null {
  if (selection.displaySource !== 'channels' || !selection.displayA) {
    return null;
  }

  return clampAlpha(readProbeChannel(sample, selection.displayA));
}

function readFirstProbeChannel(sample: PixelSample, channelNames: Array<string | null>): number {
  for (const channelName of channelNames) {
    if (!channelName || !(channelName in sample.values)) {
      continue;
    }
    return readProbeChannel(sample, channelName);
  }

  return 0;
}

function readProbeChannel(sample: PixelSample, channelName: string): number {
  if (channelName === ZERO_CHANNEL) {
    return 0;
  }

  const value = sample.values[channelName];
  return Number.isFinite(value) ? value : 0;
}

function readProbeStokesDegreeModulationValue(sample: PixelSample, selection: DisplaySelection): number {
  return clampStokesDegreeModulationValue(
    readFirstProbeChannel(sample, [
      getStokesDegreeModulationDisplayValueLabel(selection),
      getStokesDegreeModulationLabel(selection.stokesParameter)
    ])
  );
}

function toSrgbByte(value: number): number {
  const linear = Math.max(0, value);
  const srgb =
    linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;

  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function formatCssAlpha(value: number): string {
  return Number(clampAlpha(value).toPrecision(4)).toString();
}

function formatProbeRgbValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  if (value === 0) {
    return '0';
  }

  return Number(value.toPrecision(4)).toString();
}
