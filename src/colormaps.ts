import { DisplayLuminanceRange } from './types';

export interface ColormapAsset {
  label: string;
  file: string;
}

export interface ColormapManifest {
  colormaps: ColormapAsset[];
}

export interface ColormapOption {
  id: string;
  label: string;
}

export interface ColormapRegistry {
  defaultId: string;
  assets: ColormapAsset[];
  options: ColormapOption[];
}

export interface ColormapLut {
  id: string;
  label: string;
  entryCount: number;
  rgba8: Uint8Array;
}

interface ParsedNpyHeader {
  descr: string;
  fortranOrder: boolean;
  shape: number[];
}

interface ParsedDtype {
  kind: 'float32' | 'float64' | 'uint8';
  bytesPerComponent: number;
}

export const DEFAULT_COLORMAP_ID = createColormapId(0);

const COLORMAP_MANIFEST_PATH = 'colormaps/manifest.json';
const NPY_MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
const cache = new Map<string, Promise<ColormapLut>>();

export async function loadColormapRegistry(): Promise<ColormapRegistry> {
  const response = await fetch(resolvePublicAssetUrl(COLORMAP_MANIFEST_PATH));
  if (!response.ok) {
    throw new Error(`Failed to load ${COLORMAP_MANIFEST_PATH} (${response.status})`);
  }

  const registry = parseColormapManifest(await response.json());
  cache.clear();
  return registry;
}

export function parseColormapManifest(input: unknown): ColormapRegistry {
  if (!isRecord(input)) {
    throw new Error('Invalid colormap manifest: expected an object.');
  }

  const colormaps = input.colormaps;
  if (!Array.isArray(colormaps) || colormaps.length === 0) {
    throw new Error('Invalid colormap manifest: expected at least one colormap.');
  }

  const labels = new Set<string>();
  const assets = colormaps.map((entry, index): ColormapAsset => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid colormap manifest entry ${index}: expected an object.`);
    }

    const label = validateColormapLabel(entry.label, labels, index);
    const file = validateColormapFile(entry.file, index);
    return { label, file };
  });

  return {
    defaultId: DEFAULT_COLORMAP_ID,
    assets,
    options: assets.map((asset, index) => ({
      id: createColormapId(index),
      label: asset.label
    }))
  };
}

export function getColormapOptions(registry: ColormapRegistry): ColormapOption[] {
  return registry.options;
}

export function getColormapAsset(registry: ColormapRegistry, id: string): ColormapAsset | null {
  const index = parseColormapId(id);
  return index === null ? null : registry.assets[index] ?? null;
}

export async function loadColormapLut(registry: ColormapRegistry, id: string): Promise<ColormapLut> {
  const asset = getColormapAsset(registry, id);
  if (!asset) {
    throw new Error(`Unknown colormap "${id}".`);
  }

  const cacheKey = `${id}:${asset.file}`;
  let promise = cache.get(cacheKey);
  if (!promise) {
    promise = fetch(resolvePublicAssetUrl(asset.file))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${asset.file} (${response.status})`);
        }

        return parseNpyColormap(await response.arrayBuffer(), { id, label: asset.label });
      });
    cache.set(cacheKey, promise);
  }

  return await promise;
}

