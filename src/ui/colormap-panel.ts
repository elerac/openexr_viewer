import { buildZeroCenteredColormapRange } from '../colormap-range';
import { ColormapLut, sampleColormapRgbBytes } from '../colormaps';
import type { DisplayLuminanceRange, VisualizationMode } from '../types';
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
}

export class ColormapPanel {
  private isLoading = false;
  private openedImageCount = 0;
  private currentColormapRange: DisplayLuminanceRange | null = null;
  private currentAutoColormapRange: DisplayLuminanceRange | null = null;
  private currentColormapZeroCentered = false;
  private isColormapEnabled = false;
  private hasColormapOptions = false;

  constructor(
    private readonly elements: ColormapPanelElements,
    private readonly callbacks: ColormapPanelCallbacks
  ) {
    this.elements.visualizationNoneButton.disabled = true;
    this.elements.colormapToggleButton.disabled = true;
    this.elements.colormapSelect.disabled = true;
    this.elements.stokesDegreeModulationButton.disabled = true;
    this.setColormapRangeControlsDisabled(true);

    this.elements.visualizationNoneButton.addEventListener('click', () => {
      if (this.elements.visualizationNoneButton.disabled) {
        return;
      }

      this.callbacks.onVisualizationModeChange('rgb');
    });

    this.elements.colormapToggleButton.addEventListener('click', () => {
      if (this.elements.colormapToggleButton.disabled) {
        return;
      }

      this.callbacks.onVisualizationModeChange('colormap');
    });

    this.elements.colormapSelect.addEventListener('change', (event) => {
      if (this.elements.colormapSelect.disabled) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onColormapChange(target.value);
    });

    this.elements.colormapAutoRangeButton.addEventListener('click', () => {
      if (this.elements.colormapAutoRangeButton.disabled) {
        return;
      }

      this.callbacks.onColormapAutoRange();
    });

    this.elements.colormapZeroCenterButton.addEventListener('click', () => {
      if (this.elements.colormapZeroCenterButton.disabled) {
        return;
      }

      this.callbacks.onColormapZeroCenterToggle();
    });

    this.elements.stokesDegreeModulationButton.addEventListener('click', () => {
      if (this.elements.stokesDegreeModulationButton.disabled) {
        return;
      }

      this.callbacks.onStokesDegreeModulationToggle();
    });

    this.elements.colormapVminSlider.addEventListener('input', () => {
      this.commitColormapMin(Number(this.elements.colormapVminSlider.value));
    });

    this.elements.colormapVmaxSlider.addEventListener('input', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxSlider.value));
    });

    this.elements.colormapVminInput.addEventListener('change', () => {
      this.commitColormapMin(Number(this.elements.colormapVminInput.value));
    });

    this.elements.colormapVmaxInput.addEventListener('change', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxInput.value));
    });

    this.elements.exposureSlider.addEventListener('input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      this.callbacks.onExposureChange(Number(target.value));
    });

    this.elements.exposureValue.addEventListener('change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Number(this.elements.exposureSlider.min);
      const max = Number(this.elements.exposureSlider.max);
      const clamped = Math.min(max, Math.max(min, value));
      this.callbacks.onExposureChange(clamped);
    });
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.setVisualizationModeButtonsDisabled(loading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(loading || this.openedImageCount === 0 || !this.currentColormapRange);
    this.elements.exposureValue.disabled = loading;
    this.updateStokesDegreeModulationDisabled();
  }

  setOpenedImageCount(count: number): void {
    this.openedImageCount = count;
    this.setVisualizationModeButtonsDisabled(this.isLoading || this.openedImageCount === 0);
    this.setColormapRangeControlsDisabled(
      this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange
    );
    this.updateStokesDegreeModulationDisabled();
  }

  setExposure(exposureEv: number): void {
    this.elements.exposureSlider.value = exposureEv.toFixed(1);
    this.elements.exposureValue.value = exposureEv.toFixed(1);
  }

  setVisualizationMode(mode: VisualizationMode): void {
    this.isColormapEnabled = mode === 'colormap';
    this.elements.visualizationNoneButton.setAttribute('aria-pressed', mode === 'rgb' ? 'true' : 'false');
    this.elements.colormapToggleButton.setAttribute('aria-pressed', this.isColormapEnabled ? 'true' : 'false');
    this.elements.colormapToggleButton.setAttribute('aria-expanded', this.isColormapEnabled ? 'true' : 'false');
    this.elements.colormapRangeControl.classList.toggle('hidden', !this.isColormapEnabled);
    this.elements.exposureControl.classList.toggle('hidden', this.isColormapEnabled);
    this.setColormapRangeControlsDisabled(
      this.isLoading || this.openedImageCount === 0 || !this.currentColormapRange
    );
    this.updateStokesDegreeModulationDisabled();
  }

  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string): void {
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

  setStokesDegreeModulationControl(label: string | null, enabled = false): void {
    const visible = Boolean(label);
    this.elements.stokesDegreeModulationControl.classList.toggle('hidden', !visible);
    if (label) {
      this.elements.stokesDegreeModulationButton.textContent = `${label} Modulation`;
    }
    this.elements.stokesDegreeModulationButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
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
    this.elements.visualizationNoneButton.disabled = disabled;
    this.elements.colormapToggleButton.disabled = disabled;
  }

  private updateStokesDegreeModulationDisabled(): void {
    const visible = !this.elements.stokesDegreeModulationControl.classList.contains('hidden');
    this.elements.stokesDegreeModulationButton.disabled =
      !visible || this.isLoading || this.openedImageCount === 0 || !this.isColormapEnabled;
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
