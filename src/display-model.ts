export type RgbSuffix = 'R' | 'G' | 'B' | 'A';

export type StokesParameter =
  | 'aolp'
  | 'dolp'
  | 'dop'
  | 'docp'
  | 'cop'
  | 'top'
  | 's1_over_s0'
  | 's2_over_s0'
  | 's3_over_s0';

export type StokesAngleParameter = 'aolp' | 'cop' | 'top';
export type StokesScalarParameter = Exclude<StokesParameter, StokesAngleParameter>;

export type StokesSource =
  | { kind: 'scalar' }
  | { kind: 'rgbLuminance' }
  | { kind: 'rgbComponent'; component: 'R' | 'G' | 'B' };

export type StokesDegreeModulationParameter = StokesAngleParameter;
export type StokesDegreeModulationState = Record<StokesDegreeModulationParameter, boolean>;

export type ChannelRgbSelection = {
  kind: 'channelRgb';
  r: string;
  g: string;
  b: string;
  alpha: string | null;
};

export type ChannelMonoSelection = {
  kind: 'channelMono';
  channel: string;
  alpha: string | null;
};

export type StokesScalarSelection = {
  kind: 'stokesScalar';
  parameter: StokesScalarParameter;
  source: StokesSource;
};

export type StokesAngleSelection = {
  kind: 'stokesAngle';
  parameter: StokesAngleParameter;
  source: StokesSource;
};

export type ChannelSelection = ChannelRgbSelection | ChannelMonoSelection;
export type StokesSelection = StokesScalarSelection | StokesAngleSelection;
export type DisplaySelection = ChannelSelection | StokesSelection;

const STOKES_PARAMETER_LABELS: Record<StokesParameter, string> = {
  aolp: 'AoLP',
  dolp: 'DoLP',
  dop: 'DoP',
  docp: 'DoCP',
  cop: 'CoP',
  top: 'ToP',
  s1_over_s0: 'S1/S0',
  s2_over_s0: 'S2/S0',
  s3_over_s0: 'S3/S0'
};

const STOKES_DEGREE_MODULATION_LABELS: Record<StokesDegreeModulationParameter, string> = {
  aolp: 'DoLP',
  cop: 'DoCP',
  top: 'DoP'
};

export function cloneDisplaySelection(selection: DisplaySelection | null): DisplaySelection | null {
  if (!selection) {
    return null;
  }

  if (selection.kind === 'channelRgb') {
    return { ...selection };
  }

  if (selection.kind === 'channelMono') {
    return { ...selection };
  }

  return {
    ...selection,
    source: cloneStokesSource(selection.source)
  };
}

export function sameDisplaySelection(
  a: DisplaySelection | null,
  b: DisplaySelection | null
): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b || a.kind !== b.kind) {
    return false;
  }

  switch (a.kind) {
    case 'channelRgb': {
      const next = b as ChannelRgbSelection;
      return a.r === next.r && a.g === next.g && a.b === next.b && a.alpha === next.alpha;
    }
    case 'channelMono': {
      const next = b as ChannelMonoSelection;
      return a.channel === next.channel && a.alpha === next.alpha;
    }
    case 'stokesScalar':
    case 'stokesAngle': {
      const next = b as StokesSelection;
      return a.parameter === next.parameter && sameStokesSource(a.source, next.source);
    }
  }
}

export function serializeDisplaySelectionKey(selection: DisplaySelection | null): string {
  if (!selection) {
    return 'none';
  }

  switch (selection.kind) {
    case 'channelRgb':
      return `channelRgb:${selection.r}:${selection.g}:${selection.b}:${selection.alpha ?? ''}`;
    case 'channelMono':
      return `channelMono:${selection.channel}:${selection.alpha ?? ''}`;
    case 'stokesScalar':
    case 'stokesAngle':
      return `${selection.kind}:${selection.parameter}:${serializeStokesSource(selection.source)}`;
  }
}

export function isChannelSelection(selection: DisplaySelection | null): selection is ChannelSelection {
  return Boolean(selection && (selection.kind === 'channelRgb' || selection.kind === 'channelMono'));
}

export function isStokesSelection(selection: DisplaySelection | null): selection is StokesSelection {
  return Boolean(selection && (selection.kind === 'stokesScalar' || selection.kind === 'stokesAngle'));
}

export function isStokesAngleSelection(selection: DisplaySelection | null): selection is StokesAngleSelection {
  return Boolean(selection && selection.kind === 'stokesAngle');
}

export function isGroupedRgbStokesSelection(selection: DisplaySelection | null): selection is StokesSelection {
  return Boolean(isStokesSelection(selection) && selection.source.kind === 'rgbLuminance');
}

export function isMonoSelection(selection: DisplaySelection | null): boolean {
  if (!selection) {
    return false;
  }

  return selection.kind === 'channelMono' || (
    isStokesSelection(selection) &&
    selection.source.kind === 'rgbComponent'
  );
}

