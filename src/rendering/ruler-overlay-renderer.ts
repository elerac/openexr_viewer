import { imageToScreen } from '../interaction/image-geometry';
import type { Disposable } from '../lifecycle';
import { RULER_SIZE_PX } from '../ruler-layout';
import type { ViewerState, ViewportInfo } from '../types';

const RULER_SIZE = RULER_SIZE_PX;
const TARGET_MAJOR_TICK_PIXELS = 80;
const MIN_MINOR_TICK_PIXELS = 8;
const MAX_TICKS_PER_AXIS = 2000;
const RULER_LABEL_EDGE_INSET = 8;
const RULER_LABEL_MIN_GAP = 4;
const RULER_LABEL_FALLBACK_FONT_SIZE = 10;
const RULER_LABEL_FALLBACK_CHARACTER_WIDTH = 0.62;
const RULER_LABEL_PRIORITY_NORMAL = 0;
const RULER_LABEL_PRIORITY_MAX = 1;
const SVG_NS = 'http://www.w3.org/2000/svg';

type RulerAxis = 'horizontal' | 'vertical';

interface RulerPalette {
  surface: string;
  border: string;
  tick: string;
}

interface RulerLabelCandidate {
  axis: RulerAxis;
  text: string;
  x: number;
  y: number;
  priority: number;
  order: number;
}

interface RulerLabelBounds {
  axis: RulerAxis;
  start: number;
  end: number;
}

export class RulerOverlayRenderer implements Disposable {
  private readonly svg: SVGSVGElement;
  private readonly labelOverlay: HTMLElement;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private imageSize: { width: number; height: number } | null = null;
  private disposed = false;

  constructor(svg: SVGSVGElement, labelOverlay: HTMLElement) {
    this.svg = svg;
    this.labelOverlay = labelOverlay;
  }

  resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.svg.setAttribute('width', String(this.viewport.width));
    this.svg.setAttribute('height', String(this.viewport.height));
    this.svg.setAttribute('viewBox', `0 0 ${this.viewport.width} ${this.viewport.height}`);
  }

  setImageSize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.imageSize = {
      width: Math.max(0, Math.floor(width)),
      height: Math.max(0, Math.floor(height))
    };
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.imageSize = null;
    this.clear();
  }

  render(state: ViewerState, visible: boolean): void {
    if (this.disposed) {
      return;
    }

    this.clear();

    const imageSize = this.imageSize;
    if (!visible || !imageSize || state.viewerMode === 'panorama') {
      return;
    }

    if (imageSize.width <= 0 || imageSize.height <= 0 || state.zoom <= 0) {
      return;
    }

    const palette = readRulerPalette(this.svg);
    const fragment = document.createDocumentFragment();

    appendSvgRect(fragment, 0, 0, this.viewport.width, RULER_SIZE, palette.surface);
    appendSvgRect(fragment, 0, 0, RULER_SIZE, this.viewport.height, palette.surface);
    appendSvgLine(fragment, 0, RULER_SIZE - 0.5, this.viewport.width, RULER_SIZE - 0.5, palette.border);
    appendSvgLine(fragment, RULER_SIZE - 0.5, 0, RULER_SIZE - 0.5, this.viewport.height, palette.border);

    drawHorizontalRuler(fragment, this.labelOverlay, state, this.viewport, imageSize.width, palette.tick);
    drawVerticalRuler(fragment, this.labelOverlay, state, this.viewport, imageSize.height, palette.tick);

    this.svg.append(fragment);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.imageSize = null;
    this.clear();
  }

  private clear(): void {
    this.svg.replaceChildren();
    this.labelOverlay.replaceChildren();
  }
}

