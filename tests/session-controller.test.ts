import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../src/controllers/session-controller';
import { LoadQueueService } from '../src/services/load-queue';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { buildOpenedImageOptions } from '../src/app/viewer-app-selectors';
import type { DecodeBytesOptions } from '../src/exr-decode-context';
import { DecodedExrImage } from '../src/types';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection
} from './helpers/state-fixtures';
import type { DesktopFileEntry, PathFileProvider } from '../src/platform';

const RGB_STOKES_CHANNEL_NAMES = [
  'R', 'G', 'B',
  'S0.R', 'S0.G', 'S0.B',
  'S1.R', 'S1.G', 'S1.B',
  'S2.R', 'S2.G', 'S2.B',
  'S3.R', 'S3.G', 'S3.B'
];

const BEACHBALL_MULTIPART_URL =
  'https://raw.githubusercontent.com/AcademySoftwareFoundation/openexr-images/main/Beachball/multipart.0001.exr';
const BROWN_PHOTOSTUDIO_02_1K_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
const KAIST_SCENE27_REFLECTANCE_URL =
  'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/scene27_reflectance.exr';

const rulerFitInsets = {
  top: 24,
  right: 0,
  bottom: 0,
  left: 24
};

function createDecodedImage(width = 4, height = 4, channelNames: string[] = ['R', 'G', 'B']): DecodedExrImage {
  const pixelCount = width * height;
  const channelValues = Object.fromEntries(
    channelNames.map((channelName, index) => {
      const fillValue = channelName.startsWith('S') ? (index + 1) * 0.25 : index + 1;
      return [channelName, new Float32Array(pixelCount).fill(fillValue)];
    })
  ) as Record<string, Float32Array>;
  const layer = createLayerFromChannels(channelValues, 'beauty');

  return {
    width,
    height,
    layers: [layer]
  };
}

