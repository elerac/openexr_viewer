import { imageToScreen } from '../interaction';
import { resolveActiveProbePixel } from '../probe';
import type { ImagePixel, ViewerState, ViewportInfo } from '../types';
import { buildOverlayValueLines } from './overlay-value-lines';

const VALUE_LABEL_MIN_SCREEN_SIZE = 28;
const MAX_VALUE_LABELS = 1800;

export class OverlayRenderer {
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private imageSize: { width: number; height: number } | null = null;
  private displayTextureData: Float32Array | null = null;

  constructor(overlayCanvas: HTMLCanvasElement) {
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      throw new Error('Unable to create overlay 2D canvas context.');
    }

    this.overlayCanvas = overlayCanvas;
    this.overlayContext = overlayContext;
  }

  resize(width: number, height: number): void {
    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };

    this.overlayCanvas.width = this.viewport.width;
    this.overlayCanvas.height = this.viewport.height;
  }

  setDisplayTexture(width: number, height: number, rgbaTexture: Float32Array): void {
    this.imageSize = { width, height };
    this.displayTextureData = rgbaTexture;
  }

  clearImage(): void {
    this.imageSize = null;
    this.displayTextureData = null;
  }

  render(state: ViewerState): void {
    const ctx = this.overlayContext;
    const imageSize = this.imageSize;

    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    if (!imageSize) {
      return;
    }

    if (state.viewerMode === 'panorama') {
      return;
    }

    if (state.zoom >= VALUE_LABEL_MIN_SCREEN_SIZE) {
      this.drawPixelValues(state, imageSize.width, imageSize.height);
    }

    const probe = resolveActiveProbePixel(state.lockedPixel, state.hoveredPixel);
    if (probe) {
      this.drawProbeMarker(state, probe);
    }
  }

  private drawPixelValues(state: ViewerState, imageWidth: number, imageHeight: number): void {
    const data = this.displayTextureData;
    if (!data) {
      return;
    }

    const bounds = visibleBounds(state, this.viewport);
    const startX = Math.max(0, Math.floor(bounds.left));
    const endX = Math.min(imageWidth - 1, Math.ceil(bounds.right));
    const startY = Math.max(0, Math.floor(bounds.top));
    const endY = Math.min(imageHeight - 1, Math.ceil(bounds.bottom));

    if (endX < startX || endY < startY) {
      return;
    }

    const labelCount = (endX - startX + 1) * (endY - startY + 1);
    if (labelCount > MAX_VALUE_LABELS) {
      return;
    }

    const ctx = this.overlayContext;
    prepareValueLabelContext(ctx);

    const halfViewWidth = this.viewport.width * 0.5;
    const halfViewHeight = this.viewport.height * 0.5;

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const pixelIndex = y * imageWidth + x;
        const dataIndex = pixelIndex * 4;
        const valueLines = buildOverlayValueLines(
          state,
          data[dataIndex + 0],
          data[dataIndex + 1],
          data[dataIndex + 2],
          data[dataIndex + 3]
        );

        const centerX = (x + 0.5 - state.panX) * state.zoom + halfViewWidth;
        const centerY = (y + 0.5 - state.panY) * state.zoom + halfViewHeight;
        drawValueLines(ctx, valueLines, centerX, centerY, state.zoom, state.zoom);
      }
    }
  }

  private drawProbeMarker(state: ViewerState, pixel: ImagePixel): void {
    const ctx = this.overlayContext;
    const topLeft = imageToScreen(pixel.ix, pixel.iy, state, this.viewport);

    ctx.strokeStyle = state.lockedPixel ? 'rgba(255, 196, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, state.zoom, state.zoom);
  }
}

function prepareValueLabelContext(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
}

function drawValueLines(
  ctx: CanvasRenderingContext2D,
  valueLines: ReturnType<typeof buildOverlayValueLines>,
  centerX: number,
  centerY: number,
  cellWidth: number,
  cellHeight: number
): void {
  const fontSize = resolveValueLabelFontSize(ctx, cellWidth, cellHeight, valueLines.length);
  if (fontSize < 5) {
    return;
  }

  ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;
  const lineHeight = fontSize;
  const blockHeight = lineHeight * valueLines.length;
  let textY = centerY - blockHeight * 0.5 + lineHeight * 0.5;

  for (let lineIndex = 0; lineIndex < valueLines.length; lineIndex += 1) {
    const line = valueLines[lineIndex];
    ctx.fillStyle = line?.color ?? 'rgba(255, 255, 255, 0.95)';
    ctx.strokeText(line?.value ?? '', centerX, textY);
    ctx.fillText(line?.value ?? '', centerX, textY);
    textY += lineHeight;
  }
}

function resolveValueLabelFontSize(
  ctx: CanvasRenderingContext2D,
  cellWidth: number,
  cellHeight: number,
  lineCount: number
): number {
  const maxTextWidth = Math.max(1, cellWidth - 5);
  const maxTextHeight = Math.max(1, cellHeight - 5);
  let fontSize = Math.min(20, Math.min(cellWidth, cellHeight) * 0.33);
  ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;

  const sizingProbe = '-1.2e+3';
  const probeWidth = ctx.measureText(sizingProbe).width;
  if (probeWidth > maxTextWidth) {
    fontSize *= maxTextWidth / probeWidth;
  }

  const maxLineHeight = maxTextHeight / Math.max(1, lineCount);
  if (fontSize > maxLineHeight) {
    fontSize = maxLineHeight;
  }

  return Math.floor(fontSize);
}
function visibleBounds(state: ViewerState, viewport: ViewportInfo): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const halfWidth = viewport.width / (2 * state.zoom);
  const halfHeight = viewport.height / (2 * state.zoom);

  return {
    left: state.panX - halfWidth,
    right: state.panX + halfWidth,
    top: state.panY - halfHeight,
    bottom: state.panY + halfHeight
  };
}
