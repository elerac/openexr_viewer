export interface Elements {
  appMenuBar: HTMLElement;
  mainLayout: HTMLElement;
  rightStack: HTMLElement;
  sidePanel: HTMLElement;
  imagePanel: HTMLElement;
  imagePanelContent: HTMLElement;
  imagePanelCollapseButton: HTMLButtonElement;
  rightPanelCollapseButton: HTMLButtonElement;
  imagePanelResizer: HTMLElement;
  rightPanelResizer: HTMLElement;
  fileMenuButton: HTMLButtonElement;
  fileMenu: HTMLElement;
  viewMenuButton: HTMLButtonElement;
  viewMenu: HTMLElement;
  galleryMenuButton: HTMLButtonElement;
  galleryMenu: HTMLElement;
  settingsMenuButton: HTMLButtonElement;
  settingsMenu: HTMLElement;
  imageViewerMenuItem: HTMLButtonElement;
  panoramaViewerMenuItem: HTMLButtonElement;
  galleryCboxRgbButton: HTMLButtonElement;
  openFileButton: HTMLButtonElement;
  openFolderButton: HTMLButtonElement;
  exportImageButton: HTMLButtonElement;
  fileInput: HTMLInputElement;
  folderInput: HTMLInputElement;
  exportDialogBackdrop: HTMLDivElement;
  exportDialogForm: HTMLFormElement;
  exportFilenameInput: HTMLInputElement;
  exportFormatSelect: HTMLSelectElement;
  exportDialogError: HTMLElement;
  exportDialogCancelButton: HTMLButtonElement;
  exportDialogSubmitButton: HTMLButtonElement;
  resetViewButton: HTMLButtonElement;
  visualizationNoneButton: HTMLButtonElement;
  colormapToggleButton: HTMLButtonElement;
  colormapRangeControl: HTMLDivElement;
  colormapSelect: HTMLSelectElement;
  stokesDegreeModulationControl: HTMLDivElement;
  stokesDegreeModulationButton: HTMLButtonElement;
  colormapAutoRangeButton: HTMLButtonElement;
  colormapZeroCenterButton: HTMLButtonElement;
  colormapRangeSlider: HTMLDivElement;
  colormapVminSlider: HTMLInputElement;
  colormapVmaxSlider: HTMLInputElement;
  colormapVminInput: HTMLInputElement;
  colormapVmaxInput: HTMLInputElement;
  exposureControl: HTMLDivElement;
  exposureSlider: HTMLInputElement;
  exposureValue: HTMLInputElement;
  errorBanner: HTMLDivElement;
  viewerContainer: HTMLElement;
  dropOverlay: HTMLDivElement;
  loadingOverlay: HTMLDivElement;
  openedImagesSelect: HTMLSelectElement;
  openedFilesToggle: HTMLButtonElement;
  openedFilesList: HTMLElement;
  openedFilesCount: HTMLElement;
  displayCacheControl: HTMLDivElement;
  displayCacheBudgetInput: HTMLSelectElement;
  displayCacheUsage: HTMLElement;
  reloadAllOpenedImagesButton: HTMLButtonElement;
  closeAllOpenedImagesButton: HTMLButtonElement;
  layerControl: HTMLDivElement;
  layerSelect: HTMLSelectElement;
  partsLayersToggle: HTMLButtonElement;
  partsLayersList: HTMLElement;
  partsLayersCount: HTMLElement;
  rgbSplitToggleButton: HTMLButtonElement;
  rgbGroupSelect: HTMLSelectElement;
  channelViewToggle: HTMLButtonElement;
  channelViewList: HTMLElement;
  channelViewCount: HTMLElement;
  probeMode: HTMLElement;
  probeCoords: HTMLElement;
  probeColorPreview: HTMLDivElement;
  probeColorSwatch: HTMLElement;
  probeColorValues: HTMLElement;
  probeValues: HTMLElement;
  metadataEmptyState: HTMLElement;
  metadataTable: HTMLElement;
  roiEmptyState: HTMLElement;
  roiDetails: HTMLDivElement;
  roiBounds: HTMLElement;
  roiSize: HTMLElement;
  roiPixelCount: HTMLElement;
  roiValidCount: HTMLElement;
  roiStats: HTMLElement;
  clearRoiButton: HTMLButtonElement;
  glCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  probeOverlayCanvas: HTMLCanvasElement;
}

export type OpenedImagesPanelElements = Pick<
  Elements,
  | 'openedImagesSelect'
  | 'openedFilesList'
  | 'openedFilesCount'
  | 'displayCacheControl'
  | 'displayCacheBudgetInput'
  | 'displayCacheUsage'
  | 'reloadAllOpenedImagesButton'
  | 'closeAllOpenedImagesButton'