function drawHorizontalRuler(
  svg: ParentNode,
  labelOverlay: HTMLElement,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number,
  tickColor: string
): void {
  const majorStep = resolveMajorTickStep(state.zoom);
  const minorStep = resolveMinorTickStep(majorStep, state.zoom);
  const { start, end } = resolveVisibleImageBoundaryRange(state.panX, state.zoom, viewport.width, imageWidth);
  const labels: RulerLabelCandidate[] = [];

  drawMinorTicks(start, end, minorStep, majorStep, (position) => {
    const screen = imageToScreen(position, 0, state, viewport);
    drawHorizontalTick(svg, screen.x, 5, tickColor);
  });

  drawMajorTicks(start, end, majorStep, (position) => {
    const screen = imageToScreen(position, 0, state, viewport);
    drawHorizontalTick(svg, screen.x, 12, tickColor);
    addRulerLabelCandidate(
      labels,
      'horizontal',
      String(position),
      clamp(screen.x, RULER_SIZE + RULER_LABEL_EDGE_INSET, viewport.width - RULER_LABEL_EDGE_INSET),
      RULER_LABEL_EDGE_INSET,
      position === imageWidth ? RULER_LABEL_PRIORITY_MAX : RULER_LABEL_PRIORITY_NORMAL
    );
  });
  if (imageWidth >= start && imageWidth <= end && imageWidth % majorStep !== 0) {
    const screen = imageToScreen(imageWidth, 0, state, viewport);
    drawHorizontalTick(svg, screen.x, 12, tickColor);
    addRulerLabelCandidate(
      labels,
      'horizontal',
      String(imageWidth),
      clamp(screen.x, RULER_SIZE + RULER_LABEL_EDGE_INSET, viewport.width - RULER_LABEL_EDGE_INSET),
      RULER_LABEL_EDGE_INSET,
      RULER_LABEL_PRIORITY_MAX
    );
  }

  appendRulerLabels(labelOverlay, labels);
}

function drawVerticalRuler(
  svg: ParentNode,
  labelOverlay: HTMLElement,
  state: ViewerState,
  viewport: ViewportInfo,
  imageHeight: number,
  tickColor: string
): void {
  const majorStep = resolveMajorTickStep(state.zoom);
  const minorStep = resolveMinorTickStep(majorStep, state.zoom);
  const { start, end } = resolveVisibleImageBoundaryRange(state.panY, state.zoom, viewport.height, imageHeight);
  const labels: RulerLabelCandidate[] = [];

  drawMinorTicks(start, end, minorStep, majorStep, (position) => {
    const screen = imageToScreen(0, position, state, viewport);
    drawVerticalTick(svg, screen.y, 5, tickColor);
  });

  drawMajorTicks(start, end, majorStep, (position) => {
    const screen = imageToScreen(0, position, state, viewport);
    drawVerticalTick(svg, screen.y, 12, tickColor);
    addRulerLabelCandidate(
      labels,
      'vertical',
      String(position),
      RULER_LABEL_EDGE_INSET,
      clamp(screen.y, RULER_SIZE + RULER_LABEL_EDGE_INSET, viewport.height - RULER_LABEL_EDGE_INSET),
      position === imageHeight ? RULER_LABEL_PRIORITY_MAX : RULER_LABEL_PRIORITY_NORMAL
    );
  });
  if (imageHeight >= start && imageHeight <= end && imageHeight % majorStep !== 0) {
    const screen = imageToScreen(0, imageHeight, state, viewport);
    drawVerticalTick(svg, screen.y, 12, tickColor);
    addRulerLabelCandidate(
      labels,
      'vertical',
      String(imageHeight),
      RULER_LABEL_EDGE_INSET,
      clamp(screen.y, RULER_SIZE + RULER_LABEL_EDGE_INSET, viewport.height - RULER_LABEL_EDGE_INSET),
      RULER_LABEL_PRIORITY_MAX
    );
  }

  appendRulerLabels(labelOverlay, labels);
}

