import { ExrMetadataEntry } from './types';

const OPENEXR_MAGIC = 0x01312f76;
const MULTIPART_FLAG = 0x1000;
const STRING_DECODER = new TextDecoder('utf-8');

const CURATED_METADATA_KEYS = [
  'compression',
  'pixelAspectRatio',
  'dataWindow',
  'displayWindow',
  'lineOrder',
  'channels',
  'type',
  'capDate',
  'chromaticities',
  'whiteLuminance',
  'samples',
  'renderer',
  'integrator',
  'seed'
];

const OMITTED_METADATA_KEYS = new Set(['chunkCount']);

const METADATA_LABELS = new Map<string, string>([
  ['displayWindow', 'displayWin'],
  ['pixelAspectRatio', 'pixelAspect']
]);

interface RawExrAttribute {
  name: string;
  type: string;
  value: Uint8Array;
  order: number;
}

interface ParsedExrHeader {
  attributes: RawExrAttribute[];
  nextOffset: number;
}

export function parseExrMetadata(bytes: Uint8Array): ExrMetadataEntry[][] {
  try {
    if (bytes.byteLength < 8) {
      return [];
    }

    const view = toDataView(bytes);
    if (view.getUint32(0, true) !== OPENEXR_MAGIC) {
      return [];
    }

    const versionField = view.getUint32(4, true);
    const isMultipart = (versionField & MULTIPART_FLAG) !== 0;
    let offset = 8;

    if (!isMultipart) {
      const header = readHeader(bytes, view, offset);
      return [formatHeaderMetadata(header.attributes)];
    }

    const parts: ExrMetadataEntry[][] = [];
    while (offset < bytes.byteLength) {
      const header = readHeader(bytes, view, offset);
      offset = header.nextOffset;
      if (header.attributes.length === 0) {
        break;
      }
      parts.push(formatHeaderMetadata(header.attributes));
    }

    return parts;
  } catch {
    return [];
  }
}

function readHeader(bytes: Uint8Array, view: DataView, startOffset: number): ParsedExrHeader {
  const attributes: RawExrAttribute[] = [];
  let offset = startOffset;
  let order = 0;

  while (offset < bytes.byteLength) {
    const nameResult = readNullTerminatedString(bytes, offset);
    const name = nameResult.value;
    offset = nameResult.nextOffset;

    if (name === '') {
      return { attributes, nextOffset: offset };
    }

    const typeResult = readNullTerminatedString(bytes, offset);
    const type = typeResult.value;
    offset = typeResult.nextOffset;

    ensureCanRead(bytes, offset, 4);
    const size = view.getInt32(offset, true);
    offset += 4;
    if (size < 0) {
      throw new Error(`Invalid EXR metadata attribute size for ${name}.`);
    }

    ensureCanRead(bytes, offset, size);
    attributes.push({
      name,
      type,
      value: bytes.subarray(offset, offset + size),
      order
    });
    order += 1;
    offset += size;
  }

  throw new Error('Unterminated EXR header metadata.');
}

function formatHeaderMetadata(attributes: RawExrAttribute[]): ExrMetadataEntry[] {
  const decoded = attributes
    .map(decodeAttribute)
    .filter((entry): entry is ExrMetadataEntry & { order: number } => Boolean(entry));
  if (
    !decoded.some((entry) => entry.key === 'type') &&
    decoded.some((entry) => entry.key === 'channels' || entry.key === 'dataWindow')
  ) {
    decoded.push({
      key: 'type',
      label: 'type',
      value: 'scanlineimage',
      order: Number.MAX_SAFE_INTEGER
    });
  }

  const byKey = new Map(decoded.map((entry) => [entry.key, entry]));
  const result: ExrMetadataEntry[] = [];
  const emitted = new Set<string>();

  for (const key of CURATED_METADATA_KEYS) {
    const entry = byKey.get(key);
    if (!entry) {
      continue;
    }
    result.push(stripOrder(entry));
    emitted.add(key);
  }

  decoded
    .filter((entry) => !emitted.has(entry.key) && !OMITTED_METADATA_KEYS.has(entry.key))
    .sort((a, b) => a.order - b.order)
    .forEach((entry) => result.push(stripOrder(entry)));

  return result;
}

