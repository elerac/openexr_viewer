// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RulerOverlayRenderer } from '../src/rendering/ruler-overlay-renderer';
import { createViewerState } from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ruler overlay renderer', () => {
  it('clears without drawing when rulers are hidden or no image is active', () => {
    const { renderer, context } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.render(createViewerState({ viewerMode: 'image' }), true);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(context.fillRect).not.toHaveBeenCalled();

    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({ viewerMode: 'image' }), false);

    expect(context.fillRect).not.toHaveBeenCalled();
  });

  it('suppresses ruler drawing in panorama mode', () => {
    const { renderer, context } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({ viewerMode: 'panorama' }), true);

    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('draws top and left pixel rulers in image mode', () => {
    const { renderer, context } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 1,
      panX: 50,
      panY: 25
    }), true);

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 24);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 24, 100);
    expect(context.fillText).toHaveBeenCalledWith('0', 50, 8);
    expect(context.fillText).toHaveBeenCalledWith('100', 150, 8);
    expect(context.save).toHaveBeenCalled();
  });

  it('moves tick labels with pan and clamps labels to image bounds', () => {
    const { renderer, context } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 1,
      panX: 60,
      panY: 25
    }), true);

    expect(context.fillText).toHaveBeenCalledWith('0', 40, 8);
    expect(context.fillText).toHaveBeenCalledWith('100', 140, 8);
    expect(context.fillText.mock.calls.map((call) => call[0])).not.toContain('-100');
  });
});

function createRulerHarness(): {
  renderer: RulerOverlayRenderer;
  context: CanvasRenderingContext2D & {
    beginPath: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
  };
} {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    moveTo: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    font: '',
    lineWidth: 1,
    strokeStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic'
  } as unknown as CanvasRenderingContext2D & {
    beginPath: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
  };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === '2d') {
      return context;
    }
    return null;
  });

  return {
    renderer: new RulerOverlayRenderer(document.createElement('canvas')),
    context
  };
}
