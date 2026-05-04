import type {
  ExportImageScreenshotRegion,
  ExportScreenshotRegion,
  ExportViewportScreenshotRegion,
  ImageRect,
  ViewportRect
} from '../types';

export type ScreenshotRegionCrop =
  | Pick<ExportImageScreenshotRegion, 'coordinateSpace' | 'imageRect'>
  | Pick<ExportViewportScreenshotRegion, 'coordinateSpace' | 'rect' | 'sourceViewport'>;

export function isImageScreenshotRegion(
  region: ScreenshotRegionCrop
): region is Pick<ExportImageScreenshotRegion, 'coordinateSpace' | 'imageRect'> {
  return region.coordinateSpace === 'image';
}

export function isViewportScreenshotRegion(
  region: ScreenshotRegionCrop
): region is Pick<ExportViewportScreenshotRegion, 'coordinateSpace' | 'rect' | 'sourceViewport'> {
  return region.coordinateSpace === 'viewport';
}

export function cloneScreenshotRegionCrop(region: ScreenshotRegionCrop): ScreenshotRegionCrop {
  return isImageScreenshotRegion(region)
    ? {
        coordinateSpace: 'image',
        imageRect: { ...region.imageRect }
      }
    : {
        coordinateSpace: 'viewport',
        rect: { ...region.rect },
        sourceViewport: { ...region.sourceViewport }
      };
}

export function getScreenshotRegionCropRect(region: ScreenshotRegionCrop): ImageRect | ViewportRect {
  return isImageScreenshotRegion(region) ? region.imageRect : region.rect;
}

export function getScreenshotRegionCropSize(region: ScreenshotRegionCrop): { width: number; height: number } {
  const rect = getScreenshotRegionCropRect(region);
  return {
    width: rect.width,
    height: rect.height
  };
}

export function getScreenshotRegionAspectRatio(region: ScreenshotRegionCrop): number {
  const size = getScreenshotRegionCropSize(region);
  return size.width / Math.max(size.height, Number.EPSILON);
}

export function buildScaledScreenshotRegion(
  region: ExportScreenshotRegion,
  outputScale: number
): ExportScreenshotRegion {
  const cropSize = getScreenshotRegionCropSize(region);
  return {
    ...cloneScreenshotRegionCrop(region),
    outputWidth: Math.max(1, Math.round(cropSize.width * outputScale)),
    outputHeight: Math.max(1, Math.round(cropSize.height * outputScale))
  };
}

export function cloneScreenshotRegion(region: ExportScreenshotRegion): ExportScreenshotRegion {
  return {
    ...cloneScreenshotRegionCrop(region),
    outputWidth: region.outputWidth,
    outputHeight: region.outputHeight
  };
}

export function serializeScreenshotRegionCrop(region: ScreenshotRegionCrop): unknown {
  return isImageScreenshotRegion(region)
    ? {
        coordinateSpace: 'image',
        imageRect: region.imageRect
      }
    : {
        coordinateSpace: 'viewport',
        rect: region.rect,
        sourceViewport: region.sourceViewport
      };
}
