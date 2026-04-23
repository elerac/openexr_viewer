import { createImageRoiFromPixels, getImageRoiPixelCount } from './roi';
import {
  ImagePixel,
  type PanoramaKeyboardOrbitDirection,
  type PanoramaKeyboardOrbitInput,
  type ViewerViewState,
  ViewerState,
  ViewportInfo
} from './types';

export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 512;
export const MIN_PANORAMA_HFOV_DEG = 1;
export const MAX_PANORAMA_HFOV_DEG = 120;
export const DEFAULT_PANORAMA_HFOV_DEG = 100;
export const MAX_PANORAMA_PITCH_DEG = 89;
const PANORAMA_KEYBOARD_ORBIT_STEP_RATIO = 0.05;
const PANORAMA_KEYBOARD_ORBIT_SPEED_PER_SECOND = 1.5;
const PANORAMA_KEYBOARD_ORBIT_MAX_FRAME_MS = 50;
const PANORAMA_MAX_PROJECTED_ASPECT_RATIO = 4;
const PANORAMA_MIN_SEED_SEARCH_RADIUS = 4;
const PANORAMA_MAX_SEED_SEARCH_RADIUS = 128;
const RADIANS_PER_DEGREE = Math.PI / 180;

type PanoramaCameraState = Pick<
  ViewerState,
  'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
>;

