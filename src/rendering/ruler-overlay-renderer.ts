import { imageToScreen } from '../interaction/image-geometry';
import type { Disposable } from '../lifecycle';
import type { ViewerState, ViewportInfo } from '../types';

const RULER_SIZE = 24;
const TARGET_MAJOR_TICK_PIXELS = 80;
const MIN_MINOR_TICK_PIXELS = 8;
const MAX_TICKS_PER_AXIS = 2000;

interface RulerPalette {
  surface: string;
  border: string;
  tick: string;
  text: string;
}

export class RulerOverlayRenderer implements Disposable {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private imageSize: { width: number; height: number } | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create ruler overlay 2D canvas context.');
    }

    this.canvas = canvas;
    this.context = context;
  }

  resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.canvas.width = this.viewport.width;
    this.canvas.height = this.viewport.height;
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

    const palette = readRulerPalette(this.canvas);
    const ctx = this.context;

    ctx.fillStyle = palette.surface;
    ctx.fillRect(0, 0, this.viewport.width, RULER_SIZE);
    ctx.fillRect(0, 0, RULER_SIZE, this.viewport.height);

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_SIZE - 0.5);
    ctx.lineTo(this.viewport.width, RULER_SIZE - 0.5);
    ctx.moveTo(RULER_SIZE - 0.5, 0);
    ctx.lineTo(RULER_SIZE - 0.5, this.viewport.height);
    ctx.stroke();

    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.text;
    ctx.strokeStyle = palette.tick;
    ctx.lineWidth = 1;

    drawHorizontalRuler(ctx, state, this.viewport, imageSize.width);
    drawVerticalRuler(ctx, state, this.viewport, imageSize.height);
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
    this.context.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }
}

function drawHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number
): void {
  const majorStep = resolveMajorTickStep(state.zoom);
  const minorStep = resolveMinorTickStep(majorStep, state.zoom);
  const { start, end } = resolveVisibleImageBoundaryRange(state.panX, state.zoom, viewport.width, imageWidth);

  drawMinorTicks(start, end, minorStep, majorStep, (position) => {
    const screen = imageToScreen(position, 0, state, viewport);
    drawHorizontalTick(ctx, screen.x, 5);
  });

  drawMajorTicks(start, end, majorStep, (position) => {
    const screen = imageToScreen(position, 0, state, viewport);
    drawHorizontalTick(ctx, screen.x, 12);
    ctx.textAlign = 'center';
    ctx.fillText(String(position), clamp(screen.x, RULER_SIZE + 8, viewport.width - 8), 8);
  });
  if (imageWidth >= start && imageWidth <= end && imageWidth % majorStep !== 0) {
    const screen = imageToScreen(imageWidth, 0, state, viewport);
    drawHorizontalTick(ctx, screen.x, 12);
    ctx.textAlign = 'center';
    ctx.fillText(String(imageWidth), clamp(screen.x, RULER_SIZE + 8, viewport.width - 8), 8);
  }
}

function drawVerticalRuler(
  ctx: CanvasRenderingContext2D,
  state: ViewerState,
  viewport: ViewportInfo,
  imageHeight: number
): void {
  const majorStep = resolveMajorTickStep(state.zoom);
  const minorStep = resolveMinorTickStep(majorStep, state.zoom);
  const { start, end } = resolveVisibleImageBoundaryRange(state.panY, state.zoom, viewport.height, imageHeight);

  drawMinorTicks(start, end, minorStep, majorStep, (position) => {
    const screen = imageToScreen(0, position, state, viewport);
    drawVerticalTick(ctx, screen.y, 5);
  });

  drawMajorTicks(start, end, majorStep, (position) => {
    const screen = imageToScreen(0, position, state, viewport);
    drawVerticalTick(ctx, screen.y, 12);
    ctx.save();
    ctx.translate(8, clamp(screen.y, RULER_SIZE + 8, viewport.height - 8));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(String(position), 0, 0);
    ctx.restore();
  });
  if (imageHeight >= start && imageHeight <= end && imageHeight % majorStep !== 0) {
    const screen = imageToScreen(0, imageHeight, state, viewport);
    drawVerticalTick(ctx, screen.y, 12);
    ctx.save();
    ctx.translate(8, clamp(screen.y, RULER_SIZE + 8, viewport.height - 8));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(String(imageHeight), 0, 0);
    ctx.restore();
  }
}

function drawHorizontalTick(ctx: CanvasRenderingContext2D, x: number, length: number): void {
  ctx.beginPath();
  ctx.moveTo(x + 0.5, RULER_SIZE);
  ctx.lineTo(x + 0.5, RULER_SIZE - length);
  ctx.stroke();
}

function drawVerticalTick(ctx: CanvasRenderingContext2D, y: number, length: number): void {
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE, y + 0.5);
  ctx.lineTo(RULER_SIZE - length, y + 0.5);
  ctx.stroke();
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

function readRulerPalette(element: HTMLElement): RulerPalette {
  const style = getComputedStyle(element);
  return {
    surface: readCssColor(style, '--ruler-surface', 'rgba(12, 17, 24, 0.86)'),
    border: readCssColor(style, '--ruler-border', 'rgba(215, 221, 232, 0.24)'),
    tick: readCssColor(style, '--ruler-tick', 'rgba(215, 221, 232, 0.72)'),
    text: readCssColor(style, '--ruler-text', 'rgba(215, 221, 232, 0.92)')
  };
}

function readCssColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
