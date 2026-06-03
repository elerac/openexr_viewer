import { tauriHost } from './tauri-host';
import { vscodeHost } from './vscode-host';
import { webHost } from './web-host';
import type { ViewerHost } from './types';

export function createViewerHost(): ViewerHost {
  if (import.meta.env.MODE === 'desktop') {
    return tauriHost;
  }
  if (import.meta.env.MODE === 'vscode') {
    return vscodeHost;
  }
  return webHost;
}

export type {
  AppFullscreenHost,
  DesktopCommandCallbacks,
  DesktopCommandError,
  DesktopCommandId,
  DesktopErrorCode,
  DesktopFileBytes,
  DesktopFileEntry,
  DesktopRecentFile,
  ExportFileSaveOptions,
  ExportSaveResult,
  ExportSink,
  PathFileProvider,
  ViewerHost
} from './types';

export {
  isStaleDesktopPathError,
  normalizeDesktopError,
  presentDesktopError
} from './desktop-errors';
