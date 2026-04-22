import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../src/controllers/session-controller';
import { LoadQueueService } from '../src/services/load-queue';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { DecodedExrImage } from '../src/types';
import { createChannelMonoSelection, createChannelRgbSelection, createLayerFromChannels } from './helpers/state-fixtures';

function createDecodedImage(width = 4, height = 4): DecodedExrImage {
  const pixelCount = width * height;
  const layer = createLayerFromChannels({
    R: new Float32Array(pixelCount).fill(1),
    G: new Float32Array(pixelCount).fill(2),
    B: new Float32Array(pixelCount).fill(3)
  }, 'beauty');

  return {
    width,
    height,
    layers: [layer]
  };
}

function createFile(name: string, bytes: number[] = [1, 2, 3]): File {
  return {
    name,
    size: bytes.length,
    webkitRelativePath: '',
    arrayBuffer: async () => new Uint8Array(bytes).buffer
  } as unknown as File;
}

function createController(options: {
  decodeBytes?: (bytes: Uint8Array) => Promise<DecodedExrImage>;
} = {}) {
  const core = new ViewerAppCore();
  const controller = new SessionController({
    core,
    loadQueue: new LoadQueueService(),
    decodeBytes: options.decodeBytes ?? (async () => createDecodedImage()),
    getViewport: () => ({ width: 200, height: 100 })
  });

  return { controller, core };
}

describe('session controller shim', () => {
  it('applies decoded images as new active sessions', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage(8, 4));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('beauty.exr')]);

    const session = controller.getActiveSession();
    expect(decodeBytes).toHaveBeenCalledTimes(1);
    expect(session?.filename).toBe('beauty.exr');
    expect(core.getState().sessionState.activeColormapId).toBe(core.getState().defaultColormapId);
    expect(core.getState().sessionState.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('switches active sessions while carrying current view and lock state', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [firstSession] = controller.getSessions();
    core.dispatch({
      type: 'exposureSet',
      exposureEv: 2
    });
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createChannelMonoSelection('R')
    });
    core.dispatch({
      type: 'lockedPixelToggled',
      pixel: { ix: 1, iy: 1 }
    });
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 4,
        panY: 5,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      }
    });

    controller.switchActiveSession(firstSession!.id);

    expect(controller.getActiveSessionId()).toBe(firstSession!.id);
    expect(core.getState().sessionState).toMatchObject({
      zoom: 3,
      panX: 4,
      panY: 5,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 1 }
    });
  });

  it('reloads the active session with remapped session state', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('reload.exr')]);
    const sessionId = controller.getActiveSessionId()!;

    await controller.reloadSession(sessionId);

    const reloaded = controller.getActiveSession();
    expect(reloaded?.decoded.width).toBe(8);
    expect(reloaded?.decoded.height).toBe(8);
  });

  it('clears state when all sessions close', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage())
      .mockResolvedValueOnce(createDecodedImage());
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    controller.closeAllSessions();

    expect(controller.getActiveSession()).toBeNull();
    expect(core.getState().sessions).toEqual([]);
    expect(core.getState().sessionState.displaySelection).toBeNull();
  });

  it('suppresses late decoded images after the controller is disposed', async () => {
    let resolveDecode!: (image: DecodedExrImage) => void;
    const decodeBytes = vi.fn(
      () =>
        new Promise<DecodedExrImage>((resolve) => {
          resolveDecode = resolve;
        })
    );
    const { controller } = createController({ decodeBytes });

    const pending = controller.enqueueFiles([createFile('dispose.exr')]);
    for (let index = 0; index < 6 && !resolveDecode; index += 1) {
      await Promise.resolve();
    }

    controller.dispose();
    resolveDecode(createDecodedImage());

    await expect(pending).resolves.toBeUndefined();
    expect(controller.getActiveSession()).toBeNull();
  });
});
