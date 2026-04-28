export interface Elements {
  appShell: HTMLElement;
  appMenuBar: HTMLElement;
  appAutoFitImageButton: HTMLButtonElement;
  appAutoExposureButton: HTMLButtonElement;
  appScreenshotButton: HTMLButtonElement;
  appFullscreenButton: HTMLButtonElement;
  settingsDialogButton: HTMLButtonElement;
  appIconTooltip: HTMLElement;
  mainLayout: HTMLElement;
  rightStack: HTMLElement;
  sidePanel: HTMLElement;
  bottomPanel: HTMLElement;
  bottomPanelContent: HTMLElement;
  channelThumbnailStrip: HTMLElement;
  imagePanel: HTMLElement;
  imagePanelContent: HTMLElement;
  imagePanelCollapseButton: HTMLButtonElement;
  rightPanelCollapseButton: HTMLButtonElement;
  bottomPanelCollapseButton: HTMLButtonElement;
  imagePanelResizer: HTMLElement;
  rightPanelResizer: HTMLElement;
  bottomPanelResizer: HTMLElement;
  fileMenuButton: HTMLButtonElement;
  fileMenu: HTMLElement;
  viewMenuButton: HTMLButtonElement;
  viewMenu: HTMLElement;
  windowMenuButton: HTMLButtonElement;
  windowMenu: HTMLElement;
  galleryMenuButton: HTMLButtonElement;
  galleryMenu: HTMLElement;
  settingsDialogBackdrop: HTMLDivElement;
  settingsDialog: HTMLElement;
  settingsDialogCloseButton: HTMLButtonElement;
  themeSelect: HTMLSelectElement;
  spectrumLatticeMotionSelect: HTMLSelectElement;
  autoExposurePercentileInput: HTMLInputElement;
  stokesDefaultSettingsTable: HTMLTableElement;
  resetSettingsButton: HTMLButtonElement;
  imageViewerMenuItem: HTMLButtonElement;
  panoramaViewerMenuItem: HTMLButtonElement;
  windowNormalMenuItem: HTMLButtonElement;
  windowFullScreenPreviewMenuItem: HTMLButtonElement;
  galleryCboxRgbButton: HTMLButtonElement;
  openFileButton: HTMLButtonElement;
  openFolderButton: HTMLButtonElement;
  exportImageButton: HTMLButtonElement;
  exportScreenshotButton: HTMLButtonElement;
  exportImageBatchButton: HTMLButtonElement;
  exportColormapButton: HTMLButtonElement;
  fileInput: HTMLInputElement;
  folderInput: HTMLInputElement;
  exportDialogBackdrop: HTMLDivElement;
  exportDialogForm: HTMLFormElement;
  exportFilenameInput: HTMLInputElement;
  exportFormatSelect: HTMLSelectElement;
  exportSizeField: HTMLDivElement;
  exportWidthInput: HTMLInputElement;
  exportHeightInput: HTMLInputElement;
  exportPreviewStage: HTMLDivElement;
  exportPreviewCanvas: HTMLCanvasElement;
  exportPreviewStatus: HTMLElement;
  exportDialogError: HTMLElement;
  exportDialogCancelButton: HTMLButtonElement;
  exportDialogSubmitButton: HTMLButtonElement;
  exportBatchDialogBackdrop: HTMLDivElement;
  exportBatchDialogForm: HTMLFormElement;
  exportBatchDialogTitle: HTMLElement;
  exportBatchDialogSubtitle: HTMLElement;
  exportBatchArchiveFilenameInput: HTMLInputElement;
  exportBatchSizeField: HTMLDivElement;
  exportBatchWidthInput: HTMLInputElement;
  exportBatchHeightInput: HTMLInputElement;
  exportBatchSelectAllButton: HTMLButtonElement;
  exportBatchDeselectAllButton: HTMLButtonElement;
  exportBatchSplitToggleButton: HTMLButtonElement;
  exportBatchMatrix: HTMLElement;
  exportBatchDialogStatus: HTMLElement;
  exportBatchDialogError: HTMLElement;
  exportBatchDialogCancelButton: HTMLButtonElement;
  exportBatchDialogSubmitButton: HTMLButtonElement;
  folderLoadDialogBackdrop: HTMLDivElement;
  folderLoadDialogForm: HTMLFormElement;
  folderLoadDialogSummary: HTMLElement;
  folderLoadDialogStats: HTMLElement;
  folderLoadDialogWarning: HTMLElement;
  folderLoadDialogCancelButton: HTMLButtonElement;
  folderLoadDialogSubmitButton: HTMLButtonElement;
  exportColormapDialogBackdrop: HTMLDivElement;
  exportColormapDialogForm: HTMLFormElement;
  exportColormapSelect: HTMLSelectElement;
  exportColormapWidthInput: HTMLInputElement;
  exportColormapHeightInput: HTMLInputElement;
  exportColormapOrientationSelect: HTMLSelectElement;
  exportColormapPreviewStage: HTMLDivElement;
  exportColormapPreviewCanvas: HTMLCanvasElement;
  exportColormapPreviewStatus: HTMLElement;
  exportColormapFilenameInput: HTMLInputElement;
  exportColormapDialogError: HTMLElement;
  exportColormapDialogCancelButton: HTMLButtonElement;
  exportColormapDialogSubmitButton: HTMLButtonElement;
  resetViewButton: HTMLButtonElement;
  visualizationNoneButton: HTMLButtonElement;
  colormapToggleButton: HTMLButtonElement;
  colormapRangeControl: HTMLDivElement;
  colormapSelect: HTMLSelectElement;
  stokesDegreeModulationControl: HTMLDivElement;
  stokesDegreeModulationButton: HTMLButtonElement;
  stokesAolpModulationModeControl: HTMLDivElement;
  stokesAolpModulationValueButton: HTMLButtonElement;
  stokesAolpModulationSaturationButton: HTMLButtonElement;
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
  metadataToggle: HTMLButtonElement;
  metadataContent: HTMLDivElement;
  probeMode: HTMLElement;
  probeCoords: HTMLElement;
  probeColorPreview: HTMLDivElement;
  probeColorSwatch: HTMLElement;
  probeColorValues: HTMLElement;
  probeValues: HTMLElement;
  probeToggle: HTMLButtonElement;
  probeContent: HTMLDivElement;
  metadataEmptyState: HTMLElement;
  metadataTable: HTMLElement;
  roiToggle: HTMLButtonElement;
  roiContent: HTMLDivElement;
  roiEmptyState: HTMLElement;
  roiDetails: HTMLDivElement;
  roiBounds: HTMLElement;
  roiSize: HTMLElement;
  roiPixelCount: HTMLElement;
  roiValidCount: HTMLElement;
  roiStats: HTMLElement;
  clearRoiButton: HTMLButtonElement;
  spectrumLatticeCanvas: HTMLCanvasElement;
  glCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  probeOverlayCanvas: HTMLCanvasElement;
  screenshotSelectionOverlay: HTMLDivElement;
  screenshotSelectionMaskTop: HTMLDivElement;
  screenshotSelectionMaskRight: HTMLDivElement;
  screenshotSelectionMaskBottom: HTMLDivElement;
  screenshotSelectionMaskLeft: HTMLDivElement;
  screenshotSelectionGuideVertical: HTMLDivElement;
  screenshotSelectionGuideHorizontal: HTMLDivElement;
  screenshotSelectionBox: HTMLDivElement;
  screenshotSelectionSize: HTMLDivElement;
  screenshotSelectionControls: HTMLDivElement;
  screenshotSelectionFitButton: HTMLButtonElement;
  screenshotSelectionCancelButton: HTMLButtonElement;
  screenshotSelectionExportButton: HTMLButtonElement;
  screenshotSelectionExportBatchButton: HTMLButtonElement;
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

export type ChannelThumbnailStripElements = Pick<Elements, 'channelThumbnailStrip'>;

export type ColormapPanelElements = Pick<
  Elements,
  | 'visualizationNoneButton'
  | 'colormapToggleButton'
  | 'colormapRangeControl'
  | 'colormapSelect'
  | 'stokesDegreeModulationControl'
  | 'stokesDegreeModulationButton'
  | 'stokesAolpModulationModeControl'
  | 'stokesAolpModulationValueButton'
  | 'stokesAolpModulationSaturationButton'
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
  | 'bottomPanel'
  | 'bottomPanelContent'
  | 'imagePanel'
  | 'imagePanelContent'
  | 'imagePanelCollapseButton'
  | 'rightPanelCollapseButton'
  | 'bottomPanelCollapseButton'
  | 'imagePanelResizer'
  | 'rightPanelResizer'
  | 'bottomPanelResizer'
>;

export type LoadingOverlayElements = Pick<Elements, 'loadingOverlay'>;

export type TopMenuControllerElements = Pick<
  Elements,
  | 'appMenuBar'
  | 'fileMenuButton'
  | 'fileMenu'
  | 'viewMenuButton'
  | 'viewMenu'
  | 'windowMenuButton'
  | 'windowMenu'
  | 'galleryMenuButton'
  | 'galleryMenu'
>;

export type AppFullscreenElements = Pick<Elements, 'appShell' | 'appFullscreenButton'>;

export type WindowPreviewElements = Pick<
  Elements,
  | 'appShell'
  | 'viewerContainer'
  | 'windowNormalMenuItem'
  | 'windowFullScreenPreviewMenuItem'
>;

export type ExportImageDialogElements = Pick<
  Elements,
  | 'exportImageButton'
  | 'fileMenuButton'
  | 'exportDialogBackdrop'
  | 'exportDialogForm'
  | 'exportFilenameInput'
  | 'exportFormatSelect'
  | 'exportSizeField'
  | 'exportWidthInput'
  | 'exportHeightInput'
  | 'exportPreviewCanvas'
  | 'exportPreviewStatus'
  | 'exportDialogError'
  | 'exportDialogCancelButton'
  | 'exportDialogSubmitButton'
>;

export type ExportImageBatchDialogElements = Pick<
  Elements,
  | 'exportImageBatchButton'
  | 'fileMenuButton'
  | 'exportBatchDialogBackdrop'
  | 'exportBatchDialogForm'
  | 'exportBatchDialogTitle'
  | 'exportBatchDialogSubtitle'
  | 'exportBatchArchiveFilenameInput'
  | 'exportBatchSizeField'
  | 'exportBatchWidthInput'
  | 'exportBatchHeightInput'
  | 'exportBatchSelectAllButton'
  | 'exportBatchDeselectAllButton'
  | 'exportBatchSplitToggleButton'
  | 'exportBatchMatrix'
  | 'exportBatchDialogStatus'
  | 'exportBatchDialogError'
  | 'exportBatchDialogCancelButton'
  | 'exportBatchDialogSubmitButton'
>;

export type ExportColormapDialogElements = Pick<
  Elements,
  | 'exportColormapButton'
  | 'fileMenuButton'
  | 'exportColormapDialogBackdrop'
  | 'exportColormapDialogForm'
  | 'exportColormapSelect'
  | 'exportColormapWidthInput'
  | 'exportColormapHeightInput'
  | 'exportColormapOrientationSelect'
  | 'exportColormapPreviewCanvas'
  | 'exportColormapPreviewStatus'
  | 'exportColormapFilenameInput'
  | 'exportColormapDialogError'
  | 'exportColormapDialogCancelButton'
  | 'exportColormapDialogSubmitButton'
>;

export type FolderLoadDialogElements = Pick<
  Elements,
  | 'fileMenuButton'
  | 'folderLoadDialogBackdrop'
  | 'folderLoadDialogForm'
  | 'folderLoadDialogSummary'
  | 'folderLoadDialogStats'
  | 'folderLoadDialogWarning'
  | 'folderLoadDialogCancelButton'
  | 'folderLoadDialogSubmitButton'
>;

export type SettingsDialogElements = Pick<
  Elements,
  | 'settingsDialogButton'
  | 'settingsDialogBackdrop'
  | 'settingsDialog'
  | 'settingsDialogCloseButton'
  | 'themeSelect'
>;

export type ProbeReadoutElements = Pick<
  Elements,
  | 'probeMode'
  | 'probeCoords'
  | 'probeColorPreview'
  | 'probeColorSwatch'
  | 'probeColorValues'
  | 'probeValues'
>;

export type MetadataPanelElements = Pick<Elements, 'metadataEmptyState' | 'metadataTable'>;

export type RoiReadoutElements = Pick<
  Elements,
  | 'roiEmptyState'
  | 'roiDetails'
  | 'clearRoiButton'
  | 'roiBounds'
  | 'roiSize'
  | 'roiPixelCount'
  | 'roiValidCount'
  | 'roiStats'
>;

export type GlobalKeyboardControllerElements = Pick<
  Elements,
  | 'appMenuBar'
  | 'imagePanelResizer'
  | 'rightPanelResizer'
  | 'bottomPanelResizer'
  | 'openedFilesList'
  | 'partsLayersList'
  | 'channelViewList'
  | 'channelThumbnailStrip'
>;

export type DragDropElements = Pick<Elements, 'viewerContainer' | 'dropOverlay'>;

export type CollapsibleSectionsElements = Pick<
  Elements,
  | 'openedFilesToggle'
  | 'openedFilesList'
  | 'partsLayersToggle'
  | 'partsLayersList'
  | 'channelViewToggle'
  | 'channelViewList'
  | 'metadataToggle'
  | 'metadataContent'
  | 'probeToggle'
  | 'probeContent'
  | 'roiToggle'
  | 'roiContent'
>;

export function resolveElements(): Elements {
  return {
    appShell: requireElement('app', HTMLElement),
    appMenuBar: requireElement('app-menu-bar', HTMLElement),
    appAutoFitImageButton: requireElement('app-auto-fit-image-button', HTMLButtonElement),
    appAutoExposureButton: requireElement('app-auto-exposure-button', HTMLButtonElement),
    appScreenshotButton: requireElement('app-screenshot-button', HTMLButtonElement),
    appFullscreenButton: requireElement('app-fullscreen-button', HTMLButtonElement),
    settingsDialogButton: requireElement('settings-dialog-button', HTMLButtonElement),
    appIconTooltip: requireElement('app-icon-tooltip', HTMLElement),
    mainLayout: requireElement('main-layout', HTMLElement),
    rightStack: requireElement('right-stack', HTMLElement),
    sidePanel: requireElement('inspector-panel', HTMLElement),
    bottomPanel: requireElement('bottom-panel', HTMLElement),
    bottomPanelContent: requireElement('bottom-panel-content', HTMLElement),
    channelThumbnailStrip: requireElement('channel-thumbnail-strip', HTMLElement),
    imagePanel: requireElement('image-panel', HTMLElement),
    imagePanelContent: requireElement('image-panel-content', HTMLElement),
    imagePanelCollapseButton: requireElement('image-panel-collapse-button', HTMLButtonElement),
    rightPanelCollapseButton: requireElement('right-panel-collapse-button', HTMLButtonElement),
    bottomPanelCollapseButton: requireElement('bottom-panel-collapse-button', HTMLButtonElement),
    imagePanelResizer: requireElement('image-panel-resizer', HTMLElement),
    rightPanelResizer: requireElement('right-panel-resizer', HTMLElement),
    bottomPanelResizer: requireElement('bottom-panel-resizer', HTMLElement),
    fileMenuButton: requireElement('file-menu-button', HTMLButtonElement),
    fileMenu: requireElement('file-menu', HTMLElement),
    viewMenuButton: requireElement('view-menu-button', HTMLButtonElement),
    viewMenu: requireElement('view-menu', HTMLElement),
    windowMenuButton: requireElement('window-menu-button', HTMLButtonElement),
    windowMenu: requireElement('window-menu', HTMLElement),
    galleryMenuButton: requireElement('gallery-menu-button', HTMLButtonElement),
    galleryMenu: requireElement('gallery-menu', HTMLElement),
    settingsDialogBackdrop: requireElement('settings-dialog-backdrop', HTMLDivElement),
    settingsDialog: requireElement('settings-dialog', HTMLElement),
    settingsDialogCloseButton: requireElement('settings-dialog-close-button', HTMLButtonElement),
    themeSelect: requireElement('theme-select', HTMLSelectElement),
    spectrumLatticeMotionSelect: requireElement('spectrum-lattice-motion-select', HTMLSelectElement),
    autoExposurePercentileInput: requireElement('auto-exposure-percentile-input', HTMLInputElement),
    stokesDefaultSettingsTable: requireElement('stokes-default-settings-table', HTMLTableElement),
    resetSettingsButton: requireElement('reset-settings-button', HTMLButtonElement),
    imageViewerMenuItem: requireElement('image-viewer-menu-item', HTMLButtonElement),
    panoramaViewerMenuItem: requireElement('panorama-viewer-menu-item', HTMLButtonElement),
    windowNormalMenuItem: requireElement('window-normal-menu-item', HTMLButtonElement),
    windowFullScreenPreviewMenuItem: requireElement('window-full-screen-preview-menu-item', HTMLButtonElement),
    galleryCboxRgbButton: requireElement('gallery-cbox-rgb-button', HTMLButtonElement),
    openFileButton: requireElement('open-file-button', HTMLButtonElement),
    openFolderButton: requireElement('open-folder-button', HTMLButtonElement),
    exportImageButton: requireElement('export-image-button', HTMLButtonElement),
    exportScreenshotButton: requireElement('export-screenshot-button', HTMLButtonElement),
    exportImageBatchButton: requireElement('export-image-batch-button', HTMLButtonElement),
    exportColormapButton: requireElement('export-colormap-button', HTMLButtonElement),
    fileInput: requireElement('file-input', HTMLInputElement),
    folderInput: requireElement('folder-input', HTMLInputElement),
    exportDialogBackdrop: requireElement('export-dialog-backdrop', HTMLDivElement),
    exportDialogForm: requireElement('export-dialog-form', HTMLFormElement),
    exportFilenameInput: requireElement('export-filename-input', HTMLInputElement),
    exportFormatSelect: requireElement('export-format-select', HTMLSelectElement),
    exportSizeField: requireElement('export-size-field', HTMLDivElement),
    exportWidthInput: requireElement('export-width-input', HTMLInputElement),
    exportHeightInput: requireElement('export-height-input', HTMLInputElement),
    exportPreviewStage: requireElement('export-preview-stage', HTMLDivElement),
    exportPreviewCanvas: requireElement('export-preview-canvas', HTMLCanvasElement),
    exportPreviewStatus: requireElement('export-preview-status', HTMLElement),
    exportDialogError: requireElement('export-dialog-error', HTMLElement),
    exportDialogCancelButton: requireElement('export-dialog-cancel-button', HTMLButtonElement),
    exportDialogSubmitButton: requireElement('export-dialog-submit-button', HTMLButtonElement),
    exportBatchDialogBackdrop: requireElement('export-batch-dialog-backdrop', HTMLDivElement),
    exportBatchDialogForm: requireElement('export-batch-dialog-form', HTMLFormElement),
    exportBatchDialogTitle: requireElement('export-batch-dialog-title', HTMLElement),
    exportBatchDialogSubtitle: requireElement('export-batch-dialog-subtitle', HTMLElement),
    exportBatchArchiveFilenameInput: requireElement('export-batch-archive-filename-input', HTMLInputElement),
    exportBatchSizeField: requireElement('export-batch-size-field', HTMLDivElement),
    exportBatchWidthInput: requireElement('export-batch-width-input', HTMLInputElement),
    exportBatchHeightInput: requireElement('export-batch-height-input', HTMLInputElement),
    exportBatchSelectAllButton: requireElement('export-batch-select-all-button', HTMLButtonElement),
    exportBatchDeselectAllButton: requireElement('export-batch-deselect-all-button', HTMLButtonElement),
    exportBatchSplitToggleButton: requireElement('export-batch-split-toggle-button', HTMLButtonElement),
    exportBatchMatrix: requireElement('export-batch-matrix', HTMLElement),
    exportBatchDialogStatus: requireElement('export-batch-dialog-status', HTMLElement),
    exportBatchDialogError: requireElement('export-batch-dialog-error', HTMLElement),
    exportBatchDialogCancelButton: requireElement('export-batch-dialog-cancel-button', HTMLButtonElement),
    exportBatchDialogSubmitButton: requireElement('export-batch-dialog-submit-button', HTMLButtonElement),
    folderLoadDialogBackdrop: requireElement('folder-load-dialog-backdrop', HTMLDivElement),
    folderLoadDialogForm: requireElement('folder-load-dialog-form', HTMLFormElement),
    folderLoadDialogSummary: requireElement('folder-load-dialog-summary', HTMLElement),
    folderLoadDialogStats: requireElement('folder-load-dialog-stats', HTMLElement),
    folderLoadDialogWarning: requireElement('folder-load-dialog-warning', HTMLElement),
    folderLoadDialogCancelButton: requireElement('folder-load-dialog-cancel-button', HTMLButtonElement),
    folderLoadDialogSubmitButton: requireElement('folder-load-dialog-submit-button', HTMLButtonElement),
    exportColormapDialogBackdrop: requireElement('export-colormap-dialog-backdrop', HTMLDivElement),
    exportColormapDialogForm: requireElement('export-colormap-dialog-form', HTMLFormElement),
    exportColormapSelect: requireElement('export-colormap-select', HTMLSelectElement),
    exportColormapWidthInput: requireElement('export-colormap-width-input', HTMLInputElement),
    exportColormapHeightInput: requireElement('export-colormap-height-input', HTMLInputElement),
    exportColormapOrientationSelect: requireElement('export-colormap-orientation-select', HTMLSelectElement),
    exportColormapPreviewStage: requireElement('export-colormap-preview-stage', HTMLDivElement),
    exportColormapPreviewCanvas: requireElement('export-colormap-preview-canvas', HTMLCanvasElement),
    exportColormapPreviewStatus: requireElement('export-colormap-preview-status', HTMLElement),
    exportColormapFilenameInput: requireElement('export-colormap-filename-input', HTMLInputElement),
    exportColormapDialogError: requireElement('export-colormap-dialog-error', HTMLElement),
    exportColormapDialogCancelButton: requireElement('export-colormap-dialog-cancel-button', HTMLButtonElement),
    exportColormapDialogSubmitButton: requireElement('export-colormap-dialog-submit-button', HTMLButtonElement),
    resetViewButton: requireElement('reset-view-button', HTMLButtonElement),
    visualizationNoneButton: requireElement('visualization-none-button', HTMLButtonElement),
    colormapToggleButton: requireElement('colormap-toggle-button', HTMLButtonElement),
    colormapRangeControl: requireElement('colormap-range-control', HTMLDivElement),
    colormapSelect: requireElement('colormap-select', HTMLSelectElement),
    stokesDegreeModulationControl: requireElement('stokes-degree-modulation-control', HTMLDivElement),
    stokesDegreeModulationButton: requireElement('stokes-degree-modulation-button', HTMLButtonElement),
    stokesAolpModulationModeControl: requireElement('stokes-aolp-modulation-mode-control', HTMLDivElement),
    stokesAolpModulationValueButton: requireElement('stokes-aolp-modulation-value-button', HTMLButtonElement),
    stokesAolpModulationSaturationButton: requireElement('stokes-aolp-modulation-saturation-button', HTMLButtonElement),
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
    metadataToggle: requireElement('metadata-toggle', HTMLButtonElement),
    metadataContent: requireElement('metadata-content', HTMLDivElement),
    probeMode: requireElement('probe-mode', HTMLElement),
    probeCoords: requireElement('probe-coords', HTMLElement),
    probeColorPreview: requireElement('probe-color-preview', HTMLDivElement),
    probeColorSwatch: requireElement('probe-color-swatch', HTMLElement),
    probeColorValues: requireElement('probe-color-values', HTMLElement),
    probeValues: requireElement('probe-values', HTMLElement),
    probeToggle: requireElement('probe-toggle', HTMLButtonElement),
    probeContent: requireElement('probe-content', HTMLDivElement),
    metadataEmptyState: requireElement('metadata-empty-state', HTMLElement),
    metadataTable: requireElement('metadata-table', HTMLElement),
    roiToggle: requireElement('roi-toggle', HTMLButtonElement),
    roiContent: requireElement('roi-content', HTMLDivElement),
    roiEmptyState: requireElement('roi-empty-state', HTMLElement),
    roiDetails: requireElement('roi-details', HTMLDivElement),
    roiBounds: requireElement('roi-bounds', HTMLElement),
    roiSize: requireElement('roi-size', HTMLElement),
    roiPixelCount: requireElement('roi-pixel-count', HTMLElement),
    roiValidCount: requireElement('roi-valid-count', HTMLElement),
    roiStats: requireElement('roi-stats', HTMLElement),
    clearRoiButton: requireElement('clear-roi-button', HTMLButtonElement),
    spectrumLatticeCanvas: requireElement('spectrum-lattice-canvas', HTMLCanvasElement),
    glCanvas: requireElement('gl-canvas', HTMLCanvasElement),
    overlayCanvas: requireElement('overlay-canvas', HTMLCanvasElement),
    probeOverlayCanvas: requireElement('probe-overlay-canvas', HTMLCanvasElement),
    screenshotSelectionOverlay: requireElement('screenshot-selection-overlay', HTMLDivElement),
    screenshotSelectionMaskTop: requireElement('screenshot-selection-mask-top', HTMLDivElement),
    screenshotSelectionMaskRight: requireElement('screenshot-selection-mask-right', HTMLDivElement),
    screenshotSelectionMaskBottom: requireElement('screenshot-selection-mask-bottom', HTMLDivElement),
    screenshotSelectionMaskLeft: requireElement('screenshot-selection-mask-left', HTMLDivElement),
    screenshotSelectionGuideVertical: requireElement('screenshot-selection-guide-vertical', HTMLDivElement),
    screenshotSelectionGuideHorizontal: requireElement('screenshot-selection-guide-horizontal', HTMLDivElement),
    screenshotSelectionBox: requireElement('screenshot-selection-box', HTMLDivElement),
    screenshotSelectionSize: requireElement('screenshot-selection-size', HTMLDivElement),
    screenshotSelectionControls: requireElement('screenshot-selection-controls', HTMLDivElement),
    screenshotSelectionFitButton: requireElement('screenshot-selection-fit-button', HTMLButtonElement),
    screenshotSelectionCancelButton: requireElement('screenshot-selection-cancel-button', HTMLButtonElement),
    screenshotSelectionExportButton: requireElement('screenshot-selection-export-button', HTMLButtonElement),
    screenshotSelectionExportBatchButton: requireElement('screenshot-selection-export-batch-button', HTMLButtonElement)
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
