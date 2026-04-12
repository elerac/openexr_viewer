import {
  DecodedExrImage,
  DecodedLayer,
  DisplayChannelMapping,
  DisplayLuminanceRange,
  ImagePixel,
  PixelSample,
  ViewerState,
  ZERO_CHANNEL
} from './types';

export type HistogramMode = 'luminance' | 'rgb';
export type HistogramXAxisMode = 'ev' | 'linear';
export type HistogramYAxisMode = 'sqrt' | 'log' | 'linear';
type RgbSuffix = 'R' | 'G' | 'B' | 'A';

export interface HistogramBuildOptions {
  bins?: number;
  mode?: HistogramMode;
  xAxis?: HistogramXAxisMode;
  evReference?: number;
}

export interface HistogramViewOptions {
  xAxis: HistogramXAxisMode;
  yAxis: HistogramYAxisMode;
}

export interface HistogramChannelCounts {
  r: number;
  g: number;
  b: number;
}

export interface HistogramData {
  mode: HistogramMode;
  xAxis: HistogramXAxisMode;
  bins: Float32Array;
  nonPositiveCount: number;
  channelBins: { r: Float32Array; g: Float32Array; b: Float32Array } | null;
  channelNonPositiveCounts: HistogramChannelCounts | null;
  min: number;
  max: number;
  mean: number;
  channelMeans: HistogramChannelCounts | null;
  evReference: number;
}

export interface RgbChannelGroup {
  key: string;
  label: string;
  r: string;
  g: string;
  b: string;
  a?: string;
}

const HISTOGRAM_DEFAULT_EV_REFERENCE = 1;
const HISTOGRAM_EPSILON = 1e-12;
const HISTOGRAM_NORMALIZATION_PERCENTILE = 0.995;

export function createInitialState(): ViewerState {
  return {
    exposureEv: 0,
    visualizationMode: 'rgb',
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    zoom: 1,
    panX: 0,
    panY: 0,
    activeLayer: 0,
    displayR: ZERO_CHANNEL,
    displayG: ZERO_CHANNEL,
    displayB: ZERO_CHANNEL,
    hoveredPixel: null,
    lockedPixel: null
  };
}

export function buildSessionDisplayName(filename: string, existingFilenames: string[]): string {
  const duplicateCount = existingFilenames.reduce((count, current) => {
    return count + (current === filename ? 1 : 0);
  }, 0);

  if (duplicateCount === 0) {
    return filename;
  }

  return `${filename} (${duplicateCount + 1})`;
}

export function pickNextSessionIndexAfterRemoval(removedIndex: number, remainingCount: number): number {
  if (removedIndex < 0 || remainingCount <= 0) {
    return -1;
  }
  return Math.min(removedIndex, remainingCount - 1);
}

export function persistActiveSessionState<T extends { id: string; state: ViewerState }>(
  sessions: T[],
  activeSessionId: string | null,
  state: ViewerState
): void {
  if (!activeSessionId) {
    return;
  }

  const session = sessions.find((item) => item.id === activeSessionId);
  if (!session) {
    return;
  }

  session.state = { ...state };
}

export class ViewerStore {
  private state: ViewerState;
  private listeners = new Set<(state: ViewerState, previous: ViewerState) => void>();

  constructor(initialState: ViewerState) {
    this.state = initialState;
  }

  getState(): ViewerState {
    return this.state;
  }

