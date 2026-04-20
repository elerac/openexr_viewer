export const ZERO_CHANNEL = '__ZERO__';

export type VisualizationMode = 'rgb' | 'colormap';
export type ColormapRangeMode = 'alwaysAuto' | 'oneTime';
export type DisplaySourceKind = 'channels' | 'stokesScalar' | 'stokesRgb';
export type StokesParameter =
  | 'aolp'
  | 'dolp'
  | 'dop'
  | 'docp'
  | 'cop'
  | 'top'
  | 's1_over_s0'
  | 's2_over_s0'
  | 's3_over_s0';
export type StokesDegreeModulationParameter = 'aolp' | 'cop' | 'top';
export type StokesDegreeModulationState = Record<StokesDegreeModulationParameter, boolean>;

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
  channelData: Map<string, Float32Array>;
  metadata?: ExrMetadataEntry[];
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

export interface ViewerState {
  exposureEv: number;
  visualizationMode: VisualizationMode;
  activeColormapId: string;
  colormapRange: DisplayLuminanceRange | null;
  colormapRangeMode: ColormapRangeMode;
  colormapZeroCentered: boolean;
  stokesDegreeModulation: StokesDegreeModulationState;
  zoom: number;
  panX: number;
  panY: number;
  activeLayer: number;
  displaySource: DisplaySourceKind;
  stokesParameter: StokesParameter | null;
  displayR: string;
  displayG: string;
  displayB: string;
  displayA: string | null;
  hoveredPixel: ImagePixel | null;
  lockedPixel: ImagePixel | null;
}

export interface DisplayChannelMapping {
  displayR: string;
  displayG: string;
  displayB: string;
  displayA?: string | null;
}

export interface DisplaySelection extends DisplayChannelMapping {
  displaySource: DisplaySourceKind;
  stokesParameter: StokesParameter | null;
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
  thumbnailDataUrl: string | null;
  state: ViewerState;
  textureRevisionKey: string;
  displayTexture: Float32Array | null;
  displayLuminanceRange: DisplayLuminanceRange | null;
}

export interface ViewportInfo {
  width: number;
  height: number;
}
