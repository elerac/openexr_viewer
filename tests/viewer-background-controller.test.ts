// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPECTRUM_LATTICE_THEME_ID } from '../src/theme';
import { ViewerBackgroundController } from '../src/ui/viewer-background-controller';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ViewerBackgroundController', () => {
  it('owns Spectrum idle classes, canvas visibility, blend CSS vars, and checker offset', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const elements = createElements();
    const controller = new ViewerBackgroundController(elements);

    controller.setViewportRect({ left: 40, top: 10, width: 260, height: 200 });
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-checker-offset-x')).toBe('-40px');
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-checker-offset-y')).toBe('-10px');

    controller.setTheme(SPECTRUM_LATTICE_THEME_ID);
    expect(elements.appShell.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(elements.mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(elements.viewerContainer.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(elements.spectrumLatticeCanvas.classList.contains('hidden')).toBe(false);
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-checker-opacity')).toBe('0');
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-grid-opacity')).toBe('1');

    controller.setHasOpenImages(true);
    expect(elements.appShell.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(elements.mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(elements.viewerContainer.classList.contains('is-spectrum-lattice-idle')).toBe(false);
    expect(elements.spectrumLatticeCanvas.classList.contains('hidden')).toBe(false);
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-checker-opacity')).toBe('1');
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-grid-opacity')).toBe('0');

    controller.setTheme('default');
    expect(elements.spectrumLatticeCanvas.classList.contains('hidden')).toBe(true);
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-checker-opacity')).toBe('');
    expect(elements.viewerContainer.style.getPropertyValue('--viewer-grid-opacity')).toBe('');
  });
});

function createElements(): {
  appShell: HTMLElement;
  mainLayout: HTMLElement;
  viewerContainer: HTMLElement;
  spectrumLatticeCanvas: HTMLCanvasElement;
} {
  const appShell = document.createElement('div');
  const mainLayout = document.createElement('div');
  const viewerContainer = document.createElement('div');
  const spectrumLatticeCanvas = document.createElement('canvas');
  spectrumLatticeCanvas.classList.add('hidden');
  document.body.append(appShell, mainLayout, viewerContainer, spectrumLatticeCanvas);

  return {
    appShell,
    mainLayout,
    viewerContainer,
    spectrumLatticeCanvas
  };
}