function appendRulerLabel(
  labelOverlay: HTMLElement,
  axis: RulerAxis,
  text: string,
  x: number,
  y: number
): void {
  const label = document.createElement('span');
  label.className = `ruler-label ruler-label--${axis}`;
  label.textContent = text;
  label.style.left = `${x}px`;
  label.style.top = `${y}px`;
  labelOverlay.append(label);
}

function addRulerLabelCandidate(
  labels: RulerLabelCandidate[],
  axis: RulerAxis,
  text: string,
  x: number,
  y: number,
  priority: number
): void {
  labels.push({
    axis,
    text,
    x,
    y,
    priority,
    order: labels.length
  });
}

function appendRulerLabels(labelOverlay: HTMLElement, labels: RulerLabelCandidate[]): void {
  const visibleLabels = resolveVisibleRulerLabels(labelOverlay, labels);

  for (const label of labels) {
    if (!visibleLabels.has(label)) {
      continue;
    }
    appendRulerLabel(labelOverlay, label.axis, label.text, label.x, label.y);
  }
}

function resolveVisibleRulerLabels(
  labelOverlay: HTMLElement,
  labels: RulerLabelCandidate[]
): Set<RulerLabelCandidate> {
  const accepted: Array<{ label: RulerLabelCandidate; bounds: RulerLabelBounds }> = [];
  const prioritizedLabels = [...labels].sort((a, b) => b.priority - a.priority || a.order - b.order);

  for (const label of prioritizedLabels) {
    const bounds = resolveRulerLabelBounds(labelOverlay, label);
    const overlapsAcceptedLabel = accepted.some((acceptedLabel) => (
      acceptedLabel.bounds.axis === bounds.axis &&
      rulerLabelBoundsOverlap(acceptedLabel.bounds, bounds)
    ));

    if (!overlapsAcceptedLabel) {
      accepted.push({ label, bounds });
    }
  }

  return new Set(accepted.map((entry) => entry.label));
}

function resolveRulerLabelBounds(labelOverlay: HTMLElement, label: RulerLabelCandidate): RulerLabelBounds {
  const center = label.axis === 'horizontal' ? label.x : label.y;
  const extent = measureRulerLabelAxisExtent(labelOverlay, label.axis, label.text);

  return {
    axis: label.axis,
    start: center - extent * 0.5,
    end: center + extent * 0.5
  };
}

function rulerLabelBoundsOverlap(a: RulerLabelBounds, b: RulerLabelBounds): boolean {
  return a.start < b.end + RULER_LABEL_MIN_GAP && b.start < a.end + RULER_LABEL_MIN_GAP;
}

function measureRulerLabelAxisExtent(labelOverlay: HTMLElement, axis: RulerAxis, text: string): number {
  const renderedExtent = measureRenderedRulerLabelAxisExtent(labelOverlay, axis, text);
  if (renderedExtent > 0) {
    return renderedExtent;
  }

  return estimateRulerLabelAxisExtent(labelOverlay, text);
}

function measureRenderedRulerLabelAxisExtent(labelOverlay: HTMLElement, axis: RulerAxis, text: string): number {
  const label = document.createElement('span');
  label.className = `ruler-label ruler-label--${axis}`;
  label.textContent = text;
  label.style.left = '0px';
  label.style.top = '0px';
  label.style.visibility = 'hidden';
  labelOverlay.append(label);

  const rect = label.getBoundingClientRect();
  label.remove();

  const extent = axis === 'horizontal' ? rect.width : rect.height;
  return Number.isFinite(extent) && extent > 0 ? extent : 0;
}

function estimateRulerLabelAxisExtent(labelOverlay: HTMLElement, text: string): number {
  const fontSize = readRulerLabelFontSize(labelOverlay);
  const characterCount = Math.max(1, Array.from(text).length);
  return Math.max(fontSize, characterCount * fontSize * RULER_LABEL_FALLBACK_CHARACTER_WIDTH);
}

