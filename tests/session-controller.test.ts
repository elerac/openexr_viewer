import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../src/controllers/session-controller';
import { LoadQueueService } from '../src/services/load-queue';
import { ViewerStore, createInitialState } from '../src/viewer-store';
import { DecodedExrImage, ViewerState } from '../src/types';
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

function createUiMock() {
  return {
    setError: vi.fn(),
    setExportTarget: vi.fn(),
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
    clear: vi.fn(),
    getThumbnailDataUrl: vi.fn<(_: string) => string | null>(() => null)
  };
  const renderCache = {
    discard: vi.fn(),
    clear: vi.fn()
  };

  const controller = new SessionController({
    ui,
    loadQueue: new LoadQueueService(),
    thumbnailService: thumbnailService as never,
    renderCache: renderCache as never,
    decodeBytes: options.decodeBytes ?? (async () => createDecodedImage()),
    getCurrentState: () => store.getState(),
    setState: (next) => {
      store.setState(next);
    },
    getViewport: () => ({ width: 200, height: 100 }),
    getDefaultColormapId: () => 'cm-default',
    clearRendererImage: vi.fn()
  });

  return { controller, store, ui, thumbnailService, renderCache };
}

describe('session controller', () => {
  it('applies decoded images as new active sessions and enqueues thumbnails', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage(8, 4));
    const { controller, store, ui, thumbnailService, renderCache } = createController({ decodeBytes });
    thumbnailService.getThumbnailDataUrl.mockReturnValue('thumb-data');

    await controller.enqueueFiles([createFile('beauty.exr')]);

    const session = controller.getActiveSession();
    expect(decodeBytes).toHaveBeenCalledTimes(1);
    expect(session?.filename).toBe('beauty.exr');
    expect(session?.displayName).toBe('beauty.exr');
    expect(store.getState().activeColormapId).toBe('cm-default');
    expect(store.getState().displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
    expect(thumbnailService.enqueue).toHaveBeenCalledTimes(1);
    expect(ui.setOpenedImageOptions).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: session?.id,
          label: 'beauty.exr',
          thumbnailDataUrl: 'thumb-data'
        })
      ]),
      session?.id
    );
    expect(ui.setExportTarget).toHaveBeenLastCalledWith({
      filename: 'beauty.png',
      sourceWidth: 8,
      sourceHeight: 4
    });
  });

  it('switches active sessions while carrying current view and probe state', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, store, ui } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [firstSession] = controller.getSessions();
    store.setState({
      zoom: 3,
      panX: 4,
      panY: 5,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 1 },
      hoveredPixel: { ix: 2, iy: 2 }
    });
    controller.handleStoreChange(store.getState());

    controller.switchActiveSession(firstSession!.id);

    expect(controller.getActiveSessionId()).toBe(firstSession!.id);
    expect(ui.setExportTarget).toHaveBeenLastCalledWith({
      filename: 'first.png',
      sourceWidth: 6,
      sourceHeight: 6
    });
    expect(store.getState()).toMatchObject({
      zoom: 3,
      panX: 4,
      panY: 5,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 1 },
      hoveredPixel: null
    });
  });

  it('preserves inactive image camera while carrying panorama camera across session switches', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, store } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [firstSession] = controller.getSessions();
    firstSession!.state = {
      ...firstSession!.state,
      zoom: 7,
      panX: 8,
      panY: 9,
      panoramaYawDeg: 15,
      panoramaPitchDeg: 10,
      panoramaHfovDeg: 70
    };

    store.setState({
      viewerMode: 'panorama',
      zoom: 3,
      panX: 4,
      panY: 5,
      panoramaYawDeg: 45,
      panoramaPitchDeg: 20,
      panoramaHfovDeg: 80
    });

    controller.switchActiveSession(firstSession!.id);

    expect(store.getState()).toMatchObject({
      viewerMode: 'panorama',
      zoom: 7,
      panX: 8,
      panY: 9,
      panoramaYawDeg: 45,
      panoramaPitchDeg: 20,
      panoramaHfovDeg: 80
    });
  });

  it('resets panorama mode to default forward view while keeping the mode active', async () => {
    const { controller, store } = createController();

    await controller.enqueueFiles([createFile('reset.exr')]);

    store.setState({
      viewerMode: 'panorama',
      visualizationMode: 'colormap',
      exposureEv: 3,
      panoramaYawDeg: 60,
      panoramaPitchDeg: 15,
      panoramaHfovDeg: 55
    });
    controller.handleStoreChange(store.getState());

    controller.resetActiveSessionState();

    expect(store.getState()).toMatchObject({
      viewerMode: 'panorama',
      visualizationMode: 'rgb',
      exposureEv: 0,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    });
  });

  it('reloads the active session and re-enqueues its thumbnail', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller, thumbnailService, renderCache, ui } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('reload.exr')]);
    const sessionId = controller.getActiveSessionId()!;

    await controller.reloadSession(sessionId);

    const reloaded = controller.getActiveSession();
    expect(reloaded?.decoded.width).toBe(8);
    expect(reloaded?.decoded.height).toBe(8);
    expect(thumbnailService.enqueue).toHaveBeenCalledTimes(2);
    expect(thumbnailService.discard).toHaveBeenCalledWith(sessionId, { preserveDataUrl: true });
    expect(renderCache.discard).toHaveBeenCalledWith(sessionId);
    expect(ui.setExportTarget).toHaveBeenLastCalledWith({
      filename: 'reload.png',
      sourceWidth: 8,
      sourceHeight: 8
    });
  });

  it('clears external thumbnail and render cache state when sessions close', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage())
      .mockResolvedValueOnce(createDecodedImage());
    const { controller, thumbnailService, renderCache } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [first, second] = controller.getSessions();
    controller.closeSession(second!.id);

    expect(thumbnailService.discard).toHaveBeenCalledWith(second!.id);
    expect(renderCache.discard).toHaveBeenCalledWith(second!.id);

    controller.closeAllSessions();

    expect(thumbnailService.clear).toHaveBeenCalledTimes(1);
    expect(renderCache.clear).toHaveBeenCalledTimes(1);
    expect(first?.id).toBeDefined();
  });

  it('suppresses late decoded images after the controller is disposed', async () => {
    let resolveDecode!: (image: DecodedExrImage) => void;
    const decodeBytes = vi.fn(
      () =>
        new Promise<DecodedExrImage>((resolve) => {
          resolveDecode = resolve;
        })
    );
    const { controller, thumbnailService, ui } = createController({ decodeBytes });

    const pending = controller.enqueueFiles([createFile('dispose.exr')]);
    for (let index = 0; index < 6 && !resolveDecode; index += 1) {
      await Promise.resolve();
    }

    expect(resolveDecode).toBeTypeOf('function');
    controller.dispose();
    resolveDecode(createDecodedImage());

    await expect(pending).resolves.toBeUndefined();
    expect(controller.getActiveSession()).toBeNull();
    expect(thumbnailService.enqueue).not.toHaveBeenCalled();
    expect(ui.setOpenedImageOptions).not.toHaveBeenCalled();
  });
});
