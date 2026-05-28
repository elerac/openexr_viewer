(() => {
  const EMBED_READY_MESSAGE = 'openexr-viewer:embed-ready';
  const EMBED_LOAD_FILE_MESSAGE = 'openexr-viewer:load-file';
  const observedAttributes = ['src', 'gallery', 'view', 'name', 'width', 'height', 'allowfullscreen'];
  const currentScriptUrl = document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : '';

  class OpenExrViewerElement extends HTMLElement {
    static get observedAttributes() {
      return observedAttributes;
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.iframe = null;
      this.ready = false;
      this.pendingFile = null;
      this.pendingName = null;
      this.viewerBaseUrl = resolveViewerBaseUrl(currentScriptUrl);
      this.viewerOrigin = new URL(this.viewerBaseUrl).origin;
      this.handleMessage = this.handleMessage.bind(this);
    }

    connectedCallback() {
      window.addEventListener('message', this.handleMessage);
      this.render();
    }

    disconnectedCallback() {
      window.removeEventListener('message', this.handleMessage);
    }

    attributeChangedCallback() {
      if (this.isConnected) {
        this.render();
      }
    }

    loadFile(file, options = {}) {
      if (!(file instanceof File)) {
        return Promise.reject(new TypeError('openexr-viewer.loadFile(file) expects a File.'));
      }
      this.pendingFile = file;
      this.pendingName = typeof options.name === 'string' ? options.name : null;
      this.postPendingFile();
      return Promise.resolve();
    }

    render() {
      const iframe = document.createElement('iframe');
      iframe.src = this.buildIframeUrl();
      iframe.title = this.getAttribute('name') || 'OpenEXR viewer';
      iframe.loading = 'lazy';
      iframe.allow = 'clipboard-write';
      this.style.width = normalizeCssSize(this.getAttribute('width') || '100%');
      iframe.style.width = '100%';
      iframe.style.height = normalizeCssSize(this.getAttribute('height') || '320px');
      iframe.style.border = '0';
      iframe.style.display = 'block';
      iframe.style.background = '#05070a';
      if (this.getAttribute('allowfullscreen') !== 'false') {
        iframe.allowFullscreen = true;
      }

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
      url.searchParams.set('ui', 'embed');
      for (const key of ['src', 'gallery', 'view', 'name']) {
        const value = this.getAttribute(key);
        if (value) {
          url.searchParams.set(key, value);
        }
      }
      return url.toString();
    }

    handleMessage(event) {
      if (!this.iframe || event.source !== this.iframe.contentWindow) {
        return;
      }
      if (event.origin !== this.viewerOrigin || event.data?.type !== EMBED_READY_MESSAGE) {
        return;
      }
      this.ready = true;
      this.postPendingFile();
    }

    postPendingFile() {
      if (!this.ready || !this.pendingFile || !this.iframe?.contentWindow) {
        return;
      }
      this.iframe.contentWindow.postMessage({
        type: EMBED_LOAD_FILE_MESSAGE,
        file: this.pendingFile,
        name: this.pendingName || undefined
      }, this.viewerOrigin);
      this.pendingFile = null;
      this.pendingName = null;
    }
  }

  function resolveViewerBaseUrl(scriptUrl) {
    if (!scriptUrl) {
      return new URL('./', window.location.href).toString();
    }
    return new URL('../', scriptUrl).toString();
  }

  function normalizeCssSize(value) {
    return /^\d+$/.test(value) ? `${value}px` : value;
  }

  if (!customElements.get('openexr-viewer')) {
    customElements.define('openexr-viewer', OpenExrViewerElement);
  }
})();
