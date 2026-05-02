import type { DisplaySelection } from '../display-model';
import { resolveDisplaySelectionEvaluator } from '../display/evaluator';
import { clampImageRoiToBounds, getImageRoiHeight, getImageRoiPixelCount, getImageRoiWidth } from '../roi';
import type { DecodedLayer, ImageRoi, RoiStats, VisualizationMode } from '../types';
import {
  accumulateStatsValue,
  createDisplaySelectionStatsAccumulators,
  toStatsChannelSummary
} from './stats-accumulator';

export function computeDisplaySelectionRoiStats(
  layer: DecodedLayer,
  width: number,
  height: number,
  roi: ImageRoi,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb'
): RoiStats | null {
  const clampedRoi = clampImageRoiToBounds(roi, width, height);
  if (!clampedRoi) {
    return null;
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode);
  const accumulators = createDisplaySelectionStatsAccumulators(evaluator, selection);
  const pixelCount = getImageRoiPixelCount(clampedRoi);

  for (let iy = clampedRoi.y0; iy <= clampedRoi.y1; iy += 1) {
    const rowOffset = iy * width;
    for (let ix = clampedRoi.x0; ix <= clampedRoi.x1; ix += 1) {
      const pixelIndex = rowOffset + ix;
      for (const accumulator of accumulators) {
        accumulateStatsValue(accumulator, accumulator.read(pixelIndex));
      }
    }
  }

  return {
    roi: clampedRoi,
    width: getImageRoiWidth(clampedRoi),
    height: getImageRoiHeight(clampedRoi),
    pixelCount,
    channels: accumulators.map(toStatsChannelSummary)
  };
}
