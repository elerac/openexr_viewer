import type {
  DisplaySelection as DisplaySelectionModel,
  StokesAolpDegreeModulationMode,
  StokesDegreeModulationState
} from './display-model';
import type { ChannelStorage, FiniteValueRange } from './channel-storage';

export type VisualizationMode = 'rgb' | 'colormap';
export type ColormapRangeMode = 'alwaysAuto' | 'oneTime';
export type ViewerMode = 'image' | 'panorama';
export type OpenedImageDropPlacement = 'before' | 'after';
export type ViewerKeyboardNavigationDirection = 'up' | 'left' | 'down' | 'right';
export type ViewerKeyboardZoomDirection = 'in' | 'out';

export interface ViewerKeyboardNavigationInput {
  up: boolean;
  left: boolean;
  down: boolean;
  right: boolean;
}

export interface ViewerKeyboardZoomInput {
  zoomIn: boolean;
  zoomOut: boolean;
}

export type PanoramaKeyboardOrbitDirection = ViewerKeyboardNavigationDirection;
export type PanoramaKeyboardOrbitInput = ViewerKeyboardNavigationInput;

export type {
  ChannelMonoSelection,
  ChannelRgbSelection,
  ChannelSelection,
  DisplaySelection,
  RgbSuffix,
  StokesAngleParameter,
  StokesAngleSelection,
  StokesAolpDegreeModulationMode,
  StokesDegreeModulationParameter,
  StokesDegreeModulationState,
  StokesParameter,
  StokesScalarParameter,
  StokesScalarSelection,
  StokesSelection,
  StokesSource
} from './display-model';

export interface DisplayLuminanceRange {
  min: number;
  max: number;
}

export interface ImagePixel {
  ix: number;
  iy: number;
}

