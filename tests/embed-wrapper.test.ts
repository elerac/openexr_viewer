// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const EMBED_LOAD_FILE_MESSAGE = 'prismifold:load-file';
const EMBED_READY_MESSAGE = 'prismifold:embed-ready';
const EMBED_DEFERRED_LOAD_MESSAGE = 'prismifold:deferred-load';
const embedScript = readFileSync(resolve(process.cwd(), 'public/embed/prismifold.js'), 'utf8');
const originalFetch = window.fetch;
const originalIframeContentWindow = Object.getOwnPropertyDescriptor(
  HTMLIFrameElement.prototype,
  'contentWindow'
);

interface PrismifoldViewerElementForTest extends HTMLElement {
  viewerOrigin: string;
  viewerTargetOrigin: string;
  loadFile(file: File, options?: { name?: string; view?: string }): Promise<void>;
  loadUrl(src: string, options?: { name?: string; sourceOrigin?: string; view?: string }): Promise<void>;
  setView(view: string): void;
}

interface PrismifoldControllerForTest {
  element: PrismifoldViewerElementForTest;
  loadFile(file: File, options?: { name?: string; view?: string }): Promise<void>;
  loadUrl(src: string, options?: { name?: string; sourceOrigin?: string; view?: string }): Promise<void>;
  setView(view: string): PrismifoldControllerForTest;
  destroy(): void;
}

interface PrismifoldApiForTest {
  create(target: string | HTMLElement, options?: {
    src?: string;
    file?: File;
    name?: string;
    view?: string;
    width?: number | string;
    height?: number | string;
    viewerUrl?: string;
    sourceOrigin?: string;
    bottomPanel?: string;
    autoLoad?: boolean | string;
  }): PrismifoldControllerForTest;
}

interface PrismifoldWindowForTest extends Window {
  Prismifold: PrismifoldApiForTest;
}

beforeAll(() => {
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get() {
      return window;
    }
  });
  window.eval(embedScript);
});

afterAll(() => {
  if (originalIframeContentWindow) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', originalIframeContentWindow);
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  if (originalFetch) {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch
    });
  } else {
    Reflect.deleteProperty(window, 'fetch');
  }
});

