import { describe, expect, it } from 'vitest';
import {
  clampScreenshotSelectionRect,
  createDefaultScreenshotSelectionRect,
  resolveScreenshotSelectionHandle,
  updateScreenshotSelectionRectFromDrag
} from '../src/interaction/screenshot-selection';

describe('screenshot selection geometry', () => {
  it('creates a centered default rectangle covering most of the viewport', () => {
    expect(createDefaultScreenshotSelectionRect({ width: 1000, height: 500 })).toEqual({
      x: 150,
      y: 75,
      width: 700,
      height: 350
    });
  });

  it('clamps selections to the viewport and enforces a minimum size', () => {
    expect(clampScreenshotSelectionRect({
      x: -20,
      y: 90,
      width: 4,
      height: 400
    }, { width: 100, height: 120 })).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 120
    });
  });

  it('resolves corners, edges, move, and empty space with handle priority', () => {
    const rect = { x: 20, y: 30, width: 100, height: 80 };

    expect(resolveScreenshotSelectionHandle({ x: 20, y: 30 }, rect)).toBe('corner-nw');
    expect(resolveScreenshotSelectionHandle({ x: 70, y: 30 }, rect)).toBe('edge-n');
    expect(resolveScreenshotSelectionHandle({ x: 120, y: 70 }, rect)).toBe('edge-e');
    expect(resolveScreenshotSelectionHandle({ x: 70, y: 70 }, rect)).toBe('move');
    expect(resolveScreenshotSelectionHandle({ x: 5, y: 70 }, rect)).toBeNull();
  });

  it('moves and resizes rectangles while keeping them inside the viewport', () => {
    const viewport = { width: 200, height: 120 };
    const startRect = { x: 40, y: 30, width: 80, height: 50 };

    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'move',
      startPoint: { x: 50, y: 40 },
      startRect
    }, { x: 200, y: 200 }, viewport)).toEqual({
      rect: {
        x: 120,
        y: 70,
        width: 80,
        height: 50
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });

    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-nw',
      startPoint: { x: 40, y: 30 },
      startRect
    }, { x: 110, y: 90 }, viewport)).toEqual({
      rect: {
        x: 104,
        y: 64,
        width: 16,
        height: 16
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });
  });

  it('snaps corner resizing to a square when the dimensions are near 1:1', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 130, y: 110 },
      startRect: { x: 50, y: 40, width: 80, height: 70 }
    }, { x: 145, y: 133 }, { width: 240, height: 200 })).toEqual({
      rect: {
        x: 50,
        y: 40,
        width: 94,
        height: 94
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });
  });

  it('snaps edge resizing by preserving the opposite dimension when the square fits', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-e',
      startPoint: { x: 110, y: 70 },
      startRect: { x: 30, y: 20, width: 80, height: 100 }
    }, { x: 125, y: 70 }, { width: 180, height: 160 })).toEqual({
      rect: {
        x: 30,
        y: 20,
        width: 100,
        height: 100
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });
  });

  it('does not snap resized selections outside the square threshold', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-e',
      startPoint: { x: 110, y: 70 },
      startRect: { x: 30, y: 20, width: 80, height: 100 }
    }, { x: 150, y: 70 }, { width: 180, height: 160 })).toEqual({
      rect: {
        x: 30,
        y: 20,
        width: 120,
        height: 100
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('snaps moved selections to an optional center target', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'move',
      startPoint: { x: 45, y: 35 },
      startRect: { x: 20, y: 20, width: 50, height: 30 }
    }, { x: 73, y: 60 }, { width: 200, height: 160 }, {
      centerSnapTarget: { x: 75, y: 60 }
    })).toEqual({
      rect: {
        x: 50,
        y: 45,
        width: 50,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: 75, y: 60 }
    });
  });

  it('snaps resized selections to a center target while keeping the opposite edge anchored', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-e',
      startPoint: { x: 100, y: 40 },
      startRect: { x: 20, y: 20, width: 80, height: 40 }
    }, { x: 126, y: 40 }, { width: 200, height: 120 }, {
      centerSnapTarget: { x: 75, y: 80 }
    })).toEqual({
      rect: {
        x: 20,
        y: 20,
        width: 110,
        height: 40
      },
      squareSnapped: false,
      snapGuide: { x: 75, y: null }
    });
  });

  it('snaps moved selection edges to optional displayed image edge targets', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'move',
      startPoint: { x: 45, y: 35 },
      startRect: { x: 20, y: 20, width: 50, height: 30 }
    }, { x: 50, y: 35 }, { width: 200, height: 160 }, {
      edgeSnapTargets: { x: [80], y: [] }
    })).toEqual({
      rect: {
        x: 30,
        y: 20,
        width: 50,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: 80, y: null }
    });
  });

  it('snaps resized selection edges to optional displayed image edge targets', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-e',
      startPoint: { x: 100, y: 40 },
      startRect: { x: 20, y: 20, width: 80, height: 40 }
    }, { x: 126, y: 40 }, { width: 200, height: 120 }, {
      edgeSnapTargets: { x: [130], y: [] }
    })).toEqual({
      rect: {
        x: 20,
        y: 20,
        width: 110,
        height: 40
      },
      squareSnapped: false,
      snapGuide: { x: 130, y: null }
    });
  });

  it('uses the closest valid snap target on each axis', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-e',
      startPoint: { x: 100, y: 40 },
      startRect: { x: 20, y: 20, width: 80, height: 40 }
    }, { x: 126, y: 40 }, { width: 200, height: 120 }, {
      centerSnapTarget: { x: 75, y: 80 },
      edgeSnapTargets: { x: [127], y: [] }
    })).toEqual({
      rect: {
        x: 20,
        y: 20,
        width: 107,
        height: 40
      },
      squareSnapped: false,
      snapGuide: { x: 127, y: null }
    });
  });

  it('skips center snapping when exact alignment would leave the viewport', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'move',
      startPoint: { x: 40, y: 35 },
      startRect: { x: 20, y: 20, width: 40, height: 30 }
    }, { x: 20, y: 35 }, { width: 100, height: 100 }, {
      centerSnapTarget: { x: 10, y: 80 }
    })).toEqual({
      rect: {
        x: 0,
        y: 20,
        width: 40,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('ignores invalid displayed image edge targets and rejects snaps that would violate minimum size', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'move',
      startPoint: { x: 40, y: 35 },
      startRect: { x: 20, y: 20, width: 40, height: 30 }
    }, { x: 42, y: 35 }, { width: 100, height: 100 }, {
      edgeSnapTargets: { x: [-1, 101], y: [] }
    })).toEqual({
      rect: {
        x: 22,
        y: 20,
        width: 40,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });

    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-w',
      startPoint: { x: 20, y: 35 },
      startRect: { x: 20, y: 20, width: 40, height: 30 }
    }, { x: 43, y: 35 }, { width: 100, height: 100 }, {
      edgeSnapTargets: { x: [50], y: [] }
    })).toEqual({
      rect: {
        x: 43,
        y: 20,
        width: 17,
        height: 30
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('keeps square snapping ahead of center snapping', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-e',
      startPoint: { x: 110, y: 70 },
      startRect: { x: 30, y: 20, width: 80, height: 100 }
    }, { x: 125, y: 70 }, { width: 180, height: 160 }, {
      centerSnapTarget: { x: 75, y: 80 },
      edgeSnapTargets: { x: [130], y: [120] }
    })).toEqual({
      rect: {
        x: 30,
        y: 20,
        width: 100,
        height: 100
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });
  });

  it('preserves the starting aspect ratio for shift corner resizes', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 160, y: 90 },
      startRect: { x: 40, y: 30, width: 120, height: 60 }
    }, { x: 200, y: 100 }, { width: 260, height: 180 }, {
      preserveAspectRatio: true
    })).toEqual({
      rect: {
        x: 40,
        y: 30,
        width: 160,
        height: 80
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('skips center snapping while preserving aspect ratio on shift resizes', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 100, y: 60 },
      startRect: { x: 20, y: 20, width: 80, height: 40 }
    }, { x: 126, y: 63 }, { width: 200, height: 120 }, {
      preserveAspectRatio: true,
      centerSnapTarget: { x: 75, y: 80 }
    })).toEqual({
      rect: {
        x: 20,
        y: 20,
        width: 106,
        height: 53
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('preserves aspect ratio for shift edge resizes with the opposite edge fixed', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-s',
      startPoint: { x: 100, y: 90 },
      startRect: { x: 40, y: 30, width: 120, height: 60 }
    }, { x: 100, y: 110 }, { width: 240, height: 180 }, {
      preserveAspectRatio: true
    })).toEqual({
      rect: {
        x: 20,
        y: 30,
        width: 160,
        height: 80
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });

    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'edge-w',
      startPoint: { x: 40, y: 60 },
      startRect: { x: 40, y: 30, width: 120, height: 60 }
    }, { x: 10, y: 60 }, { width: 240, height: 180 }, {
      preserveAspectRatio: true
    })).toEqual({
      rect: {
        x: 10,
        y: 22.5,
        width: 150,
        height: 75
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('clamps shift aspect-locked resizes to the viewport', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 160, y: 90 },
      startRect: { x: 60, y: 40, width: 100, height: 50 }
    }, { x: 260, y: 160 }, { width: 180, height: 120 }, {
      preserveAspectRatio: true
    })).toEqual({
      rect: {
        x: 60,
        y: 40,
        width: 120,
        height: 60
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('enforces minimum size while preserving aspect ratio on shift resizes', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 100, y: 60 },
      startRect: { x: 20, y: 20, width: 80, height: 40 }
    }, { x: 10, y: 10 }, { width: 160, height: 120 }, {
      preserveAspectRatio: true
    })).toEqual({
      rect: {
        x: 20,
        y: 20,
        width: 32,
        height: 16
      },
      squareSnapped: false,
      snapGuide: { x: null, y: null }
    });
  });

  it('keeps square snapping within viewport bounds and minimum size', () => {
    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 190, y: 40 },
      startRect: { x: 150, y: 0, width: 40, height: 40 }
    }, { x: 210, y: 60 }, { width: 200, height: 200 })).toEqual({
      rect: {
        x: 150,
        y: 0,
        width: 50,
        height: 50
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });

    expect(updateScreenshotSelectionRectFromDrag({
      handle: 'corner-se',
      startPoint: { x: 30, y: 32 },
      startRect: { x: 10, y: 10, width: 20, height: 22 }
    }, { x: 15, y: 15 }, { width: 100, height: 100 })).toEqual({
      rect: {
        x: 10,
        y: 10,
        width: 16,
        height: 16
      },
      squareSnapped: true,
      snapGuide: { x: null, y: null }
    });
  });
});
