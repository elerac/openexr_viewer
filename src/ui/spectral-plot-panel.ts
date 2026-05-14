import type { SpectralPlotReadoutModel } from '../app/viewer-app-types';
import type { Disposable } from '../lifecycle';
import type { SpectralPlotPanelElements } from './elements';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPECTRAL_CHART_DEFAULT_WIDTH = 360;
const SPECTRAL_CHART_DEFAULT_HEIGHT = 230;
const SPECTRAL_CHART_ASPECT_RATIO = SPECTRAL_CHART_DEFAULT_HEIGHT / SPECTRAL_CHART_DEFAULT_WIDTH;
const SPECTRAL_X_TICK_LABEL_MIN_GAP = 4;
const SPECTRAL_X_TICK_LABEL_FONT_SIZE = 10;
const SPECTRAL_X_TICK_LABEL_CHARACTER_WIDTH = 0.62;
const SPECTRAL_TICK_PRIORITY_NORMAL = 0;
const SPECTRAL_TICK_PRIORITY_ENDPOINT = 1;
const SPECTRAL_RESIZE_EPSILON = 0.5;

interface PlotMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SpectralXAxisTick {
  value: number;
  label: string;
  showLabel: boolean;
}

interface SpectralXAxisTickCandidate {
  value: number;
  label: string;
  priority: number;
  order: number;
}

interface SpectralYAxisRange {
  min: number;
  max: number;
}

export class SpectralPlotPanel implements Disposable {
  private readonly resizeObserver: ResizeObserver | null;
  private latestReadout: SpectralPlotReadoutModel | null = null;
  private renderedWidth: number | null = null;
  private pendingMeasureFrame: number | null = null;

  constructor(private readonly elements: SpectralPlotPanelElements) {
    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        this.handleResize();
      });
    this.resizeObserver?.observe(this.elements.spectralPlot);
  }

  setReadout(readout: SpectralPlotReadoutModel): void {
    this.latestReadout = readout;
    this.renderReadout(true);
  }

  dispose(): void {
    this.cancelPendingMeasuredRender();
    this.resizeObserver?.disconnect();
  }

  private handleResize(): void {
    const readout = this.latestReadout;
    if (!readout || !shouldRenderSpectralChart(this.elements, readout)) {
      return;
    }

    const width = measureSpectralPlotWidth(this.elements.spectralPlot);
    if (this.renderedWidth !== null && Math.abs(width - this.renderedWidth) < SPECTRAL_RESIZE_EPSILON) {
      return;
    }

    this.renderReadout(false);
  }

  private renderReadout(force: boolean): void {
    const readout = this.latestReadout;
    if (!readout) {
      return;
    }

    this.elements.spectralPanel.classList.toggle('hidden', !readout.visible);

    if (!readout.visible) {
      this.elements.spectralEmptyState.classList.remove('hidden');
      this.elements.spectralPlot.classList.add('hidden');
      this.elements.spectralPlot.replaceChildren();
      this.renderedWidth = null;
      this.cancelPendingMeasuredRender();
      return;
    }

    if (readout.channels.length === 0) {
      this.elements.spectralEmptyState.classList.remove('hidden');
      this.elements.spectralPlot.classList.add('hidden');
      this.elements.spectralPlot.replaceChildren();
      this.renderedWidth = null;
      this.cancelPendingMeasuredRender();
      return;
    }

    if (readout.points.length === 0) {
      this.elements.spectralEmptyState.textContent = readout.pixel
        ? 'No finite spectral values at this pixel.'
        : 'Hover or lock a pixel to inspect its spectrum.';
      this.elements.spectralEmptyState.classList.remove('hidden');
    } else {
      this.elements.spectralEmptyState.classList.add('hidden');
    }

    this.elements.spectralPlot.classList.remove('hidden');
    const width = measureSpectralPlotWidth(this.elements.spectralPlot);
    if (!force && this.renderedWidth !== null && Math.abs(width - this.renderedWidth) < SPECTRAL_RESIZE_EPSILON) {
      return;
    }

    this.elements.spectralPlot.replaceChildren(renderSpectralChart(readout, width));
    this.renderedWidth = width;
    this.scheduleMeasuredRender();
  }

  private scheduleMeasuredRender(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      return;
    }

    this.cancelPendingMeasuredRender();
    this.pendingMeasureFrame = requestAnimationFrame(() => {
      this.pendingMeasureFrame = null;
      this.handleResize();
    });
  }

  private cancelPendingMeasuredRender(): void {
    if (this.pendingMeasureFrame === null || typeof cancelAnimationFrame === 'undefined') {
      this.pendingMeasureFrame = null;
      return;
    }

    cancelAnimationFrame(this.pendingMeasureFrame);
    this.pendingMeasureFrame = null;
  }
}

