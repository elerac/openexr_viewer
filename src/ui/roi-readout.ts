import { formatOverlayValue } from '../value-format';
import type { ImageRoi, RoiStats } from '../types';
import type { RoiReadoutElements } from './elements';

export function setRoiReadout(
  elements: RoiReadoutElements,
  readout: { roi: ImageRoi | null; stats: RoiStats | null }
): void {
  if (!readout.roi || !readout.stats) {
    elements.roiEmptyState.classList.remove('hidden');
    elements.roiDetails.classList.add('hidden');
    elements.clearRoiButton.disabled = true;
    elements.roiBounds.textContent = '';
    elements.roiSize.textContent = '';
    elements.roiPixelCount.textContent = '';
    elements.roiValidCount.textContent = '';
    elements.roiStats.replaceChildren();
    return;
  }

  elements.roiEmptyState.classList.add('hidden');
  elements.roiDetails.classList.remove('hidden');
  elements.clearRoiButton.disabled = false;
  elements.roiBounds.textContent = formatRoiBounds(readout.roi);
  elements.roiSize.textContent = `${readout.stats.width} × ${readout.stats.height} px`;
  elements.roiPixelCount.textContent = String(readout.stats.pixelCount);
  elements.roiValidCount.textContent = formatRoiValidCounts(readout.stats);
  renderRoiStats(elements, readout.stats);
}

export function formatRoiBounds(roi: ImageRoi): string {
  return `x ${roi.x0}..${roi.x1}  y ${roi.y0}..${roi.y1}`;
}

export function formatRoiValidCounts(stats: RoiStats): string {
  return stats.channels
    .map((channel) => `${channel.label} ${channel.validPixelCount}/${stats.pixelCount}`)
    .join(', ');
}

function renderRoiStats(elements: RoiReadoutElements, stats: RoiStats): void {
  elements.roiStats.replaceChildren(
    buildRoiStatsHeaderRow(),
    ...stats.channels.map((channel) => {
      const row = document.createElement('div');
      row.className = 'roi-stats-row';
      row.append(
        buildRoiStatsCell('roi-stats-cell roi-stats-cell--label', channel.label),
        buildRoiStatsCell('roi-stats-cell', formatRoiStatValue(channel.min)),
        buildRoiStatsCell('roi-stats-cell', formatRoiStatValue(channel.mean)),
        buildRoiStatsCell('roi-stats-cell', formatRoiStatValue(channel.max))
      );
      return row;
    })
  );
}

function formatRoiStatValue(value: number | null): string {
  return value === null ? 'n/a' : formatOverlayValue(value);
}

function buildRoiStatsHeaderRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'roi-stats-row roi-stats-row--header';
  row.append(
    buildRoiStatsCell('roi-stats-cell roi-stats-cell--label', 'Channel'),
    buildRoiStatsCell('roi-stats-cell', 'Min'),
    buildRoiStatsCell('roi-stats-cell', 'Mean'),
    buildRoiStatsCell('roi-stats-cell', 'Max')
  );
  return row;
}

function buildRoiStatsCell(className: string, text: string): HTMLSpanElement {
  const cell = document.createElement('span');
  cell.className = className;
  cell.textContent = text;
  return cell;
}
