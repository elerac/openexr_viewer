import { loadExr } from './exr';
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

const worker = self as DedicatedWorkerGlobalScope;

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

function collectDecodedImageTransferables(image: DecodedExrImage): Transferable[] {
  const transferables: Transferable[] = [];
  for (const layer of image.layers) {
    for (const channelValues of layer.channelData.values()) {
      if (channelValues.buffer instanceof ArrayBuffer) {
        transferables.push(channelValues.buffer);
      }
    }
  }
  return transferables;
}