export interface ImageRoi {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StatsChannelSummary {
  label: string;
  min: number | null;
  mean: number | null;
  max: number | null;
  validPixelCount: number;
  nanPixelCount: number;
  negativeInfinityPixelCount: number;
  positiveInfinityPixelCount: number;
}

export type RoiStatsChannelSummary = StatsChannelSummary;
export type ImageStatsChannelSummary = StatsChannelSummary;

export interface RoiStats {
  roi: ImageRoi;
  width: number;
  height: number;
  pixelCount: number;
  channels: RoiStatsChannelSummary[];
}

export interface ImageStats {
  width: number;
  height: number;
  pixelCount: number;
  channels: ImageStatsChannelSummary[];
}

export interface DecodedLayer {
  name: string | null;
  channelNames: string[];
  channelStorage: ChannelStorage;
  analysis: DecodedLayerAnalysis;
  metadata?: ExrMetadataEntry[];
}

export interface DecodedLayerAnalysis {
  displayLuminanceRangeBySelectionKey: Record<string, DisplayLuminanceRange | null>;
  finiteRangeByChannel: Record<string, FiniteValueRange | null>;
}

export interface DecodedExrImage {
  width: number;
  height: number;
  layers: DecodedLayer[];
}

export interface ExrMetadataEntry {
  key: string;
  label: string;
  value: string;
}

export interface ViewerViewState {
  zoom: number;
  panX: number;
  panY: number;
  panoramaYawDeg: number;
  panoramaPitchDeg: number;
  panoramaHfovDeg: number;
}

export interface ViewerSessionState extends ViewerViewState {
  exposureEv: number;
  viewerMode: ViewerMode;
  visualizationMode: VisualizationMode;
  activeColormapId: string;
  colormapRange: DisplayLuminanceRange | null;
  colormapRangeMode: ColormapRangeMode;
  colormapZeroCentered: boolean;
  stokesDegreeModulation: StokesDegreeModulationState;
  stokesAolpDegreeModulationMode: StokesAolpDegreeModulationMode;
  activeLayer: number;
  displaySelection: DisplaySelectionModel | null;
  lockedPixel: ImagePixel | null;
  roi: ImageRoi | null;
}

export interface ViewerInteractionState {
  view: ViewerViewState;
  hoveredPixel: ImagePixel | null;
  draftRoi: ImageRoi | null;
}

export interface ViewerRenderState extends ViewerSessionState {
  hoveredPixel: ImagePixel | null;
  draftRoi: ImageRoi | null;
}

export type ViewerState = ViewerRenderState;

export interface DisplayChannelMapping {
  displayR: string;
  displayG: string;
  displayB: string;
  displayA?: string | null;
}

export interface PixelSample {
  x: number;
  y: number;
  values: Record<string, number>;
}

export type SessionSource =
  | {
      kind: 'url';
      url: string;
    }
  | {
      kind: 'file';
      file: File;
    };

export interface OpenedImageSession {
  id: string;
  filename: string;
  displayName: string;
  displayNameIsCustom?: boolean;
  fileSizeBytes: number | null;
  source: SessionSource;
  decoded: DecodedExrImage;
  state: ViewerSessionState;
}

export interface ViewportInfo {
  width: number;
  height: number;
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ExportImageFormat = 'png';
export type ExportColormapFormat = 'png';
export type ExportColormapOrientation = 'horizontal' | 'vertical';

export interface ExportScreenshotRegion {
  rect: ViewportRect;
  sourceViewport: ViewportInfo;
  outputWidth: number;
  outputHeight: number;
}

export interface ExportFullImageRequest {
  filename: string;
  format: ExportImageFormat;
  mode?: 'image';
}

export interface ExportScreenshotRequest extends ExportScreenshotRegion {
  filename: string;
  format: ExportImageFormat;
  mode: 'screenshot';
}

export type ExportImageRequest = ExportFullImageRequest | ExportScreenshotRequest;

export type ExportImagePreviewRequest =
  | { mode?: 'image' }
  | ({ mode: 'screenshot' } & ExportScreenshotRegion);

export interface ExportImageBatchBaseRequest {
  sessionId: string;
  activeLayer: number;
  displaySelection: DisplaySelectionModel;
  channelLabel: string;
}

export type ExportImageBatchPreviewRequest =
  ExportImageBatchBaseRequest &
  (
    | { mode?: 'image' }
    | ({ mode: 'screenshot' } & ExportScreenshotRegion)
  );

export type ExportImageBatchEntryRequest = ExportImageBatchPreviewRequest & {
  outputFilename: string;
};

export interface ExportImageBatchRequest {
  archiveFilename: string;
  entries: ExportImageBatchEntryRequest[];
  format: 'png-zip';
}

export interface ExportColormapRequest {
  colormapId: string;
  width: number;
  height: number;
  orientation: ExportColormapOrientation;
  filename: string;
  format: ExportColormapFormat;
}

export interface ExportColormapPreviewRequest {
  colormapId: string;
  width: number;
  height: number;
  orientation: ExportColormapOrientation;
}

export type ExportImageTarget =
  | {
      filename: string;
      kind?: 'image';
    }
  | ({
      filename: string;
      kind: 'screenshot';
    } & Pick<ExportScreenshotRegion, 'rect' | 'sourceViewport'> &
      Partial<Pick<ExportScreenshotRegion, 'outputWidth' | 'outputHeight'>>);

export interface ExportImageBatchChannelTarget {
  value: string;
  label: string;
  selectionKey: string;
  selection: DisplaySelectionModel;
  swatches: string[];
  mergedOrder: number | null;
  splitOrder: number | null;
}

export interface ExportImageBatchFileTarget {
  sessionId: string;
  filename: string;
  label: string;
  sourcePath: string;
  thumbnailDataUrl: string | null;
  activeLayer: number;
  displaySelection: DisplaySelectionModel | null;
  channels: ExportImageBatchChannelTarget[];
}

export interface ExportImageBatchTarget {
  archiveFilename: string;
  activeSessionId: string | null;
  files: ExportImageBatchFileTarget[];
}