export function selectionUsesImageAlpha(selection: DisplaySelection | null): boolean {
  return Boolean(
    selection &&
    isChannelSelection(selection) &&
    getSelectionAlpha(selection) !== null
  );
}

export function getSelectionAlpha(selection: ChannelSelection | null): string | null {
  if (!selection) {
    return null;
  }

  return selection.alpha ?? null;
}

export function getStokesParameterLabel(parameter: StokesParameter): string {
  return STOKES_PARAMETER_LABELS[parameter];
}

export function isStokesAngleParameter(parameter: StokesParameter): parameter is StokesAngleParameter {
  return parameter === 'aolp' || parameter === 'cop' || parameter === 'top';
}

export function isStokesScalarParameter(parameter: StokesParameter): parameter is StokesScalarParameter {
  return !isStokesAngleParameter(parameter);
}

export function isStokesDegreeModulationParameter(
  parameter: StokesParameter | null
): parameter is StokesDegreeModulationParameter {
  return parameter === 'aolp' || parameter === 'cop' || parameter === 'top';
}

export function getStokesDegreeModulationLabel(
  parameter: StokesParameter | null
): string | null {
  return parameter && isStokesDegreeModulationParameter(parameter)
    ? STOKES_DEGREE_MODULATION_LABELS[parameter]
    : null;
}

export function getDisplaySelectionParameter(selection: DisplaySelection | null): StokesParameter | null {
  return isStokesSelection(selection) ? selection.parameter : null;
}

export function getDisplaySelectionValueLabel(selection: DisplaySelection | null): string | null {
  if (!isStokesSelection(selection)) {
    return null;
  }

  const label = getStokesParameterLabel(selection.parameter);
  return selection.source.kind === 'rgbComponent'
    ? `${label}.${selection.source.component}`
    : label;
}

export function getDisplaySelectionDegreeModulationValueLabel(
  selection: DisplaySelection | null
): string | null {
  if (!isStokesSelection(selection)) {
    return null;
  }

  const label = getStokesDegreeModulationLabel(selection.parameter);
  if (!label) {
    return null;
  }

  return selection.source.kind === 'rgbComponent'
    ? `${label}.${selection.source.component}`
    : label;
}

export function getDisplaySelectionOptionLabel(selection: DisplaySelection): string {
  switch (selection.kind) {
    case 'channelRgb':
      return formatChannelRgbSelectionLabel(selection);
    case 'channelMono':
      return selection.alpha ? `${selection.channel},${selection.alpha}` : selection.channel;
    case 'stokesScalar':
    case 'stokesAngle':
      return formatStokesSelectionLabel(selection);
  }
}

export function parseRgbChannelName(channelName: string): { base: string; suffix: RgbSuffix } | null {
  if (channelName === 'R' || channelName === 'G' || channelName === 'B' || channelName === 'A') {
    return { base: '', suffix: channelName };
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

export function buildRgbGroupLabel(base: string, hasAlpha: boolean): string {
  const channelsLabel = hasAlpha ? 'R,G,B,A' : 'R,G,B';
  return base.length > 0 ? `${base}.(${channelsLabel})` : channelsLabel;
}

export function isAlphaChannel(channelName: string): boolean {
  return channelName === 'A' || channelName.endsWith('.A');
}

function formatChannelRgbSelectionLabel(selection: ChannelRgbSelection): string {
  const parsedR = parseRgbChannelName(selection.r);
  const parsedG = parseRgbChannelName(selection.g);
  const parsedB = parseRgbChannelName(selection.b);
  if (
    parsedR &&
    parsedG &&
    parsedB &&
    parsedR.base === parsedG.base &&
    parsedR.base === parsedB.base &&
    parsedR.suffix === 'R' &&
    parsedG.suffix === 'G' &&
    parsedB.suffix === 'B'
  ) {
    return buildRgbGroupLabel(parsedR.base, Boolean(selection.alpha));
  }

  const channels = [selection.r, selection.g, selection.b];
  if (selection.alpha) {
    channels.push(selection.alpha);
  }
  return channels.join(',');
}

function formatStokesSelectionLabel(selection: StokesSelection): string {
  const label = getStokesParameterLabel(selection.parameter);
  switch (selection.source.kind) {
    case 'scalar':
      return `Stokes ${label}`;
    case 'rgbLuminance':
      return `${label}.(R,G,B)`;
    case 'rgbComponent':
      return `${label}.${selection.source.component}`;
  }
}

function cloneStokesSource(source: StokesSource): StokesSource {
  return source.kind === 'rgbComponent'
    ? { kind: 'rgbComponent', component: source.component }
    : { kind: source.kind };
}

function sameStokesSource(a: StokesSource, b: StokesSource): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  return a.kind !== 'rgbComponent' || a.component === (b as { kind: 'rgbComponent'; component: 'R' | 'G' | 'B' }).component;
}

function serializeStokesSource(source: StokesSource): string {
  return source.kind === 'rgbComponent'
    ? `rgbComponent:${source.component}`
    : source.kind;
}
