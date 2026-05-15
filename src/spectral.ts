import {
  getDisplaySelectionOptionLabel,
  getStokesParameterLabel,
  isAlphaChannel,
  isSpectralRgbSelection,
  type DisplaySelection,
  type SpectralRgbSelection,
  type StokesParameter
} from './display-model';
import { computeRawStokesDisplayValue } from './stokes/stokes-display';
import type { DisplayChannelMapping, PixelSample } from './types';

export interface SpectralChannel {
  channelName: string;
  wavelength: number;
  seriesKey: string;
  seriesLabel: string;
}

export interface SpectralPlotPoint extends SpectralChannel {
  intensity: number;
}

export interface SpectralStokesChannelGroup {
  wavelength: number;
  suffix: string;
  s0: string;
  s1: string;
  s2: string;
  s3: string;
}

export interface SpectralRgbDisplayOption {
  key: string;
  label: string;
  selection: SpectralRgbSelection;
  mapping: DisplayChannelMapping;
}

interface IndexedSpectralChannel extends SpectralChannel {
  index: number;
}

export type SpectralStokesComponent = 'S0' | 'S1' | 'S2' | 'S3';

interface IndexedSpectralStokesChannel {
  channelName: string;
  component: SpectralStokesComponent;
  wavelength: number;
  suffix: string;
}

interface SpectralSeriesCandidate {
  key: string;
  channels: IndexedSpectralChannel[];
  firstIndex: number;
}

interface SpectralStokesSeriesCandidate {
  wavelength: number;
  suffix: string;
  channels: Partial<Record<SpectralStokesComponent, string>>;
}

const DEFAULT_SPECTRAL_SERIES_LABEL = '';
const JCGT_SPECTRAL_CHANNEL_PATTERN = /^((?:S[0-3]|T))\.(\d+(?:,\d+)?(?:[eE][-+]?\d+)?)nm$/i;
const SPECTRAL_STOKES_CHANNEL_PATTERN = /^(S[0-3])\.(\d+(?:,\d+)?(?:[eE][-+]?\d+)?)nm$/i;
const RESERVED_SPECTRAL_LAYER_PATTERN = /^(?:S[0-4]|T)\./i;
const SPECTRAL_CHANNEL_PATTERN = /(\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?)nm$/i;
const MIN_SPECTRAL_CHANNEL_COUNT = 2;
const SPECTRAL_RGB_SOURCE_PREFIX = '__spectralRgb:';
const SPECTRAL_STOKES_RGB_SOURCE_PREFIX = '__spectralStokesRgb:';
const SIGNED_STOKES_SPECTRAL_RGB_SERIES = new Set<string>(['S1', 'S2', 'S3']);

export function parseSpectralChannelName(channelName: string): number | null {
  return parseSpectralChannel(channelName)?.wavelength ?? null;
}

export function parseSpectralChannel(channelName: string): SpectralChannel | null {
  const jcgtMatch = channelName.match(JCGT_SPECTRAL_CHANNEL_PATTERN);
  if (jcgtMatch) {
    const wavelength = parseWavelengthValue(jcgtMatch[2]);
    if (wavelength === null) {
      return null;
    }

    const seriesLabel = jcgtMatch[1] ?? DEFAULT_SPECTRAL_SERIES_LABEL;
    return {
      channelName,
      wavelength,
      seriesKey: seriesLabel,
      seriesLabel
    };
  }

  if (RESERVED_SPECTRAL_LAYER_PATTERN.test(channelName)) {
    return null;
  }

  const match = channelName.match(SPECTRAL_CHANNEL_PATTERN);
  if (!match) {
    return null;
  }

  const wavelength = parseWavelengthValue(match[1]);
  if (wavelength === null) {
    return null;
  }

  const prefix = channelName.slice(0, match.index ?? 0);
  const seriesLabel = prefix.endsWith('.') && prefix.length > 1
    ? prefix.slice(0, -1)
    : DEFAULT_SPECTRAL_SERIES_LABEL;

  return {
    channelName,
    wavelength,
    seriesKey: seriesLabel,
    seriesLabel
  };
}

function parseWavelengthValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const wavelength = Number(value.replace(',', '.'));
  return Number.isFinite(wavelength) ? wavelength : null;
}

