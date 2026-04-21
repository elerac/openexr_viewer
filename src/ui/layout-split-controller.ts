import type {
  PanelSplitKeyboardAction,
  PanelSplitMetrics,
  PanelSplitSizeKey,
  PanelSplitSizes
} from '../ui';
import type { LayoutSplitElements } from './elements';

const PANEL_SPLIT_STORAGE_KEY = 'openexr-viewer:panel-splits:v1';
const PANEL_SPLIT_KEYBOARD_STEP = 16;
const PANEL_SPLIT_KEYBOARD_LARGE_STEP = 64;
const IMAGE_PANEL_MIN_WIDTH = 160;
const IMAGE_PANEL_MAX_WIDTH = 420;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 520;
const VIEWER_MIN_WIDTH = 360;
const DEFAULT_PANEL_SPLIT_SIZES: PanelSplitSizes = {
  imagePanelWidth: 220,
  rightPanelWidth: 320
};

interface PanelResizeDragState {
  key: PanelSplitSizeKey;
  pointerId: number;
  startX: number;
  startY: number;
  startSizes: PanelSplitSizes;
  resizer: HTMLElement;
}

export class LayoutSplitController {
  private readonly resizeObserver: ResizeObserver;
  private panelSplitSizes: PanelSplitSizes = { ...DEFAULT_PANEL_SPLIT_SIZES };
  private activePanelResize: PanelResizeDragState | null = null;

  constructor(private readonly elements: LayoutSplitElements) {
    this.resizeObserver = new ResizeObserver(() => {
      this.reclampPanelSplits();
    });

    this.bindPanelResizer(this.elements.imagePanelResizer, 'imagePanelWidth');
    this.bindPanelResizer(this.elements.rightPanelResizer, 'rightPanelWidth');
    this.resizeObserver.observe(this.elements.mainLayout);
    this.resizeObserver.observe(this.elements.rightStack);
    window.addEventListener('blur', () => {
      this.finishPanelResize();
    });

    this.initializePanelSplits();
  }

  private initializePanelSplits(): void {
    const currentSizes = this.readCurrentPanelSplitSizes();
    const storedSizes = readStoredPanelSplitSizes();
    this.applyPanelSplitSizes({ ...currentSizes, ...storedSizes }, null, false);
  }

  private readCurrentPanelSplitSizes(): PanelSplitSizes {
    if (!this.isDesktopPanelLayout()) {
      return { ...DEFAULT_PANEL_SPLIT_SIZES };
    }

    return {
      imagePanelWidth: readElementSize(this.elements.imagePanel, 'width', DEFAULT_PANEL_SPLIT_SIZES.imagePanelWidth),
      rightPanelWidth: readElementSize(this.elements.rightStack, 'width', DEFAULT_PANEL_SPLIT_SIZES.rightPanelWidth)
    };
  }

  private isDesktopPanelLayout(): boolean {
    return getComputedStyle(this.elements.imagePanelResizer).display !== 'none';
  }

  private reclampPanelSplits(): void {
    if (!this.isDesktopPanelLayout()) {
      return;
    }

    this.applyPanelSplitSizes(this.panelSplitSizes, null, false);
  }

  private bindPanelResizer(resizer: HTMLElement, key: PanelSplitSizeKey): void {
    resizer.addEventListener('pointerdown', (event) => {
      this.beginPanelResize(event, key);
    });
    resizer.addEventListener('pointermove', (event) => {
      this.onPanelResizePointerMove(event);
    });
    resizer.addEventListener('pointerup', (event) => {
      this.finishPanelResize(event);
    });
    resizer.addEventListener('pointercancel', (event) => {
      this.finishPanelResize(event);
    });
    resizer.addEventListener('keydown', (event) => {
      this.onPanelResizerKeyDown(event, key);
    });
  }

