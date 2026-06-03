import initRawWasm, { initSync, readExr, type ExrDecoder } from './vendor/exrs_raw_wasm_bindgen.js';
import wasmUrl from './vendor/exrs_raw_wasm_bindgen_bg.wasm?url';

let initialized = false;
let initializing: Promise<void> | null = null;
let configuredWasmUrl: string | null = null;

export function configureExrRuntime(options: { wasmUrl?: string | null }): void {
  configuredWasmUrl = normalizeConfiguredWasmUrl(options.wasmUrl);
}

export function resolveExrRuntimeWasmUrl(
  assetUrl: string = wasmUrl,
  baseUrl: string = import.meta.url
): string {
  return new URL(assetUrl, baseUrl).href;
}

export async function decodeRawExr(bytes: Uint8Array): Promise<ExrDecoder> {
  await ensureInitialized();
  return readExr(bytes);
}

async function ensureInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  if (initializing) {
    await initializing;
    return;
  }

  initializing = (async () => {
    try {
      await initRawWasm({ module_or_path: getWasmModuleUrl() });
    } catch (error) {
      if (isBrowserRuntime()) {
        throw error;
      }

      const wasmBytes = await loadNodeWasmBytes();
      initSync({ module: wasmBytes });
    }

    initialized = true;
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

function getWasmModuleUrl(): string {
  return configuredWasmUrl ?? resolveExrRuntimeWasmUrl();
}

function normalizeConfiguredWasmUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isBrowserRuntime(): boolean {
  if (typeof window !== 'undefined') {
    return true;
  }

  if (typeof self === 'undefined') {
    return false;
  }

  const workerLikeSelf = self as unknown as {
    fetch?: unknown;
    location?: { href?: unknown };
    navigator?: unknown;
  };
  return typeof workerLikeSelf.fetch === 'function' &&
    typeof workerLikeSelf.location?.href === 'string' &&
    typeof workerLikeSelf.navigator !== 'undefined';
}

async function loadNodeWasmBytes(): Promise<Uint8Array> {
  const fsModuleSpecifier = 'node:fs/promises';
  const { readFile } = await import(/* @vite-ignore */ fsModuleSpecifier);
  return await readFile(new URL('./vendor/exrs_raw_wasm_bindgen_bg.wasm', import.meta.url));
}
