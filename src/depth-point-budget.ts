import { MAX_DEPTH_POINTS, normalizeDepthPointSize } from './depth';

export const CONSTRAINED_DEPTH_POINTS = 350_000;

const DEPTH_POINTS_PER_VIEWPORT_PIXEL = 4;
const DEPTH_POINT_SIZE_BUDGET_REFERENCE_PX = 2;
const CONSTRAINED_DEVICE_MEMORY_GB = 4;
const CONSTRAINED_HARDWARE_CONCURRENCY = 4;
const CONSTRAINED_JS_HEAP_SIZE_LIMIT_BYTES = 1536 * 1024 * 1024;
const CONSTRAINED_TOUCH_VIEWPORT_SIDE_PX = 900;
const MOBILE_USER_AGENT_PATTERN =
  /\b(Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile)\b/i;

export interface DepthPointBudgetViewport {
  width: number;
  height: number;
  pointSizePx?: number | null;
}

export interface DepthPointBudgetEnvironmentHints {
  deviceMemoryGb?: number | null;
  hardwareConcurrency?: number | null;
  jsHeapSizeLimitBytes?: number | null;
  maxTouchPoints?: number | null;
  coarsePointer?: boolean | null;
  anyCoarsePointer?: boolean | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  pointSizePx?: number | null;
  userAgentDataMobile?: boolean | null;
  userAgent?: string | null;
}

export type DepthPointBudgetResolver = (viewport?: DepthPointBudgetViewport) => number;

export function resolveAdaptiveDepthPointBudget(
  hints: DepthPointBudgetEnvironmentHints = collectDepthPointBudgetEnvironmentHints()
): number {
  let deviceBudget = MAX_DEPTH_POINTS;
  const deviceMemoryGb = normalizePositiveNumber(hints.deviceMemoryGb);
  if (deviceMemoryGb !== null && deviceMemoryGb <= CONSTRAINED_DEVICE_MEMORY_GB) {
    deviceBudget = CONSTRAINED_DEPTH_POINTS;
    return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
  }

  const hardwareConcurrency = normalizePositiveNumber(hints.hardwareConcurrency);
  if (hardwareConcurrency !== null && hardwareConcurrency <= CONSTRAINED_HARDWARE_CONCURRENCY) {
    deviceBudget = CONSTRAINED_DEPTH_POINTS;
    return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
  }

  const jsHeapSizeLimitBytes = normalizePositiveNumber(hints.jsHeapSizeLimitBytes);
  if (jsHeapSizeLimitBytes !== null && jsHeapSizeLimitBytes <= CONSTRAINED_JS_HEAP_SIZE_LIMIT_BYTES) {
    deviceBudget = CONSTRAINED_DEPTH_POINTS;
    return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
  }

  if (isConstrainedTouchViewport(hints)) {
    deviceBudget = CONSTRAINED_DEPTH_POINTS;
    return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
  }

  if (hints.userAgentDataMobile === true) {
    deviceBudget = CONSTRAINED_DEPTH_POINTS;
    return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
  }

  if (typeof hints.userAgent === 'string' && MOBILE_USER_AGENT_PATTERN.test(hints.userAgent)) {
    deviceBudget = CONSTRAINED_DEPTH_POINTS;
    return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
  }

  return resolveViewportAwareDepthPointBudget(deviceBudget, hints);
}

