import { formatOverlayValue } from '../value-format';
import type { PixelSample } from '../types';
import type { ProbeColorPreview, ProbeDisplayValue } from '../probe';
import type { ProbeReadoutElements } from './elements';

export interface ProbeCoordinateImageSize {
  width: number;
  height: number;
}

interface ProbeValueRowElements {
  row: HTMLDivElement;
  key: HTMLSpanElement;
  value: HTMLSpanElement;
}

interface ProbeColorRowElements {
  row: HTMLDivElement;
  channel: HTMLSpanElement;
  value: HTMLSpanElement;
}

export class ProbeReadoutController {
  private readonly probeValueRows = new Map<string, ProbeValueRowElements>();
  private readonly probeDisplayValueRows = new Map<string, ProbeColorRowElements>();

  constructor(private readonly elements: ProbeReadoutElements) {}

  setProbeReadout(
    mode: 'Hover' | 'Locked',
    sample: PixelSample | null,
    colorPreview: ProbeColorPreview | null,
    imageSize: ProbeCoordinateImageSize | null = null
  ): void {
    this.elements.probeMode.textContent = mode;

    if (!sample) {
      this.elements.probeCoords.textContent = formatProbeCoordinates(null, imageSize);
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.renderProbeDisplayValues(createEmptyProbeDisplayValues());
      this.renderProbeValueRows([]);
      return;
    }

    this.elements.probeCoords.textContent = formatProbeCoordinates(sample, imageSize);
    if (colorPreview) {
      this.elements.probeColorPreview.classList.remove('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = colorPreview.cssColor;
      this.renderProbeDisplayValues(colorPreview.displayValues);
    } else {
      this.elements.probeColorPreview.classList.add('is-empty');
      this.elements.probeColorSwatch.style.backgroundColor = 'transparent';
      this.renderProbeDisplayValues(createEmptyProbeDisplayValues());
    }

    const channelEntries = Object.entries(sample.values).sort(([a], [b]) => a.localeCompare(b));
    this.renderProbeValueRows(
      channelEntries.map(([channelName, channelValue]) => ({
        key: channelName,
        value: formatOverlayValue(channelValue)
      }))
    );
  }

  private renderProbeDisplayValues(displayValues: ProbeDisplayValue[]): void {
    if (this.probeDisplayValueRows.size === 0 && this.elements.probeColorValues.childElementCount > 0) {
      this.elements.probeColorValues.replaceChildren();
    }

    const orderedRows = displayValues.map((item) => {
      const existing = this.probeDisplayValueRows.get(item.label);
      if (existing) {
        existing.channel.textContent = `${item.label}:`;
        existing.value.textContent = item.value;
        return existing.row;
      }

      const row = document.createElement('div');
      row.className = 'probe-color-row';

      const channel = document.createElement('span');
      channel.className = 'probe-color-channel';
      channel.textContent = `${item.label}:`;

      const value = document.createElement('span');
      value.className = 'probe-color-number';
      value.textContent = item.value;

      row.append(channel, value);
      this.probeDisplayValueRows.set(item.label, {
        row,
        channel,
        value
      });
      return row;
    });

    pruneKeyedRows(this.probeDisplayValueRows, new Set(displayValues.map((item) => item.label)));
    syncRowOrder(this.elements.probeColorValues, orderedRows);
  }

  private renderProbeValueRows(items: Array<{ key: string; value: string }>): void {
    const orderedRows = items.map((item) => {
      const existing = this.probeValueRows.get(item.key);
      if (existing) {
        existing.key.textContent = item.key;
        existing.value.textContent = item.value;
        return existing.row;
      }

      const row = document.createElement('div');
      row.className = 'probe-row';

      const key = document.createElement('span');
      key.className = 'probe-key';
      key.textContent = item.key;

      const value = document.createElement('span');
      value.className = 'probe-value';
      value.textContent = item.value;

      row.append(key, value);
      this.probeValueRows.set(item.key, {
        row,
        key,
        value
      });
      return row;
    });

    pruneKeyedRows(this.probeValueRows, new Set(items.map((item) => item.key)));
    syncRowOrder(this.elements.probeValues, orderedRows);
  }
}

export function formatProbeCoordinates(
  sample: Pick<PixelSample, 'x' | 'y'> | null,
  imageSize: ProbeCoordinateImageSize | null = null
): string {
  const xWidth = getProbeCoordinateWidth(imageSize?.width);
  const yWidth = getProbeCoordinateWidth(imageSize?.height);
  return `x ${formatProbeCoordinateValue(sample?.x ?? null, xWidth)}   y ${formatProbeCoordinateValue(
    sample?.y ?? null,
    yWidth
  )}`;
}

function createEmptyProbeDisplayValues(): ProbeDisplayValue[] {
  return [
    { label: 'R', value: '-' },
    { label: 'G', value: '-' },
    { label: 'B', value: '-' }
  ];
}

function pruneKeyedRows<T extends { row: HTMLElement }>(rows: Map<string, T>, nextKeys: Set<string>): void {
  for (const [key, value] of rows.entries()) {
    if (nextKeys.has(key)) {
      continue;
    }

    value.row.remove();
    rows.delete(key);
  }
}

function syncRowOrder(container: HTMLElement, orderedRows: HTMLElement[]): void {
  let referenceNode = container.firstChild;
  for (const row of orderedRows) {
    if (row === referenceNode) {
      referenceNode = referenceNode?.nextSibling ?? null;
      continue;
    }

    container.insertBefore(row, referenceNode);
  }
}

function getProbeCoordinateWidth(size: number | undefined): number {
  if (!Number.isFinite(size) || size === undefined || size <= 0) {
    return 1;
  }

  return String(Math.max(0, Math.floor(size) - 1)).length;
}

function formatProbeCoordinateValue(value: number | null, width: number): string {
  if (value === null) {
    return '-'.padStart(width, ' ');
  }

  return String(Math.trunc(value)).padStart(width, ' ');
}
