import {
  getChannelReadView,
  readChannelValue
} from '../channel-storage';
import type { DisplaySelection, StokesSelection } from '../display-model';
import type { DecodedLayer, VisualizationMode } from '../types';
import {
  createDisplayPixelValues,
  readDisplaySelectionSnapshotPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  sanitizeAlphaValue,
  sanitizeDisplayValue,
  type DisplaySelectionEvaluator
} from './evaluator';

export function buildDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  displayR: string,
  displayG: string,
  displayB: string,
  displayAOrOutput?: string | null | Float32Array,
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const displayA = displayAOrOutput instanceof Float32Array ? null : displayAOrOutput ?? null;
  const outputBuffer = displayAOrOutput instanceof Float32Array ? displayAOrOutput : output;
  const out = outputBuffer && outputBuffer.length === requiredLength
    ? outputBuffer
    : new Float32Array(requiredLength);

  const channelR = getChannelReadView(layer, displayR);
  const channelG = getChannelReadView(layer, displayG);
  const channelB = getChannelReadView(layer, displayB);
  const channelA = displayA ? getChannelReadView(layer, displayA) : null;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outIndex = pixelIndex * 4;
    out[outIndex + 0] = sanitizeDisplayValue(readChannelValue(channelR, pixelIndex));
    out[outIndex + 1] = sanitizeDisplayValue(readChannelValue(channelG, pixelIndex));
    out[outIndex + 2] = sanitizeDisplayValue(readChannelValue(channelB, pixelIndex));
    out[outIndex + 3] = channelA ? sanitizeAlphaValue(readChannelValue(channelA, pixelIndex)) : 1;
  }

  return out;
}

export function buildSelectedDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  output?: Float32Array
): Float32Array {
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  const out = output && output.length === requiredLength
    ? output
    : new Float32Array(requiredLength);

  return fillDisplayTextureFromEvaluator(
    resolveDisplaySelectionEvaluator(layer, selection, visualizationMode),
    pixelCount,
    out
  );
}

export function buildStokesDisplayTexture(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: StokesSelection,
  visualizationMode: VisualizationMode = 'rgb',
  output?: Float32Array
): Float32Array {
  return buildSelectedDisplayTexture(layer, width, height, selection, visualizationMode, output);
}

function fillDisplayTextureFromEvaluator(
  evaluator: DisplaySelectionEvaluator,
  pixelCount: number,
  output: Float32Array
): Float32Array {
  const values = createDisplayPixelValues();
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outIndex = pixelIndex * 4;
    readDisplaySelectionSnapshotPixelValuesAtIndex(evaluator, pixelIndex, values);
    output[outIndex + 0] = values.r;
    output[outIndex + 1] = values.g;
    output[outIndex + 2] = values.b;
    output[outIndex + 3] = values.a;
  }

  return output;
}