export interface PanoramaProjectedPixel {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface ViewportClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function clampPanoramaHfov(hfovDeg: number): number {
  return Math.min(MAX_PANORAMA_HFOV_DEG, Math.max(MIN_PANORAMA_HFOV_DEG, hfovDeg));
}

export function clampPanoramaPitch(pitchDeg: number): number {
  return Math.min(MAX_PANORAMA_PITCH_DEG, Math.max(-MAX_PANORAMA_PITCH_DEG, pitchDeg));
}

export function normalizePanoramaYaw(yawDeg: number): number {
  const wrapped = ((yawDeg + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

export function exposureToScale(exposureEv: number): number {
  return 2 ** exposureEv;
}

export function screenToImage(
  screenX: number,
  screenY: number,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): ImagePixel | null {
  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  const ix = Math.floor(imageX);
  const iy = Math.floor(imageY);

  if (ix < 0 || iy < 0 || ix >= imageWidth || iy >= imageHeight) {
    return null;
  }

  return { ix, iy };
}

export function screenToImageClamped(
  screenX: number,
  screenY: number,
  state: ViewerState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): ImagePixel | null {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  return {
    ix: Math.min(imageWidth - 1, Math.max(0, Math.floor(imageX))),
    iy: Math.min(imageHeight - 1, Math.max(0, Math.floor(imageY)))
  };
}

export function imageToScreen(
  imageX: number,
  imageY: number,
  state: ViewerState,
  viewport: ViewportInfo
): { x: number; y: number } {
  return {
    x: (imageX - state.panX) * state.zoom + viewport.width * 0.5,
    y: (imageY - state.panY) * state.zoom + viewport.height * 0.5
  };
}

export function preserveImagePanOnViewportChange(
  state: Pick<ViewerViewState, 'zoom' | 'panX' | 'panY'>,
  previousViewport: ViewportClientRect,
  nextViewport: ViewportClientRect
): { panX: number; panY: number } {
  if (!Number.isFinite(state.zoom) || state.zoom <= 0) {
    return {
      panX: state.panX,
      panY: state.panY
    };
  }

  const previousCenterX = previousViewport.left + previousViewport.width * 0.5;
  const previousCenterY = previousViewport.top + previousViewport.height * 0.5;
  const nextCenterX = nextViewport.left + nextViewport.width * 0.5;
  const nextCenterY = nextViewport.top + nextViewport.height * 0.5;

  return {
    panX: state.panX + (nextCenterX - previousCenterX) / state.zoom,
    panY: state.panY + (nextCenterY - previousCenterY) / state.zoom
  };
}

export function zoomAroundPoint(
  state: ViewerState,
  viewport: ViewportInfo,
  screenX: number,
  screenY: number,
  requestedZoom: number
): { zoom: number; panX: number; panY: number } {
  const zoom = clampZoom(requestedZoom);
  const imageX = state.panX + (screenX - viewport.width * 0.5) / state.zoom;
  const imageY = state.panY + (screenY - viewport.height * 0.5) / state.zoom;

  return {
    zoom,
    panX: imageX - (screenX - viewport.width * 0.5) / zoom,
    panY: imageY - (screenY - viewport.height * 0.5) / zoom
  };
}

export function getPanoramaVerticalFovDeg(
  hfovDeg: number,
  viewport: ViewportInfo
): number {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return clampPanoramaHfov(hfovDeg);
  }

  const aspect = viewport.width / viewport.height;
  const halfHorizontal = Math.tan((clampPanoramaHfov(hfovDeg) * RADIANS_PER_DEGREE) * 0.5);
  return Math.atan(halfHorizontal / Math.max(aspect, Number.EPSILON)) * 2 / RADIANS_PER_DEGREE;
}

export function orbitPanorama(
  state: ViewerState,
  viewport: ViewportInfo,
  deltaScreenX: number,
  deltaScreenY: number
): { panoramaYawDeg: number; panoramaPitchDeg: number; panoramaHfovDeg: number } {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return {
      panoramaYawDeg: state.panoramaYawDeg,
      panoramaPitchDeg: state.panoramaPitchDeg,
      panoramaHfovDeg: state.panoramaHfovDeg
    };
  }

  const verticalFovDeg = getPanoramaVerticalFovDeg(state.panoramaHfovDeg, viewport);
  const nextYawDeg = normalizePanoramaYaw(
    state.panoramaYawDeg - (deltaScreenX / viewport.width) * state.panoramaHfovDeg
  );
  const nextPitchDeg = clampPanoramaPitch(
    state.panoramaPitchDeg - (deltaScreenY / viewport.height) * verticalFovDeg
  );

  return {
    panoramaYawDeg: nextYawDeg,
    panoramaPitchDeg: nextPitchDeg,
    panoramaHfovDeg: state.panoramaHfovDeg
  };
}

export function zoomPanorama(
  state: ViewerState,
  deltaY: number
): { panoramaYawDeg: number; panoramaPitchDeg: number; panoramaHfovDeg: number } {
  const zoomFactor = Math.exp(-deltaY * 0.0015);
  const requestedHfov = state.panoramaHfovDeg / zoomFactor;
  return {
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: clampPanoramaHfov(requestedHfov)
  };
}

export function screenToPanoramaPixel(
  screenX: number,
  screenY: number,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): ImagePixel | null {
  if (imageWidth <= 0 || imageHeight <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const ray = screenToPanoramaDirection(screenX, screenY, state, viewport);
  const longitude = Math.atan2(ray.x, ray.z);
  const latitude = Math.asin(clamp(ray.y, -1, 1));
  const u = fract(0.5 + longitude / (2 * Math.PI));
  const v = clamp(0.5 + latitude / Math.PI, 0, 1 - Number.EPSILON);

  return {
    ix: Math.floor(u * imageWidth) % imageWidth,
    iy: Math.min(imageHeight - 1, Math.max(0, Math.floor(v * imageHeight)))
  };
}

export function projectPanoramaPixelToScreen(
  pixelX: number,
  pixelY: number,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): PanoramaProjectedPixel | null {
  if (
    imageWidth <= 1 ||
    imageHeight <= 1 ||
    pixelX < 0 ||
    pixelY < 0 ||
    pixelX >= imageWidth ||
    pixelY >= imageHeight
  ) {
    return null;
  }

  // Suppress seam and pole-adjacent labels where the local footprint is ambiguous.
  if (pixelX === 0 || pixelX === imageWidth - 1 || pixelY === 0 || pixelY === imageHeight - 1) {
    return null;
  }

  const approximateCenter = projectPanoramaDirectionToScreen(
    panoramaTexelToDirection(pixelX + 0.5, pixelY + 0.5, imageWidth, imageHeight),
    state,
    viewport
  );
  if (!approximateCenter) {
    return null;
  }

  const seedSample = findPanoramaPixelSeedSample(
    pixelX,
    pixelY,
    approximateCenter,
    state,
    viewport,
    imageWidth,
    imageHeight
  );
  if (!seedSample) {
    return null;
  }

  const exactProjection = resolvePanoramaPixelFootprintFromScreenSamples(
    pixelX,
    pixelY,
    seedSample,
    state,
    viewport,
    imageWidth,
    imageHeight
  );
  if (!exactProjection) {
    return null;
  }

  return exactProjection;
}

function screenToPanoramaDirection(
  screenX: number,
  screenY: number,
  state: PanoramaCameraState,
  viewport: ViewportInfo
): { x: number; y: number; z: number } {
  const xNdc = (screenX / viewport.width) * 2 - 1;
  // Match the fragment shader's top-origin screen-space Y so probe hits and rendering sample the same texel.
  const yNdc = (screenY / viewport.height) * 2 - 1;
  const halfHorizontal = Math.tan((clampPanoramaHfov(state.panoramaHfovDeg) * RADIANS_PER_DEGREE) * 0.5);
  const halfVertical = Math.tan((getPanoramaVerticalFovDeg(state.panoramaHfovDeg, viewport) * RADIANS_PER_DEGREE) * 0.5);
  const ray = normalize3({
    x: xNdc * halfHorizontal,
    y: yNdc * halfVertical,
    z: 1
  });
  const pitched = rotatePitch(ray, state.panoramaPitchDeg * RADIANS_PER_DEGREE);
  return rotateYaw(pitched, state.panoramaYawDeg * RADIANS_PER_DEGREE);
}

function panoramaTexelToDirection(
  texelX: number,
  texelY: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; z: number } {
  const u = clamp(texelX / imageWidth, 0, 1);
  const v = clamp(texelY / imageHeight, 0, 1);
  const longitude = (u - 0.5) * 2 * Math.PI;
  const latitude = (v - 0.5) * Math.PI;
  const cosLatitude = Math.cos(latitude);

  return {
    x: Math.sin(longitude) * cosLatitude,
    y: Math.sin(latitude),
    z: Math.cos(longitude) * cosLatitude
  };
}

function projectPanoramaDirectionToScreen(
  direction: { x: number; y: number; z: number },
  state: PanoramaCameraState,
  viewport: ViewportInfo
): { x: number; y: number } | null {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const yawRad = state.panoramaYawDeg * RADIANS_PER_DEGREE;
  const pitchRad = state.panoramaPitchDeg * RADIANS_PER_DEGREE;
  const cameraDirection = rotatePitch(rotateYaw(direction, -yawRad), -pitchRad);
  if (cameraDirection.z <= Number.EPSILON) {
    return null;
  }

  const halfHorizontal = Math.tan((clampPanoramaHfov(state.panoramaHfovDeg) * RADIANS_PER_DEGREE) * 0.5);
  const halfVertical = Math.tan((getPanoramaVerticalFovDeg(state.panoramaHfovDeg, viewport) * RADIANS_PER_DEGREE) * 0.5);
  const xNdc = cameraDirection.x / (cameraDirection.z * halfHorizontal);
  const yNdc = cameraDirection.y / (cameraDirection.z * halfVertical);
  if (!Number.isFinite(xNdc) || !Number.isFinite(yNdc) || Math.abs(xNdc) > 1 || Math.abs(yNdc) > 1) {
    return null;
  }

  return {
    x: (xNdc + 1) * 0.5 * viewport.width,
    y: (yNdc + 1) * 0.5 * viewport.height
  };
}

interface PanoramaScreenSample {
  column: number;
  row: number;
}

interface PanoramaRowSpan {
  row: number;
  minColumn: number;
  maxColumn: number;
}

function findPanoramaPixelSeedSample(
  pixelX: number,
  pixelY: number,
  approximateCenter: { x: number; y: number },
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): PanoramaScreenSample | null {
  const approximateColumn = clampInteger(Math.floor(approximateCenter.x), 0, viewport.width - 1);
  const approximateRow = clampInteger(Math.floor(approximateCenter.y), 0, viewport.height - 1);
  const maxRadius = resolvePanoramaSeedSearchRadius(
    pixelX,
    pixelY,
    approximateCenter,
    state,
    viewport,
    imageWidth,
    imageHeight
  );

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const minColumn = Math.max(0, approximateColumn - radius);
    const maxColumn = Math.min(viewport.width - 1, approximateColumn + radius);
    const minRow = Math.max(0, approximateRow - radius);
    const maxRow = Math.min(viewport.height - 1, approximateRow + radius);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        if (Math.max(Math.abs(column - approximateColumn), Math.abs(row - approximateRow)) !== radius) {
          continue;
        }

        if (
          panoramaPixelMatchesScreenSample(
            column,
            row,
            pixelX,
            pixelY,
            state,
            viewport,
            imageWidth,
            imageHeight
          )
        ) {
          return { column, row };
        }
      }
    }
  }

