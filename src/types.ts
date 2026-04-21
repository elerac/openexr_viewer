import type {
  DisplaySelection as DisplaySelectionModel,
  StokesDegreeModulationState
} from './display-model';
import type { InterleavedChannelStorage } from './channel-storage';

export type VisualizationMode = 'rgb' | 'colormap';
export type ColormapRangeMode = 'alwaysAuto' | 'oneTime';

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
  channelStorage: InterleavedChannelStorage;
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
  displaySelection: DisplaySelectionModel | null;
  hoveredPixel: ImagePixel | null;
  lockedPixel: ImagePixel | null;
}

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
  thumbnailDataUrl: string | null;
  thumbnailGenerationToken: number;
  thumbnailStateSnapshot: ViewerState;
  state: ViewerState;
  textureRevisionKey: string;
  displayTexture: Float32Array | null;
  displayLuminanceRangeRevisionKey: string;
  displayLuminanceRange: DisplayLuminanceRange | null;
  displayCachePinned: boolean;
  displayCacheLastTouched: number;
}

export interface ViewportInfo {
  width: number;
  height: number;
}