  private beginPanelResize(event: PointerEvent, key: PanelSplitSizeKey): void {
    if (event.button !== 0 || !this.isDesktopPanelLayout()) {
      return;
    }

    event.preventDefault();
    const resizer = event.currentTarget as HTMLElement;
    this.activePanelResize = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSizes: { ...this.panelSplitSizes },
      resizer
    };
    resizer.classList.add('is-resizing');
    document.body.classList.add('is-resizing-panel-columns');
    resizer.setPointerCapture(event.pointerId);
  }

  private onPanelResizePointerMove(event: PointerEvent): void {
    const dragState = this.activePanelResize;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    event.preventDefault();
    const nextSizes = { ...dragState.startSizes };
    const deltaX = event.clientX - dragState.startX;

    if (dragState.key === 'imagePanelWidth') {
      nextSizes.imagePanelWidth = dragState.startSizes.imagePanelWidth + deltaX;
    } else {
      nextSizes.rightPanelWidth = dragState.startSizes.rightPanelWidth - deltaX;
    }

    this.applyPanelSplitSizes(nextSizes, dragState.key, false);
  }

  private finishPanelResize(event?: PointerEvent): void {
    const dragState = this.activePanelResize;
    if (!dragState || (event && event.pointerId !== dragState.pointerId)) {
      return;
    }

    event?.preventDefault();
    if (dragState.resizer.hasPointerCapture(dragState.pointerId)) {
      dragState.resizer.releasePointerCapture(dragState.pointerId);
    }
    dragState.resizer.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing-panel-columns');
    this.activePanelResize = null;
    saveStoredPanelSplitSizes(this.panelSplitSizes);
  }

  private onPanelResizerKeyDown(event: KeyboardEvent, key: PanelSplitSizeKey): void {
    if (!this.isDesktopPanelLayout()) {
      return;
    }

    const action = getPanelSplitKeyboardAction(event.key, event.shiftKey);
    if (!action) {
      return;
    }

    event.preventDefault();
    const nextSizes = { ...this.panelSplitSizes };

    if (action.type === 'snap') {
      const range = getPanelSplitSizeRange(key, this.panelSplitSizes, this.getPanelSplitMetrics());
      nextSizes[key] = action.target === 'min' ? range.min : range.max;
    } else {
      const delta = key === 'rightPanelWidth' ? -action.delta : action.delta;
      nextSizes[key] += delta;
    }

    this.applyPanelSplitSizes(nextSizes, key, true);
  }

  private applyPanelSplitSizes(
    sizes: PanelSplitSizes,
    activeKey: PanelSplitSizeKey | null,
    persist: boolean
  ): void {
    const clampedSizes = clampPanelSplitSizes(sizes, this.getPanelSplitMetrics(), activeKey);
    this.panelSplitSizes = clampedSizes;
    this.elements.mainLayout.style.setProperty('--image-panel-width', `${Math.round(clampedSizes.imagePanelWidth)}px`);
    this.elements.mainLayout.style.setProperty('--right-panel-width', `${Math.round(clampedSizes.rightPanelWidth)}px`);
    this.updatePanelSplitAria();

    if (persist) {
      saveStoredPanelSplitSizes(clampedSizes);
    }
  }

  private getPanelSplitMetrics(): PanelSplitMetrics {
    return {
      mainWidth: readElementSize(this.elements.mainLayout, 'width', window.innerWidth),
      imageResizerWidth: readElementSize(this.elements.imagePanelResizer, 'width', 8),
      rightResizerWidth: readElementSize(this.elements.rightPanelResizer, 'width', 8)
    };
  }

  private updatePanelSplitAria(): void {
    const metrics = this.getPanelSplitMetrics();
    this.updatePanelResizerAria(this.elements.imagePanelResizer, 'imagePanelWidth', metrics);
    this.updatePanelResizerAria(this.elements.rightPanelResizer, 'rightPanelWidth', metrics);
  }

  private updatePanelResizerAria(
    resizer: HTMLElement,
    key: PanelSplitSizeKey,
    metrics: PanelSplitMetrics
  ): void {
    const range = getPanelSplitSizeRange(key, this.panelSplitSizes, metrics);
    resizer.setAttribute('aria-valuemin', String(Math.round(range.min)));
    resizer.setAttribute('aria-valuemax', String(Math.round(range.max)));
    resizer.setAttribute('aria-valuenow', String(Math.round(this.panelSplitSizes[key])));
  }
}

export function parsePanelSplitStorageValue(value: string | null): Partial<PanelSplitSizes> {
  if (!value) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const record = parsed as Record<string, unknown>;
  const sizes: Partial<PanelSplitSizes> = {};
  const keys: PanelSplitSizeKey[] = ['imagePanelWidth', 'rightPanelWidth'];

  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'number' && Number.isFinite(item) && item > 0) {
      sizes[key] = item;
    }
  }

  return sizes;
}