  return null;
}

function resolvePanoramaSeedSearchRadius(
  pixelX: number,
  pixelY: number,
  approximateCenter: { x: number; y: number },
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): number {
  const neighborCenters = [
    pixelX > 0
      ? projectPanoramaDirectionToScreen(
          panoramaTexelToDirection(pixelX - 0.5, pixelY + 0.5, imageWidth, imageHeight),
          state,
          viewport
        )
      : null,
    pixelX + 1 < imageWidth
      ? projectPanoramaDirectionToScreen(
          panoramaTexelToDirection(pixelX + 1.5, pixelY + 0.5, imageWidth, imageHeight),
          state,
          viewport
        )
      : null,
    pixelY > 0
      ? projectPanoramaDirectionToScreen(
          panoramaTexelToDirection(pixelX + 0.5, pixelY - 0.5, imageWidth, imageHeight),
          state,
          viewport
        )
      : null,
    pixelY + 1 < imageHeight
      ? projectPanoramaDirectionToScreen(
          panoramaTexelToDirection(pixelX + 0.5, pixelY + 1.5, imageWidth, imageHeight),
          state,
          viewport
        )
      : null
  ];

  let searchRadius = PANORAMA_MIN_SEED_SEARCH_RADIUS;
  for (const neighborCenter of neighborCenters) {
    if (!neighborCenter) {
      continue;
    }

    searchRadius = Math.max(
      searchRadius,
      Math.ceil(Math.abs(neighborCenter.x - approximateCenter.x)),
      Math.ceil(Math.abs(neighborCenter.y - approximateCenter.y))
    );
  }

  return Math.min(
    Math.max(viewport.width, viewport.height),
    Math.max(PANORAMA_MIN_SEED_SEARCH_RADIUS, Math.min(PANORAMA_MAX_SEED_SEARCH_RADIUS, searchRadius + 2))
  );
}

