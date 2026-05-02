export interface OpenedImageOptionItem {
  id: string;
  label: string;
  sizeBytes?: number | null;
  sourceDetail?: string;
  thumbnailDataUrl?: string | null;
  thumbnailAspectRatio?: number | null;
  thumbnailLoading?: boolean;
  selectable?: boolean;
}

export interface LayerOptionItem {
  index: number;
  label: string;
  channelCount?: number;
  selectable?: boolean;
}
