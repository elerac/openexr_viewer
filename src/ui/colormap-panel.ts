import { buildZeroCenteredColormapRange } from '../colormap-range';
import { ColormapLut, sampleColormapRgbBytes } from '../colormaps';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { DisplayLuminanceRange, StokesAolpDegreeModulationMode, VisualizationMode } from '../types';
import type { ColormapPanelElements } from './elements';
import { syncSelectOptions } from './render-helpers';

const COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE = 1e-16;
const COLORMAP_GRADIENT_STOP_COUNT = 16;
const DEFAULT_COLORMAP_GRADIENT = 'linear-gradient(90deg, #d95656 0%, #05070a 50%, #59d884 100%)';

interface ColormapPanelCallbacks {
  onExposureChange: (value: number) => void;
  onVisualizationModeChange: (mode: VisualizationMode) => void;
  onColormapChange: (colormapId: string) => void;
  onColormapRangeChange: (range: DisplayLuminanceRange) => void;
  onColormapAutoRange: () => void;
  onColormapZeroCenterToggle: () => void;
  onStokesDegreeModulationToggle: () => void;
  onStokesAolpDegreeModulationModeChange: (mode: StokesAolpDegreeModulationMode) => void;
}

export class ColormapPanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private openedImageCount = 0;
  private currentColormapRange: DisplayLuminanceRange | null = null;
  private currentAutoColormapRange: DisplayLuminanceRange | null = null;
  private currentColormapZeroCentered = false;
  private isColormapEnabled = false;
  private hasColormapOptions = false;
  private disposed = false;

  constructor(
    private readonly elements: ColormapPanelElements,
    private readonly callbacks: ColormapPanelCallbacks
  ) {
    this.setVisualizationModeButtonsDisabled(true);
    this.elements.colormapSelect.disabled = true;
    this.elements.stokesDegreeModulationButton.disabled = true;
    this.setStokesAolpModulationModeButtonsDisabled(true);
    this.setColormapRangeControlsDisabled(true);

    this.bindVisualizationModeButton(this.elements.visualizationNoneButton, 'rgb');
    this.bindVisualizationModeButton(this.elements.colormapToggleButton, 'colormap');

    this.disposables.addEventListener(this.elements.colormapSelect, 'change', (event) => {
      if (this.elements.colormapSelect.disabled) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onColormapChange(target.value);
    });

    this.disposables.addEventListener(this.elements.colormapAutoRangeButton, 'click', () => {
      if (this.elements.colormapAutoRangeButton.disabled) {
        return;
      }

      this.callbacks.onColormapAutoRange();
    });

    this.disposables.addEventListener(this.elements.colormapZeroCenterButton, 'click', () => {
      if (this.elements.colormapZeroCenterButton.disabled) {
        return;
      }

      this.callbacks.onColormapZeroCenterToggle();
    });

    this.disposables.addEventListener(this.elements.stokesDegreeModulationButton, 'click', () => {
      if (this.elements.stokesDegreeModulationButton.disabled) {
        return;
      }

      this.callbacks.onStokesDegreeModulationToggle();
    });
    this.bindStokesAolpModulationModeButton(this.elements.stokesAolpModulationValueButton, 'value');
    this.bindStokesAolpModulationModeButton(this.elements.stokesAolpModulationSaturationButton, 'saturation');

    this.disposables.addEventListener(this.elements.colormapVminSlider, 'input', () => {
      this.commitColormapMin(Number(this.elements.colormapVminSlider.value));
    });

    this.disposables.addEventListener(this.elements.colormapVmaxSlider, 'input', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxSlider.value));
    });

    this.disposables.addEventListener(this.elements.colormapVminInput, 'change', () => {
      this.commitColormapMin(Number(this.elements.colormapVminInput.value));
    });

    this.disposables.addEventListener(this.elements.colormapVmaxInput, 'change', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxInput.value));
    });

    this.bindExposureControl(this.elements.exposureSlider, this.elements.exposureValue);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    this.isLoading = loading;
    this.setVisualizationModeButtonsDisabled(loading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(loading || this.openedImageCount === 0 || !this.currentColormapRange);
    this.elements.exposureValue.disabled = loading;
    this.updateStokesDegreeModulationDisabled();
  }

  setOpenedImageCount(count: number): void {
    if (this.disposed) {
      return;
    }

    this.openedImageCount = count;
    this.setVisualizationModeButtonsDisabled(this.isLoading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(
      this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange
    );
    this.updateStokesDegreeModulationDisabled();
  }

  setExposure(exposureEv: number): void {
    if (this.disposed) {
      return;
    }

    for (const control of this.getExposureControls()) {
      control.slider.value = exposureEv.toFixed(1);
      control.value.value = exposureEv.toFixed(1);
    }
  }

  setVisualizationMode(mode: VisualizationMode): void {
    if (this.disposed) {
      return;
    }

    this.isColormapEnabled = mode === 'colormap';
    this.setVisualizationModeButtonPressedStates(mode);
    this.elements.colormapRangeControl.classList.toggle('hidden', !this.isColormapEnabled);
    this.elements.exposureControl.classList.toggle('hidden', this.isColormapEnabled);
    this.setColormapRangeControlsDisabled(
      this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange
    );
    this.updateStokesDegreeModulationDisabled();
  }

  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string): void {
    if (this.disposed) {
      return;
    }

    this.hasColormapOptions = items.length > 0;
    const hadFocus = document.activeElement === this.elements.colormapSelect;
    syncSelectOptions(
      this.elements.colormapSelect,
      items.map((item) => ({
        value: item.id,
        label: item.label
      }))
    );

    this.setActiveColormap(activeId);
    this.setColormapRangeControlsDisabled(
      this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange
    );

    if (hadFocus && !this.elements.colormapSelect.disabled) {
      this.elements.colormapSelect.focus();
    }
  }

  setActiveColormap(activeId: string): void {
    if (this.disposed) {
      return;
    }

    if (!this.hasColormapOptions) {
      this.elements.colormapSelect.value = '';
      return;
    }

    const hasOption = Array.from(this.elements.colormapSelect.options).some(
      (option) => option.value === activeId
    );
    this.elements.colormapSelect.value = hasOption ? activeId : this.elements.colormapSelect.options[0]?.value ?? '';
  }

  setColormapGradient(lut: ColormapLut | null): void {
    if (this.disposed) {
      return;
    }

    this.elements.colormapRangeSlider.style.setProperty(
      '--colormap-gradient',
      lut ? buildColormapCssGradient(lut) : DEFAULT_COLORMAP_GRADIENT
    );
  }

  setColormapRange(
    range: DisplayLuminanceRange | null,
    autoRange: DisplayLuminanceRange | null,
    alwaysAuto = false,
    zeroCentered = false
  ): void {
    if (this.disposed) {
      return;
    }

    this.currentColormapRange = cloneRange(range);
    this.currentAutoColormapRange = cloneRange(autoRange);
    this.currentColormapZeroCentered = zeroCentered;
    this.elements.colormapAutoRangeButton.setAttribute('aria-pressed', alwaysAuto ? 'true' : 'false');
    this.elements.colormapZeroCenterButton.setAttribute('aria-pressed', zeroCentered ? 'true' : 'false');

    const controlsDisabled = this.isLoading || this.openedImageCount === 0 || !range;
    this.setColormapRangeControlsDisabled(controlsDisabled);

    if (!range) {
      this.setColormapRangeValues({ min: 0, max: 1 }, { min: 0, max: 1 });
      return;
    }

    this.setColormapRangeValues(range, autoRange ?? range);
  }

  setStokesDegreeModulationControl(
    label: string | null,
    enabled = false,
    showAolpMode = false,
    aolpMode: StokesAolpDegreeModulationMode = 'value'
  ): void {
    if (this.disposed) {
      return;
    }

    const visible = Boolean(label);
    this.elements.stokesDegreeModulationControl.classList.toggle('hidden', !visible);
    this.elements.stokesAolpModulationModeControl.classList.toggle('hidden', !visible || !showAolpMode);
    if (label) {
      this.elements.stokesDegreeModulationButton.textContent = `${label} Modulation`;
    }
    this.elements.stokesDegreeModulationButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    this.setStokesAolpModulationMode(aolpMode);
    this.updateStokesDegreeModulationDisabled();
  }

  private setColormapRangeControlsDisabled(disabled: boolean): void {
    const effectiveDisabled = disabled || !this.isColormapEnabled;
    this.elements.colormapSelect.disabled = effectiveDisabled || !this.hasColormapOptions;
    this.elements.colormapAutoRangeButton.disabled = effectiveDisabled || !this.currentAutoColormapRange;
    this.elements.colormapZeroCenterButton.disabled = effectiveDisabled || !this.currentColormapRange;
    this.elements.colormapVminSlider.disabled = effectiveDisabled;
    this.elements.colormapVmaxSlider.disabled = effectiveDisabled;
    this.elements.colormapVminInput.disabled = effectiveDisabled;
    this.elements.colormapVmaxInput.disabled = effectiveDisabled;
  }

  private setVisualizationModeButtonsDisabled(disabled: boolean): void {
    for (const button of this.getVisualizationModeButtons()) {
      button.disabled = disabled;
    }
  }

  private bindVisualizationModeButton(button: HTMLButtonElement, mode: VisualizationMode): void {
    this.disposables.addEventListener(button, 'click', () => {
      if (button.disabled) {
        return;
      }

      this.callbacks.onVisualizationModeChange(mode);
    });
  }

  private bindStokesAolpModulationModeButton(
    button: HTMLButtonElement,
    mode: StokesAolpDegreeModulationMode
  ): void {
    this.disposables.addEventListener(button, 'click', () => {
      if (button.disabled) {
        return;
      }

      this.callbacks.onStokesAolpDegreeModulationModeChange(mode);
    });
  }

  private setVisualizationModeButtonPressedStates(mode: VisualizationMode): void {
    const isRgb = mode === 'rgb';
    const isColormap = mode === 'colormap';
    this.elements.visualizationNoneButton.setAttribute('aria-pressed', isRgb ? 'true' : 'false');
    this.elements.colormapToggleButton.setAttribute('aria-pressed', isColormap ? 'true' : 'false');
    this.elements.colormapToggleButton.setAttribute('aria-expanded', isColormap ? 'true' : 'false');
  }

  private getVisualizationModeButtons(): HTMLButtonElement[] {
    return [
      this.elements.visualizationNoneButton,
      this.elements.colormapToggleButton
    ];
  }

  private bindExposureControl(slider: HTMLInputElement, valueInput: HTMLInputElement): void {
    this.disposables.addEventListener(slider, 'input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      this.callbacks.onExposureChange(Number(target.value));
    });

    this.disposables.addEventListener(valueInput, 'change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Number(slider.min);
      const max = Number(slider.max);
      const clamped = Math.min(max, Math.max(min, value));
      this.callbacks.onExposureChange(clamped);
    });
  }

  private getExposureControls(): Array<{ slider: HTMLInputElement; value: HTMLInputElement }> {
    return [
      { slider: this.elements.exposureSlider, value: this.elements.exposureValue }
    ];
  }

  private updateStokesDegreeModulationDisabled(): void {
    const visible = !this.elements.stokesDegreeModulationControl.classList.contains('hidden');
    const disabled = !visible || this.isLoading || this.openedImageCount === 0 || !this.isColormapEnabled;
    this.elements.stokesDegreeModulationButton.disabled = disabled;
    this.setStokesAolpModulationModeButtonsDisabled(
      disabled || this.elements.stokesAolpModulationModeControl.classList.contains('hidden')
    );
  }

  private setStokesAolpModulationMode(mode: StokesAolpDegreeModulationMode): void {
    this.elements.stokesAolpModulationValueButton.setAttribute('aria-pressed', mode === 'value' ? 'true' : 'false');
    this.elements.stokesAolpModulationSaturationButton.setAttribute(
      'aria-pressed',
      mode === 'saturation' ? 'true' : 'false'
    );
  }

  private setStokesAolpModulationModeButtonsDisabled(disabled: boolean): void {
    this.elements.stokesAolpModulationValueButton.disabled = disabled;
    this.elements.stokesAolpModulationSaturationButton.disabled = disabled;
  }

  private setColormapRangeValues(range: DisplayLuminanceRange, autoRange: DisplayLuminanceRange): void {
    const bounds = buildColormapSliderBounds(range, autoRange, this.currentColormapZeroCentered);
    const zeroCenteredFloor = this.currentColormapZeroCentered
      ? Math.min(COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE, bounds.max)
      : 0;
    const step = this.currentColormapZeroCentered
      ? 'any'
      : formatColormapRangeStep(bounds.min, bounds.max);
    const vminSliderMax = this.currentColormapZeroCentered ? -zeroCenteredFloor : bounds.max;
    const vmaxSliderMin = this.currentColormapZeroCentered ? zeroCenteredFloor : bounds.min;
    const vmin = clamp(range.min, bounds.min, vminSliderMax);
    const vmax = clamp(range.max, vmaxSliderMin, bounds.max);
    const span = Math.max(Number.EPSILON, bounds.max - bounds.min);
    const minPct = ((vmin - bounds.min) / span) * 100;
    const maxPct = ((vmax - bounds.min) / span) * 100;

    this.elements.colormapRangeSlider.classList.toggle('zero-centered', this.currentColormapZeroCentered);
    this.elements.colormapVminSlider.min = formatColormapInputValue(bounds.min);
    this.elements.colormapVminSlider.max = formatColormapInputValue(vminSliderMax);
    this.elements.colormapVminSlider.step = step;
    this.elements.colormapVminSlider.value = formatColormapInputValue(vmin);

    this.elements.colormapVmaxSlider.min = formatColormapInputValue(vmaxSliderMin);
    this.elements.colormapVmaxSlider.max = formatColormapInputValue(bounds.max);
    this.elements.colormapVmaxSlider.step = step;
    this.elements.colormapVmaxSlider.value = formatColormapInputValue(vmax);
    this.elements.colormapRangeSlider.style.setProperty('--colormap-vmin-pct', `${minPct}%`);
    this.elements.colormapRangeSlider.style.setProperty('--colormap-vmax-pct', `${maxPct}%`);

    if (document.activeElement !== this.elements.colormapVminInput) {
      this.elements.colormapVminInput.value = formatColormapInputValue(range.min);
    }
    if (document.activeElement !== this.elements.colormapVmaxInput) {
      this.elements.colormapVmaxInput.value = formatColormapInputValue(range.max);
    }
  }

  private commitColormapMin(value: number): void {
    const current = this.currentColormapRange;
    if (!current || !Number.isFinite(value)) {
      this.setColormapRangeValues(
        current ?? { min: 0, max: 1 },
        this.currentAutoColormapRange ?? current ?? { min: 0, max: 1 }
      );
      return;
    }

    if (this.currentColormapZeroCentered) {
      this.callbacks.onColormapRangeChange(
        buildZeroCenteredColormapRange(
          { min: value, max: value },
          COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE
        ) ?? current
      );
      return;
    }

    this.callbacks.onColormapRangeChange({
      min: value,
      max: Math.max(value, current.max)
    });
  }

  private commitColormapMax(value: number): void {
    const current = this.currentColormapRange;
    if (!current || !Number.isFinite(value)) {
      this.setColormapRangeValues(
        current ?? { min: 0, max: 1 },
        this.currentAutoColormapRange ?? current ?? { min: 0, max: 1 }
      );
      return;
    }

    if (this.currentColormapZeroCentered) {
      this.callbacks.onColormapRangeChange(
        buildZeroCenteredColormapRange(
          { min: value, max: value },
          COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE
        ) ?? current
      );
      return;
    }

    this.callbacks.onColormapRangeChange({
      min: Math.min(current.min, value),
      max: value
    });
  }
}

function cloneRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
  return range ? { min: range.min, max: range.max } : null;
}

function buildColormapCssGradient(lut: ColormapLut): string {
  const stopCount = Math.min(COLORMAP_GRADIENT_STOP_COUNT, Math.max(2, lut.entryCount));
  const stops: string[] = [];

  for (let index = 0; index < stopCount; index += 1) {
    const t = stopCount === 1 ? 0 : index / (stopCount - 1);
    const [r, g, b] = sampleColormapRgbBytes(lut, t);
    stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
  }

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function buildColormapSliderBounds(
  range: DisplayLuminanceRange,
  autoRange: DisplayLuminanceRange,
  zeroCentered = false
): DisplayLuminanceRange {
  if (zeroCentered) {
    return buildZeroCenteredColormapRange({
      min: Math.min(range.min, range.max, autoRange.min, autoRange.max),
      max: Math.max(range.min, range.max, autoRange.min, autoRange.max)
    }) ?? { min: -1, max: 1 };
  }

  let min = Math.min(range.min, range.max, autoRange.min, autoRange.max);
  let max = Math.max(range.min, range.max, autoRange.min, autoRange.max);

  if (max <= min) {
    const margin = Math.max(1, Math.abs(min) * 0.1);
    min -= margin;
    max += margin;
  }

  return { min, max };
}

function formatColormapInputValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Number(value.toPrecision(7)).toString();
}

function formatColormapRangeStep(min: number, max: number): string {
  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span <= 0) {
    return 'any';
  }

  return Number((span / 1000).toPrecision(4)).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