  setState(patch: Partial<ViewerState>): void {
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state, previous);
    }
  }

  subscribe(listener: (state: ViewerState, previous: ViewerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function pickValidLayerIndex(layerCount: number, requestedIndex: number): number {
  if (layerCount <= 0) {
    return 0;
  }

  const resolvedIndex = Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0;
  return Math.min(layerCount - 1, Math.max(0, resolvedIndex));
}

export function buildViewerStateForLayer(
  currentState: ViewerState,
  decoded: DecodedExrImage,
  requestedLayerIndex: number = currentState.activeLayer
): ViewerState {
  const activeLayer = pickValidLayerIndex(decoded.layers.length, requestedLayerIndex);
  const layer = decoded.layers[activeLayer];
  if (!layer) {
    return {
      ...currentState,
      activeLayer: 0,
      displayR: ZERO_CHANNEL,
      displayG: ZERO_CHANNEL,
      displayB: ZERO_CHANNEL
    };
  }

  return {
    ...currentState,
    activeLayer,
    ...resolveDisplayChannelsForLayer(layer.channelNames, currentState)
  };
}

export function areDisplayChannelsAvailable(
  channelNames: string[],
  selection: DisplayChannelMapping
): boolean {
  const channels = new Set(channelNames);
  const isAvailable = (channelName: string): boolean => channelName === ZERO_CHANNEL || channels.has(channelName);
  return (
    isAvailable(selection.displayR) &&
    isAvailable(selection.displayG) &&
    isAvailable(selection.displayB)
  );
}

export function pickDefaultDisplayChannels(channelNames: string[]): DisplayChannelMapping {
  const names = [...channelNames];
  const rgbGroups = extractRgbChannelGroups(names);
  if (rgbGroups.length > 0) {
    const firstGroup = rgbGroups[0];
    return {
      displayR: firstGroup.r,
      displayG: firstGroup.g,
      displayB: firstGroup.b
    };
  }

  const grayscaleChannel = pickGrayscaleDisplayChannel(names);
  if (grayscaleChannel) {
    return {
      displayR: grayscaleChannel,
      displayG: grayscaleChannel,
      displayB: grayscaleChannel
    };
  }

  return {
    displayR: names[0] ?? ZERO_CHANNEL,
    displayG: names[1] ?? ZERO_CHANNEL,
    displayB: names[2] ?? ZERO_CHANNEL
  };
}

export function resolveDisplayChannelsForLayer(
  channelNames: string[],
  currentSelection: DisplayChannelMapping
): DisplayChannelMapping {
  const hasNonZeroSelection =
    currentSelection.displayR !== ZERO_CHANNEL ||
    currentSelection.displayG !== ZERO_CHANNEL ||
    currentSelection.displayB !== ZERO_CHANNEL;

  if (hasNonZeroSelection && areDisplayChannelsAvailable(channelNames, currentSelection)) {
    return {
      displayR: currentSelection.displayR,
      displayG: currentSelection.displayG,
      displayB: currentSelection.displayB
    };
  }

  return pickDefaultDisplayChannels(channelNames);
}

export function extractRgbChannelGroups(channelNames: string[]): RgbChannelGroup[] {
  const grouped = new Map<string, Partial<Record<RgbSuffix, string>>>();

  for (const channelName of channelNames) {
    const parsed = parseRgbChannel(channelName);
    if (!parsed) {
      continue;
    }

    const group = grouped.get(parsed.base) ?? {};
    if (!group[parsed.suffix]) {
      group[parsed.suffix] = channelName;
      grouped.set(parsed.base, group);
    }
  }

  const groups: RgbChannelGroup[] = [];
  for (const [base, channels] of grouped.entries()) {
    if (!channels.R || !channels.G || !channels.B) {
      continue;
    }

    groups.push({
      key: base,
      label: buildRgbGroupLabel(base, Boolean(channels.A)),
      r: channels.R,
      g: channels.G,
      b: channels.B,
      a: channels.A
    });
  }

  groups.sort((a, b) => {
    if (a.key.length === 0) {
      return -1;
    }
    if (b.key.length === 0) {
      return 1;
    }
    return a.key.localeCompare(b.key);
  });

  return groups;
}

export function findSelectedRgbGroup(
  groups: RgbChannelGroup[],
  displayR: string,
  displayG: string,
  displayB: string
): RgbChannelGroup | null {
  return groups.find((group) => group.r === displayR && group.g === displayG && group.b === displayB) ?? null;
}

export function buildDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  displayR: string,
  displayG: string,
  displayB: string,
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const out = output && output.length === requiredLength ? output : new Float32Array(requiredLength);

  const channelR = getChannel(layer, displayR);
  const channelG = getChannel(layer, displayG);
  const channelB = getChannel(layer, displayB);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outIndex = pixelIndex * 4;
    out[outIndex + 0] = sanitizeDisplayValue(readChannelValue(channelR, pixelIndex));
    out[outIndex + 1] = sanitizeDisplayValue(readChannelValue(channelG, pixelIndex));
    out[outIndex + 2] = sanitizeDisplayValue(readChannelValue(channelB, pixelIndex));
    out[outIndex + 3] = 1;
  }

  return out;
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

export function sanitizeDisplayValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function samplePixelValues(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel
): PixelSample | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  const values: Record<string, number> = {};

  for (const channelName of layer.channelNames) {
    const channel = layer.channelData.get(channelName);
    if (!channel) {
      continue;
    }
    values[channelName] = channel[flatIndex];
  }

  return {
    x: pixel.ix,
    y: pixel.iy,
    values
  };
}

