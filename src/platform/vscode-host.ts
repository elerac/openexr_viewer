import type { Disposable } from '../lifecycle';
import {
  VSCODE_BRIDGE_CHANNEL,
  createVscodeBridgeError,
  decodeBytesFromVscodeBridge,
  encodeBytesForVscodeBridge,
  isVscodeBridgeExtensionMessage,
  isVscodeBridgeResponseMessage,
  type VscodeBridgeDesktopCommandMessage,
  type VscodeBridgeOpenEntriesMessage,
  type VscodeBridgeRequest,
  type VscodeBridgeRequestMessage,
  type VscodeBridgeResponseMessage,
  type VscodeBridgeResponseValue
} from './vscode-bridge';
import type {
  DesktopCommandCallbacks,
  DesktopEventCallbacks,
  DesktopFileBytes,
  DesktopFileEntry,
  DesktopRecentFile,
  ExportFileSaveOptions,
  ExportSaveResult,
  HostOpenFileOptions,
  HostOpenFolderOptions,
  RecentFileCallbacks,
  ViewerHost
} from './types';

interface VscodeWebviewApi {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VscodeWebviewApi;
  }
}

let cachedApi: VscodeWebviewApi | null = null;
let nextRequestId = 1;
let responseListenerInstalled = false;
const pendingRequests = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}>();

function getApi(): VscodeWebviewApi {
  if (cachedApi) {
    return cachedApi;
  }
  if (typeof window.acquireVsCodeApi !== 'function') {
    throw new Error('VS Code webview API is unavailable.');
  }
  cachedApi = window.acquireVsCodeApi();
  return cachedApi;
}

function normalizeEntry(entry: DesktopFileEntry): DesktopFileEntry {
  return {
    grantId: entry.grantId,
    path: entry.path,
    filename: entry.filename,
    ...(entry.displayPath ? { displayPath: entry.displayPath } : {}),
    ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
    fileSizeBytes: entry.fileSizeBytes
  };
}

function normalizeEntries(entries: DesktopFileEntry[]): DesktopFileEntry[] {
  return entries.map(normalizeEntry);
}

function postReady(): void {
  getApi().postMessage({
    channel: VSCODE_BRIDGE_CHANNEL,
    type: 'ready'
  });
}

async function requestExtension<T extends VscodeBridgeRequest>(
  request: T
): Promise<VscodeBridgeResponseValue<T>> {
  ensureResponseListener();
  const id = nextRequestId++;
  const message: VscodeBridgeRequestMessage = {
    channel: VSCODE_BRIDGE_CHANNEL,
    type: 'request',
    id,
    request
  };

  const promise = new Promise<unknown>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
  });
  getApi().postMessage(message);
  return await promise as VscodeBridgeResponseValue<T>;
}

function ensureResponseListener(): void {
  if (responseListenerInstalled) {
    return;
  }
  responseListenerInstalled = true;
  window.addEventListener('message', (event) => {
    if (isVscodeBridgeResponseMessage(event.data)) {
      handleResponse(event.data);
    }
  });
}

function handleResponse(message: VscodeBridgeResponseMessage): void {
  const pending = pendingRequests.get(message.id);
  if (!pending) {
    return;
  }
  pendingRequests.delete(message.id);
  if (message.ok) {
    pending.resolve(message.value);
    return;
  }
  pending.reject(createVscodeBridgeError(message.error ?? { message: 'VS Code bridge request failed.' }));
}

function addBridgeMessageListener(
  listener: (message: VscodeBridgeOpenEntriesMessage | VscodeBridgeDesktopCommandMessage) => void
): Disposable {
  const onMessage = (event: MessageEvent): void => {
    const message = event.data;
    if (isVscodeBridgeResponseMessage(message)) {
      handleResponse(message);
      return;
    }
    if (!isVscodeBridgeExtensionMessage(message)) {
      return;
    }
    if (message.type === 'openEntries' || message.type === 'desktopCommand') {
      listener(message);
    }
  };

  window.addEventListener('message', onMessage);
  return {
    dispose: () => {
      window.removeEventListener('message', onMessage);
    }
  };
}

const vscodePathFileProvider = {
  async readExrFile(grantId: string): Promise<DesktopFileBytes> {
    const file = await requestExtension({ type: 'readExrFile', grantId });
    return {
      grantId: file.grantId,
      bytes: decodeBytesFromVscodeBridge(file.bytes)
    };
  },
  async listExrFolder(path: string): Promise<DesktopFileEntry[]> {
    return normalizeEntries(await requestExtension({ type: 'listExrFolder', path }));
  },
  async resolveExrPaths(paths: string[]): Promise<DesktopFileEntry[]> {
    if (paths.length === 0) {
      return [];
    }
    return normalizeEntries(await requestExtension({ type: 'resolveExrPaths', paths }));
  },
  async openRecentFile(path: string): Promise<DesktopFileEntry> {
    return normalizeEntry(await requestExtension({ type: 'openRecentFile', path }));
  }
};