function readRulerLabelFontSize(labelOverlay: HTMLElement): number {
  const computedFontSize = Number.parseFloat(getComputedStyle(labelOverlay).fontSize);
  if (Number.isFinite(computedFontSize) && computedFontSize > 0) {
    return computedFontSize;
  }

  const inlineFontSize = Number.parseFloat(labelOverlay.style.fontSize);
  if (Number.isFinite(inlineFontSize) && inlineFontSize > 0) {
    return inlineFontSize;
  }

  return RULER_LABEL_FALLBACK_FONT_SIZE;
}

function drawHorizontalTick(svg: ParentNode, x: number, length: number, color: string): void {
  appendSvgLine(svg, x + 0.5, RULER_SIZE, x + 0.5, RULER_SIZE - length, color);
}

function drawVerticalTick(svg: ParentNode, y: number, length: number, color: string): void {
  appendSvgLine(svg, RULER_SIZE, y + 0.5, RULER_SIZE - length, y + 0.5, color);
}

function appendSvgRect(svg: ParentNode, x: number, y: number, width: number, height: number, fill: string): void {
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(height));
  rect.setAttribute('fill', fill);
  svg.append(rect);
}

function appendSvgLine(svg: ParentNode, x1: number, y1: number, x2: number, y2: number, stroke: string): void {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '1');
  svg.append(line);
}

function drawMinorTicks(
  start: number,
  end: number,
  step: number,
  majorStep: number,
  draw: (position: number) => void
): void {
  if (step <= 0 || step >= majorStep) {
    return;
  }

  const first = Math.ceil(start / step) * step;
  const tickCount = Math.floor((end - first) / step) + 1;
  if (tickCount <= 0 || tickCount > MAX_TICKS_PER_AXIS) {
    return;
  }

  for (let position = first; position <= end; position += step) {
    if (position % majorStep === 0) {
      continue;
    }
    draw(position);
  }
}

function drawMajorTicks(
  start: number,
  end: number,
  step: number,
  draw: (position: number) => void
): void {
  const first = Math.ceil(start / step) * step;
  const tickCount = Math.floor((end - first) / step) + 1;
  if (tickCount <= 0 || tickCount > MAX_TICKS_PER_AXIS) {
    return;
  }

  for (let position = first; position <= end; position += step) {
    draw(position);
  }
}

function resolveVisibleImageBoundaryRange(
  pan: number,
  zoom: number,
  viewportSize: number,
  imageSize: number
): { start: number; end: number } {
  const halfViewportImageSize = viewportSize / (2 * zoom);
  const visibleStart = pan - halfViewportImageSize;
  const visibleEnd = pan + halfViewportImageSize;

  return {
    start: Math.max(0, Math.floor(visibleStart)),
    end: Math.min(imageSize, Math.ceil(visibleEnd))
  };
}

function resolveMajorTickStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return 1;
  }

  const targetImagePixels = TARGET_MAJOR_TICK_PIXELS / zoom;
  if (targetImagePixels <= 1) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(targetImagePixels));
  const scale = 10 ** exponent;
  const normalized = targetImagePixels / scale;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.ceil(multiplier * scale));
}

function resolveMinorTickStep(majorStep: number, zoom: number): number {
  const candidates = [
    majorStep / 10,
    majorStep / 5,
    majorStep / 2
  ].filter((value) => Number.isInteger(value) && value > 0 && value < majorStep);

  for (const candidate of candidates) {
    if (candidate * zoom >= MIN_MINOR_TICK_PIXELS) {
      return candidate;
    }
  }

  return 0;
}

function readRulerPalette(element: Element): RulerPalette {
  const style = getComputedStyle(element);
  return {
    surface: readCssColor(style, '--ruler-surface', 'rgba(12, 17, 24, 0.86)'),
    border: readCssColor(style, '--ruler-border', 'rgba(215, 221, 232, 0.24)'),
    tick: readCssColor(style, '--ruler-tick', 'rgba(215, 221, 232, 0.72)')
  };
}

function readCssColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
