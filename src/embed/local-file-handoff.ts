import type { EmbedViewerStateSnapshot } from './embed-state';

export const EMBED_READY_MESSAGE = 'prismifold:embed-ready';
export const EMBED_LOAD_FILE_MESSAGE = 'prismifold:load-file';
export const EMBED_DEFERRED_LOAD_MESSAGE = 'prismifold:deferred-load';
export const LOCAL_HANDOFF_READY_MESSAGE = 'prismifold:local-handoff-ready';
export const LOCAL_HANDOFF_FILE_MESSAGE = 'prismifold:local-handoff-file';

const DB_NAME = 'prismifold-local-handoffs';
const STORE_NAME = 'handoffs';
const DB_VERSION = 1;
const HANDOFF_TTL_MS = 60 * 60 * 1000;

export interface EmbedReadyMessage {
  type: typeof EMBED_READY_MESSAGE;
}

export interface EmbedLoadFileMessage {
  type: typeof EMBED_LOAD_FILE_MESSAGE;
  file: File;
  name?: string;
  state?: EmbedViewerStateSnapshot | null;
}

export interface EmbedDeferredLoadMessage {
  type: typeof EMBED_DEFERRED_LOAD_MESSAGE;
}

export interface LocalFileHandoffReadyMessage {
  type: typeof LOCAL_HANDOFF_READY_MESSAGE;
  id: string;
}

export interface LocalFileHandoffFileMessage {
  type: typeof LOCAL_HANDOFF_FILE_MESSAGE;
  id: string;
  file: File;
  state: EmbedViewerStateSnapshot | null;
  name?: string;
}

interface StoredLocalFileHandoff {
  id: string;
  file: File;
  state: EmbedViewerStateSnapshot | null;
  name?: string;
  createdAt: number;
  expiresAt: number;
}

export function createLocalFileHandoffId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isEmbedLoadFileMessage(value: unknown): value is EmbedLoadFileMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === EMBED_LOAD_FILE_MESSAGE &&
    isFileLike(record.file) &&
    isOptionalString(record.name) &&
    isOptionalEmbedState(record.state);
}

export function isEmbedDeferredLoadMessage(value: unknown): value is EmbedDeferredLoadMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === EMBED_DEFERRED_LOAD_MESSAGE;
}

export function isLocalFileHandoffReadyMessage(value: unknown): value is LocalFileHandoffReadyMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === LOCAL_HANDOFF_READY_MESSAGE && typeof record.id === 'string';
}

export function isLocalFileHandoffFileMessage(value: unknown): value is LocalFileHandoffFileMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === LOCAL_HANDOFF_FILE_MESSAGE &&
    typeof record.id === 'string' &&
    isFileLike(record.file) &&
    isOptionalString(record.name);
}

export function postEmbedReady(target: Window = window.parent): void {
  if (target === window) {
    return;
  }
  target.postMessage({ type: EMBED_READY_MESSAGE } satisfies EmbedReadyMessage, '*');
}

export function postEmbedDeferredLoad(target: Window = window.parent): void {
  if (target === window) {
    return;
  }
  target.postMessage({ type: EMBED_DEFERRED_LOAD_MESSAGE } satisfies EmbedDeferredLoadMessage, '*');
}

export function startLocalFileHandoffSender(options: {
  targetWindow: Window;
  handoffId: string;
  file: File;
  state: EmbedViewerStateSnapshot | null;
  name?: string;
  targetOrigin?: string;
  timeoutMs?: number;
  onTimeout?: () => void;
}): () => void {
  const targetOrigin = options.targetOrigin ?? window.location.origin;
  let sent = false;
  const timeout = window.setTimeout(() => {
    if (!sent) {
      cleanup();
      options.onTimeout?.();
    }
  }, options.timeoutMs ?? 10_000);

  const cleanup = (): void => {
    window.clearTimeout(timeout);
    window.removeEventListener('message', onMessage);
  };

  const send = (): void => {
    sent = true;
    options.targetWindow.postMessage({
      type: LOCAL_HANDOFF_FILE_MESSAGE,
      id: options.handoffId,
      file: options.file,
      state: options.state,
      name: options.name
    } satisfies LocalFileHandoffFileMessage, targetOrigin);
    cleanup();
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== options.targetWindow) {
      return;
    }
    if (event.origin !== targetOrigin || !isLocalFileHandoffReadyMessage(event.data)) {
      return;
    }
    if (event.data.id !== options.handoffId) {
      return;
    }
    send();
  };

  window.addEventListener('message', onMessage);
  return cleanup;
}

export async function storeLocalFileHandoff(
  id: string,
  file: File,
  state: EmbedViewerStateSnapshot | null,
  name?: string
): Promise<void> {
  const db = await openHandoffDatabase();
  const now = Date.now();
  await runStoreRequest(db, 'readwrite', (store) => store.put({
    id,
    file,
    state,
    name,
    createdAt: now,
    expiresAt: now + HANDOFF_TTL_MS
  } satisfies StoredLocalFileHandoff));
  db.close();
}

export async function loadStoredLocalFileHandoff(id: string): Promise<LocalFileHandoffFileMessage | null> {
  const db = await openHandoffDatabase();
  const stored = await runStoreRequest<StoredLocalFileHandoff | undefined>(
    db,
    'readonly',
    (store) => store.get(id)
  );
  db.close();
  if (!stored || stored.expiresAt <= Date.now()) {
    return null;
  }
  return {
    type: LOCAL_HANDOFF_FILE_MESSAGE,
    id: stored.id,
    file: stored.file,
    state: stored.state,
    name: stored.name
  };
}

export async function deleteExpiredLocalFileHandoffs(now = Date.now()): Promise<void> {
  const db = await openHandoffDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error('Failed to scan local file handoffs.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }
      const value = cursor.value as StoredLocalFileHandoff;
      if (value.expiresAt <= now) {
        cursor.delete();
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to delete local file handoffs.'));
  }).finally(() => db.close());
}

async function openHandoffDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available.');
  }
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open local file handoff database.'));
  });
}

function runStoreRequest<T = unknown>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local file handoff request failed.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Local file handoff transaction failed.'));
  });
}

function isFileLike(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalEmbedState(value: unknown): value is EmbedViewerStateSnapshot | null | undefined {
  return value === undefined ||
    value === null ||
    (typeof value === 'object' && !Array.isArray(value));
}
