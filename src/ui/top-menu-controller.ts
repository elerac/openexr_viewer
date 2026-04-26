import { DisposableBag, type Disposable } from '../lifecycle';
import type { TopMenuControllerElements } from './elements';

interface TopMenuElements {
  button: HTMLButtonElement;
  menu: HTMLElement;
}

type TopMenuTrackingMode = 'inactive' | 'pointer';

interface TopMenuControllerCallbacks {
  onBeforeOpenMenu: () => void;
}

export class TopMenuController implements Disposable {
  private readonly disposables = new DisposableBag();
  private topMenuTrackingMode: TopMenuTrackingMode = 'inactive';
  private hoverOpenedTopMenuButton: HTMLButtonElement | null = null;
  private disposed = false;

  constructor(
    private readonly elements: TopMenuControllerElements,
    private readonly callbacks: TopMenuControllerCallbacks
  ) {
    for (const menu of this.getTopMenus()) {
      this.bindTopMenu(menu);
    }

    this.disposables.addEventListener(this.elements.appMenuBar, 'pointerover', (event) => {
      if (this.topMenuTrackingMode !== 'pointer') {
        return;
      }

      if (
        this.getTopMenus().every((menu) => !this.isTopMenuOpen(menu)) ||
        !(event.target instanceof Node) ||
        this.isPointerWithinTopMenuRegion(event.target)
      ) {
        return;
      }

      this.suspendTopMenusForTopBarHover();
    });

    this.disposables.addEventListener(document, 'click', (event) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target))
      ) {
        return;
      }

      this.closeAll();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  closeAll(restoreFocus = false): void {
    this.closeAllTopMenus(restoreFocus);
  }

  hasOpenMenu(): boolean {
    return this.getTopMenus().some((menu) => this.isTopMenuOpen(menu));
  }

  private getTopMenus(): TopMenuElements[] {
    return [
      { button: this.elements.fileMenuButton, menu: this.elements.fileMenu },
      { button: this.elements.viewMenuButton, menu: this.elements.viewMenu },
      { button: this.elements.windowMenuButton, menu: this.elements.windowMenu },
      { button: this.elements.galleryMenuButton, menu: this.elements.galleryMenu }
    ];
  }

  private isTopMenuOpen(menu: TopMenuElements): boolean {
    return !menu.menu.classList.contains('hidden');
  }

  private openTopMenu(
    menu: TopMenuElements,
    focusTarget: 'first' | 'last' | null = null,
    trackingMode: TopMenuTrackingMode | null = null
  ): void {
    this.callbacks.onBeforeOpenMenu();
    this.closeAllTopMenus(false, menu);
    menu.menu.classList.remove('hidden');
    menu.button.setAttribute('aria-expanded', 'true');
    this.topMenuTrackingMode = trackingMode ?? this.topMenuTrackingMode;

    if (focusTarget) {
      this.focusTopMenuItem(menu, focusTarget);
    }
  }

  private closeTopMenu(menu: TopMenuElements, restoreFocus = false): void {
    menu.menu.classList.add('hidden');
    menu.button.setAttribute('aria-expanded', 'false');
    if (this.hoverOpenedTopMenuButton === menu.button) {
      this.hoverOpenedTopMenuButton = null;
    }
    if (!this.getTopMenus().some((item) => item.menu !== menu.menu && this.isTopMenuOpen(item))) {
      this.topMenuTrackingMode = 'inactive';
    }

    if (restoreFocus) {
      menu.button.focus();
    }
  }

  private suspendTopMenusForTopBarHover(): void {
    for (const menu of this.getTopMenus()) {
      if (!this.isTopMenuOpen(menu)) {
        continue;
      }
      this.closeTopMenu(menu);
    }
    this.topMenuTrackingMode = 'pointer';
  }

  private isPointerWithinTopMenuRegion(target: Node): boolean {
    return this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target));
  }

  private closeAllTopMenus(restoreFocus = false, exceptMenu: TopMenuElements | null = null): void {
    for (const menu of this.getTopMenus()) {
      if (menu.menu === exceptMenu?.menu) {
        continue;
      }
      this.closeTopMenu(menu, restoreFocus && this.isTopMenuOpen(menu));
    }
  }

  private toggleTopMenu(menu: TopMenuElements): void {
    if (this.isTopMenuOpen(menu)) {
      this.closeTopMenu(menu);
      return;
    }

    this.openTopMenu(menu, null, 'pointer');
  }

  private getEnabledTopMenuItems(menu: TopMenuElements): HTMLElement[] {
    return Array.from(menu.menu.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(
      (element) => !('disabled' in element) || !element.disabled
    );
  }

  private focusTopMenuItem(menu: TopMenuElements, target: 'first' | 'last'): void {
    const items = this.getEnabledTopMenuItems(menu);
    const item = target === 'first' ? items.at(0) : items.at(-1);
    item?.focus();
  }

  private focusNextTopMenuItem(menu: TopMenuElements, delta: -1 | 1): void {
    const items = this.getEnabledTopMenuItems(menu);
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  private bindTopMenu(menu: TopMenuElements): void {
    this.disposables.addEventListener(menu.button, 'click', () => {
      if (this.hoverOpenedTopMenuButton === menu.button && this.isTopMenuOpen(menu)) {
        this.hoverOpenedTopMenuButton = null;
        return;
      }

      this.hoverOpenedTopMenuButton = null;
      this.toggleTopMenu(menu);
    });

    this.disposables.addEventListener(menu.button, 'pointerenter', () => {
      if (this.topMenuTrackingMode !== 'pointer' || this.isTopMenuOpen(menu)) {
        return;
      }

      menu.button.focus();
      this.openTopMenu(menu, null, 'pointer');
      this.hoverOpenedTopMenuButton = menu.button;
    });

    this.disposables.addEventListener(menu.button, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openTopMenu(menu, 'first', 'inactive');
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.openTopMenu(menu, 'last', 'inactive');
        return;
      }

      if (event.key === 'Escape' && this.isTopMenuOpen(menu)) {
        event.preventDefault();
        this.closeTopMenu(menu, true);
        return;
      }

      if (event.key === 'Tab' && this.isTopMenuOpen(menu)) {
        this.closeTopMenu(menu);
      }
    });

    this.disposables.addEventListener(menu.menu, 'keydown', (event) => {
      const target = event.target;
      const shouldPreserveFieldArrowKeys =
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeTopMenu(menu, true);
        return;
      }

      if (event.key === 'Tab') {
        this.closeTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown' && !shouldPreserveFieldArrowKeys) {
        event.preventDefault();
        this.focusNextTopMenuItem(menu, 1);
        return;
      }

      if (event.key === 'ArrowUp' && !shouldPreserveFieldArrowKeys) {
        event.preventDefault();
        this.focusNextTopMenuItem(menu, -1);
      }
    });
  }
}
