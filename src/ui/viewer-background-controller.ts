import type { ViewportClientRect } from '../interaction/image-geometry';
import { DEFAULT_THEME_ID, SPECTRUM_LATTICE_THEME_ID, type ThemeId } from '../theme';
import { type Disposable } from '../lifecycle';
import type { SpectrumLatticeMotionPreference } from '../spectrum-lattice-motion';
import type { Elements } from './elements';
import { SpectrumLatticeRenderer, type SpectrumLatticeBlend, type SpectrumLatticeMode } from './spectrum-lattice-renderer';

type ViewerBackgroundElements = Pick<
  Elements,
  'appShell' | 'mainLayout' | 'viewerContainer' | 'spectrumLatticeCanvas'
>;

const SPECTRUM_IDLE_CLASS = 'is-spectrum-lattice-idle';
const VIEWER_CHECKER_OFFSET_X = '--viewer-checker-offset-x';
const VIEWER_CHECKER_OFFSET_Y = '--viewer-checker-offset-y';
const VIEWER_CHECKER_OPACITY = '--viewer-checker-opacity';
const VIEWER_GRID_OPACITY = '--viewer-grid-opacity';

export class ViewerBackgroundController implements Disposable {
  private readonly spectrumRenderer: SpectrumLatticeRenderer;
  private theme: ThemeId = DEFAULT_THEME_ID;
  private hasOpenImages = false;
  private disposed = false;

  constructor(private readonly elements: ViewerBackgroundElements) {
    this.spectrumRenderer = new SpectrumLatticeRenderer({
      canvas: this.elements.spectrumLatticeCanvas,
      onBlendChange: (blend) => {
        this.applySpectrumBlend(blend);
      }
    });
    this.sync();
  }

  setTheme(theme: ThemeId): void {
    if (this.disposed || this.theme === theme) {
      return;
    }

    this.theme = theme;
    this.sync();
  }

  setSpectrumLatticeMotionPreference(preference: SpectrumLatticeMotionPreference): void {
    if (this.disposed) {
      return;
    }

    this.spectrumRenderer.setMotionPreference(preference);
  }

  setHasOpenImages(hasOpenImages: boolean): void {
    if (this.disposed || this.hasOpenImages === hasOpenImages) {
      return;
    }

    this.hasOpenImages = hasOpenImages;
    this.sync();
  }

  setViewportRect(rect: ViewportClientRect): void {
    if (this.disposed) {
      return;
    }

    this.elements.viewerContainer.style.setProperty(VIEWER_CHECKER_OFFSET_X, `${-rect.left}px`);
    this.elements.viewerContainer.style.setProperty(VIEWER_CHECKER_OFFSET_Y, `${-rect.top}px`);
    this.spectrumRenderer.resize();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clearSpectrumIdleClasses();
    this.applySpectrumBlend(null);
    this.spectrumRenderer.dispose();
  }

  private sync(): void {
    const spectrumEnabled = this.theme === SPECTRUM_LATTICE_THEME_ID;
    const idle = !this.hasOpenImages;
    const spectrumIdle = spectrumEnabled && idle;
    this.elements.appShell.classList.toggle(SPECTRUM_IDLE_CLASS, spectrumIdle);
    this.elements.mainLayout.classList.toggle(SPECTRUM_IDLE_CLASS, spectrumIdle);
    this.elements.viewerContainer.classList.toggle(SPECTRUM_IDLE_CLASS, spectrumIdle);
    this.spectrumRenderer.setMode(resolveSpectrumMode(spectrumEnabled, idle));
  }

  private clearSpectrumIdleClasses(): void {
    this.elements.appShell.classList.remove(SPECTRUM_IDLE_CLASS);
    this.elements.mainLayout.classList.remove(SPECTRUM_IDLE_CLASS);
    this.elements.viewerContainer.classList.remove(SPECTRUM_IDLE_CLASS);
  }

  private applySpectrumBlend(blend: SpectrumLatticeBlend | null): void {
    if (!blend) {
      this.elements.viewerContainer.style.removeProperty(VIEWER_CHECKER_OPACITY);
      this.elements.viewerContainer.style.removeProperty(VIEWER_GRID_OPACITY);
      return;
    }

    this.elements.viewerContainer.style.setProperty(VIEWER_CHECKER_OPACITY, formatOpacity(blend.checkerOpacity));
    this.elements.viewerContainer.style.setProperty(VIEWER_GRID_OPACITY, formatOpacity(blend.gridOpacity));
  }
}

function resolveSpectrumMode(spectrumEnabled: boolean, idle: boolean): SpectrumLatticeMode {
  if (!spectrumEnabled) {
    return 'disabled';
  }

  return idle ? 'idle' : 'active';
}

function formatOpacity(value: number): string {
  return Math.min(1, Math.max(0, value)).toFixed(4).replace(/\.?0+$/, '');
}
