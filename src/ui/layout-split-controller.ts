import type {
  PanelCollapseState,
  PanelSplitKeyboardAction,
  PanelSplitMetrics,
  PanelSplitSizeKey,
  PanelSplitSizes,
  StoredPanelSplitState
} from '../ui';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { LayoutSplitElements } from './elements';

const PANEL_SPLIT_STORAGE_KEY = 'openexr-viewer:panel-splits:v1';
const PANEL_SPLIT_KEYBOARD_STEP = 16;
const PANEL_SPLIT_KEYBOARD_LARGE_STEP = 64;
const PANEL_COLLAPSE_TAB_WIDTH = 18;
const PANEL_COLLAPSE_TAB_WIDTH_CSS = `${PANEL_COLLAPSE_TAB_WIDTH}px`;
const PANEL_RESIZER_WIDTH = 8;
const PANEL_RESIZER_WIDTH_CSS = '0.5rem';
const IMAGE_PANEL_MIN_WIDTH = 160;
const IMAGE_PANEL_MAX_WIDTH = 420;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 520;
const VIEWER_MIN_WIDTH = 360;
const DEFAULT_PANEL_SPLIT_SIZES: PanelSplitSizes = {
  imagePanelWidth: 220,
  rightPanelWidth: 320
};
const DEFAULT_PANEL_COLLAPSE_STATE: PanelCollapseState = {
  imagePanelCollapsed: false,
  rightPanelCollapsed: false
};

type PanelCollapseKey = keyof PanelCollapseState;

interface PanelLayoutState extends PanelSplitSizes, PanelCollapseState {}

interface PanelResizeDragState {
  key: PanelSplitSizeKey;
  pointerId: number;
  startX: number;
  startY: number;
  startSizes: PanelSplitSizes;
  resizer: HTMLElement;
}

export class LayoutSplitController implements Disposable {
  private readonly disposables = new DisposableBag();
  private readonly resizeObserver: ResizeObserver;
  private panelLayoutState: PanelLayoutState = {
    ...DEFAULT_PANEL_SPLIT_SIZES,
    ...DEFAULT_PANEL_COLLAPSE_STATE
  };
  private activePanelResize: PanelResizeDragState | null = null;
  private disposed = false;

  constructor(private readonly elements: LayoutSplitElements) {
    this.resizeObserver = new ResizeObserver(() => {
      this.reclampPanelSplits();
    });

    this.bindPanelResizer(this.elements.imagePanelResizer, 'imagePanelWidth');
    this.bindPanelResizer(this.elements.rightPanelResizer, 'rightPanelWidth');
    this.bindCollapseButton(this.elements.imagePanelCollapseButton, 'imagePanelCollapsed');
    this.bindCollapseButton(this.elements.rightPanelCollapseButton, 'rightPanelCollapsed');
    this.resizeObserver.observe(this.elements.mainLayout);
    this.resizeObserver.observe(this.elements.rightStack);
    this.disposables.add(() => {
      this.resizeObserver.disconnect();
    });
    this.disposables.addEventListener(window, 'blur', () => {
      this.finishPanelResize();
    });

    this.initializePanelSplits();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.finishPanelResize();
    this.disposables.dispose();
  }

  private initializePanelSplits(): void {
    const currentSizes = this.readCurrentPanelSplitSizes();
    const storedState = readStoredPanelSplitState();
    const nextState: PanelLayoutState = normalizePanelLayoutState({
      ...DEFAULT_PANEL_SPLIT_SIZES,
      ...DEFAULT_PANEL_COLLAPSE_STATE,
      ...currentSizes,
      ...storedState
    });

    if (!this.isDesktopPanelLayout()) {
      this.setPanelLayoutState(nextState, false);
      return;
    }

    this.applyPanelLayoutState(nextState, null, false);
  }

  private readCurrentPanelSplitSizes(): PanelSplitSizes {
    if (!this.isDesktopPanelLayout()) {
      return { ...DEFAULT_PANEL_SPLIT_SIZES };
    }

    return {
      imagePanelWidth: readElementSize(
        this.elements.imagePanelContent,
        'width',
        DEFAULT_PANEL_SPLIT_SIZES.imagePanelWidth
      ),
      rightPanelWidth: readElementSize(this.elements.sidePanel, 'width', DEFAULT_PANEL_SPLIT_SIZES.rightPanelWidth)
    };
  }