const vscodeAppFullscreenHost = {
  isSupported(): boolean {
    return typeof document.documentElement.requestFullscreen === 'function' &&
      typeof document.exitFullscreen === 'function';
  },
  isActive(): boolean {
    return document.fullscreenElement !== null;
  },
  async setActive(active: boolean): Promise<void> {
    if (active) {
      await document.documentElement.requestFullscreen();
      return;
    }
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
    }
  },
  async onChange(callback: () => void): Promise<Disposable> {
    document.addEventListener('fullscreenchange', callback);
    document.addEventListener('fullscreenerror', callback);
    return {
      dispose: () => {
        document.removeEventListener('fullscreenchange', callback);
        document.removeEventListener('fullscreenerror', callback);
      }
    };
  }
};

export const vscodeHost: ViewerHost = {
  kind: 'vscode',
  pathFileProvider: vscodePathFileProvider,
  appFullscreen: vscodeAppFullscreenHost,
  openFiles({ onEntries, onError }: HostOpenFileOptions): void {
    void requestExtension({ type: 'openFilesDialog' })
      .then((entries) => {
        if (entries.length > 0) {
          onEntries(normalizeEntries(entries));
        }
      })
      .catch((error) => {
        onError?.(error);
      });
  },
  openFolder({ onEntries, onError }: HostOpenFolderOptions): void {
    void requestExtension({ type: 'openFolderDialog' })
      .then((entries) => {
        if (entries.length > 0) {
          onEntries(normalizeEntries(entries));
        }
      })
      .catch((error) => {
        onError?.(error);
      });
  },
  async saveBlob(blob: Blob, options: ExportFileSaveOptions): Promise<ExportSaveResult> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return await requestExtension({
      type: 'saveBlob',
      options,
      bytes: encodeBytesForVscodeBridge(bytes)
    });
  },
  validateCopyPngBlob(): void {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Copying images to the clipboard is not supported by this VS Code webview.');
    }
    if (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports('image/png')) {
      throw new Error('Copying PNG images to the clipboard is not supported by this VS Code webview.');
    }
  },
  async copyPngBlob(blob: Blob): Promise<void> {
    this.validateCopyPngBlob?.();
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob
      })
    ]);
  },
  async setupDesktopEvents(callbacks: DesktopEventCallbacks): Promise<Disposable> {
    const listener = addBridgeMessageListener((message) => {
      if (message.type !== 'openEntries') {
        return;
      }
      const entries = normalizeEntries(message.entries);
      if (entries.length > 0) {
        callbacks.onEntries(entries);
      }
    });
    postReady();
    return listener;
  },
  async setupDesktopCommands(callbacks: DesktopCommandCallbacks): Promise<Disposable> {
    const listener = addBridgeMessageListener((message) => {
      if (message.type === 'desktopCommand') {
        callbacks.onCommand(message.commandId);
      }
    });
    const postCommandState = () => {
      getApi().postMessage({
        channel: VSCODE_BRIDGE_CHANNEL,
        type: 'commandState',
        state: callbacks.getCommandState?.() ?? {}
      });
    };
    window.addEventListener('prismifold:desktop-command-state-changed', postCommandState);
    postCommandState();
    return {
      dispose: () => {
        listener.dispose();
        window.removeEventListener('prismifold:desktop-command-state-changed', postCommandState);
      }
    };
  },
  installRecentFilesMenu(_callbacks: RecentFileCallbacks): Disposable {
    return { dispose: () => {} };
  },
  async refreshRecentFiles(): Promise<DesktopRecentFile[]> {
    return await requestExtension({ type: 'refreshRecentFiles' });
  },
  async clearRecentFiles(): Promise<void> {
    await requestExtension({ type: 'clearRecentFiles' });
  },
  recordRecentFile(entry: DesktopFileEntry): void {
    void requestExtension({ type: 'recordRecentFile', grantId: entry.grantId }).catch(() => {});
  },
  recordPathLoadFailure(entry: DesktopFileEntry, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : 'Path load failed.';
    void requestExtension({
      type: 'recordPathLoadFailure',
      entry,
      errorMessage
    }).catch(() => {});
  }
};