function createRgbStokesDecodedImage(width = 4, height = 4): DecodedExrImage {
  return createDecodedImage(width, height, RGB_STOKES_CHANNEL_NAMES);
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
  decodeBytes?: (bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>;
  pathFileProvider?: PathFileProvider | null;
  onPathSessionLoaded?: (entry: DesktopFileEntry) => void;
  onPathSessionLoadFailed?: (entry: DesktopFileEntry, error: unknown) => void;
  getFitInsets?: () => { top: number; right: number; bottom: number; left: number } | undefined;
  maxWorkers?: number;
} = {}) {
  const core = new ViewerAppCore();
  const controller = new SessionController({
    core,
    loadQueue: new LoadQueueService({ maxWorkers: options.maxWorkers }),
    decodeBytes: options.decodeBytes ?? (async () => createDecodedImage()),
    pathFileProvider: options.pathFileProvider,
    onPathSessionLoaded: options.onPathSessionLoaded,
    onPathSessionLoadFailed: options.onPathSessionLoadFailed,
    getViewport: () => ({ width: 200, height: 100 }),
    getFitInsets: options.getFitInsets ?? (() => undefined)
  });

  return { controller, core };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('session controller shim', () => {
  it('applies decoded images as new active sessions', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage(8, 4));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('beauty.exr')]);

    const session = controller.getActiveSession();
    expect(decodeBytes).toHaveBeenCalledTimes(1);
    expect(session?.filename).toBe('beauty.exr');
    expect(session?.displayName).toBe('beauty.exr');
    expect(session?.displayNameIsCustom).toBeUndefined();
    expect(core.getState().sessionState.activeColormapId).toBeNull();
    expect(core.getState().sessionState.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('loads desktop path entries as reloadable path-backed sessions', async () => {
    const entry: DesktopFileEntry = {
      grantId: 'grant-beauty',
      path: '/renders/beauty.exr',
      filename: 'beauty.exr',
      displayPath: '/renders/beauty.exr',
      fileSizeBytes: 3
    };
    const pathFileProvider: PathFileProvider = {
      resolveExrPaths: vi.fn(async () => [entry]),
      listExrFolder: vi.fn(async () => []),
      openRecentFile: vi.fn(async () => entry),
      readExrFile: vi.fn(async () => ({
        grantId: entry.grantId,
        bytes: new Uint8Array([1, 2, 3])
      }))
    };
    const decodeBytes = vi.fn(async () => createDecodedImage(8, 4));
    const onPathSessionLoaded = vi.fn();
    const { controller } = createController({
      decodeBytes,
      pathFileProvider,
      onPathSessionLoaded
    });

    await controller.enqueuePaths(['/renders/beauty.exr']);

    expect(pathFileProvider.resolveExrPaths).toHaveBeenCalledWith(['/renders/beauty.exr'], expect.any(AbortSignal));
    expect(pathFileProvider.readExrFile).toHaveBeenCalledWith('grant-beauty', expect.any(AbortSignal));
    expect(onPathSessionLoaded).toHaveBeenCalledWith(entry);
    expect(controller.getActiveSession()).toMatchObject({
      filename: 'beauty.exr',
      fileSizeBytes: 3,
      source: {
        kind: 'path',
        grantId: 'grant-beauty',
        path: '/renders/beauty.exr',
        displayPath: '/renders/beauty.exr'
      }
    });

    await controller.reloadSession(controller.getActiveSession()!.id);

    expect(pathFileProvider.readExrFile).toHaveBeenCalledTimes(2);
    expect(decodeBytes).toHaveBeenCalledTimes(2);
  });

  it('loads desktop folder paths in stable listed order', async () => {
    const entries: DesktopFileEntry[] = [
      {
        grantId: 'grant-b',
        path: '/renders/shot/b.exr',
        filename: 'b.exr',
        displayPath: '/renders/shot/b.exr',
        relativePath: 'b.exr',
        fileSizeBytes: 3
      },
      {
        grantId: 'grant-a',
        path: '/renders/shot/a.exr',
        filename: 'a.exr',
        displayPath: '/renders/shot/a.exr',
        relativePath: 'a.exr',
        fileSizeBytes: 3
      }
    ];
    const pathFileProvider: PathFileProvider = {
      resolveExrPaths: vi.fn(async () => []),
      listExrFolder: vi.fn(async () => entries),
      openRecentFile: vi.fn(async () => entries[0]!),
      readExrFile: vi.fn(async (grantId) => ({
        grantId,
        bytes: new Uint8Array([1, 2, 3])
      }))
    };
    const { controller } = createController({ pathFileProvider, maxWorkers: 2 });

    await controller.enqueueFolderPath('/renders/shot');

    expect(pathFileProvider.listExrFolder).toHaveBeenCalledWith('/renders/shot', expect.any(AbortSignal));
    expect(controller.getSessions().map((session) => session.filename)).toEqual(['b.exr', 'a.exr']);
  });

  it('applies explicit file display names without replacing source filenames', async () => {
    const { controller, core } = createController();

    await controller.enqueueFiles([createFile('beauty.exr')], { displayName: '  Hero Plate  ' });

    expect(controller.getActiveSession()).toMatchObject({
      filename: 'beauty.exr',
      displayName: 'Hero Plate',
      displayNameIsCustom: true
    });
    expect(buildOpenedImageOptions(core.getState())[0]).toMatchObject({
      label: 'Hero Plate',
      displayNameIsCustom: true
    });
  });

  it.each([
    {
      galleryId: 'beachball-multipart-0001',
      filename: 'multipart.0001.exr',
      url: BEACHBALL_MULTIPART_URL
    },
    {
      galleryId: 'brown-photostudio-02-1k',
      filename: 'brown_photostudio_02_1k.exr',
      url: BROWN_PHOTOSTUDIO_02_1K_URL
    },
    {
      galleryId: 'kaist-scene27-reflectance',
      filename: 'scene27_reflectance.exr',
      url: KAIST_SCENE27_REFLECTANCE_URL
    }
  ])('loads $filename from its configured raw URL', async ({ galleryId, filename, url }) => {
    const encodedBytes = new Uint8Array([9, 8, 7]);
    const decodeBytes = vi.fn<(
      bytes: Uint8Array,
      options?: DecodeBytesOptions
    ) => Promise<DecodedExrImage>>(async () => createDecodedImage(8, 4));
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(encodedBytes));
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock
    });

    try {
      const { controller } = createController({ decodeBytes });

      await controller.enqueueGalleryImage(galleryId);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
      expect(decodeBytes).toHaveBeenCalledTimes(1);
      expect(Array.from(decodeBytes.mock.calls[0]?.[0] ?? [])).toEqual(Array.from(encodedBytes));
      expect(decodeBytes.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        filename,
        signal: expect.any(AbortSignal)
      }));

      const session = controller.getActiveSession();
      expect(session?.filename).toBe(filename);
      expect(session?.source).toEqual({
        kind: 'url',
        url
      });
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch
      });
    }
  });

  it('loads an arbitrary URL as a URL-backed session', async () => {
    const url = 'https://example.com/renders/beauty.exr?download=1';
    const encodedBytes = new Uint8Array([1, 3, 5, 7]);
    const decodeBytes = vi.fn<(
      bytes: Uint8Array,
      options?: DecodeBytesOptions
    ) => Promise<DecodedExrImage>>(async () => createDecodedImage(8, 4));
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(encodedBytes));
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock
    });

    try {
      const { controller } = createController({ decodeBytes });

      await controller.enqueueUrl(url, { displayName: 'Beauty pass' });

      expect(fetchMock).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
      expect(decodeBytes.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        filename: 'beauty.exr',
        signal: expect.any(AbortSignal)
      }));
      expect(controller.getActiveSession()).toMatchObject({
        filename: 'beauty.exr',
        displayName: 'Beauty pass',
        displayNameIsCustom: true,
        source: {
          kind: 'url',
          url
        }
      });
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch
      });
    }
  });

  it('activates the first decoded image while the rest of a multi-file open continues loading', async () => {
    const firstDecode = createDeferred<DecodedExrImage>();
    const secondDecode = createDeferred<DecodedExrImage>();
    const decodeBytes = vi
      .fn<(bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>>()
      .mockReturnValueOnce(firstDecode.promise)
      .mockReturnValueOnce(secondDecode.promise);
    const { controller, core } = createController({ decodeBytes });

    const pending = controller.enqueueFiles([
      createFile('first.exr', [1]),
      createFile('second.exr', [2])
    ]);
    for (let index = 0; index < 6 && decodeBytes.mock.calls.length < 1; index += 1) {
      await flushMicrotasks();
    }

    expect(core.getState().isLoading).toBe(true);
    expect(controller.getSessions()).toHaveLength(0);
    expect(buildOpenedImageOptions(core.getState()).map((option) => ({
      label: option.label,
      selectable: option.selectable,
      thumbnailDataUrl: option.thumbnailDataUrl
    }))).toEqual([
      { label: 'first.exr', selectable: false, thumbnailDataUrl: null },
      { label: 'second.exr', selectable: false, thumbnailDataUrl: null }
    ]);

    firstDecode.resolve(createDecodedImage(4, 4));
    for (let index = 0; index < 6 && controller.getSessions().length < 1; index += 1) {
      await flushMicrotasks();
    }

    expect(controller.getSessions().map((session) => session.filename)).toEqual(['first.exr']);
    expect(controller.getActiveSession()?.filename).toBe('first.exr');
    expect(buildOpenedImageOptions(core.getState()).map((option) => ({
      label: option.label,
      selectable: option.selectable
    }))).toEqual([
      { label: 'first.exr', selectable: true },
      { label: 'second.exr', selectable: false }
    ]);
    expect(core.getState().isLoading).toBe(true);

    secondDecode.resolve(createDecodedImage(8, 4));
    await pending;

    expect(controller.getSessions().map((session) => session.filename)).toEqual(['first.exr', 'second.exr']);
    expect(controller.getActiveSession()?.filename).toBe('first.exr');
    expect(core.getState().isLoading).toBe(false);
  });

  it('starts multi-file decodes in parallel while committing sessions in selection order', async () => {
    const firstDecode = createDeferred<DecodedExrImage>();
    const secondDecode = createDeferred<DecodedExrImage>();
    const decodeBytes = vi
      .fn<(bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>>()
      .mockReturnValueOnce(firstDecode.promise)
      .mockReturnValueOnce(secondDecode.promise);
    const { controller, core } = createController({ decodeBytes, maxWorkers: 2 });

    const pending = controller.enqueueFiles([
      createFile('first.exr', [1]),
      createFile('second.exr', [2])
    ]);
    for (let index = 0; index < 6 && decodeBytes.mock.calls.length < 2; index += 1) {
      await flushMicrotasks();
    }

    expect(decodeBytes).toHaveBeenCalledTimes(2);
    expect(controller.getSessions()).toHaveLength(0);

    secondDecode.resolve(createDecodedImage(8, 4));
    for (let index = 0; index < 6; index += 1) {
      await flushMicrotasks();
    }
    expect(controller.getSessions()).toHaveLength(0);
    expect(buildOpenedImageOptions(core.getState()).map((option) => ({
      label: option.label,
      selectable: option.selectable
    }))).toEqual([
      { label: 'first.exr', selectable: false },
      { label: 'second.exr', selectable: false }
    ]);

    firstDecode.resolve(createDecodedImage(4, 4));
    await pending;

    expect(controller.getSessions().map((session) => session.filename)).toEqual(['first.exr', 'second.exr']);
    expect(controller.getActiveSession()?.filename).toBe('first.exr');
    expect(core.getState().isLoading).toBe(false);
  });

  it('activates the first successful parallel decode when earlier files fail', async () => {
    const firstDecode = createDeferred<DecodedExrImage>();
    const secondDecode = createDeferred<DecodedExrImage>();
    const decodeBytes = vi
      .fn<(bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>>()
      .mockReturnValueOnce(firstDecode.promise)
      .mockReturnValueOnce(secondDecode.promise);
    const { controller, core } = createController({ decodeBytes, maxWorkers: 2 });

    const pending = controller.enqueueFiles([
      createFile('broken.exr', [1]),
      createFile('second.exr', [2])
    ]);
    for (let index = 0; index < 6 && decodeBytes.mock.calls.length < 2; index += 1) {
      await flushMicrotasks();
    }

    secondDecode.resolve(createDecodedImage(8, 4));
    for (let index = 0; index < 6; index += 1) {
      await flushMicrotasks();
    }
    expect(controller.getSessions()).toHaveLength(0);

    firstDecode.reject(new Error('decode failed'));
    await pending;

    expect(controller.getSessions().map((session) => session.filename)).toEqual(['second.exr']);
    expect(controller.getActiveSession()?.filename).toBe('second.exr');
    expect(core.getState().errorMessage).toBe('Load failed: decode failed');
  });

  it('activates the first successful decode when earlier files in a multi-file open fail', async () => {
    const firstDecode = createDeferred<DecodedExrImage>();
    const secondDecode = createDeferred<DecodedExrImage>();
    const decodeBytes = vi
      .fn<(bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>>()
      .mockReturnValueOnce(firstDecode.promise)
      .mockReturnValueOnce(secondDecode.promise);
    const { controller, core } = createController({ decodeBytes });

    const pending = controller.enqueueFiles([
      createFile('broken.exr', [1]),
      createFile('second.exr', [2])
    ]);
    for (let index = 0; index < 6 && decodeBytes.mock.calls.length < 1; index += 1) {
      await flushMicrotasks();
    }

    firstDecode.reject(new Error('decode failed'));
    for (let index = 0; index < 6 && decodeBytes.mock.calls.length < 2; index += 1) {
      await flushMicrotasks();
    }

    expect(buildOpenedImageOptions(core.getState()).map((option) => ({
      label: option.label,
      selectable: option.selectable
    }))).toEqual([
      { label: 'second.exr', selectable: false }
    ]);

    secondDecode.resolve(createDecodedImage(8, 4));
    await pending;

    expect(controller.getSessions().map((session) => session.filename)).toEqual(['second.exr']);
    expect(controller.getActiveSession()?.filename).toBe('second.exr');
  });

  it('uses current fit insets when applying the first decoded image', async () => {
    const { controller, core } = createController({
      decodeBytes: async () => createDecodedImage(4, 4),
      getFitInsets: () => rulerFitInsets
    });

    await controller.enqueueFiles([createFile('beauty.exr')]);

    expect(core.getState().sessionState.zoom).toBe(19);
    expect(core.getState().sessionState.panX).toBeCloseTo(26 / 19);
    expect(core.getState().sessionState.panY).toBeCloseTo(26 / 19);
  });

  it('passes per-decode signal and filename context to file decodes', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage(8, 4));
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('beauty.exr')]);

    expect(decodeBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        filename: 'beauty.exr'
      })
    );
  });

  it('keeps a matching plain channel selection when loading a new image', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createChannelMonoSelection('G')
    });

    await controller.enqueueFiles([createFile('second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('second.exr');
    expect(core.getState().sessionState.displaySelection).toEqual(createChannelMonoSelection('G'));
  });

  it('keeps colormap state when loading a new image with the same selected channel', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6, ['R', 'G', 'B', 'Z']))
      .mockResolvedValueOnce(createDecodedImage(6, 6, ['R', 'G', 'B', 'Z']));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createChannelMonoSelection('Z')
    });
    core.dispatch({
      type: 'activeColormapSet',
      colormapId: '2'
    });
    core.dispatch({
      type: 'colormapRangeSet',
      range: { min: 0.2, max: 0.8 }
    });
    core.dispatch({
      type: 'visualizationModeRequested',
      visualizationMode: 'colormap'
    });

    await controller.enqueueFiles([createFile('second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('second.exr');
    expect(core.getState().sessionState).toMatchObject({
      visualizationMode: 'colormap',
      activeColormapId: '2',
      colormapRange: { min: 0.2, max: 0.8 },
      colormapRangeMode: 'oneTime',
      displaySelection: createChannelMonoSelection('Z')
    });
  });

  it('resets colormap state when loading a new image falls back to a different channel', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6, ['R', 'G', 'B', 'mask']))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createChannelMonoSelection('mask')
    });
    core.dispatch({
      type: 'activeColormapSet',
      colormapId: '2'
    });
    core.dispatch({
      type: 'colormapRangeSet',
      range: { min: 0.2, max: 0.8 }
    });
    core.dispatch({
      type: 'visualizationModeRequested',
      visualizationMode: 'colormap'
    });

    await controller.enqueueFiles([createFile('second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('second.exr');
    expect(core.getState().sessionState).toMatchObject({
      visualizationMode: 'rgb',
      activeColormapId: null,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    });
  });

  it('keeps a matching grouped Stokes selection when loading a new image', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createRgbStokesDecodedImage(6, 6))
      .mockResolvedValueOnce(createRgbStokesDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('stokes-first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createStokesSelection('aolp', 'stokesRgb')
    });

    await controller.enqueueFiles([createFile('stokes-second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('stokes-second.exr');
    expect(core.getState().sessionState.displaySelection).toEqual(createStokesSelection('aolp', 'stokesRgb'));
  });

  it('keeps a matching split Stokes selection and colormap state when loading a new image', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createRgbStokesDecodedImage(6, 6))
      .mockResolvedValueOnce(createRgbStokesDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('stokes-first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'R')
    });
    core.dispatch({
      type: 'activeColormapSet',
      colormapId: '2'
    });
    core.dispatch({
      type: 'colormapLoadResolved',
      requestId: null as never,
      colormapId: '2',
      lut: {
        id: '2',
        label: 'Secondary',
        entryCount: 2,
        rgba8: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255])
      }
    });
    core.dispatch({
      type: 'colormapRangeSet',
      range: { min: 0.1, max: 0.9 }
    });

    await controller.enqueueFiles([createFile('stokes-second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('stokes-second.exr');
    expect(core.getState().sessionState).toMatchObject({
      visualizationMode: 'colormap',
      activeColormapId: '2',
      colormapRange: { min: 0.1, max: 0.9 },
      colormapRangeMode: 'oneTime',
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'R')
    });
  });

  it('keeps the requested split Stokes colormap while a colormap load is still in flight', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createRgbStokesDecodedImage(6, 6))
      .mockResolvedValueOnce(createRgbStokesDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('stokes-first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'R')
    });
    core.dispatch({
      type: 'activeColormapSet',
      colormapId: '2'
    });
    core.dispatch({
      type: 'colormapRangeSet',
      range: { min: 0.1, max: 0.9 }
    });

    await controller.enqueueFiles([createFile('stokes-second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('stokes-second.exr');
    expect(core.getState().sessionState).toMatchObject({
      visualizationMode: 'colormap',
      activeColormapId: '2',
      colormapRange: { min: 0.1, max: 0.9 },
      colormapRangeMode: 'oneTime',
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'R')
    });
  });

  it('falls back to the new image default selection when the current selection is incompatible', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6, ['R', 'G', 'B', 'mask']))
      .mockResolvedValueOnce(createDecodedImage(6, 6));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    core.dispatch({
      type: 'displaySelectionSet',
      displaySelection: createChannelMonoSelection('mask')
    });

    await controller.enqueueFiles([createFile('second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('second.exr');
    expect(core.getState().sessionState.displaySelection).toEqual(createChannelRgbSelection('R', 'G', 'B'));
  });

  it('carries current image view, lock state, and ROI when loading a new image', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(6, 6))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
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
    core.dispatch({
      type: 'roiSet',
      roi: { x0: 2, y0: 3, x1: 6, y1: 7 }
    });

    await controller.enqueueFiles([createFile('second.exr')]);

    expect(controller.getActiveSession()?.filename).toBe('second.exr');
    expect(core.getState().sessionState).toMatchObject({
      zoom: 3,
      panX: 5,
      panY: 6,
      lockedPixel: { ix: 1, iy: 1 },
      roi: { x0: 2, y0: 3, x1: 6, y1: 7 }
    });
  });

  it('switches active sessions while carrying current view, lock state, and ROI', async () => {
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
    core.dispatch({
      type: 'roiSet',
      roi: { x0: 2, y0: 1, x1: 4, y1: 5 }
    });

    controller.switchActiveSession(firstSession!.id);

    expect(controller.getActiveSessionId()).toBe(firstSession!.id);
    expect(core.getState().sessionState).toMatchObject({
      zoom: 3,
      panX: 4,
      panY: 5,
      exposureEv: 2,
      displaySelection: createChannelMonoSelection('R'),
      lockedPixel: { ix: 1, iy: 1 },
      roi: { x0: 2, y0: 1, x1: 4, y1: 5 }
    });
  });

  it('clamps carried ROI to the target image when switching sessions', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [firstSession] = controller.getSessions();
    core.dispatch({
      type: 'roiSet',
      roi: { x0: 2, y0: 1, x1: 6, y1: 5 }
    });

    controller.switchActiveSession(firstSession!.id);

    expect(core.getState().sessionState.roi).toEqual({ x0: 2, y0: 1, x1: 3, y1: 3 });
  });

  it('clears carried ROI when it no longer intersects the target image on session switch', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('first.exr')]);
    await controller.enqueueFiles([createFile('second.exr')]);

    const [firstSession] = controller.getSessions();
    core.dispatch({
      type: 'roiSet',
      roi: { x0: 5, y0: 5, x1: 7, y1: 7 }
    });

    controller.switchActiveSession(firstSession!.id);

    expect(core.getState().sessionState.roi).toBeNull();
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

  it('fits the active session after reload when auto-fit is enabled', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockResolvedValueOnce(createDecodedImage(8, 8));
    const { controller, core } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('reload.exr')]);
    const sessionId = controller.getActiveSessionId()!;
    core.dispatch({
      type: 'viewStateCommitted',
      view: {
        zoom: 3,
        panX: 20,
        panY: 30,
        panoramaYawDeg: 0,
        panoramaPitchDeg: 0,
        panoramaHfovDeg: 100
      }
    });
    core.dispatch({
      type: 'autoFitImageOnSelectSet',
      enabled: true
    });

    await controller.reloadSession(sessionId);

    expect(core.getState().sessionState).toMatchObject({
      zoom: 12.5,
      panX: 4,
      panY: 4
    });
    expect(controller.getActiveSession()?.state).toMatchObject({
      zoom: 12.5,
      panX: 4,
      panY: 4
    });
  });

  it('cancels in-flight reload decodes when the session is closed', async () => {
    const reloadSignalRef: { current: AbortSignal | null } = { current: null };
    const decodeBytes = vi
      .fn<(bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>>()
      .mockResolvedValueOnce(createDecodedImage(4, 4))
      .mockImplementationOnce((_bytes, options) => {
        reloadSignalRef.current = options?.signal ?? null;
        return new Promise<DecodedExrImage>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(options.signal!.reason);
          }, { once: true });
        });
      });
    const { controller } = createController({ decodeBytes });

    await controller.enqueueFiles([createFile('reload.exr')]);
    const sessionId = controller.getActiveSessionId()!;
    const pending = controller.reloadSession(sessionId);
    for (let index = 0; index < 6 && !reloadSignalRef.current; index += 1) {
      await Promise.resolve();
    }

    controller.closeSession(sessionId);

    await expect(pending).resolves.toBeUndefined();
    if (!reloadSignalRef.current) {
      throw new Error('Reload signal was not captured.');
    }
    expect(reloadSignalRef.current.aborted).toBe(true);
    expect(controller.getActiveSession()).toBeNull();
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

  it('keeps recursive folder session order when parallel decodes finish out of order', async () => {
    const firstDecode = createDeferred<DecodedExrImage>();
    const secondDecode = createDeferred<DecodedExrImage>();
    const thirdDecode = createDeferred<DecodedExrImage>();
    const decodeBytes = vi
      .fn<(bytes: Uint8Array, options?: DecodeBytesOptions) => Promise<DecodedExrImage>>()
      .mockReturnValueOnce(firstDecode.promise)
      .mockReturnValueOnce(secondDecode.promise)
      .mockReturnValueOnce(thirdDecode.promise);
    const { controller } = createController({ decodeBytes, maxWorkers: 3 });

    const pending = controller.enqueueFolderFiles([
      createFolderFile('shots/z_last.exr', [30]),
      createFolderFile('shots/aovs/beauty.exr', [10]),
      createFolderFile('shots/aovs/masks/id.exr', [20])
    ]);
    for (let index = 0; index < 6 && decodeBytes.mock.calls.length < 3; index += 1) {
      await flushMicrotasks();
    }

    thirdDecode.resolve(createDecodedImage(30, 4));
    secondDecode.resolve(createDecodedImage(20, 4));
    for (let index = 0; index < 6; index += 1) {
      await flushMicrotasks();
    }
    expect(controller.getSessions()).toHaveLength(0);

    firstDecode.resolve(createDecodedImage(10, 4));
    await pending;

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

  it('blocks over-limit folder loads until an override is provided', async () => {
    const decodeBytes = vi.fn(async () => createDecodedImage());
    const { controller, core } = createController({ decodeBytes });
    const files = Array.from({ length: 251 }, (_value, index) => {
      return createFolderFile(`shots/${String(index).padStart(3, '0')}.exr`);
    });

    await controller.enqueueFolderFiles(files);

    expect(decodeBytes).not.toHaveBeenCalled();
    expect(controller.getSessions()).toHaveLength(0);
    expect(core.getState().errorMessage).toContain('Folder load blocked.');

    await controller.enqueueFolderFiles(files, { overrideLimits: true });

    expect(decodeBytes).toHaveBeenCalledTimes(251);
    expect(controller.getSessions()).toHaveLength(251);
  });

  it('keeps duplicate filename suffixing for files loaded from different subfolders', async () => {
    const decodeBytes = vi
      .fn<(_: Uint8Array) => Promise<DecodedExrImage>>()
      .mockResolvedValue(createDecodedImage());
    const { controller, core } = createController({ decodeBytes });

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
    expect(buildOpenedImageOptions(core.getState()).map((option) => option.label)).toEqual([
      'a/beauty.exr',
      'b/beauty.exr'
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
    const { controller, core } = createController({ decodeBytes });

    const pending = controller.enqueueFiles([createFile('dispose.exr')]);
    for (let index = 0; index < 6 && !resolveDecode; index += 1) {
      await Promise.resolve();
    }

    controller.dispose();
    resolveDecode(createDecodedImage());

    await expect(pending).resolves.toBeUndefined();
    expect(controller.getActiveSession()).toBeNull();
    expect(buildOpenedImageOptions(core.getState())).toEqual([]);
  });
});
