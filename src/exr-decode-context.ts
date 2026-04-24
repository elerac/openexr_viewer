import {
  summarizeExrHeader,
  type ExrHeaderSummary
} from './exr-metadata';

export interface DecodeBytesOptions {
  signal?: AbortSignal;
  filename?: string;
}

export interface DecodeErrorContext {
  filename: string | null;
  byteSize: number;
  headerSummary: ExrHeaderSummary | null;
  unsupportedFeatureReason: string | null;
}

export interface DecodeErrorPayload {
  message: string;
  context: DecodeErrorContext;
}

export type DecodeContextError = Error & {
  decodeContext?: DecodeErrorContext;
};

const LOSSY_OR_NEWER_COMPRESSION = new Set(['B44', 'B44A', 'DWAA', 'DWAB']);

export function createDecodeErrorContext(
  bytes: Uint8Array,
  filename: string | null | undefined,
  error?: unknown
): DecodeErrorContext {
  const headerSummary = summarizeExrHeader(bytes);
  const baseContext: DecodeErrorContext = {
    filename: normalizeFilename(filename),
    byteSize: bytes.byteLength,
    headerSummary,
    unsupportedFeatureReason: null
  };

  return completeDecodeErrorContext(baseContext, error);
}

export function completeDecodeErrorContext(
  context: DecodeErrorContext,
  error?: unknown
): DecodeErrorContext {
  return {
    ...context,
    unsupportedFeatureReason: detectUnsupportedFeatureReason(context.headerSummary, error)
  };
}

export function createDecodeErrorPayload(
  error: unknown,
  context: DecodeErrorContext
): DecodeErrorPayload {
  return {
    message: getErrorMessage(error, 'Failed to decode EXR.'),
    context: completeDecodeErrorContext(context, error)
  };
}

export function createDecodeErrorFromPayload(payload: DecodeErrorPayload): DecodeContextError {
  const error = new Error(payload.message) as DecodeContextError;
  error.name = 'ExrDecodeError';
  error.decodeContext = payload.context;
  return error;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeFilename(filename: string | null | undefined): string | null {
  const trimmed = filename?.trim() ?? '';
  return trimmed || null;
}

function detectUnsupportedFeatureReason(
  headerSummary: ExrHeaderSummary | null,
  error: unknown
): string | null {
  const message = getErrorMessage(error, '').trim();
  if (/unsupported|not supported/i.test(message)) {
    return message;
  }

  for (const part of headerSummary?.parts ?? []) {
    const type = part.type?.trim();
    if (type && type !== 'scanlineimage') {
      return `EXR image type "${type}" is not supported by this decoder.`;
    }

    const compression = part.compression?.trim();
    if (compression && LOSSY_OR_NEWER_COMPRESSION.has(compression)) {
      return `EXR compression "${compression}" may not be supported by this decoder.`;
    }
  }

  return null;
}
