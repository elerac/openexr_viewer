import type {
  DesktopCommandError,
  DesktopCommandId,
  DesktopErrorCode,
  DesktopFileBytes,
  DesktopFileEntry,
  DesktopRecentFile,
  ExportFileSaveOptions,
  ExportSaveResult
} from './types';

export const VSCODE_BRIDGE_CHANNEL = 'prismifold:vscode' as const;

export interface VscodeBridgeBinaryPayload {
  encoding: 'base64';
  data: string;
  byteLength: number;
}

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

export type VscodeBridgeResponseValue<T extends VscodeBridgeRequest = VscodeBridgeRequest> =
  T extends { type: 'readExrFile' } ? DesktopFileBytes :
    T extends { type: 'resolveExrPaths' } ? DesktopFileEntry[] :
      T extends { type: 'listExrFolder' } ? DesktopFileEntry[] :
        T extends { type: 'openRecentFile' } ? DesktopFileEntry :
          T extends { type: 'openFilesDialog' } ? DesktopFileEntry[] :
            T extends { type: 'openFolderDialog' } ? DesktopFileEntry[] :
              T extends { type: 'saveBlob' } ? ExportSaveResult :
                T extends { type: 'refreshRecentFiles' } ? DesktopRecentFile[] :
                  T extends { type: 'clearRecentFiles' } ? null :
                    T extends { type: 'recordRecentFile' } ? null :
                      T extends { type: 'recordPathLoadFailure' } ? null :
                        never;

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

export function isVscodeBridgeExtensionMessage(value: unknown): value is VscodeBridgeExtensionMessage {
  if (!isRecord(value) || value.channel !== VSCODE_BRIDGE_CHANNEL) {
    return false;
  }
  return value.type === 'response' || value.type === 'openEntries' || value.type === 'desktopCommand';
}

export function encodeBytesForVscodeBridge(bytes: Uint8Array): VscodeBridgeBinaryPayload {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return {
    encoding: 'base64',
    data: btoa(binary),
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
    const binary = atob(value.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }
  throw new Error('Received invalid binary data from VS Code.');
}

export function isVscodeBridgeResponseMessage(value: unknown): value is VscodeBridgeResponseMessage {
  return isRecord(value) &&
    value.channel === VSCODE_BRIDGE_CHANNEL &&
    value.type === 'response' &&
    typeof value.id === 'number' &&
    typeof value.ok === 'boolean';
}

export function isVscodeBridgeWebviewMessage(value: unknown): value is VscodeBridgeWebviewMessage {
  if (!isRecord(value) || value.channel !== VSCODE_BRIDGE_CHANNEL) {
    return false;
  }
  return value.type === 'ready' || value.type === 'request' || value.type === 'commandState';
}

export function createVscodeBridgeErrorPayload(error: unknown, fallbackMessage = 'VS Code bridge request failed.'): VscodeBridgeErrorPayload {
  if (error instanceof Error) {
    const commandError = error as DesktopCommandError;
    return {
      message: error.message || fallbackMessage,
      ...(commandError.code ? { code: commandError.code } : {})
    };
  }
  return {
    message: typeof error === 'string' && error.trim() ? error : fallbackMessage
  };
}

export function createVscodeBridgeError(payload: VscodeBridgeErrorPayload): DesktopCommandError {
  const error = new Error(payload.message) as DesktopCommandError;
  if (payload.code) {
    error.code = payload.code;
  }
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
