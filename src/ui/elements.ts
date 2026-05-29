export interface Elements {
  appShell: HTMLElement;
  appMenuBar: HTMLElement;
  appAutoFitImageButton: HTMLButtonElement;
  appAutoExposureButton: HTMLButtonElement;
  appInvalidValueWarningButton: HTMLButtonElement;
  appScreenshotButton: HTMLButtonElement;
  appMetadataButton: HTMLButtonElement;
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
  metadataDialogBackdrop: HTMLDivElement;
  metadataDialog: HTMLElement;
  metadataDialogCloseButton: HTMLButtonElement;
  themeSelect: HTMLSelectElement;
  spectrumLatticeMotionSelect: HTMLSelectElement;
  spectralRgbGroupingCheckbox: HTMLInputElement;
  imageLoadWorkersInput: HTMLInputElement;
  autoExposurePercentileInput: HTMLInputElement;
  stokesInvalidVectorMaskCheckbox: HTMLInputElement;
  stokesDefaultSettingsTable: HTMLTableElement;
  resetSettingsButton: HTMLButtonElement;
  imageViewerMenuItem: HTMLButtonElement;
  panoramaViewerMenuItem: HTMLButtonElement;
  depthViewerMenuItem: HTMLButtonElement;
  rulersMenuItem: HTMLButtonElement;
  windowNormalMenuItem: HTMLButtonElement;
  windowFullScreenPreviewMenuItem: HTMLButtonElement;
  windowSinglePaneMenuItem: HTMLButtonElement;
  windowSplitVerticalMenuItem: HTMLButtonElement;
  windowSplitHorizontalMenuItem: HTMLButtonElement;
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
  exportDialogTitle: HTMLElement;
  exportDialogSubtitle: HTMLElement;
  exportFilenameFieldLabel: HTMLElement;
  exportFilenameInput: HTMLInputElement;
  exportFormatSelect: HTMLSelectElement;
  exportCompressionInput: HTMLInputElement;
  exportSizeField: HTMLDivElement;
  exportSizeFieldLabel: HTMLElement;
  exportWidthFieldLabel: HTMLElement;
  exportHeightFieldLabel: HTMLElement;
  exportWidthInput: HTMLInputElement;
  exportHeightInput: HTMLInputElement;
  exportReproductionMetadataField: HTMLElement;
  exportReproductionMetadataCheckbox: HTMLInputElement;
  exportPreviewStage: HTMLDivElement;
  exportPreviewCanvas: HTMLCanvasElement;
  exportPreviewStatus: HTMLElement;
  exportProgress: HTMLDivElement;
  exportProgressBar: HTMLProgressElement;
  exportProgressLabel: HTMLElement;
  exportDialogError: HTMLElement;
  exportDialogCancelButton: HTMLButtonElement;
  exportDialogSubmitButton: HTMLButtonElement;
  exportBatchDialogBackdrop: HTMLDivElement;
  exportBatchDialogForm: HTMLFormElement;
  exportBatchDialogTitle: HTMLElement;
  exportBatchDialogSubtitle: HTMLElement;
  exportBatchArchiveFilenameInput: HTMLInputElement;
  exportBatchUseOpenFilesNamesCheckbox: HTMLInputElement;
  exportBatchCompressionInput: HTMLInputElement;
  exportBatchSizeField: HTMLDivElement;
  exportBatchSizeFieldLabel: HTMLElement;
  exportBatchWidthFieldLabel: HTMLElement;
  exportBatchHeightFieldLabel: HTMLElement;
  exportBatchWidthInput: HTMLInputElement;
  exportBatchHeightInput: HTMLInputElement;
  exportBatchReproductionMetadataField: HTMLElement;
  exportBatchReproductionMetadataCheckbox: HTMLInputElement;
  exportBatchSelectAllButton: HTMLButtonElement;
  exportBatchDeselectAllButton: HTMLButtonElement;
  exportBatchSplitToggleButton: HTMLButtonElement;
  exportBatchMatrix: HTMLElement;
  exportBatchDialogStatus: HTMLElement;
  exportBatchProgress: HTMLDivElement;
  exportBatchProgressBar: HTMLProgressElement;
  exportBatchProgressLabel: HTMLElement;
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
  exportColormapCompressionInput: HTMLInputElement;
  exportColormapPreviewStage: HTMLDivElement;
  exportColormapPreviewCanvas: HTMLCanvasElement;
  exportColormapPreviewStatus: HTMLElement;
  exportColormapFilenameInput: HTMLInputElement;
  exportColormapDialogError: HTMLElement;
  exportColormapDialogCancelButton: HTMLButtonElement;
  exportColormapDialogSubmitButton: HTMLButtonElement;
  displayControlHeading: HTMLHeadingElement;
  displayControlToggle: HTMLButtonElement;
  displayControlContent: HTMLDivElement;
  colormapRangeControl: HTMLDivElement;
  colormapSelect: HTMLSelectElement;
  colormapExposureSlider: HTMLInputElement;
  colormapExposureValue: HTMLInputElement;
  colormapGammaSlider: HTMLInputElement;
  colormapGammaValue: HTMLInputElement;
  stokesDegreeModulationControl: HTMLDivElement;
  stokesDegreeModulationButton: HTMLButtonElement;
  stokesAolpModulationModeControl: HTMLDivElement;
  stokesAolpModulationValueButton: HTMLButtonElement;
  stokesAolpModulationSaturationButton: HTMLButtonElement;
  colormapRangeResetLabel: HTMLSpanElement;
  colormapZeroCenterButton: HTMLInputElement;
  colormapReverseButton: HTMLInputElement;
  colormapRangeSlider: HTMLDivElement;
  colormapVminSlider: HTMLInputElement;
  colormapVmaxSlider: HTMLInputElement;
  colormapVminInput: HTMLInputElement;
  colormapVmaxInput: HTMLInputElement;
  exposureControl: HTMLDivElement;
  exposureSlider: HTMLInputElement;
  exposureValue: HTMLInputElement;
  gammaSlider: HTMLInputElement;
  gammaValue: HTMLInputElement;
  errorBanner: HTMLDivElement;
  viewerContainer: HTMLElement;
  viewerContextMenu: HTMLDivElement;
  viewerContextCopyImageButton: HTMLButtonElement;
  dropOverlay: HTMLDivElement;
  loadingOverlay: HTMLDivElement;
  openedImagesSelect: HTMLSelectElement;
  openedFilesToggle: HTMLButtonElement;
  openedFilesFilterInput: HTMLInputElement;
  openedFilesList: HTMLElement;
  openedFilesCount: HTMLElement;
  displayCacheControl: HTMLDivElement;
  displayCacheBudgetInput: HTMLSelectElement;
  displayCacheUsage: HTMLElement;
  reloadAllOpenedImagesButton: HTMLButtonElement;
  closeAllOpenedImagesButton: HTMLButtonElement;
  imageStatsToggle: HTMLButtonElement;
  imageStatsContent: HTMLDivElement;
  imageStatsEmptyState: HTMLElement;
  imageStatsLoadingState: HTMLElement;
  imageStatsTable: HTMLElement;
  probeMode: HTMLElement;
  probeCoords: HTMLElement;
  probeColorPreview: HTMLDivElement;
  probeColorSwatch: HTMLElement;
  probeColorValues: HTMLElement;
  probeToggle: HTMLButtonElement;
  probeContent: HTMLDivElement;
  spectralPanel: HTMLElement;
  spectralToggle: HTMLButtonElement;
  spectralContent: HTMLDivElement;
  spectralEmptyState: HTMLElement;
  spectralPlot: HTMLElement;
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
  viewerStateToggle: HTMLButtonElement;
  viewerStateContent: HTMLDivElement;
  viewerStateEmptyState: HTMLElement;
  viewerStateImageFields: HTMLDivElement;
  viewerStatePanoramaFields: HTMLDivElement;
  viewerStateDepthFields: HTMLDivElement;
  viewerStateZoomInput: HTMLInputElement;
  viewerStatePanXInput: HTMLInputElement;
  viewerStatePanYInput: HTMLInputElement;
  viewerStateYawInput: HTMLInputElement;
  viewerStatePitchInput: HTMLInputElement;
  viewerStateHfovInput: HTMLInputElement;
  viewerStateDepthChannelSelect: HTMLSelectElement;
  viewerStateDepthFocalInput: HTMLInputElement;
  viewerStateDepthYawInput: HTMLInputElement;
  viewerStateDepthPitchInput: HTMLInputElement;
  viewerStateDepthZoomInput: HTMLInputElement;
  viewerStateDepthPointSizeInput: HTMLInputElement;
  spectrumLatticeCanvas: HTMLCanvasElement;
  glCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  probeOverlayCanvas: HTMLCanvasElement;
  rulerOverlaySvg: SVGSVGElement;
  rulerLabelOverlay: HTMLDivElement;
  viewerPaneOverlay: HTMLDivElement;
  screenshotSelectionOverlay: HTMLDivElement;
  screenshotSelectionMaskTop: HTMLDivElement;
  screenshotSelectionMaskRight: HTMLDivElement;
  screenshotSelectionMaskBottom: HTMLDivElement;
  screenshotSelectionMaskLeft: HTMLDivElement;
  screenshotSelectionMaskSvg: SVGSVGElement;
  screenshotSelectionMaskPath: SVGElement;
  screenshotSelectionGuideVertical: HTMLDivElement;
  screenshotSelectionGuideHorizontal: HTMLDivElement;
  screenshotSelectionRegions: HTMLDivElement;
  screenshotSelectionBox: HTMLDivElement;
  screenshotSelectionSize: HTMLDivElement;
  screenshotSelectionControls: HTMLDivElement;
  screenshotSelectionAddButton: HTMLButtonElement;
  screenshotSelectionFitButton: HTMLButtonElement;
  screenshotSelectionDeleteButton: HTMLButtonElement;
  screenshotSelectionCancelButton: HTMLButtonElement;
  screenshotSelectionExportButton: HTMLButtonElement;
  screenshotSelectionExportBatchButton: HTMLButtonElement;
}

