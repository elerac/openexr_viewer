import { describe, expect, it } from 'vitest';
import {
  buildExportBatchTarget,
  buildExportTarget,
  buildOpenedImageOptions,
  buildPathAwareOpenedImageLabels
} from '../src/app/viewer-app-selectors';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import type { DecodedExrImage, OpenedImageSession } from '../src/types';
import { createLayerFromChannels } from './helpers/state-fixtures';

function createDecodedImage(): DecodedExrImage {
  return {
    width: 2,
    height: 1,
    layers: [createLayerFromChannels({ R: [1, 0], G: [1, 0], B: [1, 0] })]
  };
}

function createFile(name: string, webkitRelativePath: string): File {
  return {
    name,
    size: 3,
    webkitRelativePath,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
  } as unknown as File;
}

function createSession(args: {
  id: string;
  filename: string;
  displayName: string;
  displayNameIsCustom?: boolean;
  sourceDetail: string;
}): OpenedImageSession {
  const decoded = createDecodedImage();
  return {
    id: args.id,
    filename: args.filename,
    displayName: args.displayName,
    displayNameIsCustom: args.displayNameIsCustom,
    fileSizeBytes: 3,
    source: {
      kind: 'file',
      file: createFile(args.filename, args.sourceDetail)
    },
    decoded,
    state: buildViewerStateForLayer(createInitialState(), decoded, 0)
  };
}

describe('path-aware opened image labels', () => {
  it('keeps fallback labels for unique basenames', () => {
    expect(buildPathAwareOpenedImageLabels([
      { fallbackLabel: 'beauty.exr', sourceDetail: 'shots/a/beauty.exr' },
      { fallbackLabel: 'depth.exr', sourceDetail: 'shots/a/depth.exr' }
    ])).toEqual(['beauty.exr', 'depth.exr']);
  });

  it('uses the shortest unique trailing path for duplicate relative-path basenames', () => {
    expect(buildPathAwareOpenedImageLabels([
      { fallbackLabel: 'image.exr', sourceDetail: 'shots/hoge/image.exr' },
      { fallbackLabel: 'image.exr (2)', sourceDetail: 'shots/fuga/image.exr' }
    ])).toEqual(['hoge/image.exr', 'fuga/image.exr']);
  });

  it('expands deeper when duplicate paths share a parent suffix', () => {
    expect(buildPathAwareOpenedImageLabels([
      { fallbackLabel: 'image.exr', sourceDetail: 'left/shot/a/image.exr' },
      { fallbackLabel: 'image.exr (2)', sourceDetail: 'right/shot/a/image.exr' }
    ])).toEqual(['left/shot/a/image.exr', 'right/shot/a/image.exr']);
  });

  it('keeps duplicate numbering when identical full paths cannot be separated by path', () => {
    expect(buildPathAwareOpenedImageLabels([
      { fallbackLabel: 'image.exr', sourceDetail: 'hoge/image.exr' },
      { fallbackLabel: 'image.exr (2)', sourceDetail: 'hoge/image.exr' }
    ])).toEqual(['hoge/image.exr', 'hoge/image.exr (2)']);
  });

  it('uses numeric fallback only for duplicate basenames without path context', () => {
    expect(buildPathAwareOpenedImageLabels([
      { fallbackLabel: 'image.exr', sourceDetail: 'image.exr' },
      { fallbackLabel: 'image.exr (2)', sourceDetail: 'shots/fuga/image.exr' }
    ])).toEqual(['image.exr', 'fuga/image.exr']);
  });

  it('normalizes backslash separators before comparing paths', () => {
    expect(buildPathAwareOpenedImageLabels([
      { fallbackLabel: 'image.exr', sourceDetail: 'shots\\hoge\\image.exr' },
      { fallbackLabel: 'image.exr (2)', sourceDetail: 'shots\\fuga\\image.exr' }
    ])).toEqual(['hoge/image.exr', 'fuga/image.exr']);
  });
});

