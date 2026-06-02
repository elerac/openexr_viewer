(() => {
  const EMBED_READY_MESSAGE = 'prismifold:embed-ready';
  const EMBED_LOAD_FILE_MESSAGE = 'prismifold:load-file';
  const EMBED_DEFERRED_LOAD_MESSAGE = 'prismifold:deferred-load';
  const SOURCE_ORIGIN_AUTO = 'auto';
  const SOURCE_ORIGIN_PARENT = 'parent';
  const SOURCE_ORIGIN_VIEWER = 'viewer';
  const observedAttributes = [
    'src',
    'view',
    'name',
    'width',
    'height',
    'viewer-url',
    'source-origin',
    'bottom-panel',
    'auto-load',
    'autoload'
  ];
  const currentScriptUrl = document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : '';

  class PrismifoldViewerElement extends HTMLElement {
    static get observedAttributes() {
      return observedAttributes;
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.iframe = null;
      this.ready = false;
      this.pendingFileLoads = [];
      this.defaultViewerBaseUrl = resolveViewerBaseUrl(currentScriptUrl);
      this.viewerBaseUrl = this.defaultViewerBaseUrl;
      this.viewerOrigin = new URL(this.viewerBaseUrl).origin;
      this.viewerTargetOrigin = normalizePostMessageTargetOrigin(this.viewerOrigin);
      this.sourceLoadId = 0;
      this.deferredFileLoad = null;
      this.updatingAttributes = false;
      this.handleMessage = this.handleMessage.bind(this);
    }

    connectedCallback() {
      window.addEventListener('message', this.handleMessage);
      this.render();
      void this.loadAttributeSource();
    }

    disconnectedCallback() {
      window.removeEventListener('message', this.handleMessage);
      this.sourceLoadId += 1;
    }

    attributeChangedCallback() {
      if (this.isConnected && !this.updatingAttributes) {
        this.render();
        void this.loadAttributeSource();
      }
    }

    loadUrl(src, options = {}) {
      const sourceUrl = normalizeNonEmpty(src);
      if (!sourceUrl) {
        return Promise.reject(new TypeError('prismifold-viewer.loadUrl(src) expects a non-empty string.'));
      }

      const nextSourceOrigin = hasOwn(options, 'sourceOrigin')
        ? normalizeSourceOrigin(options.sourceOrigin)
        : this.getSourceOrigin();
      this.updateAttributes({
        src: sourceUrl,
        name: hasOwn(options, 'name') ? options.name : undefined,
        view: hasOwn(options, 'view') ? options.view : undefined,
        'source-origin': hasOwn(options, 'sourceOrigin') ? nextSourceOrigin : undefined,
        'auto-load': 'true'
      });
      this.deferredFileLoad = null;

      if (shouldParentFetchSource(sourceUrl, nextSourceOrigin)) {
        return this.loadParentFetchedUrl(sourceUrl, {
          name: normalizeNonEmpty(this.getAttribute('name')),
          state: this.createAttributeViewerState()
        });
      }

      this.sourceLoadId += 1;
      return Promise.resolve();
    }

    loadFile(file, options = {}) {
      if (!(file instanceof File)) {
        return Promise.reject(new TypeError('prismifold-viewer.loadFile(file) expects a File.'));
      }
      this.deferredFileLoad = null;
      this.sourceLoadId += 1;
      return this.enqueueFileLoad(file, {
        name: normalizeNonEmpty(options.name),
        state: hasOwn(options, 'view')
          ? createViewerModeState(options.view)
          : this.createAttributeViewerState()
      });
    }

    setView(view) {
      this.updateAttributes({
        view: normalizeNonEmpty(view)
      });
    }

    render() {
      this.viewerBaseUrl = this.resolveViewerBaseUrl();
      this.viewerOrigin = new URL(this.viewerBaseUrl).origin;
      this.viewerTargetOrigin = normalizePostMessageTargetOrigin(this.viewerOrigin);

      const iframe = document.createElement('iframe');
      iframe.src = this.buildIframeUrl();
      iframe.title = this.getAttribute('name') || 'Prismifold viewer';
      iframe.loading = 'lazy';
      iframe.allow = 'clipboard-write';
      this.style.width = normalizeCssSize(this.getAttribute('width') || '100%');
      iframe.style.width = '100%';
      iframe.style.height = normalizeCssSize(this.getAttribute('height') || '320px');
      iframe.style.border = '0';
      iframe.style.display = 'block';
      iframe.style.background = '#05070a';

      const style = document.createElement('style');
      style.textContent = `
        :host {
          display: block;
          max-width: 100%;
        }
        iframe {
          max-width: 100%;
        }
      `;

      this.ready = false;
      this.shadowRoot.replaceChildren(style, iframe);
      this.iframe = iframe;
    }

    buildIframeUrl() {
      const url = new URL(this.viewerBaseUrl);
      const src = normalizeNonEmpty(this.getAttribute('src'));
      const view = normalizeNonEmpty(this.getAttribute('view'));
      const name = normalizeNonEmpty(this.getAttribute('name'));
      const autoLoad = this.getAutoLoad();
      const bottomPanel = normalizeEmbedBottomPanel(this.getAttribute('bottom-panel'));
      const srcUsesParentFetch = src && shouldParentFetchSource(src, this.getSourceOrigin());

      url.searchParams.set('ui', 'embed');
      if (!autoLoad) {
        url.searchParams.set('autoLoad', 'false');
      }
      if (src && !srcUsesParentFetch) {
        url.searchParams.set('src', src);
      }
      if (view) {
        url.searchParams.set('view', view);
      }
      if (name) {
        url.searchParams.set('name', name);
      }
      if (bottomPanel !== 'probe') {
        url.searchParams.set('bottomPanel', bottomPanel);
      }
      return url.toString();
    }

    handleMessage(event) {
      if (!this.iframe || event.source !== this.iframe.contentWindow) {
        return;
      }
      if (event.origin !== this.viewerOrigin) {
        return;
      }
      if (event.data?.type === EMBED_READY_MESSAGE) {
        this.ready = true;
        this.postPendingFiles();
        return;
      }
      if (event.data?.type === EMBED_DEFERRED_LOAD_MESSAGE) {
        void this.loadDeferredAttributeSource();
      }
    }

    resolveViewerBaseUrl() {
      const viewerUrl = normalizeNonEmpty(this.getAttribute('viewer-url'));
      if (viewerUrl) {
        return new URL(viewerUrl, window.location.href).toString();
      }
      return this.defaultViewerBaseUrl;
    }

    getSourceOrigin() {
      return normalizeSourceOrigin(this.getAttribute('source-origin'));
    }

    getAutoLoad() {
      if (this.hasAttribute('auto-load')) {
        return parseAutoLoad(this.getAttribute('auto-load'));
      }
      return parseAutoLoad(this.getAttribute('autoload'));
    }

    createAttributeViewerState() {
      return createViewerModeState(this.getAttribute('view'));
    }

    updateAttributes(attributes) {
      this.updatingAttributes = true;
      try {
        for (const [key, value] of Object.entries(attributes)) {
          if (value === undefined) {
            continue;
          }
          const normalized = normalizeNonEmpty(value);
          if (normalized === null) {
            this.removeAttribute(key);
          } else {
            this.setAttribute(key, normalized);
          }
        }
      } finally {
        this.updatingAttributes = false;
      }

      if (this.isConnected) {
        this.render();
      }
    }

    loadAttributeSource() {
      const src = normalizeNonEmpty(this.getAttribute('src'));
      const sourceOrigin = this.getSourceOrigin();
      if (!this.getAutoLoad() || !src || !shouldParentFetchSource(src, sourceOrigin)) {
        this.sourceLoadId += 1;
        return Promise.resolve();
      }

      return this.loadParentFetchedUrl(src, {
        name: normalizeNonEmpty(this.getAttribute('name')),
        state: this.createAttributeViewerState()
      }).catch((error) => {
        logEmbedError(`Failed to load ${src} from the embedding page.`, error);
      });
    }

    loadDeferredAttributeSource() {
      if (this.deferredFileLoad) {
        const pending = this.deferredFileLoad;
        this.deferredFileLoad = null;
        this.sourceLoadId += 1;
        return this.enqueueFileLoad(pending.file, {
          name: pending.name,
          state: pending.state
        });
      }

      const src = normalizeNonEmpty(this.getAttribute('src'));
      const sourceOrigin = this.getSourceOrigin();
      if (!src || !shouldParentFetchSource(src, sourceOrigin)) {
        this.sourceLoadId += 1;
        return Promise.resolve();
      }

      return this.loadParentFetchedUrl(src, {
        name: normalizeNonEmpty(this.getAttribute('name')),
        state: this.createAttributeViewerState()
      }).catch((error) => {
        logEmbedError(`Failed to load ${src} from the embedding page.`, error);
      });
    }

    async loadParentFetchedUrl(src, options = {}) {
      const loadId = this.sourceLoadId + 1;
      this.sourceLoadId = loadId;
      const url = new URL(src, document.baseURI).toString();
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${url} (${response.status})`);
      }

      const blob = await response.blob();
      if (loadId !== this.sourceLoadId) {
        return;
      }

      const fileName = normalizeNonEmpty(options.name) || inferFilenameFromUrl(url);
      const file = new File([blob], fileName, {
        type: blob.type || 'application/octet-stream'
      });
      await this.enqueueFileLoad(file, {
        name: normalizeNonEmpty(options.name),
        state: normalizeViewerState(options.state)
      });
    }

    setDeferredFileLoad(file, options = {}) {
      this.deferredFileLoad = {
        file,
        name: normalizeNonEmpty(options.name),
        state: hasOwn(options, 'view')
          ? createViewerModeState(options.view)
          : this.createAttributeViewerState()
      };
    }

    enqueueFileLoad(file, options = {}) {
      return new Promise((resolve, reject) => {
        this.pendingFileLoads.push({
          file,
          name: normalizeNonEmpty(options.name),
          state: normalizeViewerState(options.state),
          resolve,
          reject
        });
        this.postPendingFiles();
      });
    }

    postPendingFiles() {
      if (!this.ready || !this.iframe?.contentWindow) {
        return;
      }

      while (this.pendingFileLoads.length > 0) {
        const pending = this.pendingFileLoads.shift();
        try {
          this.iframe.contentWindow.postMessage({
            type: EMBED_LOAD_FILE_MESSAGE,
            file: pending.file,
            name: pending.name || undefined,
            state: pending.state
          }, this.viewerTargetOrigin);
          pending.resolve();
        } catch (error) {
          pending.reject(error);
        }
      }
    }
  }

  function createPrismifoldViewer(target, options = {}) {
    const container = resolveTargetElement(target);
    const element = document.createElement('prismifold-viewer');
    const autoLoad = hasOwn(options, 'autoLoad') ? parseAutoLoad(options.autoLoad) : true;

    applyCreateOptions(element, options);
    if (!autoLoad && options.src && !options.file) {
      const sourceUrl = normalizeNonEmpty(options.src);
      if (sourceUrl) {
        element.setAttribute('src', sourceUrl);
      }
    }
    if (!autoLoad && options.file) {
      element.setDeferredFileLoad(options.file, {
        name: options.name,
        view: options.view
      });
    }
    container.appendChild(element);

    const controller = {
      element,
      loadUrl: (src, loadOptions = {}) => element.loadUrl(src, loadOptions),
      loadFile: (file, loadOptions = {}) => element.loadFile(file, loadOptions),
      setView: (view) => {
        element.setView(view);
        return controller;
      },
      destroy: () => {
        element.remove();
      }
    };

    if (autoLoad && options.file) {
      void controller.loadFile(options.file, { name: options.name, view: options.view }).catch((error) => {
        logEmbedError('Failed to load the provided Prismifold file.', error);
      });
    } else if (autoLoad && options.src) {
      void controller.loadUrl(options.src, {
        name: options.name,
        view: options.view,
        sourceOrigin: options.sourceOrigin
      }).catch((error) => {
        logEmbedError(`Failed to load ${options.src}.`, error);
      });
    }

    return controller;
  }

  function applyCreateOptions(element, options) {
    const attributes = {
      width: options.width,
      height: options.height,
      name: options.name,
      view: options.view,
      'viewer-url': options.viewerUrl,
      'source-origin': options.sourceOrigin,
      'bottom-panel': hasOwn(options, 'bottomPanel') ? normalizeEmbedBottomPanel(options.bottomPanel) : undefined,
      'auto-load': hasOwn(options, 'autoLoad') ? serializeAutoLoad(options.autoLoad) : undefined
    };

    for (const [key, value] of Object.entries(attributes)) {
      const normalized = normalizeNonEmpty(value);
      if (normalized !== null) {
        element.setAttribute(key, normalized);
      }
    }
  }

  function resolveTargetElement(target) {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;
    if (!(element instanceof HTMLElement)) {
      throw new TypeError('Prismifold.create(target, options) expects a selector or HTMLElement target.');
    }
    return element;
  }

  function resolveViewerBaseUrl(scriptUrl) {
    if (!scriptUrl) {
      return new URL('./app/', window.location.href).toString();
    }
    return new URL('../app/', scriptUrl).toString();
  }

  function shouldParentFetchSource(src, sourceOrigin) {
    if (sourceOrigin === SOURCE_ORIGIN_PARENT) {
      return true;
    }
    if (sourceOrigin === SOURCE_ORIGIN_VIEWER) {
      return false;
    }

    const trimmed = String(src).trim();
    return trimmed.startsWith('blob:') || !isAbsoluteOrProtocolRelativeUrl(trimmed);
  }

  function isAbsoluteOrProtocolRelativeUrl(value) {
    return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith('//');
  }

  function normalizeSourceOrigin(value) {
    const normalized = normalizeNonEmpty(value);
    if (
      normalized === SOURCE_ORIGIN_PARENT ||
      normalized === SOURCE_ORIGIN_VIEWER ||
      normalized === SOURCE_ORIGIN_AUTO
    ) {
      return normalized;
    }
    return SOURCE_ORIGIN_AUTO;
  }

  function createViewerModeState(value) {
    const viewerMode = normalizeViewerMode(value);
    return viewerMode ? { viewerMode } : null;
  }

  function normalizeViewerState(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function normalizeViewerMode(value) {
    const normalized = normalizeNonEmpty(value);
    if (normalized === 'image' || normalized === 'panorama' || normalized === 'depth') {
      return normalized;
    }
    return null;
  }

  function serializeAutoLoad(value) {
    return parseAutoLoad(value) ? 'true' : 'false';
  }

  function normalizeEmbedBottomPanel(value) {
    const normalized = normalizeNonEmpty(value);
    if (normalized === null) {
      return 'probe';
    }
    const lower = normalized.toLowerCase();
    return lower === 'channels' || lower === 'none' ? lower : 'probe';
  }

  function parseAutoLoad(value) {
    if (value === false || value === 0) {
      return false;
    }
    const normalized = normalizeNonEmpty(value);
    if (normalized === null) {
      return true;
    }

    const lower = normalized.toLowerCase();
    return !(lower === 'false' || lower === '0' || lower === 'no' || lower === 'off');
  }

  function normalizePostMessageTargetOrigin(origin) {
    return origin === 'null' ? '*' : origin;
  }

  function normalizeCssSize(value) {
    return /^\d+$/.test(String(value)) ? `${value}px` : String(value);
  }

  function normalizeNonEmpty(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function inferFilenameFromUrl(url) {
    try {
      const parsed = new URL(url, document.baseURI);
      const filename = parsed.pathname.split('/').filter(Boolean).pop();
      return filename || 'image.exr';
    } catch {
      const filename = String(url).split(/[?#]/, 1)[0].split('/').filter(Boolean).pop();
      return filename || 'image.exr';
    }
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function logEmbedError(message, error) {
    console.error(`[prismifold] ${message}`, error);
  }

  if (!customElements.get('prismifold-viewer')) {
    customElements.define('prismifold-viewer', PrismifoldViewerElement);
  }

  window.Prismifold = {
    create: createPrismifoldViewer
  };
})();
