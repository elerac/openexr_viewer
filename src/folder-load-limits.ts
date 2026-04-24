export interface FolderLoadLimits {
  maxFileCount: number;
  maxTotalBytes: number;
}

export interface FolderLoadStats {
  exrFileCount: number;
  totalBytes: number;
  partial: boolean;
}

export interface FolderLoadAdmission {
  stats: FolderLoadStats;
  exceeded: boolean;
  reasons: string[];
}

export const DEFAULT_FOLDER_LOAD_LIMITS: FolderLoadLimits = {
  maxFileCount: 250,
  maxTotalBytes: 2 * 1024 * 1024 * 1024
};

export function isExrFilename(filename: string): boolean {
  return /\.exr$/i.test(filename.trim());
}

export function getFolderFileSortKey(file: File): string {
  const relativePath = file.webkitRelativePath.trim();
  return relativePath || file.name;
}

export function getFolderExrFiles(files: File[]): File[] {
  return files
    .filter((file) => isExrFilename(file.name))
    .sort((left, right) => getFolderFileSortKey(left).localeCompare(getFolderFileSortKey(right)));
}

export function getFolderLoadStats(files: File[], partial = false): FolderLoadStats {
  let exrFileCount = 0;
  let totalBytes = 0;

  for (const file of files) {
    if (!isExrFilename(file.name)) {
      continue;
    }

    exrFileCount += 1;
    totalBytes += file.size;
  }

  return {
    exrFileCount,
    totalBytes,
    partial
  };
}

export function createFolderLoadAdmission(
  stats: FolderLoadStats,
  limits: FolderLoadLimits = DEFAULT_FOLDER_LOAD_LIMITS
): FolderLoadAdmission {
  const reasons: string[] = [];
  if (stats.exrFileCount > limits.maxFileCount) {
    reasons.push(`${stats.exrFileCount} EXR files exceeds the ${limits.maxFileCount} file limit`);
  }
  if (stats.totalBytes > limits.maxTotalBytes) {
    reasons.push(`${formatByteCount(stats.totalBytes)} exceeds the ${formatByteCount(limits.maxTotalBytes)} byte limit`);
  }

  return {
    stats,
    exceeded: reasons.length > 0,
    reasons
  };
}

export function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
