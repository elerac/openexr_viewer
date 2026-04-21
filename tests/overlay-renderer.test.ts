// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayRenderer } from '../src/rendering/overlay-renderer';
import { createChannelRgbSelection, createViewerState } from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('overlay renderer', () => {
  it('does not render value labels in panorama mode', () => {
    const { renderer, context } = createOverlayHarness();

    renderer.resize(800, 400);
    renderer.setDisplayTexture(1000, 500, createDisplayTexture(1000 * 500));
    renderer.render(createViewerState({
      viewerMode: 'panorama',
      panoramaHfovDeg: 2,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('keeps image-viewer value labels working unchanged', () => {
    const { renderer, context } = createOverlayHarness();

    renderer.resize(128, 64);
    renderer.setDisplayTexture(2, 1, createDisplayTexture(2));
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

function createDisplayTexture(pixelCount: number): Float32Array {
  const texture = new Float32Array(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    texture[offset + 0] = 1;
    texture[offset + 1] = 0.5;
    texture[offset + 2] = 0.25;
    texture[offset + 3] = 1;
  }
  return texture;
}