export function detectSpectralChannels(
  channelNames: string[],
  preferredChannelName: string | null = null
): SpectralChannel[] {
  const series = buildSpectralSeriesCandidates(parseIndexedSpectralChannels(channelNames))
    .filter((candidate) => candidate.channels.length >= MIN_SPECTRAL_CHANNEL_COUNT);
  if (series.length === 0) {
    return [];
  }

  const preferredSeriesKey = preferredChannelName
    ? parseSpectralChannel(preferredChannelName)?.seriesKey ?? null
    : null;
  const preferredSeries = preferredSeriesKey === null
    ? null
    : series.find((candidate) => candidate.key === preferredSeriesKey) ?? null;
  const selectedSeries = preferredSeries ?? [...series].sort(compareSpectralSeriesCandidates)[0];
  if (!selectedSeries) {
    return [];
  }

  return selectedSeries.channels
    .sort((a, b) => a.wavelength - b.wavelength || a.index - b.index)
    .map(({ channelName, wavelength, seriesKey, seriesLabel }) => ({
      channelName,
      wavelength,
      seriesKey,
      seriesLabel
    }));
}

export function detectSpectralChannelsForSeries(
  channelNames: string[],
  seriesKey: string
): SpectralChannel[] {
  const series = buildSpectralSeriesCandidates(parseIndexedSpectralChannels(channelNames))
    .find((candidate) => candidate.key === seriesKey);
  if (!series || countUniqueSpectralWavelengths(series.channels) < MIN_SPECTRAL_CHANNEL_COUNT) {
    return [];
  }

  return series.channels
    .sort((a, b) => a.wavelength - b.wavelength || a.index - b.index)
    .map(({ channelName, wavelength, seriesKey: key, seriesLabel }) => ({
      channelName,
      wavelength,
      seriesKey: key,
      seriesLabel
    }));
}

export function detectSpectralRgbChannelSeries(channelNames: string[]): SpectralChannel[][] {
  return buildSpectralSeriesCandidates(parseIndexedSpectralChannels(channelNames))
    .filter((candidate) => countUniqueSpectralWavelengths(candidate.channels) >= MIN_SPECTRAL_CHANNEL_COUNT)
    .sort(compareSpectralSeriesCandidates)
    .map((candidate) => candidate.channels
      .sort((a, b) => a.wavelength - b.wavelength || a.index - b.index)
      .map(({ channelName, wavelength, seriesKey, seriesLabel }) => ({
        channelName,
        wavelength,
        seriesKey,
        seriesLabel
      })));
}

export function buildSpectralRgbSelection(seriesKey = DEFAULT_SPECTRAL_SERIES_LABEL): SpectralRgbSelection {
  return {
    kind: 'spectralRgb',
    seriesKey
  };
}

export function getSpectralRgbDisplayOptions(channelNames: string[]): SpectralRgbDisplayOption[] {
  return detectSpectralRgbChannelSeries(channelNames).map((channels) => {
    const seriesKey = channels[0]?.seriesKey ?? DEFAULT_SPECTRAL_SERIES_LABEL;
    const selection = buildSpectralRgbSelection(seriesKey);
    const label = getDisplaySelectionOptionLabel(selection);
    return {
      key: `spectralRgb:${seriesKey}`,
      label,
      selection,
      mapping: buildSpectralRgbDisplayMapping(selection)
    };
  });
}

export function findSelectedSpectralRgbDisplayOption(
  options: readonly SpectralRgbDisplayOption[],
  selected: DisplaySelection | null
): SpectralRgbDisplayOption | null {
  if (!isSpectralRgbSelection(selected)) {
    return null;
  }

  return options.find((option) => option.selection.seriesKey === selected.seriesKey) ?? null;
}

export function isSpectralRgbDisplayAvailable(
  channelNames: string[],
  selection: DisplaySelection | null
): boolean {
  if (!isSpectralRgbSelection(selection)) {
    return true;
  }

  return detectSpectralChannelsForSeries(channelNames, selection.seriesKey).length >= MIN_SPECTRAL_CHANNEL_COUNT;
}

export function shouldReadSpectralRgbSeriesSigned(
  channelNames: string[],
  seriesKey: string
): boolean {
  return (
    SIGNED_STOKES_SPECTRAL_RGB_SERIES.has(seriesKey) &&
    isSpectralStokesRgbDisplayAvailable(channelNames)
  );
}

export function pickDefaultSpectralRgbSelection(channelNames: string[]): SpectralRgbSelection | null {
  if (!isSpectralOnlyLayer(channelNames)) {
    return null;
  }

  return getSpectralRgbDisplayOptions(channelNames)[0]?.selection ?? null;
}

