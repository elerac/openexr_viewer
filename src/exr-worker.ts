import { loadExr } from './exr';
import { collectDecodedImageTransferables } from './decode-transferables';
import {
  createDecodeErrorContext,
  createDecodeErrorPayload,
  type DecodeErrorContext,
  type DecodeErrorPayload
} from './exr-decode-context';
import type { DecodedExrImage } from './types';

interface DecodeWorkerRequest {
  id: number;
  bytes: Uint8Array;
  filename: string | null;
  context: DecodeErrorContext;
}

type DecodeWorkerResponse =
  | {
      id: number;
      ok: true;
      image: DecodedExrImage;
    }
  | {
      id: number;
      ok: false;
      error: DecodeErrorPayload;
    };

type DecodeWorkerScope = {
  addEventListener: (type: 'message', listener: (event: MessageEvent<DecodeWorkerRequest>) => void) => void;
  postMessage: (message: DecodeWorkerResponse, transfer?: Transferable[]) => void;
};

const worker = self as unknown as DecodeWorkerScope;

worker.addEventListener('message', (event: MessageEvent<DecodeWorkerRequest>) => {
  void decodeAndReply(event.data);
});

async function decodeAndReply(request: DecodeWorkerRequest): Promise<void> {
  try {
    const image = await loadExr(request.bytes);
    worker.postMessage(
      {
        id: request.id,
        ok: true,
        image
      } satisfies DecodeWorkerResponse,
      collectDecodedImageTransferables(image)
    );
  } catch (error) {
    const context = request.context ?? createDecodeErrorContext(request.bytes, request.filename, error);
    worker.postMessage({
      id: request.id,
      ok: false,
      error: createDecodeErrorPayload(error, context)
    } satisfies DecodeWorkerResponse);
  }
}