function stripOrder(entry: ExrMetadataEntry & { order: number }): ExrMetadataEntry {
  return {
    key: entry.key,
    label: entry.label,
    value: entry.value
  };
}

function decodeAttribute(attribute: RawExrAttribute): (ExrMetadataEntry & { order: number }) | null {
  if (OMITTED_METADATA_KEYS.has(attribute.name)) {
    return null;
  }

  const value = decodeAttributeValue(attribute);
  if (value === null || value === '') {
    return null;
  }

  return {
    key: attribute.name,
    label: METADATA_LABELS.get(attribute.name) ?? attribute.name,
    value,
    order: attribute.order
  };
}

function decodeAttributeValue(attribute: RawExrAttribute): string | null {
  const valueView = toDataView(attribute.value);

  switch (attribute.type) {
    case 'compression':
      return attribute.value.byteLength >= 1 ? formatCompression(attribute.value[0] ?? -1) : null;
    case 'lineOrder':
      return attribute.value.byteLength >= 1 ? formatLineOrder(attribute.value[0] ?? -1) : null;
    case 'box2i':
      return attribute.value.byteLength >= 16
        ? formatBox2i(
            valueView.getInt32(0, true),
            valueView.getInt32(4, true),
            valueView.getInt32(8, true),
            valueView.getInt32(12, true)
          )
        : null;
    case 'chlist':
      return formatChannels(readChannelList(attribute.value));
    case 'string':
      return formatString(attribute.value);
    case 'int':
      return attribute.value.byteLength >= 4
        ? formatIntMetadata(attribute.name, valueView.getInt32(0, true), valueView.getUint32(0, true))
        : null;
    case 'float':
      return attribute.value.byteLength >= 4
        ? formatFloatMetadata(attribute.name, valueView.getFloat32(0, true))
        : null;
    case 'double':
      return attribute.value.byteLength >= 8
        ? formatFloatMetadata(attribute.name, valueView.getFloat64(0, true))
        : null;
    case 'v2f':
      return attribute.value.byteLength >= 8
        ? `(${formatCompactNumber(valueView.getFloat32(0, true))}, ${formatCompactNumber(valueView.getFloat32(4, true))})`
        : null;
    case 'v3f':
      return attribute.value.byteLength >= 12
        ? `(${formatCompactNumber(valueView.getFloat32(0, true))}, ${formatCompactNumber(
            valueView.getFloat32(4, true)
          )}, ${formatCompactNumber(valueView.getFloat32(8, true))})`
        : null;
    case 'chromaticities':
      return attribute.value.byteLength >= 32 ? formatChromaticities(valueView) : null;
    default:
      return null;
  }
}

function readChannelList(bytes: Uint8Array): string[] {
  const view = toDataView(bytes);
  const channels: string[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    const nameResult = readNullTerminatedString(bytes, offset);
    const name = nameResult.value;
    offset = nameResult.nextOffset;
    if (name === '') {
      break;
    }

    ensureCanRead(bytes, offset, 16);
    const pixelType = view.getInt32(offset, true);
    if (pixelType < 0 || pixelType > 2) {
      throw new Error(`Invalid EXR channel pixel type for ${name}.`);
    }

    channels.push(name);
    offset += 16;
  }

  return channels;
}

function formatChannels(channelNames: string[]): string {
  if (channelNames.length === 0) {
    return '0';
  }

  const rootOrder = ['R', 'G', 'B', 'A'];
  const rootChannels = rootOrder.filter((channelName) => channelNames.includes(channelName));
  const rootSet = new Set(rootChannels);
  const groups = new Map<string, { base: string; suffixes: string[]; firstIndex: number }>();
  const tokens: Array<{ value: string; firstIndex: number }> = [];

  channelNames.forEach((channelName, index) => {
    if (rootSet.has(channelName)) {
      return;
    }

    const dotIndex = channelName.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex >= channelName.length - 1) {
      tokens.push({ value: channelName, firstIndex: index });
      return;
    }

    const base = channelName.slice(0, dotIndex);
    const suffix = channelName.slice(dotIndex + 1);
    const existing = groups.get(base);
    if (existing) {
      existing.suffixes.push(suffix);
      existing.firstIndex = Math.min(existing.firstIndex, index);
      return;
    }

    groups.set(base, { base, suffixes: [suffix], firstIndex: index });
  });

  for (const group of groups.values()) {
    const suffixes = sortChannelSuffixes(group.suffixes);
    tokens.push({
      value: suffixes.length > 1 ? `${group.base}.{${suffixes.join(',')}}` : `${group.base}.${suffixes[0]}`,
      firstIndex: group.firstIndex
    });
  }

  const channelSummary = [
    ...rootChannels,
    ...tokens
      .sort((a, b) => a.firstIndex - b.firstIndex || a.value.localeCompare(b.value))
      .map((token) => token.value)
  ];

  return `${channelNames.length} (${channelSummary.join(', ')})`;
}

