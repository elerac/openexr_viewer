import { describe, expect, it, vi } from 'vitest';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { applyRenderEffects } from '../src/app/viewer-app-render-effects';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import type { RenderCacheService } from '../src/services/render-cache-service';
import type { WebGlExrRenderer } from '../src/renderer';
import type { ViewerUi } from '../src/ui/viewer-ui';
import type { DecodedExrImage, OpenedImageSession, ViewerRenderState } from '../src/types';
import { createLayerFromChannels } from './helpers/state-fixtures';

function createDecodedImage(): DecodedExrImage {
  return {
    width: 2,
    height: 1,
    layers: [createLayerFromChannels({
      R: [1, 2],
      G: [0, 0],
      B: [0, 0]
    }, 'beauty')]
  };
}

function createSession(id: string, decoded = createDecodedImage()): OpenedImageSession {
  return {
    id,
    filename: `${id}.exr`,
    displayName: `${id}.exr`,
    fileSizeBytes: decoded.width * decoded.height * 16,
    source: { kind: 'url', url: `/${id}.exr` },
    decoded,
    state: buildViewerStateForLayer(createInitialState(), decoded, 0)
  };
}

function createUiMock(): ViewerUi {
  return {
    setProbeReadout: vi.fn(),
    setRoiReadout: vi.fn(),
    setViewerStateReadout: vi.fn(),
    setImageStats: vi.fn()
  } as unknown as ViewerUi;
}

function createRendererMock() {
  return {
    setColormapTexture: vi.fn(),
    clearColormapTexture: vi.fn(),
    clearImage: vi.fn(),
    setRulersVisible: vi.fn(),
    renderImage: vi.fn(),
    renderValueOverlay: vi.fn(),
    renderProbeOverlay: vi.fn(),
    renderRulerOverlay: vi.fn()
  };
}

function createRenderCacheMock() {
  return {
    prepareActiveSession: vi.fn(() => ({
      textureRevisionKey: 'texture',
      textureDirty: true
    })),
    getCachedLuminanceRange: vi.fn(() => null),
    requestImageStats: vi.fn(() => ({
      imageStats: null,
      pending: false
    })),
    requestAutoExposure: vi.fn(() => ({
      autoExposure: null,
      previewAutoExposure: {
        scalar: 4,
        exposureEv: -2,
        percentile: 99.5,
        source: 'rgbMax'
      },
      pending: true
    }))
  };
}

describe('viewer app render effects', () => {
  it('clears the renderer colormap texture when the active lut becomes unavailable', () => {
    const core = new ViewerAppCore();
    const ui = createUiMock();
    const renderer = createRendererMock();
    const renderCache = createRenderCacheMock();
    core.subscribeRender((transition) => {
      applyRenderEffects(
        core,
        ui,
        renderer as unknown as WebGlExrRenderer,
        renderCache as unknown as RenderCacheService,
        transition
      );
    });

    core.dispatch({ type: 'sessionLoaded', session: createSession('session-1') });
    core.dispatch({ type: 'activeColormapSet', colormapId: '1' });
    core.dispatch({
      type: 'colormapLoadResolved',
      requestId: null as never,
      colormapId: '1',
      lut: {
        id: '1',
        label: 'HSV',
        entryCount: 2,
        rgba8: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
      }
    });
    renderer.setColormapTexture.mockClear();
    renderer.clearColormapTexture.mockClear();

    core.dispatch({ type: 'activeColormapSet', colormapId: '0' });

    expect(renderer.clearColormapTexture).toHaveBeenCalledTimes(1);
    expect(renderer.setColormapTexture).not.toHaveBeenCalled();
  });

  it('renders auto exposure preview after the stale triggering render pass', () => {
    const core = new ViewerAppCore();
    const ui = createUiMock();
    const renderer = createRendererMock();
    const renderCache = createRenderCacheMock();
    core.subscribeRender((transition) => {
      applyRenderEffects(
        core,
        ui,
        renderer as unknown as WebGlExrRenderer,
        renderCache as unknown as RenderCacheService,
        transition
      );
    });

    core.dispatch({ type: 'autoExposureSet', enabled: true });
    core.dispatch({ type: 'sessionLoaded', session: createSession('session-1') });

    const exposureCalls = renderer.renderImage.mock.calls.map(([state]) => {
      return (state as ViewerRenderState).exposureEv;
    });
    expect(exposureCalls).toEqual([0, -2]);
    expect(core.getState().sessionState.exposureEv).toBe(-2);
  });
});