  private isDesktopPanelLayout(): boolean {
    return getComputedStyle(this.elements.imagePanelResizer).display !== 'none';
  }

  private reclampPanelSplits(): void {
    if (!this.isDesktopPanelLayout()) {
      return;
    }

    this.applyPanelLayoutState(this.panelLayoutState, null, false);
  }

  private bindPanelResizer(resizer: HTMLElement, key: PanelSplitSizeKey): void {
    this.disposables.addEventListener(resizer, 'pointerdown', (event) => {
      this.beginPanelResize(event, key);
    });
    this.disposables.addEventListener(resizer, 'pointermove', (event) => {
      this.onPanelResizePointerMove(event);
    });
    this.disposables.addEventListener(resizer, 'pointerup', (event) => {
      this.finishPanelResize(event);
    });
    this.disposables.addEventListener(resizer, 'pointercancel', (event) => {
      this.finishPanelResize(event);
    });
    this.disposables.addEventListener(resizer, 'keydown', (event) => {
      this.onPanelResizerKeyDown(event, key);
    });
  }

  private bindCollapseButton(button: HTMLButtonElement, key: PanelCollapseKey): void {
    this.disposables.addEventListener(button, 'click', () => {
      this.togglePanelCollapsed(key);
    });
  }

  private beginPanelResize(event: PointerEvent, key: PanelSplitSizeKey): void {
    if (this.disposed) {
      return;
    }

    if (event.button !== 0 || !this.isDesktopPanelLayout() || this.isPanelCollapsed(key)) {
      return;
    }

    event.preventDefault();
    const resizer = event.currentTarget as HTMLElement;
    this.activePanelResize = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSizes: this.getExpandedPanelSplitSizes(),
      resizer
    };
    resizer.classList.add('is-resizing');
    document.body.classList.add('is-resizing-panel-columns');
    resizer.setPointerCapture(event.pointerId);
  }

  private onPanelResizePointerMove(event: PointerEvent): void {
    if (this.disposed) {
      return;
    }

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

    this.applyPanelLayoutState({ ...this.panelLayoutState, ...nextSizes }, dragState.key, false);
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
    saveStoredPanelSplitState(this.panelLayoutState);
  }

  private onPanelResizerKeyDown(event: KeyboardEvent, key: PanelSplitSizeKey): void {
    if (this.disposed) {
      return;
    }

    if (!this.isDesktopPanelLayout() || this.isPanelCollapsed(key)) {
      return;
    }

    const action = getPanelSplitKeyboardAction(event.key, event.shiftKey);
    if (!action) {
      return;
    }

    event.preventDefault();
    const nextSizes = this.getExpandedPanelSplitSizes();

    if (action.type === 'snap') {
      const range = getPanelSplitSizeRange(key, nextSizes, this.getPanelSplitMetrics(this.panelLayoutState));
      nextSizes[key] = action.target === 'min' ? range.min : range.max;
    } else {
      const delta = key === 'rightPanelWidth' ? -action.delta : action.delta;
      nextSizes[key] += delta;
    }

    this.applyPanelLayoutState({ ...this.panelLayoutState, ...nextSizes }, key, true);
  }

  private togglePanelCollapsed(key: PanelCollapseKey): void {
    if (this.disposed || !this.isDesktopPanelLayout()) {
      return;
    }

    this.finishPanelResize();
    const nextCollapsed = !this.panelLayoutState[key];
    const sizeKey = getPanelSplitSizeKeyForCollapseKey(key);
    this.applyPanelLayoutState(
      { ...this.panelLayoutState, [key]: nextCollapsed },
      nextCollapsed ? null : sizeKey,
      true
    );
  }

  private applyPanelLayoutState(
    state: PanelLayoutState,
    activeKey: PanelSplitSizeKey | null,
    persist: boolean
  ): void {
    const normalizedState = normalizePanelLayoutState(state);
    const clampedSizes = clampPanelSplitSizes(
      normalizedState,
      this.getPanelSplitMetrics(normalizedState),
      activeKey
    );
    this.setPanelLayoutState({ ...normalizedState, ...clampedSizes }, persist);
  }

  private setPanelLayoutState(state: PanelLayoutState, persist: boolean): void {
    this.panelLayoutState = normalizePanelLayoutState(state);
    this.renderPanelLayoutState();

    if (persist) {
      saveStoredPanelSplitState(this.panelLayoutState);
    }
  }

  private renderPanelLayoutState(): void {
    const imagePanelWidth = this.panelLayoutState.imagePanelCollapsed ? 0 : this.panelLayoutState.imagePanelWidth;
    const rightPanelWidth = this.panelLayoutState.rightPanelCollapsed ? 0 : this.panelLayoutState.rightPanelWidth;

    this.elements.mainLayout.style.setProperty('--image-panel-tab-width', PANEL_COLLAPSE_TAB_WIDTH_CSS);
    this.elements.mainLayout.style.setProperty('--right-panel-tab-width', PANEL_COLLAPSE_TAB_WIDTH_CSS);
    this.elements.mainLayout.style.setProperty('--image-panel-width', `${Math.round(imagePanelWidth)}px`);
    this.elements.mainLayout.style.setProperty('--right-panel-width', `${Math.round(rightPanelWidth)}px`);
    this.elements.mainLayout.style.setProperty(
      '--image-panel-resizer-width',
      this.panelLayoutState.imagePanelCollapsed ? '0px' : PANEL_RESIZER_WIDTH_CSS
    );
    this.elements.mainLayout.style.setProperty(
      '--right-panel-resizer-width',
      this.panelLayoutState.rightPanelCollapsed ? '0px' : PANEL_RESIZER_WIDTH_CSS
    );
    this.elements.imagePanel.classList.toggle('is-collapsed', this.panelLayoutState.imagePanelCollapsed);
    this.elements.rightStack.classList.toggle('is-collapsed', this.panelLayoutState.rightPanelCollapsed);
    this.elements.imagePanelContent.classList.toggle('is-collapsed', this.panelLayoutState.imagePanelCollapsed);
    this.elements.sidePanel.classList.toggle('is-collapsed', this.panelLayoutState.rightPanelCollapsed);
    this.updatePanelSplitAria();
    this.updateCollapseButtons();
  }

  private getExpandedPanelSplitSizes(): PanelSplitSizes {
    return {
      imagePanelWidth: this.panelLayoutState.imagePanelWidth,
      rightPanelWidth: this.panelLayoutState.rightPanelWidth
    };
  }

  private isPanelCollapsed(key: PanelSplitSizeKey): boolean {
    return key === 'imagePanelWidth'
      ? this.panelLayoutState.imagePanelCollapsed
      : this.panelLayoutState.rightPanelCollapsed;
  }

  private getPanelSplitMetrics(state: PanelCollapseState): PanelSplitMetrics {
    return {
      mainWidth: readElementSize(this.elements.mainLayout, 'width', window.innerWidth),
      imagePanelTabWidth: PANEL_COLLAPSE_TAB_WIDTH,
      imageResizerWidth: state.imagePanelCollapsed ? 0 : PANEL_RESIZER_WIDTH,
      rightPanelTabWidth: PANEL_COLLAPSE_TAB_WIDTH,
      rightResizerWidth: state.rightPanelCollapsed ? 0 : PANEL_RESIZER_WIDTH
    };
  }

  private updatePanelSplitAria(): void {
    const metrics = this.getPanelSplitMetrics(this.panelLayoutState);
    this.updatePanelResizerAria(this.elements.imagePanelResizer, 'imagePanelWidth', metrics);
    this.updatePanelResizerAria(this.elements.rightPanelResizer, 'rightPanelWidth', metrics);
  }

  private updatePanelResizerAria(
    resizer: HTMLElement,
    key: PanelSplitSizeKey,
    metrics: PanelSplitMetrics
  ): void {
    const collapsed = this.isPanelCollapsed(key);
    const range = getPanelSplitSizeRange(key, this.getExpandedPanelSplitSizes(), metrics);
    resizer.classList.toggle('is-collapsed', collapsed);
    resizer.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    resizer.setAttribute('aria-disabled', collapsed ? 'true' : 'false');
    resizer.tabIndex = collapsed ? -1 : 0;
    resizer.setAttribute('aria-valuemin', String(Math.round(range.min)));
    resizer.setAttribute('aria-valuemax', String(Math.round(range.max)));
    resizer.setAttribute('aria-valuenow', String(Math.round(this.panelLayoutState[key])));
  }

  private updateCollapseButtons(): void {
    updateCollapseButton(
      this.elements.imagePanelCollapseButton,
      'left',
      this.panelLayoutState.imagePanelCollapsed
    );
    updateCollapseButton(
      this.elements.rightPanelCollapseButton,
      'right',
      this.panelLayoutState.rightPanelCollapsed
    );
  }
}

