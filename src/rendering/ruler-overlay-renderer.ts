import { imageToScreen } from '../interaction/image-geometry';
import type { Disposable } from '../lifecycle';
import type { ViewerState, ViewportInfo } from '../types';

const RULER_SIZE = 24;
const TARGET_MAJOR_TICK_PIXELS = 80;
const MIN_MINOR_TICK_PIXELS = 8;
const MAX_TICKS_PER_AXIS = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface RulerPalette {
  surface: string;
  border: string;
  tick: string;
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

  drawMinorTicks(start, end, minorStep, majorStep, (position) => {
    const screen = imageToScreen(position, 0, state, viewport);
    drawHorizontalTick(svg, screen.x, 5, tickColor);
  });

  drawMajorTicks(start, end, majorStep, (position) => {
    const screen = imageToScreen(position, 0, state, viewport);
    drawHorizontalTick(svg, screen.x, 12, tickColor);
    appendRulerLabel(labelOverlay, 'horizontal', String(position), clamp(screen.x, RULER_SIZE + 8, viewport.width - 8), 8);
  });
  if (imageWidth >= start && imageWidth <= end && imageWidth % majorStep !== 0) {
    const screen = imageToScreen(imageWidth, 0, state, viewport);
    drawHorizontalTick(svg, screen.x, 12, tickColor);
    appendRulerLabel(labelOverlay, 'horizontal', String(imageWidth), clamp(screen.x, RULER_SIZE + 8, viewport.width - 8), 8);
  }
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

  drawMinorTicks(start, end, minorStep, majorStep, (position) => {
    const screen = imageToScreen(0, position, state, viewport);
    drawVerticalTick(svg, screen.y, 5, tickColor);
  });

  drawMajorTicks(start, end, majorStep, (position) => {
    const screen = imageToScreen(0, position, state, viewport);
    drawVerticalTick(svg, screen.y, 12, tickColor);
    appendRulerLabel(labelOverlay, 'vertical', String(position), 8, clamp(screen.y, RULER_SIZE + 8, viewport.height - 8));
  });
  if (imageHeight >= start && imageHeight <= end && imageHeight % majorStep !== 0) {
    const screen = imageToScreen(0, imageHeight, state, viewport);
    drawVerticalTick(svg, screen.y, 12, tickColor);
    appendRulerLabel(labelOverlay, 'vertical', String(imageHeight), 8, clamp(screen.y, RULER_SIZE + 8, viewport.height - 8));
  }
}

function appendRulerLabel(
  labelOverlay: HTMLElement,
  axis: 'horizontal' | 'vertical',
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
