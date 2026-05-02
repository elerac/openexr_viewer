import {
  isGroupedRgbStokesSelection,
  type DisplaySelection,
  type StokesParameter
} from '../display-model';
import {
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  isStokesDisplayAvailable,
  type RgbStokesChannels,
  type ScalarStokesChannels
} from '../stokes';
import { getRgbComponentChannels } from '../stokes/stokes-display';
import type { DecodedLayer, VisualizationMode } from '../types';

export const DISPLAY_SOURCE_SLOT_COUNT = 12;

export type DisplaySourceMode =
  | 'empty'
  | 'channelRgb'
  | 'channelMono'
  | 'stokesDirect'
  | 'stokesRgb'
  | 'stokesRgbLuminance';

export interface DisplaySourceBinding {
  mode: DisplaySourceMode;
  slots: Array<string | null>;
  usesImageAlpha: boolean;
  stokesParameter: StokesParameter | null;
}

const EMPTY_DISPLAY_SLOTS = Object.freeze(
  Array.from({ length: DISPLAY_SOURCE_SLOT_COUNT }, () => null as string | null)
);

export function createEmptyDisplaySourceBinding(): DisplaySourceBinding {
  return {
    mode: 'empty',
    slots: [...EMPTY_DISPLAY_SLOTS],
    usesImageAlpha: false,
    stokesParameter: null
  };
}

export function buildDisplaySourceBinding(
  layer: DecodedLayer,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): DisplaySourceBinding {
  if (!selection) {
    return createEmptyDisplaySourceBinding();
  }

  switch (selection.kind) {
    case 'channelRgb':
      return createDisplaySourceBinding(
        'channelRgb',
        [selection.r, selection.g, selection.b, selection.alpha],
        selection.alpha !== null,
        null
      );
    case 'channelMono':
      return createDisplaySourceBinding(
        'channelMono',
        [selection.channel, null, null, selection.alpha],
        selection.alpha !== null,
        null
      );
    case 'stokesScalar':
    case 'stokesAngle':
      return buildStokesDisplaySourceBinding(layer, selection, visualizationMode);
  }
}

export function getDisplaySourceBindingChannelNames(binding: DisplaySourceBinding): string[] {
  const uniqueChannels = new Set<string>();

  for (const channelName of binding.slots) {
    if (!channelName) {
      continue;
    }

    uniqueChannels.add(channelName);
  }

  return [...uniqueChannels];
}

export function createDisplaySourceBinding(
  mode: DisplaySourceMode,
  slots: Array<string | null>,
  usesImageAlpha: boolean,
  stokesParameter: StokesParameter | null
): DisplaySourceBinding {
  const paddedSlots = [...EMPTY_DISPLAY_SLOTS];
  for (let slotIndex = 0; slotIndex < Math.min(paddedSlots.length, slots.length); slotIndex += 1) {
    paddedSlots[slotIndex] = slots[slotIndex] ?? null;
  }

  return {
    mode,
    slots: paddedSlots,
    usesImageAlpha,
    stokesParameter
  };
}

function buildStokesDisplaySourceBinding(
  layer: DecodedLayer,
  selection: Extract<DisplaySelection, { kind: 'stokesScalar' | 'stokesAngle' }>,
  visualizationMode: VisualizationMode
): DisplaySourceBinding {
  if (!isStokesDisplayAvailable(layer.channelNames, selection)) {
    return createEmptyDisplaySourceBinding();
  }

  if (selection.source.kind === 'scalar') {
    const channels = detectScalarStokesChannels(layer.channelNames);
    return channels
      ? createScalarStokesBinding(channels, selection.parameter)
      : createEmptyDisplaySourceBinding();
  }

  const channels = detectRgbStokesChannels(layer.channelNames);
  if (!channels) {
    return createEmptyDisplaySourceBinding();
  }

  if (selection.source.kind === 'rgbComponent') {
    return createScalarStokesBinding(
      getRgbComponentChannels(channels, selection.source.component),
      selection.parameter
    );
  }

  return createRgbStokesBinding(
    channels,
    selection.parameter,
    visualizationMode === 'colormap' && isGroupedRgbStokesSelection(selection)
      ? 'stokesRgbLuminance'
      : 'stokesRgb'
  );
}

function createScalarStokesBinding(
  channels: ScalarStokesChannels,
  parameter: StokesParameter
): DisplaySourceBinding {
  return createDisplaySourceBinding(
    'stokesDirect',
    [channels.s0, channels.s1, channels.s2, channels.s3],
    false,
    parameter
  );
}

function createRgbStokesBinding(
  channels: RgbStokesChannels,
  parameter: StokesParameter,
  mode: 'stokesRgb' | 'stokesRgbLuminance'
): DisplaySourceBinding {
  return createDisplaySourceBinding(
    mode,
    [
      channels.r.s0, channels.r.s1, channels.r.s2, channels.r.s3,
      channels.g.s0, channels.g.s1, channels.g.s2, channels.g.s3,
      channels.b.s0, channels.b.s1, channels.b.s2, channels.b.s3
    ],
    false,
    parameter
  );
}
