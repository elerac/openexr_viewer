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
const PANEL_COLLAPSE_TAB_HEIGHT = 18;
const PANEL_COLLAPSE_TAB_HEIGHT_CSS = `${PANEL_COLLAPSE_TAB_HEIGHT}px`;
const PANEL_RESIZER_WIDTH = 8;
const PANEL_RESIZER_WIDTH_CSS = '0.5rem';
const PANEL_RESIZER_HEIGHT = 8;
const PANEL_RESIZER_HEIGHT_CSS = '0.5rem';
const IMAGE_PANEL_MIN_WIDTH = 160;
const IMAGE_PANEL_MAX_WIDTH = 420;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 520;
const BOTTOM_PANEL_MIN_HEIGHT = 120;
const BOTTOM_PANEL_MAX_HEIGHT = 360;
const VIEWER_MIN_WIDTH = 360;
const VIEWER_MIN_HEIGHT = 240;
const DEFAULT_PANEL_SPLIT_SIZES: PanelSplitSizes = {
  imagePanelWidth: 220,
  rightPanelWidth: 280,
  bottomPanelHeight: 120
};
const DEFAULT_PANEL_COLLAPSE_STATE: PanelCollapseState = {
  imagePanelCollapsed: false,
  rightPanelCollapsed: false,
  bottomPanelCollapsed: true
};

type PanelCollapseKey = keyof PanelCollapseState;
type PanelSplitAxis = 'horizontal' | 'vertical';

interface PanelLayoutState extends PanelSplitSizes, PanelCollapseState {}

interface PanelResizeDragState {
  key: PanelSplitSizeKey;
  axis: PanelSplitAxis;
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
    this.bindPanelResizer(this.elements.bottomPanelResizer, 'bottomPanelHeight');
    this.bindCollapseButton(this.elements.imagePanelCollapseButton, 'imagePanelCollapsed');
    this.bindCollapseButton(this.elements.rightPanelCollapseButton, 'rightPanelCollapsed');
    this.bindCollapseButton(this.elements.bottomPanelCollapseButton, 'bottomPanelCollapsed');
    this.resizeObserver.observe(this.elements.mainLayout);
    this.resizeObserver.observe(this.elements.rightStack);
    this.resizeObserver.observe(this.elements.bottomPanel);
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

  resetToDefaults(): void {
    if (this.disposed) {
      return;
    }

    this.finishPanelResize();
    const defaultState: PanelLayoutState = {
      ...DEFAULT_PANEL_SPLIT_SIZES,
      ...DEFAULT_PANEL_COLLAPSE_STATE
    };

    if (!this.isDesktopPanelLayout()) {
      this.setPanelLayoutState(defaultState, true);
      return;
    }

    this.applyPanelLayoutState(defaultState, null, true);
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
      rightPanelWidth: readElementSize(this.elements.sidePanel, 'width', DEFAULT_PANEL_SPLIT_SIZES.rightPanelWidth),
      bottomPanelHeight: readElementSize(
        this.elements.bottomPanelContent,
        'height',
        DEFAULT_PANEL_SPLIT_SIZES.bottomPanelHeight
      )
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
    const axis = getPanelSplitAxis(key);
    this.disposables.addEventListener(resizer, 'pointerdown', (event) => {
      this.beginPanelResize(event, key, axis);
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
      this.onPanelResizerKeyDown(event, key, axis);
    });
  }

  private bindCollapseButton(button: HTMLButtonElement, key: PanelCollapseKey): void {
    this.disposables.addEventListener(button, 'click', () => {
      this.togglePanelCollapsed(key);
    });
  }

