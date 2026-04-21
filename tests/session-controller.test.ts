import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../src/controllers/session-controller';
import { LoadQueueService } from '../src/services/load-queue';
import { ViewerStore, createInitialState } from '../src/state';
import { DecodedExrImage, DecodedLayer, OpenedImageSession, ViewerState } from '../src/types';

function createDecodedImage(width = 4, height = 4): DecodedExrImage {
  const pixelCount = width * height;
  const layer: DecodedLayer = {
    name: 'beauty',
    channelNames: ['R', 'G', 'B'],
    channelData: new Map([
      ['R', new Float32Array(pixelCount).fill(1)],
      ['G', new Float32Array(pixelCount).fill(2)],
      ['B', new Float32Array(pixelCount).fill(3)]
    ])
  };

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

function createUiMock() {
  return {
    setDisplayCacheBudget: vi.fn(),
    setDisplayCacheUsage: vi.fn(),
    setError: vi.fn(),
    setLoading: vi.fn(),
    setOpenedImageOptions: vi.fn()
  };
}

function createController(options: {
  decodeBytes?: (bytes: Uint8Array) => Promise<DecodedExrImage>;
} = {}) {
  const store = new ViewerStore(createInitialState());
  const ui = createUiMock();
  const thumbnailService = {
    enqueue: vi.fn(async () => undefined),
    discard: vi.fn(),
    clear: vi.fn()
  };

  const controller = new SessionController({
    ui,
    loadQueue: new LoadQueueService(),
    thumbnailService: thumbnailService as never,
    decodeBytes: options.decodeBytes ?? (async () => createDecodedImage()),
    getCurrentState: () => store.getState(),
    setState: (next) => {
      store.setState(next);
    },
    getViewport: () => ({ width: 200, height: 100 }),
    getDefaultColormapId: () => 'cm-default',
    clearRendererImage: vi.fn()
  });

  return { controller, store, ui, thumbnailService };
}

describe('session controller', () => {
  it('applies decoded images as new active sessions and enqueues thumbnails', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage(8, 4));
    const { controller, store, ui, thumbnailService } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('beauty.exr')]);

    const session = controller.getActiveSession();
    expect(decodeBytes).toHaveBeenCalledTimes(1);
    expect(session?.filename).toBe('beauty.exr');
    expect(session?.displayName).toBe('beauty.exr');
    expect(store.getState().activeColormapId).toBe('cm-default');
    expect(store.getState().displayR).toBe('R');
    expect(thumbnailService.enqueue).toHaveBeenCalledTimes(1);
    expect(ui.setOpenedImageOptions).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: session?.id,
          label: 'beauty.exr'
        })
      ]),
      session?.id
    );
  });

  it('switches active sessions while carrying current view and probe state', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, store } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [firstSession] = controller.getSessions();
    store.setState({
      zoom: 3,
      panX: 4,
      panY: 5,
      exposureEv: 2,
      displayR: 'R',
      displayG: 'R',
      displayB: 'R',
      lockedPixel: { ix: 1, iy: 1 },
      hoveredPixel: { ix: 2, iy: 2 }
    });
    controller.handleStoreChange(store.getState());

    controller.switchActiveSession(firstSession!.id);

    expect(controller.getActiveSessionId()).toBe(firstSession!.id);
    expect(store.getState()).toMatchObject({
      zoom: 3,
      panX: 4,
      panY: 5,
      exposureEv: 2,
      displayR: 'R',
      displayG: 'R',
      displayB: 'R',
      lockedPixel: { ix: 1, iy: 1 },
      hoveredPixel: null
    });
  });

  it('reloads the active session and re-enqueues its thumbnail', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller, thumbnailService } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('reload.exr')]);
    const sessionId = controller.getActiveSessionId()!;

    await controller.reloadSession(sessionId);

    const reloaded = controller.getActiveSession();
    expect(reloaded?.decoded.width).toBe(8);
    expect(reloaded?.decoded.height).toBe(8);
    expect(thumbnailService.enqueue).toHaveBeenCalledTimes(2);
  });

  it('prunes unpinned inactive display caches and keeps pinned ones over budget', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage())
      .mockResolvedValueOnce(createDecodedImage());
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [first, second] = controller.getSessions();
    const firstTexture = new Float32Array((40 * 1024 * 1024) / 4);
    const secondTexture = new Float32Array((40 * 1024 * 1024) / 4);

    first!.displayTexture = firstTexture;
    first!.displayLuminanceRange = { min: 0, max: 1 };
    first!.displayLuminanceRangeRevisionKey = 'first-range';
    first!.textureRevisionKey = 'first-texture';
    controller.touchDisplayCache(first!);

    second!.displayTexture = secondTexture;
    second!.displayLuminanceRange = { min: 0, max: 1 };
    second!.displayLuminanceRangeRevisionKey = 'second-range';
    second!.textureRevisionKey = 'second-texture';
    controller.touchDisplayCache(second!);

    controller.setDisplayCacheBudget(64);
    expect(first!.displayTexture).toBeNull();

    first!.displayTexture = firstTexture;
    first!.displayLuminanceRange = { min: 0, max: 1 };
    first!.displayLuminanceRangeRevisionKey = 'first-range';
    first!.textureRevisionKey = 'first-texture';
    controller.toggleSessionPin(first!.id);
    controller.touchDisplayCache(first!);

    controller.setDisplayCacheBudget(64);
    expect(first!.displayTexture).toBe(firstTexture);
    expect(second!.displayTexture).toBe(secondTexture);
  });
});
