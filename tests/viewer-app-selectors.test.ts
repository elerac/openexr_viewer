import { describe, expect, it } from 'vitest';
import {
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
  sourceDetail: string;
}): OpenedImageSession {
  const decoded = createDecodedImage();
  return {
    id: args.id,
    filename: args.filename,
    displayName: args.displayName,
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
});