function shouldRenderSpectralChart(
  elements: SpectralPlotPanelElements,
  readout: SpectralPlotReadoutModel
): boolean {
  return (
    readout.visible &&
    readout.channels.length > 0 &&
    !elements.spectralPanel.classList.contains('hidden') &&
    !elements.spectralPlot.classList.contains('hidden')
  );
}

function measureSpectralPlotWidth(element: HTMLElement): number {
  if (Number.isFinite(element.clientWidth) && element.clientWidth > 0) {
    return element.clientWidth;
  }

  const rectWidth = element.getBoundingClientRect().width;
  if (Number.isFinite(rectWidth) && rectWidth > 0) {
    return rectWidth;
  }

  return SPECTRAL_CHART_DEFAULT_WIDTH;
}

function renderSpectralChart(readout: SpectralPlotReadoutModel, measuredWidth: number): SVGSVGElement {
  const points = readout.points;
  const domainChannels = readout.channels.length > 0 ? readout.channels : readout.points;
  const width = measuredWidth;
  const height = width * SPECTRAL_CHART_ASPECT_RATIO;
  const margin: PlotMargins = { top: 14, right: 14, bottom: 30, left: 42 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const wavelengths = domainChannels.map((channel) => channel.wavelength);
  const intensities = points.map((point) => point.intensity);
  const xMin = Math.min(...wavelengths);
  const xMax = Math.max(...wavelengths);
  const yRange = resolveSpectralYRange(intensities, readout.yAxis);
  const yMin = yRange.min;
  const yMax = yRange.max;
  const ySpan = Math.max(Number.EPSILON, yMax - yMin);
  const yBaseline = clamp(0, yMin, yMax);
  const xScale = (wavelength: number): number => {
    const range = xMax - xMin;
    if (range <= 0) {
      return margin.left + plotWidth / 2;
    }
    return margin.left + ((wavelength - xMin) / range) * plotWidth;
  };
  const yScale = (intensity: number): number =>
    margin.top + plotHeight - ((clamp(intensity, yMin, yMax) - yMin) / ySpan) * plotHeight;
  const xTicks = makeWavelengthTicks(xMin, xMax, 6, xScale);
  const yTicks = makeTicks(yMin, yMax, 4);

  const svg = createSvgElement('svg');
  setSvgAttributes(svg, {
    class: 'spectral-chart',
    width: formatSvgNumber(width),
    height: formatSvgNumber(height),
    viewBox: `0 0 ${formatSvgNumber(width)} ${formatSvgNumber(height)}`,
    role: 'img',
    'aria-label': readout.pixel
      ? `Spectral intensity plot at ${readout.mode.toLowerCase()} pixel`
      : 'Spectral intensity plot waiting for pixel'
  });

  const defs = createSvgElement('defs');
  const gradient = createSvgElement('linearGradient');
  setSvgAttributes(gradient, {
    id: 'spectral-area-fill',
    x1: '0',
    x2: '1',
    y1: '0',
    y2: '0'
  });
  for (let index = 0; index <= 40; index += 1) {
    const wavelength = xMin + ((xMax - xMin) * index) / 40;
    const stop = createSvgElement('stop');
    const visible = wavelengthToRgb(wavelength).visible;
    setSvgAttributes(stop, {
      offset: `${(index / 40) * 100}%`,
      'stop-color': wavelengthColor(wavelength, visible ? 0.82 : 0.12)
    });
    gradient.append(stop);
  }

  const clipPath = createSvgElement('clipPath');
  setSvgAttributes(clipPath, { id: 'spectral-plot-clip' });
  const clipRect = createSvgElement('rect');
  setSvgAttributes(clipRect, {
    x: margin.left,
    y: margin.top,
    width: plotWidth,
    height: plotHeight,
    rx: 8
  });
  clipPath.append(clipRect);
  defs.append(gradient, clipPath);
  svg.append(defs);

  const background = createSvgElement('rect');
  setSvgAttributes(background, {
    x: 0,
    y: 0,
    width,
    height,
    rx: 10,
    fill: 'rgb(9, 13, 20)'
  });
  svg.append(background);

  const plotArea = createSvgElement('rect');
  setSvgAttributes(plotArea, {
    x: margin.left,
    y: margin.top,
    width: plotWidth,
    height: plotHeight,
    rx: 8,
    fill: 'rgba(255, 255, 255, 0.035)',
    stroke: 'rgba(255, 255, 255, 0.12)'
  });
  svg.append(plotArea);

  for (const tick of yTicks) {
    const line = createSvgElement('line');
    setSvgAttributes(line, {
      x1: margin.left,
      x2: margin.left + plotWidth,
      y1: yScale(tick),
      y2: yScale(tick),
      stroke: 'rgba(255, 255, 255, 0.10)',
      'stroke-dasharray': '3 5'
    });
    svg.append(line);
    svg.append(createText(formatSpectralYAxisTick(tick), margin.left - 8, yScale(tick) + 4, {
      className: 'spectral-tick-label spectral-tick-label--y',
      anchor: 'end'
    }));
  }

  if (yMin < 0 && yMax > 0) {
    const zeroLine = createSvgElement('line');
    setSvgAttributes(zeroLine, {
      class: 'spectral-zero-line',
      x1: margin.left,
      x2: margin.left + plotWidth,
      y1: yScale(0),
      y2: yScale(0),
      stroke: 'rgba(248, 250, 252, 0.42)',
      'stroke-width': 1
    });
    svg.append(zeroLine);
  }

  for (const tick of xTicks) {
    const line = createSvgElement('line');
    setSvgAttributes(line, {
      x1: xScale(tick.value),
      x2: xScale(tick.value),
      y1: margin.top,
      y2: margin.top + plotHeight,
      stroke: 'rgba(255, 255, 255, 0.07)',
      'stroke-dasharray': '3 5'
    });
    svg.append(line);
    if (tick.showLabel) {
      svg.append(createText(tick.label, xScale(tick.value), margin.top + plotHeight + 18, {
        className: 'spectral-tick-label spectral-tick-label--x',
        anchor: 'middle'
      }));
    }
  }

  if (points.length > 0) {
    const areaPath = createSvgElement('path');
    setSvgAttributes(areaPath, {
      d: buildAreaPath(points, xScale, yScale, yBaseline),
      fill: 'url(#spectral-area-fill)',
      opacity: 0.78,
      'clip-path': 'url(#spectral-plot-clip)'
    });
    svg.append(areaPath);
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) {
      continue;
    }

    const line = createSvgElement('line');
    setSvgAttributes(line, {
      class: 'spectral-line-segment',
      x1: xScale(point.wavelength),
      y1: yScale(point.intensity),
      x2: xScale(next.wavelength),
      y2: yScale(next.intensity),
      stroke: 'rgba(248, 250, 252, 0.94)',
      'stroke-width': 2,
      'stroke-linecap': 'round'
    });
    svg.append(line);
  }

  for (const point of points) {
    const circle = createSvgElement('circle');
    const visible = wavelengthToRgb(point.wavelength).visible;
    setSvgAttributes(circle, {
      class: 'spectral-point',
      cx: xScale(point.wavelength),
      cy: yScale(point.intensity),
      r: 2.6,
      fill: 'rgb(9, 13, 20)',
      stroke: wavelengthColor(point.wavelength, visible ? 1 : 0.35),
      'stroke-width': 1.2,
      'data-channel': point.channelName,
      'data-wavelength': String(point.wavelength),
      'data-intensity': String(point.intensity)
    });
    const title = createSvgElement('title');
    title.textContent = `${formatNumber(point.wavelength, 0)} nm - ${formatNumber(point.intensity, 3)}`;
    circle.append(title);
    svg.append(circle);
  }

  const xAxis = createSvgElement('line');
  setSvgAttributes(xAxis, {
    x1: margin.left,
    x2: margin.left + plotWidth,
    y1: margin.top + plotHeight,
    y2: margin.top + plotHeight,
    stroke: 'rgba(248, 250, 252, 0.78)'
  });
  svg.append(xAxis);

  const yAxis = createSvgElement('line');
  setSvgAttributes(yAxis, {
    x1: margin.left,
    x2: margin.left,
    y1: margin.top,
    y2: margin.top + plotHeight,
    stroke: 'rgba(248, 250, 252, 0.78)'
  });
  svg.append(yAxis);

  return svg;
}

