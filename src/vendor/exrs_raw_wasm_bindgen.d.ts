/* tslint:disable */
/* eslint-disable */
/**
 * Write a single RGB layer to EXR bytes.
 *
 * This is a convenience function for simple single-layer images.
 * No `.free()` call is needed - the result is returned directly.
 *
 * # Arguments
 * * `width` - Image width in pixels
 * * `height` - Image height in pixels
 * * `layer_name` - Layer name (e.g., "normals")
 * * `data` - RGB pixel data as Float32Array, length must be width * height * 3
 * * `precision` - Sample precision (F16, F32, or U32)
 * * `compression` - Compression method
 */
export function writeExrRgb(width: number, height: number, layer_name: string | null | undefined, data: Float32Array, precision: SamplePrecision, compression: CompressionMethod): Uint8Array;
/**
 * Initialize panic hook for better error messages in browser console.
 * This is called automatically when the WASM module loads - no need to call manually.
 */
export function init_panic_hook(): void;
/**
 * Read an EXR file expecting RGBA channels.
 *
 * This is an optimized function that reads RGBA data directly into
 * interleaved format. Returns the first valid layer with RGBA channels.
 */
export function readExrRgba(data: Uint8Array): ExrSimpleImage;
/**
 * Write a single RGBA layer to EXR bytes.
 *
 * `data` must have length `width * height * 4`.
 */
export function writeExrRgba(width: number, height: number, layer_name: string | null | undefined, data: Float32Array, precision: SamplePrecision, compression: CompressionMethod): Uint8Array;
/**
 * Read an EXR file from bytes.
 */
export function readExr(data: Uint8Array): ExrDecoder;
/**
 * Read an EXR file expecting RGB channels.
 *
 * This is an optimized function that reads RGB data directly into
 * interleaved format. Returns the first valid layer with RGB channels.
 */
export function readExrRgb(data: Uint8Array): ExrSimpleImage;
/**
 * Compression method for EXR output.
 */
export enum CompressionMethod {
  /**
   * No compression - fastest, largest files
   */
  None = 0,
  /**
   * Run-length encoding - fast, good for flat areas
   */
  Rle = 1,
  /**
   * ZIP compression (single scanline) - slower, smaller files
   */
  Zip = 2,
  /**
   * ZIP compression (16 scanlines) - good balance
   */
  Zip16 = 3,
  /**
   * PIZ wavelet compression - best for noisy images
   */
  Piz = 4,
  /**
   * PXR24 - optimized for depth buffers (lossy for f32)
   */
  Pxr24 = 5,
}
/**
 * Sample precision for pixel data.
 */
export enum SamplePrecision {
  /**
   * 16-bit half float
   */
  F16 = 0,
  /**
   * 32-bit float (default)
   */
  F32 = 1,
  /**
   * 32-bit unsigned integer
   */
  U32 = 2,
}
/**
 * Decoder result from reading an EXR file.
 *
 * Contains metadata and pixel data for all layers and channels.
 */
export class ExrDecoder {
  private constructor();
  free(): void;
  /**
   * Get the name of a layer by index.
   * Returns null for the main/default layer (which has no name).
   */
  getLayerName(index: number): string | undefined;
  /**
   * Get interleaved pixel data for a layer.
   * Returns null if any of the required channels are missing or if the layer index is invalid.
   * Pixels are interleaved in the order specified by the provided channel names.
   */
  getLayerPixels(layer_index: number, channel_names: string[]): Float32Array | undefined;
  /**
   * Get the channel names for a layer.
   */
  getLayerChannelNames(layer_index: number): string[];
  /**
   * Number of layers in the image.
   */
  readonly layerCount: number;
  /**
   * Image width in pixels.
   */
  readonly width: number;
  /**
   * Image height in pixels.
   */
  readonly height: number;
}
/**
 * Encoder for creating multi-layer EXR images.
 *
 * Use this class to construct EXR files with multiple AOV layers
 * (beauty, depth, normals, etc.) from WebGL/WebGPU render buffers.
 */
export class ExrEncoder {
  free(): void;
  /**
   * Create a new EXR image builder.
   */
  constructor(width: number, height: number);
  /**
   * Encode the image to EXR bytes.
   *
   * Returns a Uint8Array containing the complete EXR file.
   */
  encode(): Uint8Array;
  /**
   * Add a new layer with the specified channels.
   * The `data` contains all pixels, each pixel with one float per channel.
   */
  addLayer(name: string | null | undefined, channel_names: string[], interleaved: Float32Array, precision: SamplePrecision, compression: CompressionMethod): void;
}
/**
 * Result of optimized RGB(A) reading.
 */
export class ExrSimpleImage {
  private constructor();
  free(): void;
  /**
   * Get the interleaved RGB pixel data as Float32Array.
   */
  readonly data: Float32Array;
  /**
   * Image width in pixels.
   */
  readonly width: number;
  /**
   * Image height in pixels.
   */
  readonly height: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_exrdecoder_free: (a: number, b: number) => void;
  readonly __wbg_exrencoder_free: (a: number, b: number) => void;
  readonly __wbg_exrsimpleimage_free: (a: number, b: number) => void;
  readonly exrdecoder_getLayerChannelNames: (a: number, b: number) => [number, number];
  readonly exrdecoder_getLayerName: (a: number, b: number) => [number, number];
  readonly exrdecoder_getLayerPixels: (a: number, b: number, c: number, d: number) => [number, number];
  readonly exrdecoder_height: (a: number) => number;
  readonly exrdecoder_layerCount: (a: number) => number;
  readonly exrdecoder_width: (a: number) => number;
  readonly exrencoder_addLayer: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
  readonly exrencoder_encode: (a: number) => [number, number, number, number];
  readonly exrencoder_new: (a: number, b: number) => number;
  readonly exrsimpleimage_data: (a: number) => [number, number];
  readonly exrsimpleimage_height: (a: number) => number;
  readonly exrsimpleimage_width: (a: number) => number;
  readonly init_panic_hook: () => void;
  readonly readExr: (a: number, b: number) => [number, number, number];
  readonly readExrRgb: (a: number, b: number) => [number, number, number];
  readonly readExrRgba: (a: number, b: number) => [number, number, number];
  readonly writeExrRgb: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly writeExrRgba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_3: WebAssembly.Table;
  readonly __externref_table_alloc: () => number;
  readonly __externref_drop_slice: (a: number, b: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
