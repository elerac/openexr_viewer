import { DisposableBag, type Disposable } from '../lifecycle';
import type { DragDropElements } from './elements';

interface FileSystemHandleLike {
  kind: 'file' | 'directory';
  name: string;
}

interface FileSystemFileHandleLike extends FileSystemHandleLike {
  kind: 'file';
  getFile: () => Promise<File>;
}

interface FileSystemDirectoryHandleLike extends FileSystemHandleLike {
  kind: 'directory';
  values: () => AsyncIterable<FileSystemHandleLike>;
}

interface LegacyFileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface LegacyFileSystemFileEntryLike extends LegacyFileSystemEntryLike {
  isFile: true;
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
}

interface LegacyFileSystemDirectoryReaderLike {
  readEntries: (
    success: (entries: LegacyFileSystemEntryLike[]) => void,
    error?: (error: DOMException) => void
  ) => void;
}

interface LegacyFileSystemDirectoryEntryLike extends LegacyFileSystemEntryLike {
  isDirectory: true;
  createReader: () => LegacyFileSystemDirectoryReaderLike;
}

interface DirectoryAwareDataTransferItem extends DataTransferItem {
  getAsEntry?: () => LegacyFileSystemEntryLike | null;
  getAsFileSystemHandle?: () => Promise<FileSystemHandleLike | null>;
  webkitGetAsEntry?: () => LegacyFileSystemEntryLike | null;
}

interface ResolvedDroppedFiles {
  files: File[];
  containsDirectory: boolean;
}

interface CapturedDroppedFileSystemHandle {
  handles: Promise<FileSystemHandleLike | null>[];
}

interface CapturedDroppedEntries {
  entries: Array<LegacyFileSystemEntryLike | null>;
}

interface DragDropControllerCallbacks {
  onFolderSelected: (files: File[]) => void;
  onFilesDropped: (files: File[]) => void;
}

export class DragDropController implements Disposable {
  private readonly disposables = new DisposableBag();
  private disposed = false;

  constructor(
    private readonly elements: DragDropElements,
    private readonly callbacks: DragDropControllerCallbacks
  ) {
    this.disposables.addEventListener(window, 'dragover', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });

    this.disposables.addEventListener(window, 'drop', (event) => {
      void this.handleDropEvent(event);
    });

    this.disposables.addEventListener(this.elements.viewerContainer, 'dragover', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      this.showOverlay(true);
    });

    this.disposables.addEventListener(this.elements.viewerContainer, 'dragleave', (event) => {
      if (!hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();

      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && this.elements.viewerContainer.contains(nextTarget)) {
        return;
      }
      this.showOverlay(false);
    });

    this.disposables.addEventListener(this.elements.viewerContainer, 'drop', (event) => {
      void this.handleDropEvent(event, true);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  showOverlay(show: boolean): void {
    this.elements.dropOverlay.classList.toggle('hidden', !show);
  }

  private async handleDropEvent(event: DragEvent, stopPropagation = false): Promise<void> {
    if (!hasDroppedFiles(event)) {
      return;
    }

    event.preventDefault();
    if (stopPropagation) {
      event.stopPropagation();
    }
    this.showOverlay(false);

    const { files, containsDirectory } = await resolveDroppedFiles(event.dataTransfer);
    if (files.length === 0) {
      return;
    }

    if (containsDirectory) {
      this.callbacks.onFolderSelected(files);
      return;
    }

    this.callbacks.onFilesDropped(files);
  }
}

function hasDroppedFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes('Files');
}

function toFiles(files: FileList | null | undefined): File[] {
  if (!files) {
    return [];
  }
  return Array.from(files);
}

async function resolveDroppedFiles(dataTransfer: DataTransfer | null | undefined): Promise<ResolvedDroppedFiles> {
  if (!dataTransfer) {
    return {
      files: [],
      containsDirectory: false
    };
  }

  const fallbackFiles = toFiles(dataTransfer.files);
  const items = Array.from(dataTransfer.items ?? []) as DirectoryAwareDataTransferItem[];
  if (items.length > 0) {
    const capturedHandles = captureDroppedHandlePromises(items);
    const capturedEntries = captureDroppedEntries(items);

    if (capturedHandles) {
      try {
        const handleResolved = await resolveDroppedFilesFromCapturedHandles(capturedHandles);
        if (handleResolved) {
          return handleResolved;
        }
      } catch {
        // Fall through to entry/plain-file resolution.
      }
    }

    if (capturedEntries) {
      try {
        const entryResolved = await resolveDroppedFilesFromCapturedEntries(capturedEntries);
        if (entryResolved) {
          return entryResolved;
        }
      } catch {
        // Fall through to plain-file resolution.
      }
    }
  }

  return {
    files: fallbackFiles,
    containsDirectory: false
  };
}