describe('embed wrapper public script', () => {
  it('registers the custom element and global JS API', () => {
    expect(customElements.get('prismifold-viewer')).toEqual(expect.any(Function));
    expect(getPrismifold().create).toEqual(expect.any(Function));
    const legacyElementName = ['openexr', 'viewer'].join('-');
    const legacyGlobalName = ['Open', 'Exr', 'Viewer'].join('');
    expect(customElements.get(legacyElementName)).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[legacyGlobalName]).toBeUndefined();
  });

  it('creates iframe-backed viewers with expected attributes', () => {
    document.body.innerHTML = '<div id="target"></div>';

    const controller = getPrismifold().create('#target', {
      src: 'https://example.com/render.exr',
      name: 'Beauty pass',
      width: 300,
      height: 240,
      view: 'panorama',
      bottomPanel: 'channels'
    });

    const iframe = getViewerIframe(controller.element);
    const iframeUrl = new URL(iframe.src);

    expect(controller.element.parentElement?.id).toBe('target');
    expect(controller.element.style.width).toBe('300px');
    expect(controller.element.getAttribute('name')).toBe('Beauty pass');
    expect(controller.element.getAttribute('bottom-panel')).toBe('channels');
    expect(iframe.style.height).toBe('240px');
    expect(iframe.allowFullscreen).toBe(false);
    expect(iframeUrl.pathname).toBe('/app/');
    expect(iframeUrl.searchParams.get('ui')).toBe('embed');
    expect(iframeUrl.searchParams.get('src')).toBe('https://example.com/render.exr');
    expect(iframeUrl.searchParams.get('name')).toBe('Beauty pass');
    expect(iframeUrl.searchParams.get('view')).toBe('panorama');
    expect(iframeUrl.searchParams.get('bottomPanel')).toBe('channels');
  });

  it('passes bottom-panel markup through and omits the default probe query param', () => {
    const defaultElement = document.createElement('prismifold-viewer');
    defaultElement.setAttribute('src', 'https://example.com/default.exr');
    document.body.append(defaultElement);

    expect(new URL(getViewerIframe(defaultElement).src).searchParams.get('bottomPanel')).toBeNull();

    const noneElement = document.createElement('prismifold-viewer');
    noneElement.setAttribute('src', 'https://example.com/hidden.exr');
    noneElement.setAttribute('bottom-panel', 'none');
    document.body.append(noneElement);

    expect(new URL(getViewerIframe(noneElement).src).searchParams.get('bottomPanel')).toBe('none');
  });

  it('parent-fetches relative sources and posts them to the iframe', async () => {
    document.body.innerHTML = '<div id="target"></div>';
    const fetchMock = stubFetchOk();

    const controller = getPrismifold().create('#target', {
      src: './public/cbox_rgb.exr',
      name: 'Cornell Box',
      width: 300,
      height: 300,
      view: 'panorama'
    });
    const iframe = getViewerIframe(controller.element);
    const postMessage = spyOnIframePostMessage(iframe);

    dispatchEmbedReady(controller.element, iframe);
    await flushPromises();

    const posted = postMessage.mock.calls[0]?.[0] as {
      type: string;
      file: File;
      name?: string;
      state?: { viewerMode?: string } | null;
    };
    expect(fetchMock).toHaveBeenCalledWith(new URL('./public/cbox_rgb.exr', document.baseURI).toString());
    expect(new URL(iframe.src).searchParams.get('src')).toBeNull();
    expect(new URL(iframe.src).searchParams.get('view')).toBe('panorama');
    expect(posted).toMatchObject({
      type: EMBED_LOAD_FILE_MESSAGE,
      name: 'Cornell Box',
      state: {
        viewerMode: 'panorama'
      }
    });
    expect(posted.file).toBeInstanceOf(File);
    expect(posted.file.name).toBe('Cornell Box');
    expect(postMessage.mock.calls[0]?.[1]).toBe(controller.element.viewerTargetOrigin);
  });

  it('defers parent-fetched relative sources when autoLoad is false', async () => {
    document.body.innerHTML = '<div id="target"></div>';
    const fetchMock = stubFetchOk();

    const controller = getPrismifold().create('#target', {
      src: './public/cbox_rgb.exr',
      name: 'Deferred Cornell Box',
      view: 'panorama',
      autoLoad: false
    });
    const iframe = getViewerIframe(controller.element);
    const postMessage = spyOnIframePostMessage(iframe);
    const iframeUrl = new URL(iframe.src);

    expect(controller.element.getAttribute('auto-load')).toBe('false');
    expect(iframeUrl.searchParams.get('autoLoad')).toBe('false');
    expect(iframeUrl.searchParams.get('src')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    dispatchEmbedReady(controller.element, iframe);
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();

    dispatchEmbedDeferredLoad(controller.element, iframe);
    await flushPromises();

    const posted = postMessage.mock.calls[0]?.[0] as {
      type: string;
      file: File;
      name?: string;
      state?: { viewerMode?: string } | null;
    };
    expect(fetchMock).toHaveBeenCalledWith(new URL('./public/cbox_rgb.exr', document.baseURI).toString());
    expect(posted).toMatchObject({
      type: EMBED_LOAD_FILE_MESSAGE,
      name: 'Deferred Cornell Box',
      state: {
        viewerMode: 'panorama'
      }
    });
    expect(posted.file.name).toBe('Deferred Cornell Box');
  });

  it('keeps absolute HTTPS sources in the iframe URL by default', () => {
    document.body.innerHTML = '<div id="target"></div>';
    const fetchMock = stubFetchOk();

    const controller = getPrismifold().create('#target', {
      src: 'https://example.com/render.exr',
      name: 'Remote render'
    });
    const iframeUrl = new URL(getViewerIframe(controller.element).src);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(iframeUrl.pathname).toBe('/app/');
    expect(iframeUrl.searchParams.get('src')).toBe('https://example.com/render.exr');
  });

  it('passes autoLoad=false through for viewer-fetched absolute sources', () => {
    document.body.innerHTML = '<div id="target"></div>';
    const fetchMock = stubFetchOk();

    const controller = getPrismifold().create('#target', {
      src: 'https://example.com/render.exr',
      name: 'Deferred remote render',
      autoLoad: false
    });
    const iframeUrl = new URL(getViewerIframe(controller.element).src);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(controller.element.getAttribute('auto-load')).toBe('false');
    expect(iframeUrl.searchParams.get('src')).toBe('https://example.com/render.exr');
    expect(iframeUrl.searchParams.get('autoLoad')).toBe('false');
  });

  it('accepts autoload as a markup alias for auto-load', () => {
    const element = document.createElement('prismifold-viewer');
    element.setAttribute('src', 'https://example.com/render.exr');
    element.setAttribute('autoload', 'false');
    document.body.append(element);

    const iframeUrl = new URL(getViewerIframe(element).src);
    expect(iframeUrl.searchParams.get('autoLoad')).toBe('false');
  });

  it('forces parent fetch when sourceOrigin is parent', async () => {
    document.body.innerHTML = '<div id="target"></div>';
    const fetchMock = stubFetchOk();
    const controller = getPrismifold().create('#target');

    const loadPromise = controller.loadUrl('https://example.com/render.exr', {
      name: 'Parent fetched',
      view: 'panorama',
      sourceOrigin: 'parent'
    });
    const iframe = getViewerIframe(controller.element);
    const postMessage = spyOnIframePostMessage(iframe);

    dispatchEmbedReady(controller.element, iframe);
    await loadPromise;

    const posted = postMessage.mock.calls[0]?.[0] as {
      type: string;
      file: File;
      name?: string;
      state?: { viewerMode?: string } | null;
    };
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/render.exr');
    expect(new URL(iframe.src).searchParams.get('src')).toBeNull();
    expect(new URL(iframe.src).searchParams.get('view')).toBe('panorama');
    expect(posted.type).toBe(EMBED_LOAD_FILE_MESSAGE);
    expect(posted.name).toBe('Parent fetched');
    expect(posted.state).toEqual({
      viewerMode: 'panorama'
    });
  });

  it('supports controller loadFile, loadUrl, setView, and destroy', async () => {
    document.body.innerHTML = '<div id="target"></div>';
    const controller = getPrismifold().create('#target', {
      height: 200
    });
    const initialIframe = getViewerIframe(controller.element);
    const postMessage = spyOnIframePostMessage(initialIframe);

    dispatchEmbedReady(controller.element, initialIframe);
    await controller.loadFile(new File(['pixels'], 'local.exr'), {
      name: 'Local plate',
      view: 'panorama'
    });

    const posted = postMessage.mock.calls[0]?.[0] as {
      type: string;
      file: File;
      name?: string;
      state?: { viewerMode?: string } | null;
    };
    expect(posted.type).toBe(EMBED_LOAD_FILE_MESSAGE);
    expect(posted.file.name).toBe('local.exr');
    expect(posted.name).toBe('Local plate');
    expect(posted.state).toEqual({
      viewerMode: 'panorama'
    });
    expect(controller).not.toHaveProperty('loadGallery');

    await controller.loadUrl('https://example.com/next.exr', {
      name: 'Next plate',
      view: 'image'
    });
    const url = new URL(getViewerIframe(controller.element).src);
    expect(controller.element.getAttribute('src')).toBe('https://example.com/next.exr');
    expect(url.pathname).toBe('/app/');
    expect(url.searchParams.get('src')).toBe('https://example.com/next.exr');
    expect(url.searchParams.get('gallery')).toBeNull();
    expect(url.searchParams.get('name')).toBe('Next plate');
    expect(url.searchParams.get('view')).toBe('image');

    controller.setView('panorama');
    const panoramaUrl = new URL(getViewerIframe(controller.element).src);
    expect(panoramaUrl.pathname).toBe('/app/');
    expect(panoramaUrl.searchParams.get('view')).toBe('panorama');

    controller.destroy();
    expect(document.querySelector('prismifold-viewer')).toBeNull();
  });
});

