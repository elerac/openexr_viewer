import {
  getDisplaySelectionOptionLabel,
  getStokesParameterLabel,
  isSpectralRgbSelection,
  type DisplaySelection,
  type SpectralRgbSelection,
  type StokesParameter
} from './display-model';
import { isStokesParameterAvailable, type StokesComputationOptions } from './stokes';
import { computeRawStokesDisplayValue } from './stokes/stokes-display';
import type { DisplayChannelMapping, PixelSample } from './types';
import {
  compileChannelRecognitionNameRules,
  parseSpectralChannelNameWithRules,
  parseSpectralStokesChannelNameWithRules,
  type ChannelRecognitionNameRules,
  type CompiledChannelRecognitionNameRules
} from './channel-recognition-name-rules';

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
  s3: string | null;
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

export interface SpectralRecognitionConfig {
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
  compiledChannelRecognitionNameRules?: CompiledChannelRecognitionNameRules;
}

const DEFAULT_SPECTRAL_SERIES_LABEL = '';
const MIN_SPECTRAL_CHANNEL_COUNT = 2;
const SPECTRAL_RGB_SOURCE_PREFIX = '__spectralRgb:';
const SPECTRAL_STOKES_RGB_SOURCE_PREFIX = '__spectralStokesRgb:';
const SIGNED_STOKES_SPECTRAL_RGB_SERIES = new Set<string>(['S1', 'S2', 'S3']);

export function parseSpectralChannelName(
  channelName: string,
  config: SpectralRecognitionConfig = {}
): number | null {
  return parseSpectralChannel(channelName, config)?.wavelength ?? null;
}