>;

export type LayerPanelElements = Pick<
  Elements,
  'layerControl' | 'layerSelect' | 'partsLayersList' | 'partsLayersCount'
>;

export type ChannelPanelElements = Pick<
  Elements,
  'rgbSplitToggleButton' | 'rgbGroupSelect' | 'channelViewList' | 'channelViewCount'
>;

export type ColormapPanelElements = Pick<
  Elements,
  | 'visualizationNoneButton'
  | 'colormapToggleButton'
  | 'colormapRangeControl'
  | 'colormapSelect'
  | 'stokesDegreeModulationControl'
  | 'stokesDegreeModulationButton'
  | 'colormapAutoRangeButton'
  | 'colormapZeroCenterButton'
  | 'colormapRangeSlider'
  | 'colormapVminSlider'
  | 'colormapVmaxSlider'
  | 'colormapVminInput'
  | 'colormapVmaxInput'
  | 'exposureControl'
  | 'exposureSlider'
  | 'exposureValue'
>;

export type LayoutSplitElements = Pick<
  Elements,
  | 'mainLayout'
  | 'rightStack'
  | 'sidePanel'
  | 'imagePanel'
  | 'imagePanelContent'
  | 'imagePanelCollapseButton'
  | 'rightPanelCollapseButton'
  | 'imagePanelResizer'
  | 'rightPanelResizer'
>;