function captureDroppedHandlePromises(
  items: DirectoryAwareDataTransferItem[]
): CapturedDroppedFileSystemHandle | null {
  const fileItems = items.filter((item) => item.kind === 'file');
  if (fileItems.length === 0 || !fileItems.every((item) => typeof item.getAsFileSystemHandle === 'function')) {
    return null;
  }

  // getAsFileSystemHandle() must be called synchronously during the drop event turn.
  return {
    handles: fileItems.map((item) => item.getAsFileSystemHandle!())
  };
}

async function resolveDroppedFilesFromCapturedHandles(
  captured: CapturedDroppedFileSystemHandle
): Promise<ResolvedDroppedFiles | null> {
  const handles = await Promise.all(captured.handles);
  const files: File[] = [];
  let containsDirectory = false;

  for (const handle of handles) {
    if (!handle) {
      continue;
    }

    if (handle.kind === 'file') {
      files.push(await (handle as FileSystemFileHandleLike).getFile());
      continue;
    }

    containsDirectory = true;
    files.push(...await collectFilesFromDirectoryHandle(handle as FileSystemDirectoryHandleLike, handle.name));
  }

  return {
    files,
    containsDirectory
  };
}

async function collectFilesFromDirectoryHandle(
  directory: FileSystemDirectoryHandleLike,
  relativePrefix: string
): Promise<File[]> {
  const files: File[] = [];

  for await (const handle of directory.values()) {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandleLike).getFile();
      files.push(withRelativePath(file, `${relativePrefix}/${file.name}`));
      continue;
    }

    files.push(...await collectFilesFromDirectoryHandle(
      handle as FileSystemDirectoryHandleLike,
      `${relativePrefix}/${handle.name}`
    ));
  }

  return files;
}

function captureDroppedEntries(items: DirectoryAwareDataTransferItem[]): CapturedDroppedEntries | null {
  const fileItems = items.filter((item) => item.kind === 'file');
  if (fileItems.length === 0) {
    return null;
  }

  const entries = fileItems.map((item) => getDroppedEntry(item));
  if (entries.every((entry) => entry === null)) {
    return null;
  }

  return {
    entries
  };
}

async function resolveDroppedFilesFromCapturedEntries(
  captured: CapturedDroppedEntries
): Promise<ResolvedDroppedFiles | null> {
  const files: File[] = [];
  let containsDirectory = false;

  for (const entry of captured.entries) {
    if (!entry) {
      continue;
    }

    if (entry.isDirectory) {
      containsDirectory = true;
      files.push(...await collectFilesFromLegacyEntry(
        entry as LegacyFileSystemDirectoryEntryLike,
        entry.name
      ));
      continue;
    }

    files.push(...await collectFilesFromLegacyEntry(
      entry as LegacyFileSystemFileEntryLike,
      null
    ));
  }

  return {
    files,
    containsDirectory
  };
}

function getDroppedEntry(item: DirectoryAwareDataTransferItem): LegacyFileSystemEntryLike | null {
  if (typeof item.getAsEntry === 'function') {
    return item.getAsEntry();
  }

  if (typeof item.webkitGetAsEntry === 'function') {
    return item.webkitGetAsEntry();
  }

  return null;
}

async function collectFilesFromLegacyEntry(
  entry: LegacyFileSystemFileEntryLike | LegacyFileSystemDirectoryEntryLike,
  relativePath: string | null
): Promise<File[]> {
  if (entry.isFile) {
    const file = await getFileFromLegacyEntry(entry);
    return [relativePath ? withRelativePath(file, relativePath) : file];
  }

  const entries = await readAllLegacyDirectoryEntries(entry);
  const files: File[] = [];

  for (const child of entries) {
    const childRelativePath = relativePath ? `${relativePath}/${child.name}` : child.name;
    files.push(...await collectFilesFromLegacyEntry(
      child as LegacyFileSystemFileEntryLike | LegacyFileSystemDirectoryEntryLike,
      childRelativePath
    ));
  }

  return files;
}

function getFileFromLegacyEntry(entry: LegacyFileSystemFileEntryLike): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllLegacyDirectoryEntries(
  directory: LegacyFileSystemDirectoryEntryLike
): Promise<LegacyFileSystemEntryLike[]> {
  const reader = directory.createReader();
  const entries: LegacyFileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<LegacyFileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

function withRelativePath(file: File, relativePath: string): File {
  const normalizedPath = relativePath.trim();
  if (!normalizedPath) {
    return file;
  }

  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: normalizedPath
    });
    return file;
  } catch {
    const clonedFile = new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified
    });
    Object.defineProperty(clonedFile, 'webkitRelativePath', {
      configurable: true,
      value: normalizedPath
    });
    return clonedFile;
  }
}
