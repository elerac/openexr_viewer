import { ViewerUi } from '../ui/viewer-ui';
import { ViewerUiInvalidationFlags } from './viewer-app-ui';
import type { ViewerUiTransition } from './viewer-app-types';

export function applyUiEffects(ui: ViewerUi, transition: ViewerUiTransition): void {
  const { snapshot, invalidation } = transition;

  if (invalidation & ViewerUiInvalidationFlags.Error) {
    ui.setError(snapshot.errorMessage);
  }

  if (invalidation & ViewerUiInvalidationFlags.Loading) {
    ui.setLoading(snapshot.isLoading);
    ui.setRgbViewLoading(snapshot.isRgbViewLoading);
  }

  if (invalidation & ViewerUiInvalidationFlags.OpenedImages) {
    ui.setOpenedImageOptions(snapshot.openedImageOptions, snapshot.activeSessionId);
  }

  if (invalidation & ViewerUiInvalidationFlags.ExportTarget) {
    ui.setExportTarget(snapshot.exportTarget);
  }

  if (invalidation & ViewerUiInvalidationFlags.Exposure) {
    ui.setExposure(snapshot.exposureEv);
  }

  if (invalidation & ViewerUiInvalidationFlags.ViewerMode) {
    ui.setViewerMode(snapshot.viewerMode);
  }

  if (invalidation & ViewerUiInvalidationFlags.VisualizationMode) {
    ui.setVisualizationMode(snapshot.visualizationMode);
  }

  if (invalidation & ViewerUiInvalidationFlags.StokesDegreeModulation) {
    ui.setStokesDegreeModulationControl(
      snapshot.stokesDegreeModulationControl?.label ?? null,
      snapshot.stokesDegreeModulationControl?.enabled ?? false
    );
  }

  if (invalidation & ViewerUiInvalidationFlags.ActiveColormap) {
    ui.setActiveColormap(snapshot.activeColormapId);
  }

  if (invalidation & ViewerUiInvalidationFlags.ColormapOptions) {
    ui.setColormapOptions(snapshot.colormapOptions, snapshot.defaultColormapId);
  }

  if ((invalidation & ViewerUiInvalidationFlags.ColormapGradient) && snapshot.activeColormapLut) {
    ui.setColormapGradient(snapshot.activeColormapLut);
  }

  if (invalidation & ViewerUiInvalidationFlags.ColormapRange) {
    ui.setColormapRange(
      snapshot.colormapRange,
      snapshot.activeDisplayLuminanceRange ?? snapshot.colormapRange,
      snapshot.isColormapAutoRange,
      snapshot.colormapZeroCentered
    );
  }

  if (invalidation & ViewerUiInvalidationFlags.LayerOptions) {
    ui.setLayerOptions(snapshot.layerOptions, snapshot.activeLayer);
  }

  if (invalidation & ViewerUiInvalidationFlags.Metadata) {
    ui.setMetadata(snapshot.metadata);
  }

  if (invalidation & ViewerUiInvalidationFlags.RgbGroupOptions) {
    ui.setRgbGroupOptions(
      snapshot.rgbGroupChannelNames,
      snapshot.displaySelection,
      snapshot.channelThumbnailItems
    );
  }

  if (invalidation & ViewerUiInvalidationFlags.ClearPanels) {
    ui.clearImageBrowserPanels();
  }
}