export function parsePanelSplitStorageValue(value: string | null): StoredPanelSplitState {
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
  const state: StoredPanelSplitState = {};
  const keys: PanelSplitSizeKey[] = ['imagePanelWidth', 'rightPanelWidth'];

  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'number' && Number.isFinite(item) && item > 0) {
      state[key] = item;
    }
  }

  if (typeof record.imagePanelCollapsed === 'boolean') {
    state.imagePanelCollapsed = record.imagePanelCollapsed;
  }
  if (typeof record.rightPanelCollapsed === 'boolean') {
    state.rightPanelCollapsed = record.rightPanelCollapsed;
  }

  return state;
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

function readStoredPanelSplitState(): StoredPanelSplitState {
  try {
    return parsePanelSplitStorageValue(window.localStorage.getItem(PANEL_SPLIT_STORAGE_KEY));
  } catch {
    return {};
  }
}

function saveStoredPanelSplitState(state: PanelLayoutState): void {
  try {
    window.localStorage.setItem(
      PANEL_SPLIT_STORAGE_KEY,
      JSON.stringify({
        imagePanelWidth: Math.round(state.imagePanelWidth),
        rightPanelWidth: Math.round(state.rightPanelWidth),
        imagePanelCollapsed: state.imagePanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed
      })
    );
  } catch {
    // Storage can be unavailable in private contexts; resizing should still work for the current page.
  }
}

