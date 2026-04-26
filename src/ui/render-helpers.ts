const LISTBOX_ROW_KEY_DATASET = 'renderKey';

export interface ListboxHitTestMetrics {
  top: number;
  height: number;
  scrollTop: number;
  scrollHeight: number;
  optionCount: number;
}

export interface SelectOptionDefinition {
  value: string;
  label: string;
  disabled?: boolean;
}

export function syncSelectOptions(
  select: HTMLSelectElement,
  options: readonly SelectOptionDefinition[]
): void {
  const children = options.map((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    option.disabled = item.disabled ?? false;
    return option;
  });

  select.replaceChildren(...children);
}

export function renderKeyedChildren<T>(
  container: HTMLElement,
  items: readonly T[],
  getKey: (item: T) => string,
  renderItem: (item: T, existing: HTMLElement | null) => HTMLElement
): void {
  const previousScrollLeft = container.scrollLeft;
  const previousScrollTop = container.scrollTop;
  const existingChildren = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    const key = child.dataset[LISTBOX_ROW_KEY_DATASET];
    if (!key) {
      continue;
    }

    existingChildren.set(key, child);
  }

  const nextChildren = items.map((item) => {
    const key = getKey(item);
    const existing = existingChildren.get(key) ?? null;
    if (existing) {
      existingChildren.delete(key);
    }

    const child = renderItem(item, existing);
    child.dataset[LISTBOX_ROW_KEY_DATASET] = key;
    return child;
  });

  container.replaceChildren(...nextChildren);
  if (container.scrollLeft !== previousScrollLeft) {
    container.scrollLeft = previousScrollLeft;
  }
  if (container.scrollTop !== previousScrollTop) {
    container.scrollTop = previousScrollTop;
  }
}

export function applyListboxRowSizing(
  select: HTMLSelectElement,
  optionCount: number,
  maxRows: number
): void {
  if (optionCount <= 0) {
    select.size = 1;
    select.classList.remove('single-row-listbox');
    return;
  }

  if (optionCount === 1) {
    // Keep listbox rendering on browsers that fallback to dropdown at size=1.
    select.size = 2;
    select.classList.add('single-row-listbox');
    return;
  }

  select.size = Math.max(2, Math.min(maxRows, optionCount));
  select.classList.remove('single-row-listbox');
}

export function createEmptyListMessage(message: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'image-browser-empty';
  element.textContent = message;
  return element;
}

export function renderEmptyListMessage(container: HTMLElement, message: string): void {
  const existing = container.children.length === 1 ? container.firstElementChild : null;
  if (
    existing instanceof HTMLElement &&
    existing.classList.contains('image-browser-empty') &&
    existing.textContent === message
  ) {
    return;
  }

  container.replaceChildren(createEmptyListMessage(message));
}

export function findClosestListRow(target: EventTarget | null, datasetKey: string): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const row = target.closest<HTMLElement>('.image-browser-row');
  if (!row || !row.dataset[datasetKey]) {
    return null;
  }

  return row;
}

export function getImageBrowserRows(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('.image-browser-row')).filter(
    (row) => !(row instanceof HTMLButtonElement && row.disabled) && row.getAttribute('aria-disabled') !== 'true'
  );
}

export function getFocusedImageBrowserRow(
  list: HTMLElement,
  activeElement: HTMLElement
): HTMLElement | null {
  if (!list.contains(activeElement)) {
    return null;
  }

  const row = activeElement.closest<HTMLElement>('.image-browser-row');
  return row && list.contains(row) ? row : null;
}

export function isFocusWithinElement(element: HTMLElement): boolean {
  return document.activeElement instanceof HTMLElement && element.contains(document.activeElement);
}

export function focusSelectedImageBrowserRow(list: HTMLElement): void {
  const selectedRow = getImageBrowserRows(list).find(isSelectedRow);
  selectedRow?.focus();
}

export function isNestedInteractiveListControl(
  target: EventTarget | null,
  row: HTMLElement | null
): boolean {
  if (!row || !(target instanceof Element)) {
    return false;
  }

  const control = target.closest<HTMLElement>('button, input, select, textarea, a[href], [role="button"]');
  return Boolean(control && control !== row && row.contains(control));
}

export function handleImageBrowserListKeyDown(
  event: KeyboardEvent,
  list: HTMLElement,
  activate: (row: HTMLElement) => void
): void {
  const rows = getImageBrowserRows(list);
  if (rows.length === 0) {
    return;
  }

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedRow = activeElement ? getFocusedImageBrowserRow(list, activeElement) : null;
  const focusedIndex = focusedRow ? rows.indexOf(focusedRow) : -1;
  const selectedIndex = rows.findIndex(isSelectedRow);
  const currentIndex = Math.max(0, focusedIndex >= 0 ? focusedIndex : selectedIndex);
  let nextIndex = currentIndex;

  if (event.key === 'Enter' || event.key === ' ') {
    if (isNestedInteractiveListControl(event.target, focusedRow)) {
      return;
    }

    event.preventDefault();
    const row = rows[currentIndex];
    if (row) {
      activate(row);
    }
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'Up') {
    nextIndex = Math.max(0, currentIndex - 1);
  } else if (event.key === 'ArrowDown' || event.key === 'Down') {
    nextIndex = Math.min(rows.length - 1, currentIndex + 1);
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = rows.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const nextRow = rows[nextIndex];
  if (!nextRow) {
    return;
  }

  nextRow.focus();
  activate(nextRow);
}

export function getImageBrowserRowValueAtClientY(
  list: HTMLElement,
  clientY: number,
  datasetKey: string
): string | null {
  const rows = getImageBrowserRows(list);
  if (rows.length === 0) {
    return null;
  }

  const listRect = list.getBoundingClientRect();
  if (clientY < listRect.top || clientY > listRect.bottom) {
    return null;
  }

  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return row.dataset[datasetKey] ?? null;
    }
  }

  if (clientY < rows[0].getBoundingClientRect().top) {
    return rows[0].dataset[datasetKey] ?? null;
  }

  return rows[rows.length - 1]?.dataset[datasetKey] ?? null;
}

export function getListboxOptionIndexAtClientY(
  clientY: number,
  metrics: ListboxHitTestMetrics
): number {
  if (metrics.optionCount <= 0 || metrics.height <= 0) {
    return -1;
  }

  if (clientY < metrics.top || clientY >= metrics.top + metrics.height) {
    return -1;
  }

  const totalContentHeight = Math.max(metrics.height, metrics.scrollHeight);
  const rowHeight = totalContentHeight / metrics.optionCount;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    return -1;
  }

  const relativeY = clientY - metrics.top;
  const position = metrics.scrollTop + relativeY;
  const rawIndex = Math.floor(position / rowHeight);
  return Math.min(metrics.optionCount - 1, Math.max(0, rawIndex));
}

function isSelectedRow(row: HTMLElement): boolean {
  return row.getAttribute('aria-selected') === 'true';
}