export function parseSpectralChannel(
  channelName: string,
  config: SpectralRecognitionConfig = {}
): SpectralChannel | null {
  return parseSpectralChannelNameWithRules(channelName, resolveCompiledNameRules(config));
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
  preferredChannelName: string | null = null,
  config: SpectralRecognitionConfig = {}
): SpectralChannel[] {
  const compiled = resolveCompiledNameRules(config);
  const series = buildSpectralSeriesCandidates(parseIndexedSpectralChannels(channelNames, { compiledChannelRecognitionNameRules: compiled }))
    .filter((candidate) => candidate.channels.length >= MIN_SPECTRAL_CHANNEL_COUNT);
  if (series.length === 0) {
    return [];
  }

  const preferredSeriesKey = preferredChannelName
    ? parseSpectralChannel(preferredChannelName, { compiledChannelRecognitionNameRules: compiled })?.seriesKey ?? null
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
  seriesKey: string,
  config: SpectralRecognitionConfig = {}
): SpectralChannel[] {
  const compiled = resolveCompiledNameRules(config);
  if (shouldHideIncompleteSpectralStokesS3Series(channelNames, seriesKey, { compiledChannelRecognitionNameRules: compiled })) {
    return [];
  }

  const series = buildSpectralSeriesCandidates(parseIndexedSpectralChannels(channelNames, { compiledChannelRecognitionNameRules: compiled }))
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

export function detectSpectralRgbChannelSeries(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): SpectralChannel[][] {
  const compiled = resolveCompiledNameRules(config);
  const hideIncompleteS3 = shouldHideIncompleteSpectralStokesS3Series(channelNames, 'S3', { compiledChannelRecognitionNameRules: compiled });
  return buildSpectralSeriesCandidates(parseIndexedSpectralChannels(channelNames, { compiledChannelRecognitionNameRules: compiled }))
    .filter((candidate) => !(hideIncompleteS3 && candidate.key === 'S3'))
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

export function getSpectralRgbDisplayOptions(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): SpectralRgbDisplayOption[] {
  return detectSpectralRgbChannelSeries(channelNames, config).map((channels) => {
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
  selection: DisplaySelection | null,
  config: SpectralRecognitionConfig = {}
): boolean {
  if (!isSpectralRgbSelection(selection)) {
    return true;
  }

  return detectSpectralChannelsForSeries(channelNames, selection.seriesKey, config).length >= MIN_SPECTRAL_CHANNEL_COUNT;
}

export function isSpectralRgbSplitChannel(
  channelNames: string[],
  channelName: string,
  config: SpectralRecognitionConfig = {}
): boolean {
  return getSpectralRgbSplitChannelNames(channelNames, config).has(channelName);
}

export function getSpectralRgbSplitChannelNames(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): Set<string> {
  const splitChannelNames = new Set<string>();
  for (const channels of detectSpectralRgbChannelSeries(channelNames, config)) {
    for (const channel of channels) {
      splitChannelNames.add(channel.channelName);
    }
  }

  return splitChannelNames;
}

export function findFirstSpectralRgbSplitChannel(
  channelNames: string[],
  seriesKey: string,
  config: SpectralRecognitionConfig = {}
): string | null {
  return detectSpectralChannelsForSeries(channelNames, seriesKey, config)[0]?.channelName ?? null;
}

export function findSpectralRgbSeriesKeyForChannel(
  channelNames: string[],
  channelName: string,
  config: SpectralRecognitionConfig = {}
): string | null {
  const parsed = parseSpectralChannel(channelName, config);
  if (!parsed) {
    return null;
  }

  const series = detectSpectralChannelsForSeries(channelNames, parsed.seriesKey, config);
  return series.some((channel) => channel.channelName === channelName)
    ? parsed.seriesKey
    : null;
}

export function shouldReadSpectralRgbSeriesSigned(
  channelNames: string[],
  seriesKey: string,
  config: SpectralRecognitionConfig = {}
): boolean {
  return (
    SIGNED_STOKES_SPECTRAL_RGB_SERIES.has(seriesKey) &&
    isSpectralStokesRgbDisplayAvailable(channelNames, config) &&
    !shouldHideIncompleteSpectralStokesS3Series(channelNames, seriesKey, config)
  );
}

export function pickDefaultSpectralRgbSelection(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): SpectralRgbSelection | null {
  return getSpectralRgbDisplayOptions(channelNames, config)[0]?.selection ?? null;
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

export function detectSpectralStokesChannelGroups(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): SpectralStokesChannelGroup[] {
  const compiled = resolveCompiledNameRules(config);
  const candidatesByWavelength = new Map<string, SpectralStokesSeriesCandidate>();

  channelNames.forEach((channelName) => {
    const parsed = parseSpectralStokesChannel(channelName, { compiledChannelRecognitionNameRules: compiled });
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

export function isSpectralStokesRgbDisplayAvailable(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): boolean {
  return detectSpectralStokesChannelGroups(channelNames, config).length >= MIN_SPECTRAL_CHANNEL_COUNT;
}

export function hasCompleteSpectralStokesS3(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): boolean {
  const groups = detectSpectralStokesChannelGroups(channelNames, config);
  return groups.length >= MIN_SPECTRAL_CHANNEL_COUNT && groups.every((group) => group.s3 !== null);
}

export function buildSpectralStokesComponentChannels(
  groups: readonly SpectralStokesChannelGroup[],
  component: SpectralStokesComponent
): SpectralChannel[] {
  const channels: SpectralChannel[] = [];
  for (const group of groups) {
    const channelName = getSpectralStokesComponentChannelName(group, component);
    if (!channelName) {
      continue;
    }

    channels.push({
      channelName,
      wavelength: group.wavelength,
      seriesKey: component,
      seriesLabel: component
    });
  }

  return channels;
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
  parameter: StokesParameter,
  options: StokesComputationOptions = {}
): SpectralPlotPoint[] {
  if (!sample) {
    return [];
  }

  if (!isStokesParameterAvailable(parameter, groups.every((group) => group.s3 !== null))) {
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
        group.s3 ? sample.values[group.s3] : 0,
        options
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

function parseSpectralStokesChannel(
  channelName: string,
  config: SpectralRecognitionConfig = {}
): IndexedSpectralStokesChannel | null {
  const parsed = parseSpectralStokesChannelNameWithRules(channelName, resolveCompiledNameRules(config));
  if (!parsed) {
    return null;
  }

  return {
    channelName,
    component: parsed.component as SpectralStokesComponent,
    wavelength: parsed.wavelength,
    suffix: parsed.suffix
  };
}

function isSpectralStokesComponent(value: string): value is SpectralStokesComponent {
  return value === 'S0' || value === 'S1' || value === 'S2' || value === 'S3';
}

function getSpectralStokesComponentChannelName(
  group: SpectralStokesChannelGroup,
  component: SpectralStokesComponent
): string | null {
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
  if (!s0 || !s1 || !s2) {
    return null;
  }

  return {
    wavelength: candidate.wavelength,
    suffix: candidate.suffix,
    s0,
    s1,
    s2,
    s3: candidate.channels.S3 ?? null
  };
}

function shouldHideIncompleteSpectralStokesS3Series(
  channelNames: string[],
  seriesKey: string,
  config: SpectralRecognitionConfig = {}
): boolean {
  return (
    seriesKey === 'S3' &&
    isSpectralStokesRgbDisplayAvailable(channelNames, config) &&
    !hasCompleteSpectralStokesS3(channelNames, config)
  );
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

function parseIndexedSpectralChannels(
  channelNames: string[],
  config: SpectralRecognitionConfig = {}
): IndexedSpectralChannel[] {
  const compiled = resolveCompiledNameRules(config);
  return channelNames
    .map((channelName, index) => {
      const parsed = parseSpectralChannel(channelName, { compiledChannelRecognitionNameRules: compiled });
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

function resolveCompiledNameRules(config: SpectralRecognitionConfig): CompiledChannelRecognitionNameRules {
  return config.compiledChannelRecognitionNameRules ?? compileChannelRecognitionNameRules(config.channelRecognitionNameRules);
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
