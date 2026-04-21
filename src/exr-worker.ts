import { loadExr } from './exr';
import { collectDecodedImageTransferables } from './decode-transferables';
import type { DecodedExrImage } from './types';

interface DecodeWorkerRequest {
  id: number;
  bytes: Uint8Array;
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
      error: string;
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
    worker.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to decode EXR.'
    } satisfies DecodeWorkerResponse);
  }
}