export type OpenedImagesPanelElements = Pick<
  Elements,
  | 'openedImagesSelect'
  | 'openedFilesFilterInput'
  | 'openedFilesList'
  | 'openedFilesCount'
  | 'viewerContainer'
  | 'displayCacheControl'
  | 'displayCacheBudgetInput'
  | 'displayCacheUsage'
  | 'reloadAllOpenedImagesButton'
  | 'closeAllOpenedImagesButton'
>;

export type ChannelThumbnailStripElements = Pick<Elements, 'channelThumbnailStrip' | 'viewerContainer'>;

export type ColormapPanelElements = Pick<
  Elements,
  | 'colormapRangeControl'
  | 'colormapSelect'
  | 'colormapExposureSlider'
  | 'colormapExposureValue'
  | 'colormapGammaSlider'
  | 'colormapGammaValue'
  | 'stokesDegreeModulationControl'
  | 'stokesDegreeModulationButton'
  | 'stokesAolpModulationModeControl'
  | 'stokesAolpModulationValueButton'
  | 'stokesAolpModulationSaturationButton'
  | 'colormapRangeResetLabel'
  | 'colormapZeroCenterButton'
  | 'colormapReverseButton'
  | 'colormapRangeSlider'
  | 'colormapVminSlider'
  | 'colormapVmaxSlider'
  | 'colormapVminInput'
  | 'colormapVmaxInput'
  | 'exposureControl'
  | 'exposureSlider'
  | 'exposureValue'
  | 'gammaSlider'
  | 'gammaValue'
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
  | 'exportDialogTitle'
  | 'exportDialogSubtitle'
  | 'exportFilenameFieldLabel'
  | 'exportFilenameInput'
  | 'exportFormatSelect'
  | 'exportCompressionInput'
  | 'exportSizeField'
  | 'exportSizeFieldLabel'
  | 'exportWidthFieldLabel'
  | 'exportHeightFieldLabel'
  | 'exportWidthInput'
  | 'exportHeightInput'
  | 'exportReproductionMetadataField'
  | 'exportReproductionMetadataCheckbox'
  | 'exportPreviewStage'
  | 'exportPreviewCanvas'
  | 'exportPreviewStatus'
  | 'exportProgress'
  | 'exportProgressBar'
  | 'exportProgressLabel'
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
  | 'exportBatchUseOpenFilesNamesCheckbox'
  | 'exportBatchCompressionInput'
  | 'exportBatchSizeField'
  | 'exportBatchSizeFieldLabel'
  | 'exportBatchWidthFieldLabel'
  | 'exportBatchHeightFieldLabel'
  | 'exportBatchWidthInput'
  | 'exportBatchHeightInput'
  | 'exportBatchReproductionMetadataField'
  | 'exportBatchReproductionMetadataCheckbox'
  | 'exportBatchSelectAllButton'
  | 'exportBatchDeselectAllButton'
  | 'exportBatchSplitToggleButton'
  | 'exportBatchMatrix'
  | 'exportBatchDialogStatus'
  | 'exportBatchProgress'
  | 'exportBatchProgressBar'
  | 'exportBatchProgressLabel'
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
  | 'exportColormapCompressionInput'
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