  private beginPanelResize(event: PointerEvent, key: PanelSplitSizeKey, axis: PanelSplitAxis): void {
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
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSizes: this.getExpandedPanelSplitSizes(),
      resizer
    };
    resizer.classList.add('is-resizing');
    document.body.classList.add(axis === 'horizontal' ? 'is-resizing-panel-columns' : 'is-resizing-panel-rows');
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
    const delta =
      dragState.axis === 'horizontal' ? event.clientX - dragState.startX : event.clientY - dragState.startY;
    nextSizes[dragState.key] =
      dragState.startSizes[dragState.key] + delta * getPanelSplitResizeDirection(dragState.key);

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
    document.body.classList.remove('is-resizing-panel-rows');
    this.activePanelResize = null;
    saveStoredPanelSplitState(this.panelLayoutState);
  }

  private onPanelResizerKeyDown(event: KeyboardEvent, key: PanelSplitSizeKey, axis: PanelSplitAxis): void {
    if (this.disposed) {
      return;
    }

    if (!this.isDesktopPanelLayout() || this.isPanelCollapsed(key)) {
      return;
    }

    const action = getPanelSplitKeyboardAction(event.key, event.shiftKey, axis);
    if (!action) {
      return;
    }

    event.preventDefault();
    const nextSizes = this.getExpandedPanelSplitSizes();

    if (action.type === 'snap') {
      const range = getPanelSplitSizeRange(key, nextSizes, this.getPanelSplitMetrics(this.panelLayoutState));
      nextSizes[key] = action.target === 'min' ? range.min : range.max;
    } else {
      nextSizes[key] += action.delta * getPanelSplitResizeDirection(key);
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
    const bottomPanelHeight = this.panelLayoutState.bottomPanelCollapsed ? 0 : this.panelLayoutState.bottomPanelHeight;

    this.elements.mainLayout.style.setProperty('--image-panel-tab-width', PANEL_COLLAPSE_TAB_WIDTH_CSS);
    this.elements.mainLayout.style.setProperty('--right-panel-tab-width', PANEL_COLLAPSE_TAB_WIDTH_CSS);
    this.elements.mainLayout.style.setProperty('--bottom-panel-tab-height', PANEL_COLLAPSE_TAB_HEIGHT_CSS);
    this.elements.mainLayout.style.setProperty('--image-panel-width', `${Math.round(imagePanelWidth)}px`);
    this.elements.mainLayout.style.setProperty('--right-panel-width', `${Math.round(rightPanelWidth)}px`);
    this.elements.mainLayout.style.setProperty('--bottom-panel-height', `${Math.round(bottomPanelHeight)}px`);
    this.elements.mainLayout.style.setProperty(
      '--image-panel-resizer-width',
      this.panelLayoutState.imagePanelCollapsed ? '0px' : PANEL_RESIZER_WIDTH_CSS
    );
    this.elements.mainLayout.style.setProperty(
      '--right-panel-resizer-width',
      this.panelLayoutState.rightPanelCollapsed ? '0px' : PANEL_RESIZER_WIDTH_CSS
    );
    this.elements.mainLayout.style.setProperty(
      '--bottom-panel-resizer-height',
      this.panelLayoutState.bottomPanelCollapsed ? '0px' : PANEL_RESIZER_HEIGHT_CSS
    );
    this.elements.imagePanel.classList.toggle('is-collapsed', this.panelLayoutState.imagePanelCollapsed);
    this.elements.rightStack.classList.toggle('is-collapsed', this.panelLayoutState.rightPanelCollapsed);
    this.elements.bottomPanel.classList.toggle('is-collapsed', this.panelLayoutState.bottomPanelCollapsed);
    this.elements.imagePanelContent.classList.toggle('is-collapsed', this.panelLayoutState.imagePanelCollapsed);
    this.elements.sidePanel.classList.toggle('is-collapsed', this.panelLayoutState.rightPanelCollapsed);
    this.elements.bottomPanelContent.classList.toggle('is-collapsed', this.panelLayoutState.bottomPanelCollapsed);
    this.updatePanelSplitAria();
    this.updateCollapseButtons();
  }

  private getExpandedPanelSplitSizes(): PanelSplitSizes {
    return {
      imagePanelWidth: this.panelLayoutState.imagePanelWidth,
      rightPanelWidth: this.panelLayoutState.rightPanelWidth,
      bottomPanelHeight: this.panelLayoutState.bottomPanelHeight
    };
  }

  private isPanelCollapsed(key: PanelSplitSizeKey): boolean {
    switch (key) {
      case 'imagePanelWidth':
        return this.panelLayoutState.imagePanelCollapsed;
      case 'rightPanelWidth':
        return this.panelLayoutState.rightPanelCollapsed;
      case 'bottomPanelHeight':
        return this.panelLayoutState.bottomPanelCollapsed;
      default:
        throw new Error(`Unknown panel split size key: ${key satisfies never}`);
    }
  }

  private getPanelSplitMetrics(state: PanelCollapseState): PanelSplitMetrics {
    return {
      mainWidth: readElementSize(this.elements.mainLayout, 'width', window.innerWidth),
      mainHeight: readElementSize(this.elements.mainLayout, 'height', window.innerHeight),
      imagePanelTabWidth: PANEL_COLLAPSE_TAB_WIDTH,
      imageResizerWidth: state.imagePanelCollapsed ? 0 : PANEL_RESIZER_WIDTH,
      rightPanelTabWidth: PANEL_COLLAPSE_TAB_WIDTH,
      rightResizerWidth: state.rightPanelCollapsed ? 0 : PANEL_RESIZER_WIDTH,
      bottomPanelTabHeight: PANEL_COLLAPSE_TAB_HEIGHT,
      bottomResizerHeight: state.bottomPanelCollapsed ? 0 : PANEL_RESIZER_HEIGHT
    };
  }

  private updatePanelSplitAria(): void {
    const metrics = this.getPanelSplitMetrics(this.panelLayoutState);
    this.updatePanelResizerAria(this.elements.imagePanelResizer, 'imagePanelWidth', metrics);
    this.updatePanelResizerAria(this.elements.rightPanelResizer, 'rightPanelWidth', metrics);
    this.updatePanelResizerAria(this.elements.bottomPanelResizer, 'bottomPanelHeight', metrics);
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
    updateCollapseButton(
      this.elements.bottomPanelCollapseButton,
      'bottom',
      this.panelLayoutState.bottomPanelCollapsed
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
  const keys: PanelSplitSizeKey[] = ['imagePanelWidth', 'rightPanelWidth', 'bottomPanelHeight'];

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
  if (typeof record.bottomPanelCollapsed === 'boolean') {
    state.bottomPanelCollapsed = record.bottomPanelCollapsed;
  }

  return state;
}

export function getPanelSplitKeyboardAction(
  key: string,
  shiftKey: boolean,
  axis: PanelSplitAxis = 'horizontal'
): PanelSplitKeyboardAction | null {
  if (key === 'Home') {
    return { type: 'snap', target: 'min' };
  }
  if (key === 'End') {
    return { type: 'snap', target: 'max' };
  }

  const step = shiftKey ? PANEL_SPLIT_KEYBOARD_LARGE_STEP : PANEL_SPLIT_KEYBOARD_STEP;
  if (axis === 'horizontal') {
    if (key === 'ArrowLeft' || key === 'Left') {
      return { type: 'delta', delta: -step };
    }
    if (key === 'ArrowRight' || key === 'Right') {
      return { type: 'delta', delta: step };
    }
  } else {
    if (key === 'ArrowUp' || key === 'Up') {
      return { type: 'delta', delta: -step };
    }
    if (key === 'ArrowDown' || key === 'Down') {
      return { type: 'delta', delta: step };
    }
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
    rightPanelWidth: clampFiniteSize(sizes.rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
    bottomPanelHeight: clampFiniteSize(
      sizes.bottomPanelHeight,
      BOTTOM_PANEL_MIN_HEIGHT,
      BOTTOM_PANEL_MAX_HEIGHT
    )
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

  clampedSizes.bottomPanelHeight = Math.min(clampedSizes.bottomPanelHeight, getBottomPanelHeightLimit(metrics));

  return {
    imagePanelWidth: Math.round(clampedSizes.imagePanelWidth),
    rightPanelWidth: Math.round(clampedSizes.rightPanelWidth),
    bottomPanelHeight: Math.round(clampedSizes.bottomPanelHeight)
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

  if (key === 'bottomPanelHeight') {
    return {
      min: BOTTOM_PANEL_MIN_HEIGHT,
      max: Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(BOTTOM_PANEL_MAX_HEIGHT, getBottomPanelHeightLimit(metrics)))
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
        bottomPanelHeight: Math.round(state.bottomPanelHeight),
        imagePanelCollapsed: state.imagePanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        bottomPanelCollapsed: state.bottomPanelCollapsed
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
    bottomPanelHeight: clampFiniteSize(
      state.bottomPanelHeight ?? DEFAULT_PANEL_SPLIT_SIZES.bottomPanelHeight,
      BOTTOM_PANEL_MIN_HEIGHT,
      BOTTOM_PANEL_MAX_HEIGHT
    ),
    imagePanelCollapsed: state.imagePanelCollapsed ?? DEFAULT_PANEL_COLLAPSE_STATE.imagePanelCollapsed,
    rightPanelCollapsed: state.rightPanelCollapsed ?? DEFAULT_PANEL_COLLAPSE_STATE.rightPanelCollapsed,
    bottomPanelCollapsed: state.bottomPanelCollapsed ?? DEFAULT_PANEL_COLLAPSE_STATE.bottomPanelCollapsed
  };
}

function getPanelSplitSizeKeyForCollapseKey(key: PanelCollapseKey): PanelSplitSizeKey {
  switch (key) {
    case 'imagePanelCollapsed':
      return 'imagePanelWidth';
    case 'rightPanelCollapsed':
      return 'rightPanelWidth';
    case 'bottomPanelCollapsed':
      return 'bottomPanelHeight';
    default:
      throw new Error(`Unknown panel collapse key: ${key satisfies never}`);
  }
}

function updateCollapseButton(
  button: HTMLButtonElement,
  side: 'left' | 'right' | 'bottom',
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

function getPanelSplitAxis(key: PanelSplitSizeKey): PanelSplitAxis {
  return key === 'bottomPanelHeight' ? 'vertical' : 'horizontal';
}

function getPanelSplitResizeDirection(key: PanelSplitSizeKey): number {
  return key === 'imagePanelWidth' ? 1 : -1;
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

function getBottomPanelHeightLimit(metrics: PanelSplitMetrics): number {
  const availableHeight =
    metrics.mainHeight - metrics.bottomPanelTabHeight - metrics.bottomResizerHeight - VIEWER_MIN_HEIGHT;
  return Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.min(BOTTOM_PANEL_MAX_HEIGHT, Math.floor(availableHeight)));
}

function clampFiniteSize(value: number, min: number, max: number): number {
  return clamp(Number.isFinite(value) ? value : min, min, max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