export function buildSpectralRgbSourceName(seriesKey: string): string {
  return `${SPECTRAL_RGB_SOURCE_PREFIX}${encodeURIComponent(seriesKey)}`;
}

export function parseSpectralRgbSourceName(sourceName: string | null | undefined): string | null {
  if (!sourceName?.startsWith(SPECTRAL_RGB_SOURCE_PREFIX)) {
    return null;
  }

  try {
    return decodeURIComponent(sourceName.slice(SPECTRAL_RGB_SOURCE_PREFIX.length));
  } catch {
    return null;
  }
}

export function isSpectralRgbSourceName(sourceName: string | null | undefined): boolean {
  return parseSpectralRgbSourceName(sourceName) !== null;
}

export function buildSpectralStokesRgbSourceName(component: SpectralStokesComponent): string {
  return `${SPECTRAL_STOKES_RGB_SOURCE_PREFIX}${component}`;
}

export function parseSpectralStokesRgbSourceName(
  sourceName: string | null | undefined
): SpectralStokesComponent | null {
  if (!sourceName?.startsWith(SPECTRAL_STOKES_RGB_SOURCE_PREFIX)) {
    return null;
  }

  const component = sourceName.slice(SPECTRAL_STOKES_RGB_SOURCE_PREFIX.length).toUpperCase();
  return isSpectralStokesComponent(component) ? component : null;
}

export function isSpectralStokesRgbSourceName(sourceName: string | null | undefined): boolean {
  return parseSpectralStokesRgbSourceName(sourceName) !== null;
}

export function detectSpectralStokesChannelGroups(channelNames: string[]): SpectralStokesChannelGroup[] {
  const candidatesByWavelength = new Map<string, SpectralStokesSeriesCandidate>();

  channelNames.forEach((channelName) => {
    const parsed = parseSpectralStokesChannel(channelName);
    if (!parsed) {
      return;
    }

    const key = String(parsed.wavelength);
    const candidate = candidatesByWavelength.get(key) ?? {
      wavelength: parsed.wavelength,
      suffix: parsed.suffix,
      channels: {}
    };
    candidate.channels[parsed.component] ??= parsed.channelName;
    candidatesByWavelength.set(key, candidate);
  });

  return [...candidatesByWavelength.values()]
    .map(buildSpectralStokesChannelGroup)
    .filter((group): group is SpectralStokesChannelGroup => group !== null)
    .sort((a, b) => a.wavelength - b.wavelength);
}

export function isSpectralStokesRgbDisplayAvailable(channelNames: string[]): boolean {
  return detectSpectralStokesChannelGroups(channelNames).length >= MIN_SPECTRAL_CHANNEL_COUNT;
}

export function buildSpectralStokesComponentChannels(
  groups: readonly SpectralStokesChannelGroup[],
  component: SpectralStokesComponent
): SpectralChannel[] {
  return groups.map((group) => ({
    channelName: getSpectralStokesComponentChannelName(group, component),
    wavelength: group.wavelength,
    seriesKey: component,
    seriesLabel: component
  }));
}

export function buildSpectralStokesChannels(
  groups: readonly SpectralStokesChannelGroup[],
  parameter: StokesParameter
): SpectralChannel[] {
  const label = getStokesParameterLabel(parameter);
  return groups.map((group) => ({
    channelName: `${label}.${formatSpectralStokesWavelength(group.wavelength)}nm`,
    wavelength: group.wavelength,
    seriesKey: label,
    seriesLabel: label
  }));
}

export function buildSpectralStokesPlotPoints(
  sample: PixelSample | null,
  groups: readonly SpectralStokesChannelGroup[],
  parameter: StokesParameter
): SpectralPlotPoint[] {
  if (!sample) {
    return [];
  }

  const channels = buildSpectralStokesChannels(groups, parameter);
  return groups
    .map((group, index) => {
      const channel = channels[index];
      if (!channel) {
        return null;
      }

      const intensity = computeRawStokesDisplayValue(
        parameter,
        sample.values[group.s0],
        sample.values[group.s1],
        sample.values[group.s2],
        sample.values[group.s3]
      );
      return Number.isFinite(intensity)
        ? { ...channel, intensity }
        : null;
    })
    .filter((point): point is SpectralPlotPoint => point !== null);
}

export function isSpectralStokesSuffix(value: string | null | undefined): boolean {
  return parseSpectralStokesSuffixWavelength(value) !== null;
}

export function parseSpectralStokesSuffixWavelength(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  if (!/nm$/i.test(value)) {
    return null;
  }

  return parseWavelengthValue(value.replace(/nm$/i, ''));
}

