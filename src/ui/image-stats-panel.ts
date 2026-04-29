import { formatOverlayValue } from '../value-format';
import type { ImageStatsReadoutModel } from '../app/viewer-app-types';
import type { ImageStats, StatsChannelSummary } from '../types';
import type { ImageStatsPanelElements } from './elements';

export function setImageStats(
  elements: ImageStatsPanelElements,
  readout: ImageStatsReadoutModel
): void {
  elements.imageStatsEmptyState.classList.toggle('hidden', readout.hasActiveImage);
  elements.imageStatsLoadingState.classList.toggle('hidden', !readout.isLoading);

  if (!readout.hasActiveImage || readout.isLoading || !readout.stats || readout.stats.channels.length === 0) {
    elements.imageStatsTable.classList.add('hidden');
    elements.imageStatsTable.replaceChildren();
    if (readout.hasActiveImage && !readout.isLoading && (!readout.stats || readout.stats.channels.length === 0)) {
      elements.imageStatsEmptyState.classList.remove('hidden');
    }
    return;
  }

  elements.imageStatsEmptyState.classList.add('hidden');
  elements.imageStatsTable.classList.remove('hidden');
  renderImageStatsTable(elements, readout.stats);
}

function renderImageStatsTable(elements: ImageStatsPanelElements, stats: ImageStats): void {
  elements.imageStatsTable.replaceChildren(
    buildImageStatsHeaderRow(),
    ...stats.channels.map((channel) => buildImageStatsRow(channel, stats.pixelCount))
  );
}

function buildImageStatsHeaderRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'image-stats-row image-stats-row--header';
  row.append(
    buildImageStatsCell('image-stats-cell image-stats-cell--label', 'Channel'),
    buildImageStatsCell('image-stats-cell', 'Min'),
    buildImageStatsCell('image-stats-cell', 'Mean'),
    buildImageStatsCell('image-stats-cell', 'Max'),
    buildImageStatsCell('image-stats-cell', 'Finite'),
    buildImageStatsCell('image-stats-cell', 'NaN'),
    buildImageStatsCell('image-stats-cell', '-Inf'),
    buildImageStatsCell('image-stats-cell', '+Inf'),
    buildImageStatsCell('image-stats-cell', 'Invalid %')
  );
  return row;
}

function buildImageStatsRow(channel: StatsChannelSummary, pixelCount: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'image-stats-row';
  row.append(
    buildImageStatsCell('image-stats-cell image-stats-cell--label', channel.label),
    buildImageStatsCell('image-stats-cell', formatImageStatsValue(channel.min)),
    buildImageStatsCell('image-stats-cell', formatImageStatsValue(channel.mean)),
    buildImageStatsCell('image-stats-cell', formatImageStatsValue(channel.max)),
    buildImageStatsCell('image-stats-cell', String(channel.validPixelCount)),
    buildImageStatsCell('image-stats-cell', String(channel.nanPixelCount)),
    buildImageStatsCell('image-stats-cell', String(channel.negativeInfinityPixelCount)),
    buildImageStatsCell('image-stats-cell', String(channel.positiveInfinityPixelCount)),
    buildImageStatsCell('image-stats-cell', formatInvalidPercent(channel, pixelCount))
  );
  return row;
}

function formatImageStatsValue(value: number | null): string {
  return value === null ? 'n/a' : formatOverlayValue(value);
}

function formatInvalidPercent(channel: StatsChannelSummary, pixelCount: number): string {
  if (pixelCount <= 0) {
    return '0%';
  }

  const invalidCount =
    channel.nanPixelCount +
    channel.negativeInfinityPixelCount +
    channel.positiveInfinityPixelCount;
  if (invalidCount === 0) {
    return '0%';
  }

  const percent = (invalidCount / pixelCount) * 100;
  if (percent < 0.1) {
    return `${percent.toFixed(2)}%`;
  }
  if (percent < 10) {
    return `${percent.toFixed(1)}%`;
  }
  return `${percent.toFixed(0)}%`;
}

function buildImageStatsCell(className: string, text: string): HTMLSpanElement {
  const cell = document.createElement('span');
  cell.className = className;
  cell.textContent = text;
  return cell;
}