export function collectDepthPointBudgetEnvironmentHints(
  globalLike: unknown = typeof globalThis === 'undefined' ? null : globalThis,
  viewport?: DepthPointBudgetViewport
): DepthPointBudgetEnvironmentHints {
  const globalRecord = isRecord(globalLike) ? globalLike : {};
  const navigatorRecord = isRecord(globalRecord.navigator) ? globalRecord.navigator : {};
  const userAgentDataRecord = isRecord(navigatorRecord.userAgentData) ? navigatorRecord.userAgentData : {};
  const performanceRecord = isRecord(globalRecord.performance) ? globalRecord.performance : {};
  const performanceMemoryRecord = isRecord(performanceRecord.memory) ? performanceRecord.memory : {};

  return {
    deviceMemoryGb: normalizePositiveNumber(navigatorRecord.deviceMemory),
    hardwareConcurrency: normalizePositiveNumber(navigatorRecord.hardwareConcurrency),
    jsHeapSizeLimitBytes: normalizePositiveNumber(performanceMemoryRecord.jsHeapSizeLimit),
    maxTouchPoints: normalizePositiveNumber(navigatorRecord.maxTouchPoints),
    coarsePointer: readMatchMedia(globalRecord, '(pointer: coarse)'),
    anyCoarsePointer: readMatchMedia(globalRecord, '(any-pointer: coarse)'),
    viewportWidth: normalizePositiveNumber(viewport?.width) ?? normalizePositiveNumber(globalRecord.innerWidth),
    viewportHeight: normalizePositiveNumber(viewport?.height) ?? normalizePositiveNumber(globalRecord.innerHeight),
    pointSizePx: normalizePositiveNumber(viewport?.pointSizePx),
    userAgentDataMobile: typeof userAgentDataRecord.mobile === 'boolean' ? userAgentDataRecord.mobile : null,
    userAgent: typeof navigatorRecord.userAgent === 'string' ? navigatorRecord.userAgent : null
  };
}

export function createAdaptiveDepthPointBudgetResolver(
  globalLike: unknown = typeof globalThis === 'undefined' ? null : globalThis
): DepthPointBudgetResolver {
  return (viewport) => resolveAdaptiveDepthPointBudget(
    collectDepthPointBudgetEnvironmentHints(globalLike, viewport)
  );
}

function isConstrainedTouchViewport(hints: DepthPointBudgetEnvironmentHints): boolean {
  const maxTouchPoints = normalizePositiveNumber(hints.maxTouchPoints);
  const viewportWidth = normalizePositiveNumber(hints.viewportWidth);
  const viewportHeight = normalizePositiveNumber(hints.viewportHeight);
  if (
    maxTouchPoints === null ||
    maxTouchPoints <= 0 ||
    viewportWidth === null ||
    viewportHeight === null ||
    hints.coarsePointer !== true && hints.anyCoarsePointer !== true
  ) {
    return false;
  }

  return Math.min(viewportWidth, viewportHeight) <= CONSTRAINED_TOUCH_VIEWPORT_SIDE_PX;
}

function resolveViewportAwareDepthPointBudget(
  deviceBudget: number,
  hints: DepthPointBudgetEnvironmentHints
): number {
  const viewportWidth = normalizePositiveNumber(hints.viewportWidth);
  const viewportHeight = normalizePositiveNumber(hints.viewportHeight);
  if (viewportWidth === null || viewportHeight === null) {
    return deviceBudget;
  }

  const pointSizePx = normalizeDepthPointSize(hints.pointSizePx ?? DEPTH_POINT_SIZE_BUDGET_REFERENCE_PX);
  const pointSizeScale = DEPTH_POINT_SIZE_BUDGET_REFERENCE_PX / pointSizePx;
  const screenBudget = Math.max(
    1,
    Math.min(
      MAX_DEPTH_POINTS,
      Math.floor(viewportWidth * viewportHeight * DEPTH_POINTS_PER_VIEWPORT_PIXEL * pointSizeScale * pointSizeScale)
    )
  );
  return Math.min(deviceBudget, screenBudget);
}

function readMatchMedia(globalRecord: Record<string, unknown>, query: string): boolean | null {
  if (typeof globalRecord.matchMedia !== 'function') {
    return null;
  }

  try {
    const result = globalRecord.matchMedia(query);
    return isRecord(result) && typeof result.matches === 'boolean' ? result.matches : null;
  } catch {
    return null;
  }
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
