// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProbeOverlayRenderer } from '../src/rendering/probe-overlay-renderer';
import { createViewerState } from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probe overlay renderer', () => {
  it('renders the probe marker on its dedicated canvas layer', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      zoom: 32,
      panX: 1,
      panY: 0.5,
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.clearRect).toHaveBeenCalled();
    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('clears without drawing when there is no active probe target', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState());

    expect(context.clearRect).toHaveBeenCalled();
    expect(context.strokeRect).not.toHaveBeenCalled();
  });
});

function createProbeOverlayHarness(): {
  renderer: ProbeOverlayRenderer;
  context: CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };
} {
  const context = {
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    lineWidth: 1,
    strokeStyle: ''
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === '2d') {
      return context;
    }
    return null;
  });

  return {
    renderer: new ProbeOverlayRenderer(document.createElement('canvas')),
    context
  };
}
