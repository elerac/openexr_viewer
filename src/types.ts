export const ZERO_CHANNEL = '__ZERO__';

export type VisualizationMode = 'rgb' | 'colormap';
export type ColormapRangeMode = 'alwaysAuto' | 'oneTime';

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
}

export interface DecodedExrImage {
  width: number;
  height: number;
  layers: DecodedLayer[];
}

export interface ViewerState {
  exposureEv: number;
  visualizationMode: VisualizationMode;
  activeColormapId: string;
  colormapRange: DisplayLuminanceRange | null;
  colormapRangeMode: ColormapRangeMode;
  colormapZeroCentered: boolean;
  zoom: number;
  panX: number;
  panY: number;
  activeLayer: number;
  displayR: string;
  displayG: string;
  displayB: string;
  hoveredPixel: ImagePixel | null;
  lockedPixel: ImagePixel | null;
}

export interface DisplayChannelMapping {
  displayR: string;
  displayG: string;
  displayB: string;
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
  source: SessionSource;
  decoded: DecodedExrImage;
  state: ViewerState;
  textureRevisionKey: string;
  displayTexture: Float32Array | null;
  displayLuminanceRange: DisplayLuminanceRange | null;
}

export interface ViewportInfo {
  width: number;
  height: number;
}
