// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayRenderer } from '../src/rendering/overlay-renderer';
import { createChannelRgbSelection, createLayerFromChannels, createViewerState } from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('overlay renderer', () => {
  it('does not render value labels in panorama mode', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(1);

    renderer.resize(800, 400);
    renderer.setDisplaySelectionContext(1000, 500, layer, createChannelRgbSelection('R', 'G', 'B'));
    renderer.render(createViewerState({
      viewerMode: 'panorama',
      panoramaHfovDeg: 2,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('keeps image-viewer value labels working unchanged', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'));
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 32,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).toHaveBeenCalled();
  });
});

function createOverlayHarness(): {
  renderer: OverlayRenderer;
  context: CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };
} {
  const context = {
    clearRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    lineJoin: 'round',
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: ''
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === '2d') {
      return context;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  return {
    renderer: new OverlayRenderer(canvas),
    context
  };
}

function createDisplayLayer(pixelCount: number) {
  return createLayerFromChannels({
    R: new Float32Array(pixelCount).fill(1),
    G: new Float32Array(pixelCount).fill(0.5),
    B: new Float32Array(pixelCount).fill(0.25)
  });
}