export type MetadataDialogElements = Pick<
  Elements,
  | 'appMetadataButton'
  | 'metadataDialogBackdrop'
  | 'metadataDialog'
  | 'metadataDialogCloseButton'
>;

export type ProbeReadoutElements = Pick<
  Elements,
  | 'probeMode'
  | 'probeCoords'
  | 'probeColorPreview'
  | 'probeColorSwatch'
  | 'probeColorValues'
>;

export type SpectralPlotPanelElements = Pick<
  Elements,
  | 'spectralPanel'
  | 'spectralEmptyState'
  | 'spectralPlot'
>;

export type MetadataPanelElements = Pick<Elements, 'metadataEmptyState' | 'metadataTable'>;

export type ImageStatsPanelElements = Pick<
  Elements,
  | 'imageStatsEmptyState'
  | 'imageStatsLoadingState'
  | 'imageStatsTable'
>;

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

export type ViewerStatePanelElements = Pick<
  Elements,
  | 'viewerStateEmptyState'
  | 'viewerStateImageFields'
  | 'viewerStatePanoramaFields'
  | 'viewerStateDepthFields'
  | 'viewerStateZoomInput'
  | 'viewerStatePanXInput'
  | 'viewerStatePanYInput'
  | 'viewerStateYawInput'
  | 'viewerStatePitchInput'
  | 'viewerStateHfovInput'
  | 'viewerStateDepthChannelSelect'
  | 'viewerStateDepthFocalInput'
  | 'viewerStateDepthYawInput'
  | 'viewerStateDepthPitchInput'
  | 'viewerStateDepthZoomInput'
  | 'viewerStateDepthPointSizeInput'
