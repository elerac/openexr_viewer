// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  registerEmbedMessageBridge,
  runInitialBootstrapLoad
} from '../src/embed/embed-runtime';
import { EMBED_LOAD_FILE_MESSAGE } from '../src/embed/local-file-handoff';
import type { AppHandle } from '../src/app/bootstrap';

function createAppHandle(): AppHandle {
  return {
    loadUrl: vi.fn(async () => undefined),
    loadGallery: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    applyState: vi.fn(),
    deferInitialLoad: vi.fn(),
    openFullViewer: vi.fn(),
    dispose: vi.fn()
  };
}

describe('embed runtime', () => {
  it('passes explicit names through initial URL loads', () => {
    const urlApp = createAppHandle();
    runInitialBootstrapLoad({
      uiMode: 'embed',
      src: 'https://example.com/beauty.exr',
      name: 'Beauty pass',
      view: null,
      autoLoad: true,
      bottomPanel: 'probe',
      handoffId: null,
      state: null
    }, urlApp);

    expect(urlApp.loadUrl).toHaveBeenCalledWith('https://example.com/beauty.exr', {
      name: 'Beauty pass',
      state: null
    });
    expect(urlApp.loadGallery).not.toHaveBeenCalled();
  });

  it('defers initial embed URL loads when autoLoad is false', async () => {
    const urlApp = createAppHandle();
    const deferred: { load: (() => void | Promise<void>) | null } = { load: null };
    vi.mocked(urlApp.deferInitialLoad).mockImplementation((load) => {
      deferred.load = load;
    });

    runInitialBootstrapLoad({
      uiMode: 'embed',
      src: 'https://example.com/beauty.exr',
      name: 'Beauty pass',
      view: 'panorama',
      autoLoad: false,
      bottomPanel: 'probe',
      handoffId: null,
      state: null
    }, urlApp);

    expect(urlApp.loadUrl).not.toHaveBeenCalled();
    expect(urlApp.deferInitialLoad).toHaveBeenCalledTimes(1);

    const deferredLoad = deferred.load;
    if (!deferredLoad) {
      throw new Error('Expected deferred load callback to be registered.');
    }
    await deferredLoad();
    expect(urlApp.loadUrl).toHaveBeenCalledWith('https://example.com/beauty.exr', {
      name: 'Beauty pass',
      state: {
        viewerMode: 'panorama'
      }
    });
  });

  it('passes wrapper-provided local file names and state to app file loads', () => {
    const app = createAppHandle();
    const cleanup = registerEmbedMessageBridge(app);
    const file = new File(['pixels'], 'beauty.exr');

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        type: EMBED_LOAD_FILE_MESSAGE,
        file,
        name: 'Beauty local',
        state: {
          viewerMode: 'panorama'
        }
      }
    }));

    expect(app.loadFile).toHaveBeenCalledWith(file, {
      name: 'Beauty local',
      state: {
        viewerMode: 'panorama'
      }
    });
    cleanup();
  });
});