function getPrismifold(): PrismifoldApiForTest {
  return (window as unknown as PrismifoldWindowForTest).Prismifold;
}

function getViewerIframe(element: HTMLElement): HTMLIFrameElement {
  const iframe = element.shadowRoot?.querySelector('iframe');
  expect(iframe).toBeInstanceOf(HTMLIFrameElement);
  return iframe as HTMLIFrameElement;
}

function dispatchEmbedReady(element: PrismifoldViewerElementForTest, iframe: HTMLIFrameElement): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow,
    origin: element.viewerOrigin,
    data: {
      type: EMBED_READY_MESSAGE
    }
  }));
}

function dispatchEmbedDeferredLoad(element: PrismifoldViewerElementForTest, iframe: HTMLIFrameElement): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow,
    origin: element.viewerOrigin,
    data: {
      type: EMBED_DEFERRED_LOAD_MESSAGE
    }
  }));
}

function spyOnIframePostMessage(iframe: HTMLIFrameElement) {
  if (!iframe.contentWindow) {
    throw new Error('Expected iframe.contentWindow to exist.');
  }
  return vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => undefined);
}

function stubFetchOk() {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    return {
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], {
        type: 'image/x-exr'
      })
    } as Response;
  });
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock
  });
  return fetchMock;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
