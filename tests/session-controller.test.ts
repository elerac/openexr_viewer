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

function createFolderFile(
  relativePath: string,
  bytes: number[] = [1, 2, 3]
): File {
  const segments = relativePath.split(/[\\/]/);
  const name = segments[segments.length - 1] ?? relativePath;

  return {
    name,
    size: bytes.length,
    webkitRelativePath: relativePath,
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

  it('loads only exr files from folder selections', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValue(createDecodedImage());
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFolderFiles([
      createFolderFile('shots/beauty.exr'),
      createFolderFile('shots/notes.txt'),
      createFolderFile('shots/aovs/albedo.EXR'),
      createFolderFile('shots/depth.png')
    ]);

    expect(decodeBytes).toHaveBeenCalledTimes(2);
    expect(controller.getSessions().map((session) => session.filename)).toEqual(['albedo.EXR', 'beauty.exr']);
  });

  it('loads recursive folder selections in stable relative-path order', async () => {
    const decodeBytes = vi.fn(async (bytes: Uint8Array) => createDecodedImage(bytes[0] ?? 1, 4));
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFolderFiles([
      createFolderFile('shots/z_last.exr', [30]),
      createFolderFile('shots/aovs/beauty.exr', [10]),
      createFolderFile('shots/aovs/masks/id.exr', [20])
    ]);

    expect(controller.getSessions().map((session) => session.source.kind === 'file'
      ? session.source.file.webkitRelativePath
      : session.filename
    )).toEqual([
      'shots/aovs/beauty.exr',
      'shots/aovs/masks/id.exr',
      'shots/z_last.exr'
    ]);
    expect(controller.getSessions().map((session) => session.decoded.width)).toEqual([10, 20, 30]);
  });

  it('reports an error and leaves sessions unchanged when a folder has no exr files', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage());
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('existing.exr')]);

    await controller.enqueueFolderFiles([
      createFolderFile('shots/readme.md'),
      createFolderFile('shots/aovs/depth.png')
    ]);

    expect(decodeBytes).toHaveBeenCalledTimes(1);
    expect(controller.getSessions().map((session) => session.filename)).toEqual(['existing.exr']);
    expect(core.getState().errorMessage).toBe('No OpenEXR files found in the selected folder.');
  });

  it('keeps duplicate filename suffixing for files loaded from different subfolders', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValue(createDecodedImage());
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFolderFiles([
      createFolderFile('shots/a/beauty.exr'),
      createFolderFile('shots/b/beauty.exr')
    ]);

    expect(controller.getSessions().map((session) => session.displayName)).toEqual([
      'beauty.exr',
      'beauty.exr (2)'
    ]);
    expect(controller.getSessions().map((session) => session.source.kind === 'file'
      ? session.source.file.webkitRelativePath
      : session.filename
    )).toEqual([
      'shots/a/beauty.exr',
      'shots/b/beauty.exr'
    ]);
  });

  it('reorders sessions using explicit before and after placement', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage())
      .mockResolvedValueOnce(createDecodedImage())
      .mockResolvedValueOnce(createDecodedImage());
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);
    await controller.enqueueFiles([createFile('third.exr')]);

    const [first, second, third] = controller.getSessions();
    controller.reorderSessions(third!.id, second!.id, 'before');
    expect(controller.getSessions().map((session) => session.id)).toEqual([first!.id, third!.id, second!.id]);

    controller.reorderSessions(first!.id, third!.id, 'after');
    expect(controller.getSessions().map((session) => session.id)).toEqual([third!.id, first!.id, second!.id]);
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
