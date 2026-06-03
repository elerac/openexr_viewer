import * as vscode from 'vscode';
import {
  VSCODE_BRIDGE_CHANNEL,
  createDesktopCommandMessage,
  createErrorPayload,
  createOpenEntriesMessage,
  createResponseMessage,
  decodeBytesFromVscodeBridge,
  encodeBytesForVscodeBridge,
  isVscodeBridgeWebviewMessage,
  type DesktopCommandId,
  type VscodeBridgeCommandStateMessage,
  type VscodeBridgeRequest,
  type VscodeBridgeRequestMessage
} from './protocol';
import { UriGrantStore } from './uriGrants';
import { buildPrismifoldWebviewHtml } from './webviewHtml';

type WebviewHost = vscode.WebviewPanel | { webview: vscode.Webview };

interface PrismifoldSessionOptions {
  context: vscode.ExtensionContext;
  host: WebviewHost;
  grants: UriGrantStore;
  initialUris?: readonly vscode.Uri[];
  onDidBecomeActive?: (session: PrismifoldSession) => void;
  onDidDispose?: (session: PrismifoldSession) => void;
}

export class PrismifoldSession {
  private readonly context: vscode.ExtensionContext;
  private readonly host: WebviewHost;
  private readonly grants: UriGrantStore;
  private readonly initialUris: readonly vscode.Uri[];
  private readonly onDidBecomeActive: (session: PrismifoldSession) => void;
  private readonly onDidDispose: (session: PrismifoldSession) => void;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private commandState: Partial<Record<DesktopCommandId, boolean>> = {};

  constructor(options: PrismifoldSessionOptions) {
    this.context = options.context;
    this.host = options.host;
    this.grants = options.grants;
    this.initialUris = options.initialUris ?? [];
    this.onDidBecomeActive = options.onDidBecomeActive ?? (() => {});
    this.onDidDispose = options.onDidDispose ?? (() => {});
  }

  async initialize(): Promise<void> {
    const webview = this.host.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'prismifold')
      ]
    };
    webview.html = await buildPrismifoldWebviewHtml(this.context, webview);

    this.disposables.push(webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    }));

    if ('onDidChangeViewState' in this.host) {
      this.disposables.push(this.host.onDidChangeViewState((event) => {
        if (event.webviewPanel.active || event.webviewPanel.visible) {
          this.onDidBecomeActive(this);
        }
      }));
      this.disposables.push(this.host.onDidDispose(() => {
        this.dispose();
      }));
    }

    this.onDidBecomeActive(this);
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.onDidDispose(this);
  }

  getCommandState(): Partial<Record<DesktopCommandId, boolean>> {
    return this.commandState;
  }

  postDesktopCommand(commandId: DesktopCommandId): void {
    void this.host.webview.postMessage(createDesktopCommandMessage(commandId));
  }

  async postOpenUris(uris: readonly vscode.Uri[]): Promise<void> {
    const entries = await this.grants.createEntries(uris);
    if (entries.length === 0) {
      void vscode.window.showWarningMessage('No OpenEXR files found.');
      return;
    }
    await this.host.webview.postMessage(createOpenEntriesMessage(entries));
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isVscodeBridgeWebviewMessage(message)) {
      return;
    }
    if (message.type === 'ready') {
      this.ready = true;
      if (this.initialUris.length > 0) {
        await this.postOpenUris(this.initialUris);
      }
      return;
    }
    if (message.type === 'commandState') {
      this.handleCommandState(message);
      return;
    }
    if (message.type === 'request') {
      await this.handleRequestMessage(message);
    }
  }

  private handleCommandState(message: VscodeBridgeCommandStateMessage): void {
    this.commandState = message.state;
    this.onDidBecomeActive(this);
  }

  private async handleRequestMessage(message: VscodeBridgeRequestMessage): Promise<void> {
    try {
      const value = await this.handleRequest(message.request);
      await this.host.webview.postMessage(createResponseMessage(message.id, {
        ok: true,
        value
      }));
    } catch (error) {
      await this.host.webview.postMessage(createResponseMessage(message.id, {
        ok: false,
        error: createErrorPayload(error)
      }));
    }
  }

  private async handleRequest(request: VscodeBridgeRequest): Promise<unknown> {
    switch (request.type) {
      case 'readExrFile': {
        const file = await this.grants.readExrFile(request.grantId);
        return {
          grantId: file.grantId,
          bytes: encodeBytesForVscodeBridge(file.bytes)
        };
      }
      case 'resolveExrPaths':
        return await this.grants.resolveExrPaths(request.paths);
      case 'listExrFolder':
        return await this.grants.listExrFolderPath(request.path);
      case 'openRecentFile':
        return await this.grants.openRecentFile(request.path);
      case 'openFilesDialog':
        return await this.openFilesDialog();
      case 'openFolderDialog':
        return await this.openFolderDialog();
      case 'saveBlob':
        return await this.saveBlob(request);
      case 'refreshRecentFiles':
        return [];
      case 'clearRecentFiles':
      case 'recordRecentFile':
      case 'recordPathLoadFailure':
        return null;
    }
  }

  private async openFilesDialog() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: {
        OpenEXR: ['exr']
      },
      title: 'Open OpenEXR Files'
    });
    return uris ? await this.grants.createEntries(uris) : [];
  }

  private async openFolderDialog() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Open OpenEXR Folder'
    });
    const folder = uris?.[0];
    return folder ? await this.grants.listExrFolder(folder) : [];
  }

  private async saveBlob(request: Extract<VscodeBridgeRequest, { type: 'saveBlob' }>) {
    const target = await vscode.window.showSaveDialog({
      title: request.options.title,
      defaultUri: this.resolveDefaultSaveUri(request.options.filename),
      filters: {
        [request.options.extensions.map((extension) => extension.toUpperCase()).join(', ')]: request.options.extensions
      }
    });
    if (!target) {
      return { status: 'cancelled' };
    }
    await vscode.workspace.fs.writeFile(target, decodeBytesFromVscodeBridge(request.bytes));
    return {
      status: 'saved',
      path: target.toString()
    };
  }

  private resolveDefaultSaveUri(filename: string): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder ? vscode.Uri.joinPath(workspaceFolder.uri, filename) : undefined;
  }
}

export function createStandalonePanel(context: vscode.ExtensionContext, title = 'Prismifold'): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel(
    'prismifold.viewer',
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media', 'prismifold')
      ]
    }
  );
}
