import { loadExr } from './exr';
import { createPlanarChannelStorageFromInterleaved } from './channel-storage';
import { collectDecodedImageTransferables } from './decode-transferables';
import { configureExrRuntime } from './exr-runtime';
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
  wasmUrl: string;
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
    configureExrRuntime({ wasmUrl: request.wasmUrl });
    const image = convertDecodedImageToPlanar(await loadExr(request.bytes));
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

function convertDecodedImageToPlanar(image: DecodedExrImage): DecodedExrImage {
  return {
    ...image,
    layers: image.layers.map((layer) => {
      if (layer.channelStorage.kind !== 'interleaved-f32') {
        return layer;
      }

      const { storage, finiteRangeByChannel } = createPlanarChannelStorageFromInterleaved(
        layer.channelStorage.pixels,
        layer.channelNames
      );

      return {
        ...layer,
        channelStorage: storage,
        analysis: {
          ...layer.analysis,
          finiteRangeByChannel
        }
      };
    })
  };
}
