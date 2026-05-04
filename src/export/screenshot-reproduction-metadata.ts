import { cloneDisplayLuminanceRange } from '../colormap-range';
import { cloneDisplaySelection } from '../display-model';
import {
  cloneScreenshotRegionCrop,
  getScreenshotRegionCropSize,
  type ScreenshotRegionCrop
} from './screenshot-region';
import type {
  ExportScreenshotRegion,
  OpenedImageSession,
  PngCompressionLevel,
  ViewerState,
} from '../types';

const SCREENSHOT_REPRODUCTION_METADATA_SCHEMA_VERSION = 2;
const APP_NAME = 'openexr-viewer';

export interface ScreenshotReproductionMetadataBatchContext {
  archiveFilename: string;
  sessionId: string;
  channelLabel: string;
  outputFilename: string;
  regionIndex?: number;
  regionLabel?: string;
  regionCount?: number;
}

export interface BuildScreenshotReproductionMetadataArgs {
  pngFilename: string;
  jsonFilename?: string;
  pngCompressionLevel?: PngCompressionLevel;
  region: ExportScreenshotRegion;
  session: OpenedImageSession;
  renderState: ViewerState;
  createdAt?: string;
  batch?: ScreenshotReproductionMetadataBatchContext;
}

export interface ScreenshotReproductionMetadataV2 {
  schemaVersion: 2;
  app: {
    name: string;
  };
  export: {
    mode: 'screenshot';
    format: 'png';
    pngFilename: string;
    jsonFilename: string;
    pngCompressionLevel: PngCompressionLevel | null;
    createdAt: string;
    batch?: ScreenshotReproductionMetadataBatchContext;
  };
  screenshot: {
    crop: ScreenshotRegionCrop;
    outputWidth: number;
    outputHeight: number;
    outputScale: {
      x: number;
      y: number;
    };
  };
  viewer: {
    viewerMode: ViewerState['viewerMode'];
    zoom: number;
    panX: number;
    panY: number;
    panoramaYawDeg: number;
    panoramaPitchDeg: number;
    panoramaHfovDeg: number;
  };
  sourceImage: {
    sessionId: string;
    filename: string;
    displayName: string;
    source: {
      kind: OpenedImageSession['source']['kind'];
      detail: string | null;
    };
    fileSizeBytes: number | null;
    width: number;
    height: number;
  };
  display: {
    activeLayer: number;
    layerName: string | null;
    displaySelection: ViewerState['displaySelection'];
    visualizationMode: ViewerState['visualizationMode'];
    exposureEv: number;
    displayGamma: number;
    activeColormapId: string;
    colormapRange: ViewerState['colormapRange'];
    colormapRangeMode: ViewerState['colormapRangeMode'];
    colormapZeroCentered: boolean;
    stokesDegreeModulation: ViewerState['stokesDegreeModulation'];
    stokesAolpDegreeModulationMode: ViewerState['stokesAolpDegreeModulationMode'];
  };
}

export function buildScreenshotReproductionMetadata({
  pngFilename,
  jsonFilename = buildReproductionMetadataFilename(pngFilename),
  pngCompressionLevel,
  region,
  session,
  renderState,
  createdAt = new Date().toISOString(),
  batch
}: BuildScreenshotReproductionMetadataArgs): ScreenshotReproductionMetadataV2 {
  const layer = session.decoded.layers[renderState.activeLayer] ?? null;
  return {
    schemaVersion: SCREENSHOT_REPRODUCTION_METADATA_SCHEMA_VERSION,
    app: {
      name: APP_NAME
    },
    export: {
      mode: 'screenshot',
      format: 'png',
      pngFilename,
      jsonFilename,
      pngCompressionLevel: pngCompressionLevel ?? null,
      createdAt,
      ...(batch ? { batch: { ...batch } } : {})
    },
    screenshot: {
      crop: cloneScreenshotRegionCrop(region),
      outputWidth: region.outputWidth,
      outputHeight: region.outputHeight,
      outputScale: {
        x: region.outputWidth / getScreenshotRegionCropSize(region).width,
        y: region.outputHeight / getScreenshotRegionCropSize(region).height
      }
    },
    viewer: {
      viewerMode: renderState.viewerMode,
      zoom: renderState.zoom,
      panX: renderState.panX,
      panY: renderState.panY,
      panoramaYawDeg: renderState.panoramaYawDeg,
      panoramaPitchDeg: renderState.panoramaPitchDeg,
      panoramaHfovDeg: renderState.panoramaHfovDeg
    },
    sourceImage: {
      sessionId: session.id,
      filename: session.filename,
      displayName: session.displayName,
      source: resolveSourceIdentity(session),
      fileSizeBytes: session.fileSizeBytes,
      width: session.decoded.width,
      height: session.decoded.height
    },
    display: {
      activeLayer: renderState.activeLayer,
      layerName: layer?.name ?? null,
      displaySelection: cloneDisplaySelection(renderState.displaySelection),
      visualizationMode: renderState.visualizationMode,
      exposureEv: renderState.exposureEv,
      displayGamma: renderState.displayGamma,
      activeColormapId: renderState.activeColormapId,
      colormapRange: cloneDisplayLuminanceRange(renderState.colormapRange),
      colormapRangeMode: renderState.colormapRangeMode,
      colormapZeroCentered: renderState.colormapZeroCentered,
      stokesDegreeModulation: { ...renderState.stokesDegreeModulation },
      stokesAolpDegreeModulationMode: renderState.stokesAolpDegreeModulationMode
    }
  };
}

export function buildReproductionMetadataFilename(pngFilename: string): string {
  return /\.png$/i.test(pngFilename)
    ? pngFilename.replace(/\.png$/i, '.json')
    : `${pngFilename}.json`;
}

export function serializeScreenshotReproductionMetadata(metadata: ScreenshotReproductionMetadataV2): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

function resolveSourceIdentity(session: OpenedImageSession): ScreenshotReproductionMetadataV2['sourceImage']['source'] {
  if (session.source.kind === 'url') {
    return {
      kind: 'url',
      detail: session.source.url
    };
  }

  const relativePath = session.source.file.webkitRelativePath.trim();
  return {
    kind: 'file',
    detail: relativePath || session.source.file.name || session.filename || null
  };
}
