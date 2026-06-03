export const VSCODE_BRIDGE_CHANNEL = 'prismifold:vscode';

export interface VscodeBridgeBinaryPayload {
  encoding: 'base64';
  data: string;
  byteLength: number;
}

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

export interface DesktopFileBytes {
  grantId: string;
  bytes: Uint8Array;
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

export type VscodeBridgeRequest =
  | {
      type: 'readExrFile';
      grantId: string;
    }
  | {
      type: 'resolveExrPaths';
      paths: string[];
    }
  | {
      type: 'listExrFolder';
      path: string;
    }
  | {
      type: 'openRecentFile';
      path: string;
    }
  | {
      type: 'openFilesDialog';
    }
  | {
      type: 'openFolderDialog';
    }
  | {
      type: 'saveBlob';
      options: ExportFileSaveOptions;
      bytes: VscodeBridgeBinaryPayload;
    }
  | {
      type: 'refreshRecentFiles';
    }
  | {
      type: 'clearRecentFiles';
    }
  | {
      type: 'recordRecentFile';
      grantId: string;
    }
  | {
      type: 'recordPathLoadFailure';
      entry: DesktopFileEntry;
      errorMessage: string;
    };

export interface VscodeBridgeErrorPayload {
  message: string;
  code?: DesktopErrorCode;
}

export interface VscodeBridgeReadyMessage {
  channel: typeof VSCODE_BRIDGE_CHANNEL;
  type: 'ready';
}

export interface VscodeBridgeRequestMessage {
  channel: typeof VSCODE_BRIDGE_CHANNEL;
  type: 'request';
  id: number;
  request: VscodeBridgeRequest;
}

export interface VscodeBridgeResponseMessage {
  channel: typeof VSCODE_BRIDGE_CHANNEL;
  type: 'response';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: VscodeBridgeErrorPayload;
}

export interface VscodeBridgeOpenEntriesMessage {
  channel: typeof VSCODE_BRIDGE_CHANNEL;
  type: 'openEntries';
  entries: DesktopFileEntry[];
}

export interface VscodeBridgeDesktopCommandMessage {
  channel: typeof VSCODE_BRIDGE_CHANNEL;
  type: 'desktopCommand';
  commandId: DesktopCommandId;
}

export interface VscodeBridgeCommandStateMessage {
  channel: typeof VSCODE_BRIDGE_CHANNEL;
  type: 'commandState';
  state: Partial<Record<DesktopCommandId, boolean>>;
}

export type VscodeBridgeWebviewMessage =
  | VscodeBridgeReadyMessage
  | VscodeBridgeRequestMessage
  | VscodeBridgeCommandStateMessage;

export type VscodeBridgeExtensionMessage =
  | VscodeBridgeResponseMessage
  | VscodeBridgeOpenEntriesMessage
  | VscodeBridgeDesktopCommandMessage;

export function isVscodeBridgeWebviewMessage(value: unknown): value is VscodeBridgeWebviewMessage {
  if (!isRecord(value) || value.channel !== VSCODE_BRIDGE_CHANNEL) {
    return false;
  }
  return value.type === 'ready' || value.type === 'request' || value.type === 'commandState';
}

export function createDesktopCommandMessage(commandId: DesktopCommandId): VscodeBridgeDesktopCommandMessage {
  return {
    channel: VSCODE_BRIDGE_CHANNEL,
    type: 'desktopCommand',
    commandId
  };
}

export function createOpenEntriesMessage(entries: DesktopFileEntry[]): VscodeBridgeOpenEntriesMessage {
  return {
    channel: VSCODE_BRIDGE_CHANNEL,
    type: 'openEntries',
    entries
  };
}

export function createResponseMessage(
  id: number,
  result: { ok: true; value: unknown } | { ok: false; error: VscodeBridgeErrorPayload }
): VscodeBridgeResponseMessage {
  return {
    channel: VSCODE_BRIDGE_CHANNEL,
    type: 'response',
    id,
    ...result
  };
}

export function encodeBytesForVscodeBridge(bytes: Uint8Array): VscodeBridgeBinaryPayload {
  return {
    encoding: 'base64',
    data: Buffer.from(bytes).toString('base64'),
    byteLength: bytes.byteLength
  };
}

export function decodeBytesFromVscodeBridge(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  if (isRecord(value) && value.encoding === 'base64' && typeof value.data === 'string') {
    return new Uint8Array(Buffer.from(value.data, 'base64'));
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }
  throw new Error('Received invalid binary data from Prismifold webview.');
}

export function createErrorPayload(error: unknown): VscodeBridgeErrorPayload {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: string };
    const code = normalizeDesktopErrorCode(candidate.code);
    return {
      message: error.message || 'VS Code bridge request failed.',
      ...(code ? { code } : {})
    };
  }
  return {
    message: typeof error === 'string' && error.trim() ? error : 'VS Code bridge request failed.'
  };
}

function normalizeDesktopErrorCode(code: string | undefined): VscodeBridgeErrorPayload['code'] | undefined {
  switch (code) {
    case 'notFound':
    case 'notFile':
    case 'notExr':
    case 'permissionDenied':
    case 'tooLarge':
    case 'folderLimit':
    case 'invalidOutput':
    case 'cancelled':
    case 'io':
      return code;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