>;

export type GlobalKeyboardControllerElements = Pick<
  Elements,
  | 'appMenuBar'
  | 'imagePanelResizer'
  | 'rightPanelResizer'
  | 'bottomPanelResizer'
  | 'openedFilesList'
  | 'channelThumbnailStrip'
>;

export type DragDropElements = Pick<Elements, 'viewerContainer' | 'dropOverlay'>;

export type CollapsibleSectionsElements = Pick<
  Elements,
  | 'openedFilesToggle'
  | 'openedFilesList'
  | 'displayControlToggle'
  | 'displayControlContent'
  | 'imageStatsToggle'
  | 'imageStatsContent'
  | 'viewerStateToggle'
  | 'viewerStateContent'
  | 'probeToggle'
  | 'probeContent'
  | 'spectralToggle'
  | 'spectralContent'
  | 'roiToggle'
  | 'roiContent'
>;

export function resolveElements(): Elements {
  return {
    appShell: requireElement('app', HTMLElement),
    appMenuBar: requireElement('app-menu-bar', HTMLElement),
    appAutoFitImageButton: requireElement('app-auto-fit-image-button', HTMLButtonElement),
    appAutoExposureButton: requireElement('app-auto-exposure-button', HTMLButtonElement),
    appInvalidValueWarningButton: requireElement('app-invalid-value-warning-button', HTMLButtonElement),
    appScreenshotButton: requireElement('app-screenshot-button', HTMLButtonElement),
    appMetadataButton: requireElement('app-metadata-button', HTMLButtonElement),
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
    metadataDialogBackdrop: requireElement('metadata-dialog-backdrop', HTMLDivElement),
    metadataDialog: requireElement('metadata-dialog', HTMLElement),
    metadataDialogCloseButton: requireElement('metadata-dialog-close-button', HTMLButtonElement),
    themeSelect: requireElement('theme-select', HTMLSelectElement),
    spectrumLatticeMotionSelect: requireElement('spectrum-lattice-motion-select', HTMLSelectElement),
    spectralRgbGroupingCheckbox: requireElement('spectral-rgb-grouping-checkbox', HTMLInputElement),
    imageLoadWorkersInput: requireElement('image-load-workers-input', HTMLInputElement),
    autoExposurePercentileInput: requireElement('auto-exposure-percentile-input', HTMLInputElement),
    stokesInvalidVectorMaskCheckbox: requireElement('stokes-invalid-vector-mask-checkbox', HTMLInputElement),
    stokesDefaultSettingsTable: requireElement('stokes-default-settings-table', HTMLTableElement),
    resetSettingsButton: requireElement('reset-settings-button', HTMLButtonElement),
    imageViewerMenuItem: requireElement('image-viewer-menu-item', HTMLButtonElement),
    panoramaViewerMenuItem: requireElement('panorama-viewer-menu-item', HTMLButtonElement),
    depthViewerMenuItem: requireElement('depth-viewer-menu-item', HTMLButtonElement),
    rulersMenuItem: requireElement('rulers-menu-item', HTMLButtonElement),
    windowNormalMenuItem: requireElement('window-normal-menu-item', HTMLButtonElement),
    windowFullScreenPreviewMenuItem: requireElement('window-full-screen-preview-menu-item', HTMLButtonElement),
    windowSinglePaneMenuItem: requireElement('window-single-pane-menu-item', HTMLButtonElement),
    windowSplitVerticalMenuItem: requireElement('window-split-vertical-menu-item', HTMLButtonElement),
    windowSplitHorizontalMenuItem: requireElement('window-split-horizontal-menu-item', HTMLButtonElement),
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
    exportDialogTitle: requireElement('export-dialog-title', HTMLElement),
    exportDialogSubtitle: requireElement('export-dialog-subtitle', HTMLElement),
    exportFilenameFieldLabel: requireElement('export-filename-field-label', HTMLElement),
    exportFilenameInput: requireElement('export-filename-input', HTMLInputElement),
    exportFormatSelect: requireElement('export-format-select', HTMLSelectElement),
    exportCompressionInput: requireElement('export-compression-input', HTMLInputElement),
    exportSizeField: requireElement('export-size-field', HTMLDivElement),
    exportSizeFieldLabel: requireElement('export-size-field-label', HTMLElement),
    exportWidthFieldLabel: requireElement('export-width-field-label', HTMLElement),
    exportHeightFieldLabel: requireElement('export-height-field-label', HTMLElement),
    exportWidthInput: requireElement('export-width-input', HTMLInputElement),
    exportHeightInput: requireElement('export-height-input', HTMLInputElement),
    exportReproductionMetadataField: requireElement('export-reproduction-metadata-field', HTMLElement),
    exportReproductionMetadataCheckbox: requireElement('export-reproduction-metadata-checkbox', HTMLInputElement),
    exportPreviewStage: requireElement('export-preview-stage', HTMLDivElement),
    exportPreviewCanvas: requireElement('export-preview-canvas', HTMLCanvasElement),
    exportPreviewStatus: requireElement('export-preview-status', HTMLElement),
    exportProgress: requireElement('export-progress', HTMLDivElement),
    exportProgressBar: requireElement('export-progress-bar', HTMLProgressElement),
    exportProgressLabel: requireElement('export-progress-label', HTMLElement),
    exportDialogError: requireElement('export-dialog-error', HTMLElement),
    exportDialogCancelButton: requireElement('export-dialog-cancel-button', HTMLButtonElement),
    exportDialogSubmitButton: requireElement('export-dialog-submit-button', HTMLButtonElement),
    exportBatchDialogBackdrop: requireElement('export-batch-dialog-backdrop', HTMLDivElement),
    exportBatchDialogForm: requireElement('export-batch-dialog-form', HTMLFormElement),
    exportBatchDialogTitle: requireElement('export-batch-dialog-title', HTMLElement),
    exportBatchDialogSubtitle: requireElement('export-batch-dialog-subtitle', HTMLElement),
    exportBatchArchiveFilenameInput: requireElement('export-batch-archive-filename-input', HTMLInputElement),
    exportBatchUseOpenFilesNamesCheckbox: requireElement(
      'export-batch-use-open-files-names-checkbox',
      HTMLInputElement
    ),
    exportBatchCompressionInput: requireElement('export-batch-compression-input', HTMLInputElement),
    exportBatchSizeField: requireElement('export-batch-size-field', HTMLDivElement),
    exportBatchSizeFieldLabel: requireElement('export-batch-size-field-label', HTMLElement),
    exportBatchWidthFieldLabel: requireElement('export-batch-width-field-label', HTMLElement),
    exportBatchHeightFieldLabel: requireElement('export-batch-height-field-label', HTMLElement),
    exportBatchWidthInput: requireElement('export-batch-width-input', HTMLInputElement),
    exportBatchHeightInput: requireElement('export-batch-height-input', HTMLInputElement),
    exportBatchReproductionMetadataField: requireElement('export-batch-reproduction-metadata-field', HTMLElement),
    exportBatchReproductionMetadataCheckbox: requireElement(
      'export-batch-reproduction-metadata-checkbox',
      HTMLInputElement
    ),
    exportBatchSelectAllButton: requireElement('export-batch-select-all-button', HTMLButtonElement),
    exportBatchDeselectAllButton: requireElement('export-batch-deselect-all-button', HTMLButtonElement),
    exportBatchSplitToggleButton: requireElement('export-batch-split-toggle-button', HTMLButtonElement),
    exportBatchMatrix: requireElement('export-batch-matrix', HTMLElement),
    exportBatchDialogStatus: requireElement('export-batch-dialog-status', HTMLElement),
    exportBatchProgress: requireElement('export-batch-progress', HTMLDivElement),
    exportBatchProgressBar: requireElement('export-batch-progress-bar', HTMLProgressElement),
    exportBatchProgressLabel: requireElement('export-batch-progress-label', HTMLElement),
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
    exportColormapCompressionInput: requireElement('export-colormap-compression-input', HTMLInputElement),
    exportColormapPreviewStage: requireElement('export-colormap-preview-stage', HTMLDivElement),
    exportColormapPreviewCanvas: requireElement('export-colormap-preview-canvas', HTMLCanvasElement),
    exportColormapPreviewStatus: requireElement('export-colormap-preview-status', HTMLElement),
    exportColormapFilenameInput: requireElement('export-colormap-filename-input', HTMLInputElement),
    exportColormapDialogError: requireElement('export-colormap-dialog-error', HTMLElement),
    exportColormapDialogCancelButton: requireElement('export-colormap-dialog-cancel-button', HTMLButtonElement),
    exportColormapDialogSubmitButton: requireElement('export-colormap-dialog-submit-button', HTMLButtonElement),
    displayControlHeading: requireElement('display-control-heading', HTMLHeadingElement),
    displayControlToggle: requireElement('display-control-toggle', HTMLButtonElement),
    displayControlContent: requireElement('display-control-content', HTMLDivElement),
    colormapRangeControl: requireElement('colormap-range-control', HTMLDivElement),
    colormapSelect: requireElement('colormap-select', HTMLSelectElement),
    colormapExposureSlider: requireElement('colormap-exposure-slider', HTMLInputElement),
    colormapExposureValue: requireElement('colormap-exposure-value', HTMLInputElement),
    colormapGammaSlider: requireElement('colormap-gamma-slider', HTMLInputElement),
    colormapGammaValue: requireElement('colormap-gamma-value', HTMLInputElement),
    stokesDegreeModulationControl: requireElement('stokes-degree-modulation-control', HTMLDivElement),
    stokesDegreeModulationButton: requireElement('stokes-degree-modulation-button', HTMLButtonElement),
    stokesAolpModulationModeControl: requireElement('stokes-aolp-modulation-mode-control', HTMLDivElement),
    stokesAolpModulationValueButton: requireElement('stokes-aolp-modulation-value-button', HTMLButtonElement),
    stokesAolpModulationSaturationButton: requireElement('stokes-aolp-modulation-saturation-button', HTMLButtonElement),
    colormapRangeResetLabel: requireElement('colormap-range-reset-label', HTMLSpanElement),
    colormapZeroCenterButton: requireElement('colormap-zero-center-button', HTMLInputElement),
    colormapReverseButton: requireElement('colormap-reverse-button', HTMLInputElement),
    colormapRangeSlider: requireElement('colormap-range-slider', HTMLDivElement),
    colormapVminSlider: requireElement('colormap-vmin-slider', HTMLInputElement),
    colormapVmaxSlider: requireElement('colormap-vmax-slider', HTMLInputElement),
    colormapVminInput: requireElement('colormap-vmin-input', HTMLInputElement),
    colormapVmaxInput: requireElement('colormap-vmax-input', HTMLInputElement),
    exposureControl: requireElement('exposure-control', HTMLDivElement),
    exposureSlider: requireElement('exposure-slider', HTMLInputElement),
    exposureValue: requireElement('exposure-value', HTMLInputElement),
    gammaSlider: requireElement('gamma-slider', HTMLInputElement),
    gammaValue: requireElement('gamma-value', HTMLInputElement),
    errorBanner: requireElement('error-banner', HTMLDivElement),
    viewerContainer: requireElement('viewer-container', HTMLElement),
    viewerContextMenu: requireElement('viewer-context-menu', HTMLDivElement),
    viewerContextCopyImageButton: requireElement('viewer-context-copy-image-button', HTMLButtonElement),
    dropOverlay: requireElement('drop-overlay', HTMLDivElement),
    loadingOverlay: requireElement('loading-overlay', HTMLDivElement),
    openedImagesSelect: requireElement('opened-images-select', HTMLSelectElement),
    openedFilesToggle: requireElement('opened-files-toggle', HTMLButtonElement),
    openedFilesFilterInput: requireElement('opened-files-filter-input', HTMLInputElement),
    openedFilesList: requireElement('opened-files-list', HTMLElement),
    openedFilesCount: requireElement('opened-files-count', HTMLElement),
    displayCacheControl: requireElement('display-cache-control', HTMLDivElement),
    displayCacheBudgetInput: requireElement('display-cache-budget-input', HTMLSelectElement),
    displayCacheUsage: requireElement('display-cache-usage', HTMLElement),
    reloadAllOpenedImagesButton: requireElement('reload-all-opened-images-button', HTMLButtonElement),
    closeAllOpenedImagesButton: requireElement('close-all-opened-images-button', HTMLButtonElement),
    imageStatsToggle: requireElement('image-stats-toggle', HTMLButtonElement),
    imageStatsContent: requireElement('image-stats-content', HTMLDivElement),
    imageStatsEmptyState: requireElement('image-stats-empty-state', HTMLElement),
    imageStatsLoadingState: requireElement('image-stats-loading-state', HTMLElement),
    imageStatsTable: requireElement('image-stats-table', HTMLElement),
    probeMode: requireElement('probe-mode', HTMLElement),
    probeCoords: requireElement('probe-coords', HTMLElement),
    probeColorPreview: requireElement('probe-color-preview', HTMLDivElement),
    probeColorSwatch: requireElement('probe-color-swatch', HTMLElement),
    probeColorValues: requireElement('probe-color-values', HTMLElement),
    probeToggle: requireElement('probe-toggle', HTMLButtonElement),
    probeContent: requireElement('probe-content', HTMLDivElement),
    spectralPanel: requireElement('spectral-panel', HTMLElement),
    spectralToggle: requireElement('spectral-toggle', HTMLButtonElement),
    spectralContent: requireElement('spectral-content', HTMLDivElement),
    spectralEmptyState: requireElement('spectral-empty-state', HTMLElement),
    spectralPlot: requireElement('spectral-plot', HTMLElement),
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
    viewerStateToggle: requireElement('viewer-state-toggle', HTMLButtonElement),
    viewerStateContent: requireElement('viewer-state-content', HTMLDivElement),
    viewerStateEmptyState: requireElement('viewer-state-empty-state', HTMLElement),
    viewerStateImageFields: requireElement('viewer-state-image-fields', HTMLDivElement),
    viewerStatePanoramaFields: requireElement('viewer-state-panorama-fields', HTMLDivElement),
    viewerStateDepthFields: requireElement('viewer-state-depth-fields', HTMLDivElement),
    viewerStateZoomInput: requireElement('viewer-state-zoom-input', HTMLInputElement),
    viewerStatePanXInput: requireElement('viewer-state-pan-x-input', HTMLInputElement),
    viewerStatePanYInput: requireElement('viewer-state-pan-y-input', HTMLInputElement),
    viewerStateYawInput: requireElement('viewer-state-yaw-input', HTMLInputElement),
    viewerStatePitchInput: requireElement('viewer-state-pitch-input', HTMLInputElement),
    viewerStateHfovInput: requireElement('viewer-state-hfov-input', HTMLInputElement),
    viewerStateDepthChannelSelect: requireElement('viewer-state-depth-channel-select', HTMLSelectElement),
    viewerStateDepthFocalInput: requireElement('viewer-state-depth-focal-input', HTMLInputElement),
    viewerStateDepthYawInput: requireElement('viewer-state-depth-yaw-input', HTMLInputElement),
    viewerStateDepthPitchInput: requireElement('viewer-state-depth-pitch-input', HTMLInputElement),
    viewerStateDepthZoomInput: requireElement('viewer-state-depth-zoom-input', HTMLInputElement),
    viewerStateDepthPointSizeInput: requireElement('viewer-state-depth-point-size-input', HTMLInputElement),
    spectrumLatticeCanvas: requireElement('spectrum-lattice-canvas', HTMLCanvasElement),
    glCanvas: requireElement('gl-canvas', HTMLCanvasElement),
    overlayCanvas: requireElement('overlay-canvas', HTMLCanvasElement),
    probeOverlayCanvas: requireElement('probe-overlay-canvas', HTMLCanvasElement),
    rulerOverlaySvg: requireElement('ruler-overlay-svg', SVGSVGElement),
    rulerLabelOverlay: requireElement('ruler-label-overlay', HTMLDivElement),
    viewerPaneOverlay: requireElement('viewer-pane-overlay', HTMLDivElement),
    screenshotSelectionOverlay: requireElement('screenshot-selection-overlay', HTMLDivElement),
    screenshotSelectionMaskTop: requireElement('screenshot-selection-mask-top', HTMLDivElement),
    screenshotSelectionMaskRight: requireElement('screenshot-selection-mask-right', HTMLDivElement),
    screenshotSelectionMaskBottom: requireElement('screenshot-selection-mask-bottom', HTMLDivElement),
    screenshotSelectionMaskLeft: requireElement('screenshot-selection-mask-left', HTMLDivElement),
    screenshotSelectionMaskSvg: requireElement('screenshot-selection-mask-svg', SVGSVGElement),
    screenshotSelectionMaskPath: requireElement('screenshot-selection-mask-path', SVGElement),
    screenshotSelectionGuideVertical: requireElement('screenshot-selection-guide-vertical', HTMLDivElement),
    screenshotSelectionGuideHorizontal: requireElement('screenshot-selection-guide-horizontal', HTMLDivElement),
    screenshotSelectionRegions: requireElement('screenshot-selection-regions', HTMLDivElement),
    screenshotSelectionBox: requireElement('screenshot-selection-box', HTMLDivElement),
    screenshotSelectionSize: requireElement('screenshot-selection-size', HTMLDivElement),
    screenshotSelectionControls: requireElement('screenshot-selection-controls', HTMLDivElement),
    screenshotSelectionAddButton: requireElement('screenshot-selection-add-button', HTMLButtonElement),
    screenshotSelectionFitButton: requireElement('screenshot-selection-fit-button', HTMLButtonElement),
    screenshotSelectionDeleteButton: requireElement('screenshot-selection-delete-button', HTMLButtonElement),
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