function resolvePanoramaPixelFootprintFromScreenSamples(
  pixelX: number,
  pixelY: number,
  seedSample: PanoramaScreenSample,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): PanoramaProjectedPixel | null {
  const seedSpan = expandPanoramaPixelRowSpan(
    pixelX,
    pixelY,
    seedSample.row,
    seedSample.column,
    state,
    viewport,
    imageWidth,
    imageHeight
  );
  if (!seedSpan) {
    return null;
  }

  const rowSpans: PanoramaRowSpan[] = [];
  let minColumn = seedSpan.minColumn;
  let maxColumn = seedSpan.maxColumn;
  let minRow = seedSpan.row;
  let maxRow = seedSpan.row;
  let sampleCount = 0;
  let sumX = 0;
  let sumY = 0;

  const accumulateSpan = (span: PanoramaRowSpan): void => {
    const spanSampleCount = span.maxColumn - span.minColumn + 1;
    sampleCount += spanSampleCount;
    sumX += spanSampleCount * ((span.minColumn + span.maxColumn + 1) * 0.5);
    sumY += spanSampleCount * (span.row + 0.5);
    minColumn = Math.min(minColumn, span.minColumn);
    maxColumn = Math.max(maxColumn, span.maxColumn);
    minRow = Math.min(minRow, span.row);
    maxRow = Math.max(maxRow, span.row);
    rowSpans.push(span);
  };

  accumulateSpan(seedSpan);
  scanPanoramaPixelRowSpans(-1, pixelX, pixelY, seedSpan, accumulateSpan, state, viewport, imageWidth, imageHeight);
  scanPanoramaPixelRowSpans(1, pixelX, pixelY, seedSpan, accumulateSpan, state, viewport, imageWidth, imageHeight);

  if (sampleCount <= 0 || minColumn <= 0 || maxColumn >= viewport.width - 1 || minRow <= 0 || maxRow >= viewport.height - 1) {
    return null;
  }

  const width = maxColumn - minColumn + 1;
  const height = maxRow - minRow + 1;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const aspectRatio = Math.max(width, height) / Math.max(Math.min(width, height), Number.EPSILON);
  if (aspectRatio > PANORAMA_MAX_PROJECTED_ASPECT_RATIO) {
    return null;
  }

  const centerSample = findPanoramaFootprintCenterSample(rowSpans, sumX / sampleCount, sumY / sampleCount);
  if (!centerSample) {
    return null;
  }

  return {
    centerX: centerSample.column + 0.5,
    centerY: centerSample.row + 0.5,
    width,
    height
  };
}

function scanPanoramaPixelRowSpans(
  step: -1 | 1,
  pixelX: number,
  pixelY: number,
  seedSpan: PanoramaRowSpan,
  onSpan: (span: PanoramaRowSpan) => void,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): void {
  let previousSpan = seedSpan;
  for (let row = seedSpan.row + step; row >= 0 && row < viewport.height; row += step) {
    const predictedColumn = clampInteger(
      Math.round((previousSpan.minColumn + previousSpan.maxColumn) * 0.5),
      0,
      viewport.width - 1
    );
    const searchRadius = Math.max(
      PANORAMA_MIN_SEED_SEARCH_RADIUS,
      previousSpan.maxColumn - previousSpan.minColumn + 2
    );
    const rowSeedColumn = findPanoramaPixelSampleColumnOnRow(
      pixelX,
      pixelY,
      row,
      predictedColumn,
      searchRadius,
      state,
      viewport,
      imageWidth,
      imageHeight
    );
    if (rowSeedColumn === null) {
      break;
    }

    const rowSpan = expandPanoramaPixelRowSpan(
      pixelX,
      pixelY,
      row,
      rowSeedColumn,
      state,
      viewport,
      imageWidth,
      imageHeight
    );
    if (!rowSpan) {
      break;
    }

    onSpan(rowSpan);
    previousSpan = rowSpan;
  }
}

