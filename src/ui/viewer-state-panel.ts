import { clampZoom } from '../interaction/image-geometry';
import {
  clampPanoramaHfov,
  clampPanoramaPitch,
  normalizePanoramaYaw
} from '../interaction/panorama-geometry';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { ViewerStateReadoutModel } from '../app/viewer-app-types';
import type { ViewerViewState } from '../types';
import type { ViewerStatePanelElements } from './elements';

type ViewerStateField = keyof ViewerViewState;

interface ViewerStatePanelCallbacks {
  onViewerViewStateChange: (patch: Partial<ViewerViewState>) => void;
}

export class ViewerStatePanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private readout: ViewerStateReadoutModel = {
    hasActiveImage: false,
    viewerMode: 'image',
    view: {
      zoom: 1,
      panX: 0,
      panY: 0,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    }
  };
  private disposed = false;

  constructor(
    private readonly elements: ViewerStatePanelElements,
    private readonly callbacks: ViewerStatePanelCallbacks
  ) {
    this.bindInput(this.elements.viewerStateZoomInput, 'zoom');
    this.bindInput(this.elements.viewerStatePanXInput, 'panX');
    this.bindInput(this.elements.viewerStatePanYInput, 'panY');
    this.bindInput(this.elements.viewerStateYawInput, 'panoramaYawDeg');
    this.bindInput(this.elements.viewerStatePitchInput, 'panoramaPitchDeg');
    this.bindInput(this.elements.viewerStateHfovInput, 'panoramaHfovDeg');
    this.setReadout(this.readout);
  }

  setReadout(readout: ViewerStateReadoutModel): void {
    if (this.disposed) {
      return;
    }

    this.readout = {
      hasActiveImage: readout.hasActiveImage,
      viewerMode: readout.viewerMode,
      view: { ...readout.view }
    };

    const imageFieldsActive = readout.hasActiveImage && readout.viewerMode === 'image';
    const panoramaFieldsActive = readout.hasActiveImage && readout.viewerMode === 'panorama';
    this.elements.viewerStateEmptyState.classList.toggle('hidden', readout.hasActiveImage);
    this.elements.viewerStateImageFields.classList.toggle(
      'hidden',
      !imageFieldsActive
    );
    this.elements.viewerStatePanoramaFields.classList.toggle(
      'hidden',
      !panoramaFieldsActive
    );

    for (const input of this.getInputs()) {
      input.removeAttribute('aria-invalid');
    }
    this.elements.viewerStateZoomInput.disabled = !imageFieldsActive;
    this.elements.viewerStatePanXInput.disabled = !imageFieldsActive;
    this.elements.viewerStatePanYInput.disabled = !imageFieldsActive;
    this.elements.viewerStateYawInput.disabled = !panoramaFieldsActive;
    this.elements.viewerStatePitchInput.disabled = !panoramaFieldsActive;
    this.elements.viewerStateHfovInput.disabled = !panoramaFieldsActive;

    this.elements.viewerStateZoomInput.value = formatViewerStateNumber(readout.view.zoom);
    this.elements.viewerStatePanXInput.value = formatViewerStateNumber(readout.view.panX);
    this.elements.viewerStatePanYInput.value = formatViewerStateNumber(readout.view.panY);
    this.elements.viewerStateYawInput.value = formatViewerStateNumber(readout.view.panoramaYawDeg);
    this.elements.viewerStatePitchInput.value = formatViewerStateNumber(readout.view.panoramaPitchDeg);
    this.elements.viewerStateHfovInput.value = formatViewerStateNumber(readout.view.panoramaHfovDeg);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  private bindInput(input: HTMLInputElement, field: ViewerStateField): void {
    this.disposables.addEventListener(input, 'keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      this.commitField(input, field);
    });
    this.disposables.addEventListener(input, 'blur', () => {
      this.commitField(input, field);
    });
  }

  private commitField(input: HTMLInputElement, field: ViewerStateField): void {
    if (this.disposed || input.disabled || !this.readout.hasActiveImage) {
      return;
    }

    const text = input.value.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value)) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    const normalized = normalizeViewerStateField(field, value);
    input.removeAttribute('aria-invalid');
    input.value = formatViewerStateNumber(normalized);

    if (this.readout.view[field] === normalized) {
      return;
    }

    const patch: Partial<ViewerViewState> = {};
    patch[field] = normalized;
    this.callbacks.onViewerViewStateChange(patch);
  }

  private getInputs(): HTMLInputElement[] {
    return [
      this.elements.viewerStateZoomInput,
      this.elements.viewerStatePanXInput,
      this.elements.viewerStatePanYInput,
      this.elements.viewerStateYawInput,
      this.elements.viewerStatePitchInput,
      this.elements.viewerStateHfovInput
    ];
  }
}

function normalizeViewerStateField(field: ViewerStateField, value: number): number {
  switch (field) {
    case 'zoom':
      return clampZoom(value);
    case 'panX':
    case 'panY':
      return value;
    case 'panoramaYawDeg':
      return normalizePanoramaYaw(value);
    case 'panoramaPitchDeg':
      return clampPanoramaPitch(value);
    case 'panoramaHfovDeg':
      return clampPanoramaHfov(value);
    default:
      throw new Error(`Unknown viewer state field: ${field satisfies never}`);
  }
}

function formatViewerStateNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Number(value.toPrecision(7)).toString();
}