describe('opened image option labels', () => {
  it('marks pending opened-image reservations as thumbnail loading', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'pendingOpenedImagesReserved',
      reservations: [{
        id: 'pending-1',
        filename: 'sphere_owl.exr',
        displayName: 'sphere_owl.exr',
        fileSizeBytes: 3,
        source: {
          kind: 'url',
          url: '/sphere_owl.exr'
        }
      }]
    });

    expect(buildOpenedImageOptions(core.getState())[0]).toMatchObject({
      label: 'sphere_owl.exr',
      thumbnailDataUrl: null,
      thumbnailLoading: true,
      selectable: false
    });
  });

  it('tracks loaded opened-image thumbnail loading status until thumbnail generation finishes', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-1',
        filename: 'image.exr',
        displayName: 'image.exr',
        sourceDetail: 'shots/image.exr'
      })
    });

    expect(buildOpenedImageOptions(core.getState())[0]).toMatchObject({
      thumbnailDataUrl: null,
      thumbnailLoading: true
    });

    core.dispatch({ type: 'thumbnailRequested', sessionId: 'session-1', token: 1 });
    core.dispatch({
      type: 'thumbnailReady',
      sessionId: 'session-1',
      token: 1,
      thumbnailDataUrl: 'data:image/png;base64,AAAA'
    });

    expect(buildOpenedImageOptions(core.getState())[0]).toMatchObject({
      thumbnailDataUrl: 'data:image/png;base64,AAAA',
      thumbnailLoading: false
    });

    core.dispatch({ type: 'thumbnailRequested', sessionId: 'session-1', token: 2 });
    core.dispatch({
      type: 'thumbnailReady',
      sessionId: 'session-1',
      token: 2,
      thumbnailDataUrl: null
    });

    expect(buildOpenedImageOptions(core.getState())[0]).toMatchObject({
      thumbnailDataUrl: null,
      thumbnailLoading: false
    });
  });

  it('shows compact path labels for folder-loaded duplicate basenames', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-1',
        filename: 'image.exr',
        displayName: 'image.exr',
        sourceDetail: 'shots/hoge/image.exr'
      })
    });
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-2',
        filename: 'image.exr',
        displayName: 'image.exr (2)',
        sourceDetail: 'shots/fuga/image.exr'
      })
    });

    expect(buildOpenedImageOptions(core.getState()).map((option) => option.label)).toEqual([
      'hoge/image.exr',
      'fuga/image.exr'
    ]);
    expect(buildOpenedImageOptions(core.getState()).map((option) => option.sourceDetail)).toEqual([
      'shots/hoge/image.exr',
      'shots/fuga/image.exr'
    ]);
  });

  it('uses custom display names directly while preserving path-aware labels for non-custom duplicates', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-1',
        filename: 'image.exr',
        displayName: 'Hero Plate.exr',
        displayNameIsCustom: true,
        sourceDetail: 'shots/custom/image.exr'
      })
    });
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-2',
        filename: 'image.exr',
        displayName: 'image.exr',
        sourceDetail: 'shots/hoge/image.exr'
      })
    });
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-3',
        filename: 'image.exr',
        displayName: 'image.exr (2)',
        sourceDetail: 'shots/fuga/image.exr'
      })
    });

    expect(buildOpenedImageOptions(core.getState()).map((option) => option.label)).toEqual([
      'Hero Plate.exr',
      'hoge/image.exr',
      'fuga/image.exr'
    ]);
  });

  it('uses custom display names for export defaults and batch labels without changing source paths', () => {
    const core = new ViewerAppCore();
    core.dispatch({
      type: 'sessionLoaded',
      session: createSession({
        id: 'session-1',
        filename: 'image.exr',
        displayName: 'Hero Plate.exr',
        displayNameIsCustom: true,
        sourceDetail: 'shots/hoge/image.exr'
      })
    });

    const state = core.getState();
    const session = state.sessions[0] ?? null;
    const batchTarget = buildExportBatchTarget(state);

    expect(buildExportTarget(session)).toEqual({ filename: 'Hero Plate.png' });
    expect(batchTarget?.files[0]).toMatchObject({
      sessionId: 'session-1',
      filename: 'image.exr',
      label: 'Hero Plate.exr',
      sourcePath: 'shots/hoge/image.exr'
    });
  });
});