export function formatScientific(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return value.toExponential(5);
}

export function buildDisplayHistogram(
  displayTexture: Float32Array,
  options: HistogramBuildOptions = {}
): HistogramData {
  const resolvedOptions = resolveHistogramBuildOptions(options);
  if (resolvedOptions.mode === 'rgb') {
    return buildRgbHistogram(displayTexture, resolvedOptions);
  }
  return buildLuminanceHistogram(displayTexture, resolvedOptions);
}

export function buildLayerDisplayHistogram(
  layer: DecodedLayer,
  width: number,
  height: number,
  displayR: string,
  displayG: string,
  displayB: string,
  options: HistogramBuildOptions = {}
): HistogramData {
  const resolvedOptions = resolveHistogramBuildOptions(options);
  const pixelCount = width * height;
  const channelR = getChannel(layer, displayR);
  const channelG = getChannel(layer, displayG);
  const channelB = getChannel(layer, displayB);

  if (resolvedOptions.mode === 'rgb') {
    return buildRgbHistogramFromChannels(channelR, channelG, channelB, pixelCount, resolvedOptions);
  }

  return buildLuminanceHistogramFromChannels(channelR, channelG, channelB, pixelCount, resolvedOptions);
}

export function computeHistogramRenderCeiling(histogram: HistogramData): number {
  const positiveValues = collectHistogramPositiveCounts(histogram);
  if (positiveValues.length === 0) {
    return 0;
  }

  positiveValues.sort((a, b) => a - b);
  const quantileIndex = Math.max(
    0,
    Math.min(
      positiveValues.length - 1,
      Math.floor((positiveValues.length - 1) * HISTOGRAM_NORMALIZATION_PERCENTILE)
    )
  );
  return positiveValues[quantileIndex] ?? 0;
}

export function scaleHistogramCount(count: number, ceiling: number, mode: HistogramYAxisMode): number {
  if (ceiling <= 0 || count <= 0) {
    return 0;
  }

  const clampedCount = Math.min(count, ceiling);
  if (mode === 'linear') {
    return clampedCount / ceiling;
  }
  if (mode === 'log') {
    return Math.log1p(clampedCount) / Math.log1p(ceiling);
  }
  return Math.sqrt(clampedCount) / Math.sqrt(ceiling);
}

function buildLuminanceHistogram(
  displayTexture: Float32Array,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const histogram = new Float32Array(options.bins);
  let nonPositiveCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sum = 0;
  let hasDomainSamples = false;

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    sum += luminance;

    if (options.xAxis === 'ev') {
      if (luminance <= 0) {
        nonPositiveCount += 1;
        continue;
      }
    }

    const domainValue = mapValueToHistogramDomain(luminance, options);
    if (domainValue < min) {
      min = domainValue;
    }
    if (domainValue > max) {
      max = domainValue;
    }
    hasDomainSamples = true;
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('luminance', options);
  }

  const flatBucket = Math.floor(histogram.length / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    if (options.xAxis === 'ev' && luminance <= 0) {
      continue;
    }

    addValueToBins(luminance, histogram, min, max, flatBucket, options);
  }

  return {
    mode: 'luminance',
    xAxis: options.xAxis,
    bins: histogram,
    nonPositiveCount,
    channelBins: null,
    channelNonPositiveCounts: null,
    min,
    max,
    mean: sum / finiteCount,
    channelMeans: null,
    evReference: options.evReference
  };
}

