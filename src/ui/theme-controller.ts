import {
  DEFAULT_THEME_ID,
  THEMES,
  applyTheme,
  parseStoredTheme,
  readStoredTheme,
  saveStoredTheme,
  type ThemeId
} from '../theme';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { Elements } from './elements';

type ThemeControllerElements = Pick<Elements, 'themeSelect'>;

interface ThemeControllerCallbacks {
  onThemeChange: (theme: ThemeId) => void;
}

export class ThemeController implements Disposable {
  private readonly disposables = new DisposableBag();
  private theme: ThemeId = DEFAULT_THEME_ID;
  private disposed = false;

  constructor(
    private readonly elements: ThemeControllerElements,
    private readonly callbacks: ThemeControllerCallbacks
  ) {
    this.renderOptions();
    this.disposables.addEventListener(this.elements.themeSelect, 'change', () => {
      this.setTheme(parseStoredTheme(this.elements.themeSelect.value));
    });
    this.setTheme(readStoredTheme(), { persist: false });
  }

  getTheme(): ThemeId {
    return this.theme;
  }

  setTheme(theme: ThemeId, options: { persist?: boolean } = {}): void {
    if (this.disposed) {
      return;
    }

    const persist = options.persist ?? true;
    this.theme = theme;
    this.elements.themeSelect.value = theme;
    applyTheme(theme);
    if (persist) {
      saveStoredTheme(theme);
    }
    this.callbacks.onThemeChange(theme);
  }

  reset(): void {
    this.setTheme(DEFAULT_THEME_ID);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  private renderOptions(): void {
    this.elements.themeSelect.replaceChildren(
      ...THEMES.map((theme) => {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.label;
        return option;
      })
    );
  }
}
