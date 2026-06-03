import type { Disposable } from '../lifecycle';

export interface DesktopFileEntry {
  grantId: string;
  path: string;
  filename: string;
  displayPath?: string;
  relativePath?: string;
  fileSizeBytes: number;
}

export type DesktopErrorCode =
  | 'notFound'
  | 'notFile'
  | 'notExr'
  | 'permissionDenied'
  | 'tooLarge'
  | 'folderLimit'
  | 'invalidOutput'
  | 'cancelled'
  | 'io';

export interface DesktopCommandError extends Error {
  code?: DesktopErrorCode;
}

export interface DesktopFileBytes {
  grantId: string;
  bytes: Uint8Array;
}

export interface PathFileProvider {
  readExrFile(grantId: string, signal?: AbortSignal): Promise<DesktopFileBytes>;
  listExrFolder(path: string, signal?: AbortSignal): Promise<DesktopFileEntry[]>;
  resolveExrPaths(paths: string[], signal?: AbortSignal): Promise<DesktopFileEntry[]>;
  openRecentFile(path: string, signal?: AbortSignal): Promise<DesktopFileEntry>;
}

export interface ExportFileSaveOptions {
  filename: string;
  title?: string;
  extensions: string[];
}

export type ExportSaveResult =
  | {
      status: 'saved';
      path?: string;
    }
  | {
      status: 'cancelled';
    };

export interface ExportSink {
  saveBlob(blob: Blob, options: ExportFileSaveOptions): Promise<ExportSaveResult>;
  validateCopyPngBlob?(): void;
  copyPngBlob(blob: Blob): Promise<void>;
}

export interface HostOpenFileOptions {
  fallback: () => void;
  onEntries: (entries: DesktopFileEntry[]) => void;
  onError?: (error: DesktopCommandError) => void;
}

export interface HostOpenFolderOptions {
  fallback: () => void;
  onEntries: (entries: DesktopFileEntry[]) => void;
  onError?: (error: DesktopCommandError) => void;
}

export interface DesktopEventCallbacks {
  onEntries: (entries: DesktopFileEntry[]) => void;
  onDragStateChange?: (active: boolean) => void;
  onError?: (error: DesktopCommandError) => void;
}

export interface RecentFileCallbacks {
  onOpenEntry: (entry: DesktopFileEntry) => void;
  onError?: (error: DesktopCommandError) => void;
}

export interface DesktopRecentFile {
  path: string;
  label: string;
  displayPath: string;
  openedAt: number;
}

export type DesktopCommandId =
  | 'openFile'
  | 'openFolder'
  | 'exportImage'
  | 'exportScreenshot'
  | 'exportBatch'
  | 'exportColormap'
  | 'copyImage'
  | 'reloadAll'
  | 'closeAll'
  | 'settings'
  | 'metadata'
  | 'viewerModeImage'
  | 'viewerModePanorama'
  | 'viewerModeDepth'
  | 'toggleRulers'
  | 'windowPreviewNormal'
  | 'windowPreviewFullscreen'
  | 'paneReset'
  | 'paneSplitVertical'
  | 'paneSplitHorizontal'
  | 'toggleAppFullscreen'
  | 'clearRecentFiles';

export interface DesktopCommandCallbacks {
  onCommand: (commandId: DesktopCommandId) => void;
  onOpenRecent: (entry: DesktopFileEntry) => void;
  onError?: (error: DesktopCommandError) => void;
  getCommandState?: () => Partial<Record<DesktopCommandId, boolean>>;
}

export interface AppFullscreenHost {
  isSupported(): boolean;
  isActive(): boolean | Promise<boolean>;
  setActive(active: boolean): Promise<void>;
  onChange(callback: () => void): Promise<Disposable>;
}

export interface ViewerHost extends ExportSink {
  kind: 'web' | 'tauri' | 'vscode';
  pathFileProvider: PathFileProvider | null;
  appFullscreen: AppFullscreenHost;
  openFiles(options: HostOpenFileOptions): void;
  openFolder(options: HostOpenFolderOptions): void;
  setupDesktopEvents(callbacks: DesktopEventCallbacks): Promise<Disposable>;
  setupDesktopCommands(callbacks: DesktopCommandCallbacks): Promise<Disposable>;
  installRecentFilesMenu(callbacks: RecentFileCallbacks): Disposable;
  refreshRecentFiles(): Promise<DesktopRecentFile[]>;
  clearRecentFiles(): Promise<void>;
  recordRecentFile(entry: DesktopFileEntry): void;
  recordPathLoadFailure(entry: DesktopFileEntry, error: unknown): void;
}
