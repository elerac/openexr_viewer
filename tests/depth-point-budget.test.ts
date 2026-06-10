import { describe, expect, it, vi } from 'vitest';
import {
  collectDepthPointBudgetEnvironmentHints,
  CONSTRAINED_DEPTH_POINTS,
  createAdaptiveDepthPointBudgetResolver,
  resolveAdaptiveDepthPointBudget
} from '../src/depth-point-budget';
import { MAX_DEPTH_POINTS } from '../src/depth';

const MEBIBYTE = 1024 * 1024;

describe('depth point budget', () => {
  it('keeps the desktop ceiling by default', () => {
    expect(resolveAdaptiveDepthPointBudget({})).toBe(MAX_DEPTH_POINTS);
  });

  it('keeps the desktop ceiling for large default-point-size viewports', () => {
    expect(resolveAdaptiveDepthPointBudget({
      viewportWidth: 1920,
      viewportHeight: 1080,
      pointSizePx: 2
    })).toBe(MAX_DEPTH_POINTS);
  });

  it('caps the budget for small viewports by screen-space density', () => {
    expect(resolveAdaptiveDepthPointBudget({
      viewportWidth: 320,
      viewportHeight: 180,
      pointSizePx: 2
    })).toBe(230_400);
  });

  it('lowers the screen-space budget for larger point sizes', () => {
    expect(resolveAdaptiveDepthPointBudget({
      viewportWidth: 1920,
      viewportHeight: 1080,
      pointSizePx: 8
    })).toBe(518_400);
  });

  it('uses the lower of constrained-device and screen-space budgets', () => {
    expect(resolveAdaptiveDepthPointBudget({
      deviceMemoryGb: 4,
      viewportWidth: 1920,
      viewportHeight: 1080,
      pointSizePx: 2
    })).toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({
      deviceMemoryGb: 4,
      viewportWidth: 320,
      viewportHeight: 180,
      pointSizePx: 2
    })).toBe(230_400);
  });

  it('uses the constrained budget for low device memory', () => {
    expect(resolveAdaptiveDepthPointBudget({ deviceMemoryGb: 4 })).toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({ deviceMemoryGb: 4.1 })).toBe(MAX_DEPTH_POINTS);
  });

  it('uses the constrained budget for low hardware concurrency', () => {
    expect(resolveAdaptiveDepthPointBudget({ hardwareConcurrency: 4 })).toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({ hardwareConcurrency: 5 })).toBe(MAX_DEPTH_POINTS);
  });

  it('uses the constrained budget for a low JS heap limit', () => {
    expect(resolveAdaptiveDepthPointBudget({ jsHeapSizeLimitBytes: 1536 * MEBIBYTE }))
      .toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({ jsHeapSizeLimitBytes: 1537 * MEBIBYTE }))
      .toBe(MAX_DEPTH_POINTS);
  });

  it('uses the constrained budget for coarse touch devices with small viewports', () => {
    expect(resolveAdaptiveDepthPointBudget({
      coarsePointer: true,
      maxTouchPoints: 1,
      viewportWidth: 1200,
      viewportHeight: 900
    })).toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({
      anyCoarsePointer: true,
      maxTouchPoints: 1,
      viewportWidth: 900,
      viewportHeight: 1200
    })).toBe(CONSTRAINED_DEPTH_POINTS);
  });

  it('does not constrain touch-capable desktops with fine pointers or large viewports', () => {
    expect(resolveAdaptiveDepthPointBudget({
      coarsePointer: false,
      anyCoarsePointer: false,
      maxTouchPoints: 10,
      viewportWidth: 800,
      viewportHeight: 600
    })).toBe(MAX_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({
      coarsePointer: true,
      maxTouchPoints: 10,
      viewportWidth: 1600,
      viewportHeight: 901
    })).toBe(MAX_DEPTH_POINTS);
  });

  it('uses mobile user-agent signals as a fallback', () => {
    expect(resolveAdaptiveDepthPointBudget({ userAgentDataMobile: true })).toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolveAdaptiveDepthPointBudget({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    })).toBe(CONSTRAINED_DEPTH_POINTS);
  });

  it('treats missing and invalid capability values as neutral', () => {
    expect(resolveAdaptiveDepthPointBudget({
      deviceMemoryGb: 0,
      hardwareConcurrency: Number.NaN,
      jsHeapSizeLimitBytes: -1,
      maxTouchPoints: -1,
      coarsePointer: true,
      viewportWidth: 800,
      viewportHeight: null,
      userAgentDataMobile: false,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)'
    })).toBe(MAX_DEPTH_POINTS);
  });

  it('collects capability hints from a browser-like global', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(any-pointer: coarse)'
    }));

    expect(collectDepthPointBudgetEnvironmentHints({
      navigator: {
        deviceMemory: 8,
        hardwareConcurrency: 6,
        maxTouchPoints: 2,
        userAgentData: { mobile: false },
        userAgent: 'Mozilla/5.0'
      },
      performance: {
        memory: {
          jsHeapSizeLimit: 2048 * MEBIBYTE
        }
      },
      matchMedia,
      innerWidth: 1440,
      innerHeight: 900
    })).toEqual({
      deviceMemoryGb: 8,
      hardwareConcurrency: 6,
      jsHeapSizeLimitBytes: 2048 * MEBIBYTE,
      maxTouchPoints: 2,
      coarsePointer: false,
      anyCoarsePointer: true,
      viewportWidth: 1440,
      viewportHeight: 900,
      pointSizePx: null,
      userAgentDataMobile: false,
      userAgent: 'Mozilla/5.0'
    });
  });

  it('lets injected resolvers use the current viewport', () => {
    const resolver = createAdaptiveDepthPointBudgetResolver({
      navigator: {
        deviceMemory: 8,
        hardwareConcurrency: 8,
        maxTouchPoints: 1,
        userAgent: 'Mozilla/5.0'
      },
      performance: {
        memory: {
          jsHeapSizeLimit: 4096 * MEBIBYTE
        }
      },
      matchMedia: () => ({ matches: true })
    });

    expect(resolver({ width: 1200, height: 900 })).toBe(CONSTRAINED_DEPTH_POINTS);
    expect(resolver({ width: 1200, height: 901 })).toBe(MAX_DEPTH_POINTS);
  });
});