function findPanoramaPixelSampleColumnOnRow(
  pixelX: number,
  pixelY: number,
  row: number,
  predictedColumn: number,
  searchRadius: number,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): number | null {
  if (row < 0 || row >= viewport.height) {
    return null;
  }

  const clampedSearchRadius = Math.min(searchRadius, viewport.width - 1);
  for (let offset = 0; offset <= clampedSearchRadius; offset += 1) {
    const leftColumn = predictedColumn - offset;
    if (
      leftColumn >= 0 &&
      panoramaPixelMatchesScreenSample(
        leftColumn,
        row,
        pixelX,
        pixelY,
        state,
        viewport,
        imageWidth,
        imageHeight
      )
    ) {
      return leftColumn;
    }

    const rightColumn = predictedColumn + offset;
    if (
      offset > 0 &&
      rightColumn < viewport.width &&
      panoramaPixelMatchesScreenSample(
        rightColumn,
        row,
        pixelX,
        pixelY,
        state,
        viewport,
        imageWidth,
        imageHeight
      )
    ) {
      return rightColumn;
    }
  }

  return null;
}

function expandPanoramaPixelRowSpan(
  pixelX: number,
  pixelY: number,
  row: number,
  column: number,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): PanoramaRowSpan | null {
  if (
    !panoramaPixelMatchesScreenSample(column, row, pixelX, pixelY, state, viewport, imageWidth, imageHeight)
  ) {
    return null;
  }

  let minColumn = column;
  while (
    minColumn > 0 &&
    panoramaPixelMatchesScreenSample(
      minColumn - 1,
      row,
      pixelX,
      pixelY,
      state,
      viewport,
      imageWidth,
      imageHeight
    )
  ) {
    minColumn -= 1;
  }

  let maxColumn = column;
  while (
    maxColumn + 1 < viewport.width &&
    panoramaPixelMatchesScreenSample(
      maxColumn + 1,
      row,
      pixelX,
      pixelY,
      state,
      viewport,
      imageWidth,
      imageHeight
    )
  ) {
    maxColumn += 1;
  }

  return { row, minColumn, maxColumn };
}

function findPanoramaFootprintCenterSample(
  rowSpans: PanoramaRowSpan[],
  targetX: number,
  targetY: number
): PanoramaScreenSample | null {
  let bestSample: PanoramaScreenSample | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const rowSpan of rowSpans) {
    const column = clampInteger(Math.round(targetX - 0.5), rowSpan.minColumn, rowSpan.maxColumn);
    const sampleX = column + 0.5;
    const sampleY = rowSpan.row + 0.5;
    const distanceSquared = (sampleX - targetX) ** 2 + (sampleY - targetY) ** 2;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestSample = { column, row: rowSpan.row };
    }
  }

  return bestSample;
}