function buildRgbHistogram(
  displayTexture: Float32Array,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const binsR = new Float32Array(options.bins);
  const binsG = new Float32Array(options.bins);
  const binsB = new Float32Array(options.bins);
  const channelNonPositiveCounts: HistogramChannelCounts = { r: 0, g: 0, b: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let countR = 0;
  let countG = 0;
  let countB = 0;
  let hasDomainSamples = false;

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];

    if (Number.isFinite(r)) {
      finiteCount += 1;
      sumR += r;
      countR += 1;

      if (options.xAxis === 'ev' && r <= 0) {
        channelNonPositiveCounts.r += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(r, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(g)) {
      finiteCount += 1;
      sumG += g;
      countG += 1;

      if (options.xAxis === 'ev' && g <= 0) {
        channelNonPositiveCounts.g += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(g, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(b)) {
      finiteCount += 1;
      sumB += b;
      countB += 1;

      if (options.xAxis === 'ev' && b <= 0) {
        channelNonPositiveCounts.b += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(b, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('rgb', options);
  }

  const flatBucket = Math.floor(options.bins / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let i = 0; i < displayTexture.length; i += 4) {
    const r = displayTexture[i + 0];
    const g = displayTexture[i + 1];
    const b = displayTexture[i + 2];

    if (Number.isFinite(r) && !(options.xAxis === 'ev' && r <= 0)) {
      addValueToBins(r, binsR, min, max, flatBucket, options);
    }
    if (Number.isFinite(g) && !(options.xAxis === 'ev' && g <= 0)) {
      addValueToBins(g, binsG, min, max, flatBucket, options);
    }
    if (Number.isFinite(b) && !(options.xAxis === 'ev' && b <= 0)) {
      addValueToBins(b, binsB, min, max, flatBucket, options);
    }
  }

  const merged = new Float32Array(options.bins);
  for (let i = 0; i < options.bins; i += 1) {
    merged[i] = Math.max(binsR[i], binsG[i], binsB[i]);
  }

  const meanR = countR > 0 ? sumR / countR : 0;
  const meanG = countG > 0 ? sumG / countG : 0;
  const meanB = countB > 0 ? sumB / countB : 0;
  const meanContributors = (countR > 0 ? 1 : 0) + (countG > 0 ? 1 : 0) + (countB > 0 ? 1 : 0);
  const mean = meanContributors > 0 ? (meanR + meanG + meanB) / meanContributors : 0;

  return {
    mode: 'rgb',
    xAxis: options.xAxis,
    bins: merged,
    nonPositiveCount: Math.max(
      channelNonPositiveCounts.r,
      channelNonPositiveCounts.g,
      channelNonPositiveCounts.b
    ),
    channelBins: { r: binsR, g: binsG, b: binsB },
    channelNonPositiveCounts,
    min,
    max,
    mean,
    channelMeans: { r: meanR, g: meanG, b: meanB },
    evReference: options.evReference
  };
}

function buildLuminanceHistogramFromChannels(
  channelR: Float32Array | null,
  channelG: Float32Array | null,
  channelB: Float32Array | null,
  pixelCount: number,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const histogram = new Float32Array(options.bins);
  let nonPositiveCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sum = 0;
  let hasDomainSamples = false;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    sum += luminance;

    if (options.xAxis === 'ev' && luminance <= 0) {
      nonPositiveCount += 1;
      continue;
    }

    const domainValue = mapValueToHistogramDomain(luminance, options);
    if (domainValue < min) {
      min = domainValue;
    }
    if (domainValue > max) {
      max = domainValue;
    }
    hasDomainSamples = true;
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('luminance', options);
  }

  const flatBucket = Math.floor(histogram.length / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (!Number.isFinite(luminance)) {
      continue;
    }

    if (options.xAxis === 'ev' && luminance <= 0) {
      continue;
    }

    addValueToBins(luminance, histogram, min, max, flatBucket, options);
  }

  return {
    mode: 'luminance',
    xAxis: options.xAxis,
    bins: histogram,
    nonPositiveCount,
    channelBins: null,
    channelNonPositiveCounts: null,
    min,
    max,
    mean: sum / finiteCount,
    channelMeans: null,
    evReference: options.evReference
  };
}

function buildRgbHistogramFromChannels(
  channelR: Float32Array | null,
  channelG: Float32Array | null,
  channelB: Float32Array | null,
  pixelCount: number,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const binsR = new Float32Array(options.bins);
  const binsG = new Float32Array(options.bins);
  const binsB = new Float32Array(options.bins);
  const channelNonPositiveCounts: HistogramChannelCounts = { r: 0, g: 0, b: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let countR = 0;
  let countG = 0;
  let countB = 0;
  let hasDomainSamples = false;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);

    if (Number.isFinite(r)) {
      finiteCount += 1;
      sumR += r;
      countR += 1;

      if (options.xAxis === 'ev' && r <= 0) {
        channelNonPositiveCounts.r += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(r, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(g)) {
      finiteCount += 1;
      sumG += g;
      countG += 1;

      if (options.xAxis === 'ev' && g <= 0) {
        channelNonPositiveCounts.g += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(g, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }

    if (Number.isFinite(b)) {
      finiteCount += 1;
      sumB += b;
      countB += 1;

      if (options.xAxis === 'ev' && b <= 0) {
        channelNonPositiveCounts.b += 1;
      } else {
        const domainValue = mapValueToHistogramDomain(b, options);
        if (domainValue < min) {
          min = domainValue;
        }
        if (domainValue > max) {
          max = domainValue;
        }
        hasDomainSamples = true;
      }
    }
  }

  if (finiteCount === 0) {
    return createEmptyHistogramData('rgb', options);
  }

  const flatBucket = Math.floor(options.bins / 2);
  if (!hasDomainSamples) {
    const fallbackDomain = createFallbackHistogramDomain(options.xAxis);
    min = fallbackDomain.min;
    max = fallbackDomain.max;
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const r = readChannelValue(channelR, pixelIndex);
    const g = readChannelValue(channelG, pixelIndex);
    const b = readChannelValue(channelB, pixelIndex);

    if (Number.isFinite(r) && !(options.xAxis === 'ev' && r <= 0)) {
      addValueToBins(r, binsR, min, max, flatBucket, options);
    }
    if (Number.isFinite(g) && !(options.xAxis === 'ev' && g <= 0)) {
      addValueToBins(g, binsG, min, max, flatBucket, options);
    }
    if (Number.isFinite(b) && !(options.xAxis === 'ev' && b <= 0)) {
      addValueToBins(b, binsB, min, max, flatBucket, options);
    }
  }

  const merged = new Float32Array(options.bins);
  for (let i = 0; i < options.bins; i += 1) {
    merged[i] = Math.max(binsR[i], binsG[i], binsB[i]);
  }

  const meanR = countR > 0 ? sumR / countR : 0;
  const meanG = countG > 0 ? sumG / countG : 0;
  const meanB = countB > 0 ? sumB / countB : 0;
  const meanContributors = (countR > 0 ? 1 : 0) + (countG > 0 ? 1 : 0) + (countB > 0 ? 1 : 0);
  const mean = meanContributors > 0 ? (meanR + meanG + meanB) / meanContributors : 0;

  return {
    mode: 'rgb',
    xAxis: options.xAxis,
    bins: merged,
    nonPositiveCount: Math.max(
      channelNonPositiveCounts.r,
      channelNonPositiveCounts.g,
      channelNonPositiveCounts.b
    ),
    channelBins: { r: binsR, g: binsG, b: binsB },
    channelNonPositiveCounts,
    min,
    max,
    mean,
    channelMeans: { r: meanR, g: meanG, b: meanB },
    evReference: options.evReference
  };
}

function addValueToBins(
  value: number,
  bins: Float32Array,
  min: number,
  max: number,
  flatBucket: number,
  options: Required<HistogramBuildOptions>
): void {
  if (!Number.isFinite(value)) {
    return;
  }

  const bucket = valueToBucket(value, bins.length, min, max, flatBucket, options);
  bins[bucket] += 1;
}

function valueToBucket(
  value: number,
  binCount: number,
  min: number,
  max: number,
  flatBucket: number,
  options: Required<HistogramBuildOptions>
): number {
  if (max - min <= HISTOGRAM_EPSILON) {
    return flatBucket;
  }

  const domainValue = mapValueToHistogramDomain(value, options);
  const unit = clampUnit((domainValue - min) / (max - min));
  const scaled = Math.floor(unit * binCount);
  return Math.min(binCount - 1, Math.max(0, scaled));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveHistogramBuildOptions(options: HistogramBuildOptions): Required<HistogramBuildOptions> {
  return {
    bins: Math.max(2, Math.floor(options.bins ?? 64)),
    mode: options.mode ?? 'luminance',
    xAxis: options.xAxis ?? 'ev',
    evReference: options.evReference && options.evReference > 0 ? options.evReference : HISTOGRAM_DEFAULT_EV_REFERENCE
  };
}

function mapValueToHistogramDomain(value: number, options: Required<HistogramBuildOptions>): number {
  if (options.xAxis === 'linear') {
    return value;
  }
  return Math.log2(value / options.evReference);
}

function collectHistogramPositiveCounts(histogram: HistogramData): number[] {
  const positiveValues: number[] = [];

  if (histogram.channelBins && histogram.channelNonPositiveCounts) {
    pushPositiveCounts(positiveValues, histogram.channelBins.r);
    pushPositiveCounts(positiveValues, histogram.channelBins.g);
    pushPositiveCounts(positiveValues, histogram.channelBins.b);
    pushPositiveCount(positiveValues, histogram.channelNonPositiveCounts.r);
    pushPositiveCount(positiveValues, histogram.channelNonPositiveCounts.g);
    pushPositiveCount(positiveValues, histogram.channelNonPositiveCounts.b);
    return positiveValues;
  }

  pushPositiveCounts(positiveValues, histogram.bins);
  pushPositiveCount(positiveValues, histogram.nonPositiveCount);
  return positiveValues;
}

function pushPositiveCounts(output: number[], bins: Float32Array): void {
  for (let i = 0; i < bins.length; i += 1) {
    pushPositiveCount(output, bins[i]);
  }
}

function pushPositiveCount(output: number[], value: number): void {
  if (value > 0) {
    output.push(value);
  }
}

function createEmptyHistogramData(
  mode: HistogramMode,
  options: Required<HistogramBuildOptions>
): HistogramData {
  const emptyBins = new Float32Array(options.bins);
  return {
    mode,
    xAxis: options.xAxis,
    bins: emptyBins,
    nonPositiveCount: 0,
    channelBins:
      mode === 'rgb'
        ? {
            r: new Float32Array(options.bins),
            g: new Float32Array(options.bins),
            b: new Float32Array(options.bins)
          }
        : null,
    channelNonPositiveCounts: mode === 'rgb' ? { r: 0, g: 0, b: 0 } : null,
    min: createFallbackHistogramDomain(options.xAxis).min,
    max: createFallbackHistogramDomain(options.xAxis).max,
    mean: 0,
    channelMeans: mode === 'rgb' ? { r: 0, g: 0, b: 0 } : null,
    evReference: options.evReference
  };
}

function createFallbackHistogramDomain(xAxis: HistogramXAxisMode): { min: number; max: number } {
  if (xAxis === 'ev') {
    return { min: -1, max: 1 };
  }
  return { min: 0, max: 1 };
}

export function samePixel(a: ImagePixel | null, b: ImagePixel | null): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
}

function getChannel(layer: DecodedLayer, channelName: string): Float32Array | null {
  if (channelName === ZERO_CHANNEL) {
    return null;
  }
  return layer.channelData.get(channelName) ?? null;
}

function readChannelValue(channel: Float32Array | null, pixelIndex: number): number {
  return channel ? channel[pixelIndex] ?? 0 : 0;
}

function parseRgbChannel(channelName: string): { base: string; suffix: RgbSuffix } | null {
  if (channelName === 'R' || channelName === 'G' || channelName === 'B' || channelName === 'A') {
    return {
      base: '',
      suffix: channelName
    };
  }

  const dotIndex = channelName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= channelName.length - 1) {
    return null;
  }

  const suffix = channelName.slice(dotIndex + 1);
  if (suffix !== 'R' && suffix !== 'G' && suffix !== 'B' && suffix !== 'A') {
    return null;
  }

  return {
    base: channelName.slice(0, dotIndex),
    suffix
  };
}

function buildRgbGroupLabel(base: string, hasAlpha: boolean): string {
  const channelsLabel = hasAlpha ? 'R,G,B,A' : 'R,G,B';
  return base.length > 0 ? `${base}.(${channelsLabel})` : channelsLabel;
}

function pickGrayscaleDisplayChannel(channelNames: string[]): string | null {
  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  const nonAlphaChannels = channelNames.filter((channelName) => !isAlphaChannel(channelName));
  return nonAlphaChannels.length === 1 ? nonAlphaChannels[0] ?? null : null;
}

function isAlphaChannel(channelName: string): boolean {
  return channelName === 'A' || channelName.endsWith('.A');
}
