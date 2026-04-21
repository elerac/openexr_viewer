import { computeRec709Luminance } from '../color';
import {
  getSelectionAlpha,
  isChannelSelection,
  isMonoSelection
} from '../display-model';
import type { ViewerState } from '../types';

const OVERLAY_MONO_LABEL_COLOR = 'rgba(255, 255, 255, 0.95)';
const OVERLAY_RGB_LABEL_COLORS = [
  'rgba(255, 120, 120, 0.96)',
  'rgba(120, 255, 140, 0.96)',
  'rgba(120, 170, 255, 0.96)'
] as const;

type OverlayLabelState = Pick<ViewerState, 'visualizationMode' | 'displaySelection'>;

export interface OverlayValueLine {
  color: string;
  value: string;
}

export function buildOverlayValueLines(
  state: OverlayLabelState,
  r: number,
  g: number,
  b: number,
  a: number = 1
): OverlayValueLine[] {
  const selection = state.displaySelection;
  const alphaChannel = isChannelSelection(selection) ? getSelectionAlpha(selection) : null;
  let lines: OverlayValueLine[];
  if (state.visualizationMode === 'colormap') {
    lines = [
      {
        color: OVERLAY_MONO_LABEL_COLOR,
        value: formatOverlayValue(computeRec709Luminance(r, g, b))
      }
    ];
  } else if (isMonoSelection(selection)) {
    lines = [
      {
        color: overlayLabelColorForSelection(selection),
        value: formatOverlayValue(r)
      }
    ];
  } else {
    lines = [
      { color: OVERLAY_RGB_LABEL_COLORS[0], value: formatOverlayValue(r) },
      { color: OVERLAY_RGB_LABEL_COLORS[1], value: formatOverlayValue(g) },
      { color: OVERLAY_RGB_LABEL_COLORS[2], value: formatOverlayValue(b) }
    ];
  }

  if (alphaChannel) {
    lines.push({ color: OVERLAY_MONO_LABEL_COLOR, value: formatOverlayValue(a) });
  }

  return lines;
}

export function getOverlayValueLineCount(state: OverlayLabelState): number {
  const colorLineCount = state.visualizationMode === 'colormap' || isMonoSelection(state.displaySelection) ? 1 : 3;
  return selectionUsesOverlayAlpha(state.displaySelection) ? colorLineCount + 1 : colorLineCount;
}

function formatOverlayValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1000)) {
    return value.toExponential(1);
  }

  return value.toPrecision(3);
}

function overlayLabelColorForChannel(channelName: string): string {
  if (channelName === 'R' || channelName.endsWith('.R')) {
    return 'rgba(255, 120, 120, 0.96)';
  }
  if (channelName === 'G' || channelName.endsWith('.G')) {
    return 'rgba(120, 255, 140, 0.96)';
  }
  if (channelName === 'B' || channelName.endsWith('.B')) {
    return 'rgba(120, 170, 255, 0.96)';
  }
  return OVERLAY_MONO_LABEL_COLOR;
}

function overlayLabelColorForSelection(selection: ViewerState['displaySelection']): string {
  if (!selection) {
    return OVERLAY_MONO_LABEL_COLOR;
  }

  if (selection.kind === 'channelMono') {
    return overlayLabelColorForChannel(selection.channel);
  }

  if (selection.kind === 'stokesScalar' || selection.kind === 'stokesAngle') {
    return selection.source.kind === 'rgbComponent'
      ? overlayLabelColorForChannel(selection.source.component)
      : OVERLAY_MONO_LABEL_COLOR;
  }

  return OVERLAY_MONO_LABEL_COLOR;
}

function selectionUsesOverlayAlpha(selection: ViewerState['displaySelection']): boolean {
  return Boolean(isChannelSelection(selection) && getSelectionAlpha(selection));
}