function panoramaPixelMatchesScreenSample(
  column: number,
  row: number,
  pixelX: number,
  pixelY: number,
  state: PanoramaCameraState,
  viewport: ViewportInfo,
  imageWidth: number,
  imageHeight: number
): boolean {
  if (column < 0 || column >= viewport.width || row < 0 || row >= viewport.height) {
    return false;
  }

  const mappedPixel = screenToPanoramaPixel(column + 0.5, row + 0.5, state, viewport, imageWidth, imageHeight);
  return mappedPixel?.ix === pixelX && mappedPixel.iy === pixelY;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function rotatePitch(
  vector: { x: number; y: number; z: number },
  angleRad: number
): { x: number; y: number; z: number } {
  const cosAngle = Math.cos(angleRad);
  const sinAngle = Math.sin(angleRad);

  return {
    x: vector.x,
    y: vector.y * cosAngle + vector.z * sinAngle,
    z: -vector.y * sinAngle + vector.z * cosAngle
  };
}

function rotateYaw(
  vector: { x: number; y: number; z: number },
  angleRad: number
): { x: number; y: number; z: number } {
  const cosAngle = Math.cos(angleRad);
  const sinAngle = Math.sin(angleRad);

  return {
    x: vector.x * cosAngle + vector.z * sinAngle,
    y: vector.y,
    z: -vector.x * sinAngle + vector.z * cosAngle
  };
}

function normalize3(vector: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface InteractionCallbacks {
  getState: () => ViewerState;
  getViewport: () => ViewportInfo;
  getImageSize: () => { width: number; height: number } | null;
  onViewChange: (
    next: Partial<Pick<
      ViewerState,
      'zoom' | 'panX' | 'panY' | 'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
    >>
  ) => void;
  onHoverPixel: (pixel: ImagePixel | null) => void;
  onToggleLockPixel: (pixel: ImagePixel | null) => void;
  onDraftRoi: (roi: ViewerState['draftRoi']) => void;
  onCommitRoi: (roi: ViewerState['roi']) => void;
}

export interface InteractionDependencies {
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}

interface PointerPosition {
  x: number;
  y: number;
}

export class ViewerInteraction {
  private readonly element: HTMLElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private dragging = false;
  private movedDuringDrag = false;
  private dragMode: 'pan' | 'roi' | null = null;
  private previousPointer: PointerPosition | null = null;
  private lastPointerInElement: PointerPosition | null = null;
  private roiAnchorPixel: ImagePixel | null = null;
  private panoramaKeyboardOrbitInput = createPanoramaKeyboardOrbitInput();
  private panoramaKeyboardOrbitFrameId: number | null = null;
  private panoramaKeyboardOrbitLastFrameTime: number | null = null;

  constructor(
    element: HTMLElement,
    callbacks: InteractionCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);

    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointerleave', this.onPointerLeave);
  }

  destroy(): void {
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.cancelPanoramaKeyboardOrbitFrame();
    this.panoramaKeyboardOrbitInput = createPanoramaKeyboardOrbitInput();
    this.panoramaKeyboardOrbitLastFrameTime = null;
  }

  handlePanoramaKeyboardOrbit(direction: PanoramaKeyboardOrbitDirection): void {
    this.applyPanoramaKeyboardOrbitInput(createPanoramaKeyboardOrbitInput(direction), PANORAMA_KEYBOARD_ORBIT_STEP_RATIO);
  }

  setPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): void {
    const previousInput = this.panoramaKeyboardOrbitInput;
    const nextInput = clonePanoramaKeyboardOrbitInput(input);
    if (samePanoramaKeyboardOrbitInput(previousInput, nextInput)) {
      if (hasPanoramaKeyboardOrbitInput(nextInput)) {
        this.ensurePanoramaKeyboardOrbitFrame();
      } else {
        this.cancelPanoramaKeyboardOrbitFrame();
        this.panoramaKeyboardOrbitLastFrameTime = null;
      }
      return;
    }

    this.panoramaKeyboardOrbitInput = nextInput;
    const newlyPressedInput = getNewlyPressedPanoramaKeyboardOrbitInput(previousInput, nextInput);
    if (hasPanoramaKeyboardOrbitInput(newlyPressedInput)) {
      this.applyPanoramaKeyboardOrbitInput(newlyPressedInput, PANORAMA_KEYBOARD_ORBIT_STEP_RATIO);
    }

    if (hasPanoramaKeyboardOrbitInput(nextInput)) {
      if (!hasPanoramaKeyboardOrbitInput(previousInput)) {
        this.panoramaKeyboardOrbitLastFrameTime = null;
      }
      this.ensurePanoramaKeyboardOrbitFrame();
      return;
    }

    this.cancelPanoramaKeyboardOrbitFrame();
    this.panoramaKeyboardOrbitLastFrameTime = null;
  }

  private applyPanoramaKeyboardOrbitInput(
    input: PanoramaKeyboardOrbitInput,
    viewportStepRatio: number
  ): void {
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode !== 'panorama') {
      return;
    }

    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const { horizontalStep, verticalStep } = getPanoramaKeyboardOrbitStepSizes(
      state.panoramaHfovDeg,
      viewport,
      viewportStepRatio
    );
    const { deltaScreenX, deltaScreenY } = getPanoramaKeyboardOrbitDeltaForInput(
      input,
      horizontalStep,
      verticalStep
    );
    if (deltaScreenX === 0 && deltaScreenY === 0) {
      return;
    }

    const nextView = orbitPanorama(state, viewport, deltaScreenX, deltaScreenY);
    if (
      nextView.panoramaYawDeg === state.panoramaYawDeg &&
      nextView.panoramaPitchDeg === state.panoramaPitchDeg &&
      nextView.panoramaHfovDeg === state.panoramaHfovDeg
    ) {
      return;
    }

    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(this.resolveHoverPixel(nextState, viewport, imageSize));
  }

  private ensurePanoramaKeyboardOrbitFrame(): void {
    if (this.panoramaKeyboardOrbitFrameId !== null || !hasPanoramaKeyboardOrbitInput(this.panoramaKeyboardOrbitInput)) {
      return;
    }

    this.panoramaKeyboardOrbitFrameId = this.scheduleFrame(this.onPanoramaKeyboardOrbitFrame);
  }

  private cancelPanoramaKeyboardOrbitFrame(): void {
    if (this.panoramaKeyboardOrbitFrameId === null) {
      return;
    }

    this.cancelFrame(this.panoramaKeyboardOrbitFrameId);
    this.panoramaKeyboardOrbitFrameId = null;
  }

  private onPanoramaKeyboardOrbitFrame = (timestamp: number): void => {
    this.panoramaKeyboardOrbitFrameId = null;
    if (!hasPanoramaKeyboardOrbitInput(this.panoramaKeyboardOrbitInput)) {
      this.panoramaKeyboardOrbitLastFrameTime = null;
      return;
    }

    if (this.panoramaKeyboardOrbitLastFrameTime !== null) {
      const elapsedMs = Math.min(
        PANORAMA_KEYBOARD_ORBIT_MAX_FRAME_MS,
        Math.max(0, timestamp - this.panoramaKeyboardOrbitLastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyPanoramaKeyboardOrbitInput(
          this.panoramaKeyboardOrbitInput,
          PANORAMA_KEYBOARD_ORBIT_SPEED_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.panoramaKeyboardOrbitLastFrameTime = timestamp;
    this.ensurePanoramaKeyboardOrbitFrame();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const point = this.getLocalPoint(event);
    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();

    if (state.viewerMode === 'panorama') {
      const nextView = zoomPanorama(state, event.deltaY);
      const nextState = { ...state, ...nextView };
      const hoverPixel = screenToPanoramaPixel(
        point.x,
        point.y,
        nextState,
        viewport,
        imageSize.width,
        imageSize.height
      );
      this.callbacks.onViewChange(nextView);
      this.callbacks.onHoverPixel(hoverPixel);
      return;
    }

    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const requestedZoom = state.zoom * zoomFactor;
    const nextView = zoomAroundPoint(state, viewport, point.x, point.y, requestedZoom);
    const nextState = { ...state, ...nextView };
    const hoverPixel = screenToImage(
      point.x,
      point.y,
      nextState,
      viewport,
      imageSize.width,
      imageSize.height
    );

    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(hoverPixel);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode === 'image' && event.shiftKey) {
      const anchorPixel = screenToImage(
        point.x,
        point.y,
        state,
        this.callbacks.getViewport(),
        imageSize.width,
        imageSize.height
      );
      if (!anchorPixel) {
        return;
      }

      this.dragging = true;
      this.dragMode = 'roi';
      this.movedDuringDrag = false;
      this.roiAnchorPixel = anchorPixel;
      this.previousPointer = point;
      this.callbacks.onDraftRoi(createImageRoiFromPixels(anchorPixel, anchorPixel));
      this.element.setPointerCapture(event.pointerId);
      return;
    }

    this.dragging = true;
    this.dragMode = 'pan';
    this.movedDuringDrag = false;
    this.previousPointer = point;
    this.element.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.callbacks.onHoverPixel(null);
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();
    let hoverState = state;

    if (this.dragging && this.previousPointer) {
      const dx = point.x - this.previousPointer.x;
      const dy = point.y - this.previousPointer.y;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.movedDuringDrag = true;
      }

      if (this.dragMode === 'roi' && this.roiAnchorPixel) {
        const targetPixel = screenToImageClamped(
          point.x,
          point.y,
          state,
          viewport,
          imageSize.width,
          imageSize.height
        );
        this.callbacks.onDraftRoi(
          targetPixel ? createImageRoiFromPixels(this.roiAnchorPixel, targetPixel) : null
        );
      } else if (state.viewerMode === 'panorama') {
        const nextView = orbitPanorama(state, viewport, dx, dy);
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
      } else {
        const nextView = {
          zoom: state.zoom,
          panX: state.panX - dx / state.zoom,
          panY: state.panY - dy / state.zoom,
          panoramaYawDeg: state.panoramaYawDeg,
          panoramaPitchDeg: state.panoramaPitchDeg,
          panoramaHfovDeg: state.panoramaHfovDeg
        };
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
      }

      this.previousPointer = point;
    }

    const hoverPixel = hoverState.viewerMode === 'panorama'
      ? screenToPanoramaPixel(
          point.x,
          point.y,
          hoverState,
          viewport,
          imageSize.width,
          imageSize.height
        )
      : screenToImage(
          point.x,
          point.y,
          hoverState,
          viewport,
          imageSize.width,
          imageSize.height
        );
    this.callbacks.onHoverPixel(hoverPixel);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    const point = this.getLocalPoint(event);
    this.lastPointerInElement = point;
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.clearDrag(event.pointerId);
      return;
    }

    if (this.dragging && this.dragMode === 'roi' && this.roiAnchorPixel) {
      const state = this.callbacks.getState();
      const viewport = this.callbacks.getViewport();
      const targetPixel = screenToImageClamped(
        point.x,
        point.y,
        state,
        viewport,
        imageSize.width,
        imageSize.height
      ) ?? this.roiAnchorPixel;
      const roi = createImageRoiFromPixels(this.roiAnchorPixel, targetPixel);
      this.callbacks.onDraftRoi(null);
      this.callbacks.onCommitRoi(getImageRoiPixelCount(roi) === 1 ? null : roi);
      this.clearDrag(event.pointerId);
      return;
    }

    if (this.dragging && !this.movedDuringDrag) {
      const state = this.callbacks.getState();
      const viewport = this.callbacks.getViewport();

      const pixel = state.viewerMode === 'panorama'
        ? screenToPanoramaPixel(
            point.x,
            point.y,
            state,
            viewport,
            imageSize.width,
            imageSize.height
          )
        : screenToImage(
            point.x,
            point.y,
            state,
            viewport,
            imageSize.width,
            imageSize.height
          );
      this.callbacks.onToggleLockPixel(pixel);
    }

    this.clearDrag(event.pointerId);
  };

  private onPointerLeave = (): void => {
    this.lastPointerInElement = null;
    this.callbacks.onHoverPixel(null);
  };

  private clearDrag(pointerId: number): void {
    if (this.dragging && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
    this.dragging = false;
    this.dragMode = null;
    this.movedDuringDrag = false;
    this.previousPointer = null;
    this.roiAnchorPixel = null;
  }

  private getLocalPoint(event: MouseEvent): PointerPosition {
    const rect = this.element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  private resolveHoverPixel(
    state: ViewerState,
    viewport: ViewportInfo,
    imageSize: { width: number; height: number }
  ): ImagePixel | null {
    if (!this.lastPointerInElement) {
      return null;
    }

    return state.viewerMode === 'panorama'
      ? screenToPanoramaPixel(
          this.lastPointerInElement.x,
          this.lastPointerInElement.y,
          state,
          viewport,
          imageSize.width,
          imageSize.height
        )
      : screenToImage(
          this.lastPointerInElement.x,
          this.lastPointerInElement.y,
          state,
          viewport,
          imageSize.width,
          imageSize.height
        );
  }
}

function getPanoramaKeyboardOrbitDeltaForInput(
  input: PanoramaKeyboardOrbitInput,
  horizontalStep: number,
  verticalStep: number
): { deltaScreenX: number; deltaScreenY: number } {
  const horizontalDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const verticalDirection = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  return {
    deltaScreenX: horizontalStep * horizontalDirection,
    deltaScreenY: verticalStep * verticalDirection
  };
}

function getPanoramaKeyboardOrbitStepSizes(
  horizontalFovDeg: number,
  viewport: ViewportInfo,
  viewportStepRatio: number
): { horizontalStep: number; verticalStep: number } {
  const verticalFovDeg = getPanoramaVerticalFovDeg(horizontalFovDeg, viewport);
  return {
    horizontalStep: horizontalFovDeg === 0
      ? 0
      : viewport.width * viewportStepRatio * (verticalFovDeg / horizontalFovDeg),
    verticalStep: viewport.height * viewportStepRatio
  };
}

function createPanoramaKeyboardOrbitInput(
  direction: PanoramaKeyboardOrbitDirection | null = null
): PanoramaKeyboardOrbitInput {
  return {
    up: direction === 'up',
    left: direction === 'left',
    down: direction === 'down',
    right: direction === 'right'
  };
}

function clonePanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): PanoramaKeyboardOrbitInput {
  return {
    up: input.up,
    left: input.left,
    down: input.down,
    right: input.right
  };
}

function getNewlyPressedPanoramaKeyboardOrbitInput(
  previousInput: PanoramaKeyboardOrbitInput,
  nextInput: PanoramaKeyboardOrbitInput
): PanoramaKeyboardOrbitInput {
  return {
    up: nextInput.up && !previousInput.up,
    left: nextInput.left && !previousInput.left,
    down: nextInput.down && !previousInput.down,
    right: nextInput.right && !previousInput.right
  };
}

function hasPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function samePanoramaKeyboardOrbitInput(
  a: PanoramaKeyboardOrbitInput,
  b: PanoramaKeyboardOrbitInput
): boolean {
  return (
    a.up === b.up &&
    a.left === b.left &&
    a.down === b.down &&
    a.right === b.right
  );
}