function normalizePanelLayoutState(state: Partial<PanelLayoutState>): PanelLayoutState {
  return {
    imagePanelWidth: clampFiniteSize(
      state.imagePanelWidth ?? DEFAULT_PANEL_SPLIT_SIZES.imagePanelWidth,
      IMAGE_PANEL_MIN_WIDTH,
      IMAGE_PANEL_MAX_WIDTH
    ),
    rightPanelWidth: clampFiniteSize(
      state.rightPanelWidth ?? DEFAULT_PANEL_SPLIT_SIZES.rightPanelWidth,
      RIGHT_PANEL_MIN_WIDTH,
      RIGHT_PANEL_MAX_WIDTH
    ),
    imagePanelCollapsed: state.imagePanelCollapsed ?? DEFAULT_PANEL_COLLAPSE_STATE.imagePanelCollapsed,
    rightPanelCollapsed: state.rightPanelCollapsed ?? DEFAULT_PANEL_COLLAPSE_STATE.rightPanelCollapsed
  };
}

function getPanelSplitSizeKeyForCollapseKey(key: PanelCollapseKey): PanelSplitSizeKey {
  return key === 'imagePanelCollapsed' ? 'imagePanelWidth' : 'rightPanelWidth';
}

function updateCollapseButton(
  button: HTMLButtonElement,
  side: 'left' | 'right',
  collapsed: boolean
): void {
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${side} panel`);
  button.classList.toggle('is-collapsed', collapsed);
}

function readElementSize(element: HTMLElement, axis: 'width' | 'height', fallback: number): number {
  const rect = element.getBoundingClientRect();
  const value = axis === 'width' ? rect.width : rect.height;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function getSidePanelWidthLimit(metrics: PanelSplitMetrics): number {
  const availableWidth =
    metrics.mainWidth -
    metrics.imagePanelTabWidth -
    metrics.imageResizerWidth -
    metrics.rightPanelTabWidth -
    metrics.rightResizerWidth -
    VIEWER_MIN_WIDTH;
  return Math.max(IMAGE_PANEL_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH, Math.floor(availableWidth));
}

function clampFiniteSize(value: number, min: number, max: number): number {
  return clamp(Number.isFinite(value) ? value : min, min, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