function buildAreaPath(
  points: SpectralPlotReadoutModel['points'],
  xScale: (wavelength: number) => number,
  yScale: (intensity: number) => number,
  baseline: number
): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return '';
  }

  return [
    `M ${xScale(first.wavelength)} ${yScale(baseline)}`,
    ...points.map((point) => `L ${xScale(point.wavelength)} ${yScale(point.intensity)}`),
    `L ${xScale(last.wavelength)} ${yScale(baseline)}`,
    'Z'
  ].join(' ');
}

function createText(
  value: string,
  x: number,
  y: number,
  options: { className: string; anchor: 'start' | 'middle' | 'end' }
): SVGTextElement {
  const text = createSvgElement('text');
  setSvgAttributes(text, {
    class: options.className,
    x,
    y,
    'text-anchor': options.anchor
  });
  text.textContent = value;
  return text;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function setSvgAttributes(
  element: SVGElement,
  attributes: Record<string, string | number>
): void {
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
}

function formatSvgNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveSpectralYRange(
  intensities: readonly number[],
  yAxis: SpectralPlotReadoutModel['yAxis']
): SpectralYAxisRange {
  if (yAxis && Number.isFinite(yAxis.range.min) && Number.isFinite(yAxis.range.max)) {
    return normalizeSpectralYRange(yAxis.range.min, yAxis.range.max);
  }

  const maxIntensity = Math.max(...intensities, 0);
  return { min: 0, max: maxIntensity > 0 ? maxIntensity : 1 };
}

function normalizeSpectralYRange(min: number, max: number): SpectralYAxisRange {
  if (max > min) {
    return { min, max };
  }

  const center = Number.isFinite(min) ? min : 0;
  const margin = Math.max(1, Math.abs(center) * 0.1);
  return {
    min: center - margin,
    max: center + margin
  };
}

function wavelengthToRgb(wavelength: number): { r: number; g: number; b: number; visible: boolean } {
  const nm = Number(wavelength);
  let r = 0;
  let g = 0;
  let b = 0;

  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (nm >= 440 && nm < 490) {
    r = 0;
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm >= 490 && nm < 510) {
    r = 0;
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (nm >= 580 && nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
    b = 0;
  } else if (nm >= 645 && nm <= 780) {
    r = 1;
    g = 0;
    b = 0;
  } else {
    return { r: 80, g: 90, b: 110, visible: false };
  }

  let factor = 1;
  if (nm >= 380 && nm < 420) {
    factor = 0.3 + (0.7 * (nm - 380)) / (420 - 380);
  } else if (nm >= 420 && nm <= 700) {
    factor = 1;
  } else if (nm > 700 && nm <= 780) {
    factor = 0.3 + (0.7 * (780 - nm)) / (780 - 700);
  }

  const gamma = 0.8;
  return {
    r: Math.round(255 * Math.pow(r * factor, gamma)),
    g: Math.round(255 * Math.pow(g * factor, gamma)),
    b: Math.round(255 * Math.pow(b * factor, gamma)),
    visible: true
  };
}

function wavelengthColor(wavelength: number, alpha = 1): string {
  const { r, g, b } = wavelengthToRgb(wavelength);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function niceStep(range: number, targetTickCount: number): number {
  if (!Number.isFinite(range) || range <= 0) {
    return 1;
  }

  const rawStep = range / Math.max(1, targetTickCount);
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const scaled = rawStep / power;
  if (scaled >= 5) {
    return 5 * power;
  }
  if (scaled >= 2) {
    return 2 * power;
  }
  return power;
}

function makeTicks(min: number, max: number, targetTickCount: number): number[] {
  const step = niceStep(max - min, targetTickCount);
  const ticks: number[] = [];
  let tick = Math.ceil(min / step) * step;
  const precision = getTickRoundingPrecision(step);
  const epsilon = getTickComparisonEpsilon(step, max);
  const minLimit = min - epsilon;
  const maxLimit = max + epsilon;
  while (tick <= maxLimit) {
    const roundedTick = Number(tick.toFixed(precision));
    if (roundedTick >= minLimit && roundedTick <= maxLimit) {
      ticks.push(roundedTick);
    }
    tick += step;
  }
  return ticks;
}

function makeWavelengthTicks(
  min: number,
  max: number,
  targetTickCount: number,
  scale: (value: number) => number
): SpectralXAxisTick[] {
  const candidatesByValue = new Map<string, SpectralXAxisTickCandidate>();
  let order = 0;
  for (const tick of makeTicks(min, max, targetTickCount)) {
    addSpectralTickCandidate(
      candidatesByValue,
      tick,
      SPECTRAL_TICK_PRIORITY_NORMAL,
      order
    );
    order += 1;
  }

  addSpectralTickCandidate(candidatesByValue, min, SPECTRAL_TICK_PRIORITY_ENDPOINT, -2);
  if (max !== min) {
    addSpectralTickCandidate(candidatesByValue, max, SPECTRAL_TICK_PRIORITY_ENDPOINT, -1);
  }

  const candidates = [...candidatesByValue.values()].sort((a, b) => a.value - b.value);
  const visibleLabels = resolveVisibleSpectralTickLabels(candidates, scale);
  return candidates.map((candidate) => ({
    value: candidate.value,
    label: candidate.label,
    showLabel: visibleLabels.has(candidate)
  }));
}

function addSpectralTickCandidate(
  candidatesByValue: Map<string, SpectralXAxisTickCandidate>,
  value: number,
  priority: number,
  order: number
): void {
  const key = String(value);
  const existing = candidatesByValue.get(key);
  if (existing) {
    existing.priority = Math.max(existing.priority, priority);
    existing.order = Math.min(existing.order, order);
    return;
  }

  candidatesByValue.set(key, {
    value,
    label: key,
    priority,
    order
  });
}

function resolveVisibleSpectralTickLabels(
  candidates: SpectralXAxisTickCandidate[],
  scale: (value: number) => number
): Set<SpectralXAxisTickCandidate> {
  const accepted: Array<{ candidate: SpectralXAxisTickCandidate; start: number; end: number }> = [];
  const prioritizedCandidates = [...candidates].sort((a, b) => b.priority - a.priority || a.order - b.order);

  for (const candidate of prioritizedCandidates) {
    const center = scale(candidate.value);
    const extent = estimateSpectralTickLabelWidth(candidate.label);
    const bounds = {
      start: center - extent * 0.5,
      end: center + extent * 0.5
    };
    const overlapsAcceptedLabel = accepted.some((entry) => (
      bounds.start < entry.end + SPECTRAL_X_TICK_LABEL_MIN_GAP &&
      entry.start < bounds.end + SPECTRAL_X_TICK_LABEL_MIN_GAP
    ));

    if (!overlapsAcceptedLabel) {
      accepted.push({ candidate, ...bounds });
    }
  }

  return new Set(accepted.map((entry) => entry.candidate));
}

function estimateSpectralTickLabelWidth(label: string): number {
  const characterCount = Math.max(1, Array.from(label).length);
  return Math.max(
    SPECTRAL_X_TICK_LABEL_FONT_SIZE,
    characterCount * SPECTRAL_X_TICK_LABEL_FONT_SIZE * SPECTRAL_X_TICK_LABEL_CHARACTER_WIDTH
  );
}

function getTickComparisonEpsilon(step: number, value: number): number {
  const magnitude = Math.max(Math.abs(step), Math.abs(value), 1);
  return Math.max(Number.EPSILON * magnitude * 16, Math.abs(step) * 1e-6);
}

function getTickRoundingPrecision(step: number): number {
  if (!Number.isFinite(step) || step >= 1) {
    return 0;
  }

  return Math.min(12, Math.ceil(-Math.log10(Math.max(step, Number.MIN_VALUE))) + 1);
}

function formatSpectralYAxisTick(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const rounded = Math.abs(value) < Number.EPSILON
    ? 0
    : Number(value.toPrecision(8));
  return String(rounded);
}

function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(decimals);
}