function sortChannelSuffixes(suffixes: string[]): string[] {
  const preferred = ['R', 'G', 'B', 'A', 'X', 'Y', 'Z', 'U', 'V'];
  return [...new Set(suffixes)].sort((a, b) => {
    const preferredA = preferred.indexOf(a);
    const preferredB = preferred.indexOf(b);
    if (preferredA >= 0 || preferredB >= 0) {
      return (preferredA >= 0 ? preferredA : Number.MAX_SAFE_INTEGER) -
        (preferredB >= 0 ? preferredB : Number.MAX_SAFE_INTEGER);
    }
    return a.localeCompare(b);
  });
}

function formatCompression(value: number): string {
  const names = ['NONE', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'];
  return names[value] ?? `UNKNOWN(${value})`;
}

function formatLineOrder(value: number): string {
  const names = ['INCREASING_Y', 'DECREASING_Y', 'RANDOM_Y'];
  return names[value] ?? `UNKNOWN(${value})`;
}

function formatBox2i(minX: number, minY: number, maxX: number, maxY: number): string {
  return `[${minX},${minY}]-[${maxX},${maxY}]`;
}

function formatString(bytes: Uint8Array): string {
  return STRING_DECODER.decode(bytes).replace(/\0+$/u, '');
}

function formatIntMetadata(key: string, signedValue: number, unsignedValue: number): string {
  if (key === 'samples') {
    return `${signedValue} spp`;
  }

  if (key === 'seed') {
    return `0x${unsignedValue.toString(16).toUpperCase().padStart(8, '0')}`;
  }

  return String(signedValue);
}

function formatFloatMetadata(key: string, value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  if (key === 'pixelAspectRatio') {
    return value.toFixed(3);
  }

  return formatCompactNumber(value);
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const rounded = Number(value.toPrecision(7));
  if (Object.is(rounded, -0)) {
    return '0.0';
  }

  if (Number.isInteger(rounded)) {
    return `${rounded}.0`;
  }

  return String(rounded);
}

function formatChromaticities(view: DataView): string {
  const values = [
    view.getFloat32(0, true),
    view.getFloat32(4, true),
    view.getFloat32(8, true),
    view.getFloat32(12, true),
    view.getFloat32(16, true),
    view.getFloat32(20, true),
    view.getFloat32(24, true),
    view.getFloat32(28, true)
  ];

  const rec709 = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329];
  if (values.every((value, index) => Math.abs(value - (rec709[index] ?? 0)) < 0.0005)) {
    return 'Rec.709';
  }

  const [rx, ry, gx, gy, bx, by, wx, wy] = values.map(formatCompactNumber);
  return `R(${rx},${ry}) G(${gx},${gy}) B(${bx},${by}) W(${wx},${wy})`;
}

function readNullTerminatedString(bytes: Uint8Array, offset: number): { value: string; nextOffset: number } {
  let end = offset;
  while (end < bytes.byteLength && bytes[end] !== 0) {
    end += 1;
  }

  if (end >= bytes.byteLength) {
    throw new Error('Unterminated EXR metadata string.');
  }

  return {
    value: STRING_DECODER.decode(bytes.subarray(offset, end)),
    nextOffset: end + 1
  };
}

function ensureCanRead(bytes: Uint8Array, offset: number, byteLength: number): void {
  if (offset < 0 || byteLength < 0 || offset + byteLength > bytes.byteLength) {
    throw new Error('EXR metadata read out of bounds.');
  }
}

function toDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