function parseSpectralStokesChannel(channelName: string): IndexedSpectralStokesChannel | null {
  const match = channelName.match(SPECTRAL_STOKES_CHANNEL_PATTERN);
  if (!match) {
    return null;
  }

  const wavelength = parseWavelengthValue(match[2]);
  if (wavelength === null) {
    return null;
  }

  const dotIndex = channelName.indexOf('.');
  return {
    channelName,
    component: match[1]!.toUpperCase() as SpectralStokesComponent,
    wavelength,
    suffix: dotIndex >= 0 ? channelName.slice(dotIndex + 1) : `${match[2]}nm`
  };
}

function isSpectralStokesComponent(value: string): value is SpectralStokesComponent {
  return value === 'S0' || value === 'S1' || value === 'S2' || value === 'S3';
}

function getSpectralStokesComponentChannelName(
  group: SpectralStokesChannelGroup,
  component: SpectralStokesComponent
): string {
  switch (component) {
    case 'S0':
      return group.s0;
    case 'S1':
      return group.s1;
    case 'S2':
      return group.s2;
    case 'S3':
      return group.s3;
  }
}

function buildSpectralStokesChannelGroup(
  candidate: SpectralStokesSeriesCandidate
): SpectralStokesChannelGroup | null {
  const s0 = candidate.channels.S0;
  const s1 = candidate.channels.S1;
  const s2 = candidate.channels.S2;
  const s3 = candidate.channels.S3;
  if (!s0 || !s1 || !s2 || !s3) {
    return null;
  }

  return {
    wavelength: candidate.wavelength,
    suffix: candidate.suffix,
    s0,
    s1,
    s2,
    s3
  };
}

function buildSpectralSeriesCandidates(channels: IndexedSpectralChannel[]): SpectralSeriesCandidate[] {
  const seriesByKey = new Map<string, SpectralSeriesCandidate>();
  for (const channel of channels) {
    const candidate = seriesByKey.get(channel.seriesKey);
    if (candidate) {
      candidate.channels.push(channel);
      candidate.firstIndex = Math.min(candidate.firstIndex, channel.index);
      continue;
    }

    seriesByKey.set(channel.seriesKey, {
      key: channel.seriesKey,
      channels: [channel],
      firstIndex: channel.index
    });
  }

  return [...seriesByKey.values()];
}

function compareSpectralSeriesCandidates(a: SpectralSeriesCandidate, b: SpectralSeriesCandidate): number {
  return b.channels.length - a.channels.length || a.firstIndex - b.firstIndex;
}

function parseIndexedSpectralChannels(channelNames: string[]): IndexedSpectralChannel[] {
  return channelNames
    .map((channelName, index) => {
      const parsed = parseSpectralChannel(channelName);
      return parsed ? { ...parsed, index } : null;
    })
    .filter((channel): channel is IndexedSpectralChannel => channel !== null);
}

function countUniqueSpectralWavelengths(channels: readonly SpectralChannel[]): number {
  return new Set(
    channels
      .map((channel) => channel.wavelength)
      .filter((wavelength) => Number.isFinite(wavelength))
  ).size;
}

function isSpectralOnlyLayer(channelNames: string[]): boolean {
  const nonAlphaChannels = channelNames.filter((channelName) => !isAlphaChannel(channelName));
  return (
    nonAlphaChannels.length > 0 &&
    nonAlphaChannels.every((channelName) => parseSpectralChannel(channelName) !== null) &&
    getSpectralRgbDisplayOptions(channelNames).length > 0
  );
}

function buildSpectralRgbDisplayMapping(selection: SpectralRgbSelection): DisplayChannelMapping {
  const label = getDisplaySelectionOptionLabel(selection);
  return {
    displayR: `${label}.R`,
    displayG: `${label}.G`,
    displayB: `${label}.B`,
    displayA: null
  };
}

export function buildSpectralPlotPoints(
  sample: PixelSample | null,
  channels: readonly SpectralChannel[]
): SpectralPlotPoint[] {
  if (!sample) {
    return [];
  }

  return channels
    .map((channel) => ({
      ...channel,
      intensity: sample.values[channel.channelName]
    }))
    .filter((point): point is SpectralPlotPoint => Number.isFinite(point.intensity));
}

function formatSpectralStokesWavelength(wavelength: number): string {
  if (!Number.isFinite(wavelength)) {
    return '0';
  }

  return Number(wavelength.toPrecision(12)).toString();
}