export function resolveElements(): Elements {
  return {
    appMenuBar: requireElement('app-menu-bar', HTMLElement),
    mainLayout: requireElement('main-layout', HTMLElement),
    rightStack: requireElement('right-stack', HTMLElement),
    sidePanel: requireElement('inspector-panel', HTMLElement),
    imagePanel: requireElement('image-panel', HTMLElement),
    imagePanelContent: requireElement('image-panel-content', HTMLElement),
    imagePanelCollapseButton: requireElement('image-panel-collapse-button', HTMLButtonElement),
    rightPanelCollapseButton: requireElement('right-panel-collapse-button', HTMLButtonElement),
    imagePanelResizer: requireElement('image-panel-resizer', HTMLElement),
    rightPanelResizer: requireElement('right-panel-resizer', HTMLElement),
    fileMenuButton: requireElement('file-menu-button', HTMLButtonElement),
    fileMenu: requireElement('file-menu', HTMLElement),
    viewMenuButton: requireElement('view-menu-button', HTMLButtonElement),
    viewMenu: requireElement('view-menu', HTMLElement),
    galleryMenuButton: requireElement('gallery-menu-button', HTMLButtonElement),
    galleryMenu: requireElement('gallery-menu', HTMLElement),
    settingsMenuButton: requireElement('settings-menu-button', HTMLButtonElement),
    settingsMenu: requireElement('settings-menu', HTMLElement),
    imageViewerMenuItem: requireElement('image-viewer-menu-item', HTMLButtonElement),
    panoramaViewerMenuItem: requireElement('panorama-viewer-menu-item', HTMLButtonElement),
    galleryCboxRgbButton: requireElement('gallery-cbox-rgb-button', HTMLButtonElement),
    openFileButton: requireElement('open-file-button', HTMLButtonElement),
    openFolderButton: requireElement('open-folder-button', HTMLButtonElement),
    exportImageButton: requireElement('export-image-button', HTMLButtonElement),
    fileInput: requireElement('file-input', HTMLInputElement),
    folderInput: requireElement('folder-input', HTMLInputElement),
    exportDialogBackdrop: requireElement('export-dialog-backdrop', HTMLDivElement),
    exportDialogForm: requireElement('export-dialog-form', HTMLFormElement),
    exportFilenameInput: requireElement('export-filename-input', HTMLInputElement),
    exportFormatSelect: requireElement('export-format-select', HTMLSelectElement),
    exportDialogError: requireElement('export-dialog-error', HTMLElement),
    exportDialogCancelButton: requireElement('export-dialog-cancel-button', HTMLButtonElement),
    exportDialogSubmitButton: requireElement('export-dialog-submit-button', HTMLButtonElement),
    resetViewButton: requireElement('reset-view-button', HTMLButtonElement),
    visualizationNoneButton: requireElement('visualization-none-button', HTMLButtonElement),
    colormapToggleButton: requireElement('colormap-toggle-button', HTMLButtonElement),
    colormapRangeControl: requireElement('colormap-range-control', HTMLDivElement),
    colormapSelect: requireElement('colormap-select', HTMLSelectElement),
    stokesDegreeModulationControl: requireElement('stokes-degree-modulation-control', HTMLDivElement),
    stokesDegreeModulationButton: requireElement('stokes-degree-modulation-button', HTMLButtonElement),
    colormapAutoRangeButton: requireElement('colormap-auto-range-button', HTMLButtonElement),
    colormapZeroCenterButton: requireElement('colormap-zero-center-button', HTMLButtonElement),
    colormapRangeSlider: requireElement('colormap-range-slider', HTMLDivElement),
    colormapVminSlider: requireElement('colormap-vmin-slider', HTMLInputElement),
    colormapVmaxSlider: requireElement('colormap-vmax-slider', HTMLInputElement),
    colormapVminInput: requireElement('colormap-vmin-input', HTMLInputElement),
    colormapVmaxInput: requireElement('colormap-vmax-input', HTMLInputElement),
    exposureControl: requireElement('exposure-control', HTMLDivElement),
    exposureSlider: requireElement('exposure-slider', HTMLInputElement),
    exposureValue: requireElement('exposure-value', HTMLInputElement),
    errorBanner: requireElement('error-banner', HTMLDivElement),
    viewerContainer: requireElement('viewer-container', HTMLElement),
    dropOverlay: requireElement('drop-overlay', HTMLDivElement),
    loadingOverlay: requireElement('loading-overlay', HTMLDivElement),
    openedImagesSelect: requireElement('opened-images-select', HTMLSelectElement),
    openedFilesToggle: requireElement('opened-files-toggle', HTMLButtonElement),
    openedFilesList: requireElement('opened-files-list', HTMLElement),
    openedFilesCount: requireElement('opened-files-count', HTMLElement),
    displayCacheControl: requireElement('display-cache-control', HTMLDivElement),
    displayCacheBudgetInput: requireElement('display-cache-budget-input', HTMLSelectElement),
    displayCacheUsage: requireElement('display-cache-usage', HTMLElement),
    reloadAllOpenedImagesButton: requireElement('reload-all-opened-images-button', HTMLButtonElement),
    closeAllOpenedImagesButton: requireElement('close-all-opened-images-button', HTMLButtonElement),
    layerControl: requireElement('layer-control', HTMLDivElement),
    layerSelect: requireElement('layer-select', HTMLSelectElement),
    partsLayersToggle: requireElement('parts-layers-toggle', HTMLButtonElement),
    partsLayersList: requireElement('parts-layers-list', HTMLElement),
    partsLayersCount: requireElement('parts-layers-count', HTMLElement),
    rgbSplitToggleButton: requireElement('rgb-split-toggle-button', HTMLButtonElement),
    rgbGroupSelect: requireElement('rgb-group-select', HTMLSelectElement),
    channelViewToggle: requireElement('channel-view-toggle', HTMLButtonElement),
    channelViewList: requireElement('channel-view-list', HTMLElement),
    channelViewCount: requireElement('channel-view-count', HTMLElement),
    probeMode: requireElement('probe-mode', HTMLElement),
    probeCoords: requireElement('probe-coords', HTMLElement),
    probeColorPreview: requireElement('probe-color-preview', HTMLDivElement),
    probeColorSwatch: requireElement('probe-color-swatch', HTMLElement),
    probeColorValues: requireElement('probe-color-values', HTMLElement),
    probeValues: requireElement('probe-values', HTMLElement),
    metadataEmptyState: requireElement('metadata-empty-state', HTMLElement),
    metadataTable: requireElement('metadata-table', HTMLElement),
    roiEmptyState: requireElement('roi-empty-state', HTMLElement),
    roiDetails: requireElement('roi-details', HTMLDivElement),
    roiBounds: requireElement('roi-bounds', HTMLElement),
    roiSize: requireElement('roi-size', HTMLElement),
    roiPixelCount: requireElement('roi-pixel-count', HTMLElement),
    roiValidCount: requireElement('roi-valid-count', HTMLElement),
    roiStats: requireElement('roi-stats', HTMLElement),
    clearRoiButton: requireElement('clear-roi-button', HTMLButtonElement),
    glCanvas: requireElement('gl-canvas', HTMLCanvasElement),
    overlayCanvas: requireElement('overlay-canvas', HTMLCanvasElement),
    probeOverlayCanvas: requireElement('probe-overlay-canvas', HTMLCanvasElement)
  };
}

function requireElement<T extends Element>(id: string, type: { new (): T }): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  if (!(element instanceof type)) {
    throw new Error(`Element #${id} is not of expected type.`);
  }

  return element;
}