export function parseNpyColormap(
  input: ArrayBuffer | Uint8Array,
  asset: ColormapOption = { id: 'custom', label: 'Custom' }
): ColormapLut {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  validateNpyMagic(bytes);
  if (bytes.byteLength < 10) {
    throw new Error('Invalid .npy file: truncated header.');
  }

  const major = bytes[6];
  const minor = bytes[7];
  let headerLength = 0;
  let dataOffset = 0;

  if (major === 1) {
    headerLength = view.getUint16(8, true);
    dataOffset = 10 + headerLength;
  } else if (major === 2 || major === 3) {
    if (bytes.byteLength < 12) {
      throw new Error('Invalid .npy file: truncated header.');
    }
    headerLength = view.getUint32(8, true);
    dataOffset = 12 + headerLength;
  } else {
    throw new Error(`Unsupported .npy version ${major}.${minor}.`);
  }

  if (dataOffset > bytes.byteLength) {
    throw new Error('Invalid .npy file: header exceeds file length.');
  }

  const headerOffset = major === 1 ? 10 : 12;
  const headerText = new TextDecoder().decode(
    bytes.subarray(headerOffset, headerOffset + headerLength)
  );
  const header = parseNpyHeader(headerText);
  if (header.fortranOrder) {
    throw new Error('Unsupported .npy file: Fortran-order arrays are not supported.');
  }

  if (header.shape.length !== 2 || (header.shape[1] !== 3 && header.shape[1] !== 4)) {
    throw new Error('Invalid colormap shape: expected (N, 3) or (N, 4).');
  }

  const entryCount = header.shape[0] ?? 0;
  const componentCount = header.shape[1] ?? 0;
  if (entryCount < 2) {
    throw new Error('Invalid colormap: expected at least 2 entries.');
  }

  const dtype = parseDtype(header.descr);
  const expectedDataLength = entryCount * componentCount * dtype.bytesPerComponent;
  const actualDataLength = bytes.byteLength - dataOffset;
  if (actualDataLength !== expectedDataLength) {
    throw new Error(
      `Invalid .npy data length: expected ${expectedDataLength} byte(s), got ${actualDataLength}.`
    );
  }

  return {
    id: asset.id,
    label: asset.label,
    entryCount,
    rgba8: convertNpyDataToRgba8(bytes, dataOffset, entryCount, componentCount, dtype)
  };
}

export function sampleColormapRgbBytes(lut: ColormapLut | null, t: number): [number, number, number] {
  if (!lut || lut.entryCount < 2 || !Number.isFinite(t)) {
    return [0, 0, 0];
  }

  const clampedT = clampUnit(t);
  const scaledIndex = clampedT * (lut.entryCount - 1);
  const index0 = Math.floor(scaledIndex);
  const index1 = Math.min(index0 + 1, lut.entryCount - 1);
  const fraction = scaledIndex - index0;
  const offset0 = index0 * 4;
  const offset1 = index1 * 4;

  return [
    Math.round(lerp(lut.rgba8[offset0 + 0], lut.rgba8[offset1 + 0], fraction)),
    Math.round(lerp(lut.rgba8[offset0 + 1], lut.rgba8[offset1 + 1], fraction)),
    Math.round(lerp(lut.rgba8[offset0 + 2], lut.rgba8[offset1 + 2], fraction))
  ];
}

export function mapValueToColormapRgbBytes(
  value: number,
  range: DisplayLuminanceRange | null,
  lut: ColormapLut | null
): [number, number, number] {
  if (!range || !Number.isFinite(value) || range.max <= range.min) {
    return [0, 0, 0];
  }

  return sampleColormapRgbBytes(lut, (value - range.min) / (range.max - range.min));
}

function resolvePublicAssetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${file}`;
}

function createColormapId(index: number): string {
  return String(index);
}

function parseColormapId(id: string): number | null {
  const index = Number(id);
  if (!Number.isInteger(index) || index < 0 || String(index) !== id) {
    return null;
  }

  return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateColormapLabel(value: unknown, labels: Set<string>, index: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid colormap manifest entry ${index}: label must be a string.`);
  }

  const label = value.trim();
  if (label.length === 0) {
    throw new Error(`Invalid colormap manifest entry ${index}: label must not be empty.`);
  }

  if (labels.has(label)) {
    throw new Error(`Invalid colormap manifest entry ${index}: duplicate label "${label}".`);
  }

  labels.add(label);
  return label;
}

