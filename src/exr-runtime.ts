import initRawWasm, { initSync, readExr, type ExrDecoder } from './vendor/exrs_raw_wasm_bindgen.js';
import wasmUrl from './vendor/exrs_raw_wasm_bindgen_bg.wasm?url';

let initialized = false;
let initializing: Promise<void> | null = null;

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
      await initRawWasm({ module_or_path: wasmUrl });
    } catch (error) {
      if (typeof window !== 'undefined') {
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

async function loadNodeWasmBytes(): Promise<Uint8Array> {
  const fsModuleSpecifier = 'node:fs/promises';
  const { readFile } = await import(/* @vite-ignore */ fsModuleSpecifier);
  return await readFile(new URL('./vendor/exrs_raw_wasm_bindgen_bg.wasm', import.meta.url));
}
