import type {
  DisplaySelection as DisplaySelectionModel,
  StokesDegreeModulationState
} from './display-model';
import type { ChannelStorage, FiniteValueRange } from './channel-storage';

export type VisualizationMode = 'rgb' | 'colormap';
export type ColormapRangeMode = 'alwaysAuto' | 'oneTime';
export type ViewerMode = 'image' | 'panorama';
export type OpenedImageDropPlacement = 'before' | 'after';

export type {
  ChannelMonoSelection,
  ChannelRgbSelection,
  ChannelSelection,
  DisplaySelection,
  RgbSuffix,
  StokesAngleParameter,
  StokesAngleSelection,
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
  activeLayer: number;
  displaySelection: DisplaySelectionModel | null;
  lockedPixel: ImagePixel | null;
}

export interface ViewerInteractionState {
  view: ViewerViewState;
  hoveredPixel: ImagePixel | null;
}

export interface ViewerRenderState extends ViewerSessionState {
  hoveredPixel: ImagePixel | null;
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
  fileSizeBytes: number | null;
  source: SessionSource;
  decoded: DecodedExrImage;
  state: ViewerSessionState;
}

export interface ViewportInfo {
  width: number;
  height: number;
}

export type ExportImageFormat = 'png';

export interface ExportImageRequest {
  filename: string;
  format: ExportImageFormat;
  width: number;
  height: number;
}

export interface ExportImageTarget {
  filename: string;
  sourceWidth: number;
  sourceHeight: number;
}