function validateColormapFile(value: unknown, index: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid colormap manifest entry ${index}: file must be a string.`);
  }

  const file = value.trim();
  const parts = file.split('/');
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(file);
  if (
    file.length === 0 ||
    !file.endsWith('.npy') ||
    file.startsWith('/') ||
    file.includes('\\') ||
    hasScheme ||
    parts.includes('..') ||
    parts.some((part) => part.length === 0)
  ) {
    throw new Error(`Invalid colormap manifest entry ${index}: file must be a relative .npy path.`);
  }

  return `colormaps/${file}`;
}

function validateNpyMagic(bytes: Uint8Array): void {
  if (bytes.byteLength < NPY_MAGIC.length) {
    throw new Error('Invalid .npy file: missing magic bytes.');
  }

  for (let i = 0; i < NPY_MAGIC.length; i += 1) {
    if (bytes[i] !== NPY_MAGIC[i]) {
      throw new Error('Invalid .npy file: missing magic bytes.');
    }
  }
}

function parseNpyHeader(headerText: string): ParsedNpyHeader {
  const descr = parseHeaderStringValue(headerText, 'descr');
  const fortranOrder = parseHeaderBooleanValue(headerText, 'fortran_order');
  const shape = parseHeaderShapeValue(headerText);

  return {
    descr,
    fortranOrder,
    shape
  };
}

function parseHeaderStringValue(headerText: string, key: string): string {
  const match = new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`).exec(headerText);
  if (!match?.[1]) {
    throw new Error(`Invalid .npy header: missing "${key}".`);
  }

  return match[1];
}

function parseHeaderBooleanValue(headerText: string, key: string): boolean {
  const match = new RegExp(`['"]${key}['"]\\s*:\\s*(True|False)`).exec(headerText);
  if (!match?.[1]) {
    throw new Error(`Invalid .npy header: missing "${key}".`);
  }

  return match[1] === 'True';
}

function parseHeaderShapeValue(headerText: string): number[] {
  const match = /['"]shape['"]\s*:\s*\(([^)]*)\)/.exec(headerText);
  if (!match?.[1]) {
    throw new Error('Invalid .npy header: missing "shape".');
  }

  const shape = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));

  if (shape.length === 0 || shape.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('Invalid .npy header: shape must contain positive integer dimensions.');
  }

  return shape;
}

function parseDtype(descr: string): ParsedDtype {
  if (descr === '<f4') {
    return { kind: 'float32', bytesPerComponent: 4 };
  }
  if (descr === '<f8') {
    return { kind: 'float64', bytesPerComponent: 8 };
  }
  if (descr === '|u1' || descr === '<u1') {
    return { kind: 'uint8', bytesPerComponent: 1 };
  }

  throw new Error(`Unsupported .npy dtype "${descr}".`);
}

function convertNpyDataToRgba8(
  bytes: Uint8Array,
  dataOffset: number,
  entryCount: number,
  componentCount: number,
  dtype: ParsedDtype
): Uint8Array {
  const rgba8 = new Uint8Array(entryCount * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = bytes.subarray(dataOffset);

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const inBase = entryIndex * componentCount;
    const outBase = entryIndex * 4;

    rgba8[outBase + 0] = readColormapComponent(data, view, dataOffset, inBase + 0, dtype);
    rgba8[outBase + 1] = readColormapComponent(data, view, dataOffset, inBase + 1, dtype);
    rgba8[outBase + 2] = readColormapComponent(data, view, dataOffset, inBase + 2, dtype);
    rgba8[outBase + 3] =
      componentCount === 4
        ? readColormapComponent(data, view, dataOffset, inBase + 3, dtype)
        : 255;
  }

  return rgba8;
}

function readColormapComponent(
  data: Uint8Array,
  view: DataView,
  dataOffset: number,
  componentIndex: number,
  dtype: ParsedDtype
): number {
  if (dtype.kind === 'uint8') {
    return data[componentIndex] ?? 0;
  }

  const byteOffset = dataOffset + componentIndex * dtype.bytesPerComponent;
  const value =
    dtype.kind === 'float32'
      ? view.getFloat32(byteOffset, true)
      : view.getFloat64(byteOffset, true);

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Invalid colormap value: float components must be finite values in [0, 1].');
  }

  return Math.round(value * 255);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