export function getPanelSplitKeyboardAction(
  key: string,
  shiftKey: boolean
): PanelSplitKeyboardAction | null {
  if (key === 'Home') {
    return { type: 'snap', target: 'min' };
  }
  if (key === 'End') {
    return { type: 'snap', target: 'max' };
  }

  const step = shiftKey ? PANEL_SPLIT_KEYBOARD_LARGE_STEP : PANEL_SPLIT_KEYBOARD_STEP;
  if (key === 'ArrowLeft' || key === 'Left') {
    return { type: 'delta', delta: -step };
  }
  if (key === 'ArrowRight' || key === 'Right') {
    return { type: 'delta', delta: step };
  }

  return null;
}

export function clampPanelSplitSizes(
  sizes: PanelSplitSizes,
  metrics: PanelSplitMetrics,
  activeKey: PanelSplitSizeKey | null = null
): PanelSplitSizes {
  const sideWidthLimit = getSidePanelWidthLimit(metrics);
  const clampedSizes: PanelSplitSizes = {
    imagePanelWidth: clampFiniteSize(sizes.imagePanelWidth, IMAGE_PANEL_MIN_WIDTH, IMAGE_PANEL_MAX_WIDTH),
    rightPanelWidth: clampFiniteSize(sizes.rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH)
  };

  let overflow = clampedSizes.imagePanelWidth + clampedSizes.rightPanelWidth - sideWidthLimit;
  if (overflow > 0) {
    const reductionOrder: PanelSplitSizeKey[] =
      activeKey === 'imagePanelWidth'
        ? ['rightPanelWidth', 'imagePanelWidth']
        : activeKey === 'rightPanelWidth'
          ? ['imagePanelWidth', 'rightPanelWidth']
          : ['rightPanelWidth', 'imagePanelWidth'];

    for (const key of reductionOrder) {
      if (overflow <= 0) {
        break;
      }

      const min = key === 'imagePanelWidth' ? IMAGE_PANEL_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
      const reduction = Math.min(overflow, clampedSizes[key] - min);
      clampedSizes[key] -= reduction;
      overflow -= reduction;
    }
  }

  return {
    imagePanelWidth: Math.round(clampedSizes.imagePanelWidth),
    rightPanelWidth: Math.round(clampedSizes.rightPanelWidth)
  };
}

export function getPanelSplitSizeRange(
  key: PanelSplitSizeKey,
  sizes: PanelSplitSizes,
  metrics: PanelSplitMetrics
): { min: number; max: number } {
  if (key === 'imagePanelWidth') {
    const rightWidth = clampFiniteSize(sizes.rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);
    return {
      min: IMAGE_PANEL_MIN_WIDTH,
      max: Math.max(IMAGE_PANEL_MIN_WIDTH, Math.min(IMAGE_PANEL_MAX_WIDTH, getSidePanelWidthLimit(metrics) - rightWidth))
    };
  }

  if (key === 'rightPanelWidth') {
    const imageWidth = clampFiniteSize(sizes.imagePanelWidth, IMAGE_PANEL_MIN_WIDTH, IMAGE_PANEL_MAX_WIDTH);
    return {
      min: RIGHT_PANEL_MIN_WIDTH,
      max: Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, getSidePanelWidthLimit(metrics) - imageWidth))
    };
  }

  throw new Error(`Unknown panel split size key: ${key}`);
}

function readStoredPanelSplitSizes(): Partial<PanelSplitSizes> {
  try {
    return parsePanelSplitStorageValue(window.localStorage.getItem(PANEL_SPLIT_STORAGE_KEY));
  } catch {
    return {};
  }
}

function saveStoredPanelSplitSizes(sizes: PanelSplitSizes): void {
  try {
    window.localStorage.setItem(
      PANEL_SPLIT_STORAGE_KEY,
      JSON.stringify({
        imagePanelWidth: Math.round(sizes.imagePanelWidth),
        rightPanelWidth: Math.round(sizes.rightPanelWidth)
      })
    );
  } catch {
    // Storage can be unavailable in private contexts; resizing should still work for the current page.
  }
}

function readElementSize(element: HTMLElement, axis: 'width' | 'height', fallback: number): number {
  const rect = element.getBoundingClientRect();
  const value = axis === 'width' ? rect.width : rect.height;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function getSidePanelWidthLimit(metrics: PanelSplitMetrics): number {
  const availableWidth =
    metrics.mainWidth - metrics.imageResizerWidth - metrics.rightResizerWidth - VIEWER_MIN_WIDTH;
  return Math.max(IMAGE_PANEL_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH, Math.floor(availableWidth));
}

function clampFiniteSize(value: number, min: number, max: number): number {
  return clamp(Number.isFinite(value) ? value : min, min, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
