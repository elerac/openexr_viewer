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
    renderer.setDisplaySelectionContext(1000, 500, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'panorama',
      panoramaHfovDeg: 2,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('does not render value labels below the fade start zoom', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 24,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).not.toHaveBeenCalled();
    expect(context.alphaHistory).toEqual([]);
    expect(context.globalAlpha).toBe(1);
  });

  it('fades value labels in with partial transparency inside the zoom ramp', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 28,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).toHaveBeenCalled();
    expect(context.alphaHistory).toEqual([0.5, 1]);
    expect(context.globalAlpha).toBe(1);
  });

  it('renders value labels at full opacity at and above the full-opacity zoom', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 32,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).toHaveBeenCalled();
    expect(context.alphaHistory).toEqual([1, 1]);
    expect(context.globalAlpha).toBe(1);
  });
});

function createOverlayHarness(): {
  renderer: OverlayRenderer;
  context: CanvasRenderingContext2D & {
    alphaHistory: number[];
    clearRect: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };
} {
  let globalAlpha = 1;
  const alphaHistory: number[] = [];
  const context = {
    alphaHistory,
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
    alphaHistory: number[];
    clearRect: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };

  Object.defineProperty(context, 'globalAlpha', {
    configurable: true,
    enumerable: true,
    get: () => globalAlpha,
    set: (value: number) => {
      globalAlpha = value;
      alphaHistory.push(value);
    }
  });

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
