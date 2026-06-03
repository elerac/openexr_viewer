import * as vscode from 'vscode';
import type { DesktopCommandId } from './protocol';
import { createStandalonePanel, PrismifoldSession } from './prismifoldSession';
import { isExrUri, UriGrantStore } from './uriGrants';

export class PrismifoldSessionManager {
  private readonly context: vscode.ExtensionContext;
  private readonly grants = new UriGrantStore();
  private readonly sessions = new Set<PrismifoldSession>();
  private activeSession: PrismifoldSession | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async createCustomEditorSession(webviewPanel: vscode.WebviewPanel, initialUri: vscode.Uri): Promise<void> {
    await this.createSession({
      host: webviewPanel,
      initialUris: [initialUri]
    });
  }

  async createPanelSession(initialUris: readonly vscode.Uri[], title = 'Prismifold'): Promise<void> {
    const panel = createStandalonePanel(this.context, title);
    await this.createSession({
      host: panel,
      initialUris
    });
  }

  async openFileCommand(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): Promise<void> {
    const explicitUris = normalizeCommandUris(uri, selectedUris).filter(isExrUri);
    if (explicitUris.length > 0) {
      await this.openUris(explicitUris);
      return;
    }

    if (this.activeSession) {
      this.activeSession.postDesktopCommand('openFile');
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: {
        OpenEXR: ['exr']
      },
      title: 'Open OpenEXR Files'
    });
    if (uris?.length) {
      await this.openUris(uris);
    }
  }

  async openFolderCommand(uri?: vscode.Uri): Promise<void> {
    if (uri && this.activeSession) {
      const entries = await this.grants.resolveExrPaths([uri.toString()]);
      if (entries.length > 0) {
        await this.activeSession.postOpenUris(entries.map((entry) => vscode.Uri.parse(entry.path)));
        return;
      }
    }

    if (!uri && this.activeSession) {
      this.activeSession.postDesktopCommand('openFolder');
      return;
    }

    const folder = uri ?? (await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Open OpenEXR Folder'
    }))?.[0];
    if (!folder) {
      return;
    }
    const entries = await this.grants.listExrFolder(folder);
    if (entries.length === 0) {
      void vscode.window.showWarningMessage('No OpenEXR files found in the selected folder.');
      return;
    }
    await this.createPanelSession(entries.map((entry) => vscode.Uri.parse(entry.path)), 'Prismifold Folder');
  }

  postDesktopCommand(commandId: DesktopCommandId): void {
    if (!this.activeSession) {
      void vscode.window.showInformationMessage('Open an EXR in Prismifold before running this command.');
      return;
    }
    const state = this.activeSession.getCommandState();
    if (state[commandId] === false) {
      return;
    }
    this.activeSession.postDesktopCommand(commandId);
  }

  private async openUris(uris: readonly vscode.Uri[]): Promise<void> {
    if (uris.length === 1) {
      await vscode.commands.executeCommand('vscode.openWith', uris[0], 'prismifold.exrViewer');
      return;
    }
    if (this.activeSession) {
      await this.activeSession.postOpenUris(uris);
      return;
    }
    await this.createPanelSession(uris, 'Prismifold Files');
  }

  private async createSession(options: {
    host: vscode.WebviewPanel;
    initialUris: readonly vscode.Uri[];
  }): Promise<void> {
    const session = new PrismifoldSession({
      context: this.context,
      host: options.host,
      grants: this.grants,
      initialUris: options.initialUris,
      onDidBecomeActive: (active) => {
        this.activeSession = active;
      },
      onDidDispose: (disposed) => {
        this.sessions.delete(disposed);
        if (this.activeSession === disposed) {
          this.activeSession = this.sessions.values().next().value ?? null;
        }
      }
    });
    this.sessions.add(session);
    await session.initialize();
  }
}

function normalizeCommandUris(uri: vscode.Uri | undefined, selectedUris: vscode.Uri[] | undefined): vscode.Uri[] {
  if (selectedUris?.length) {
    return selectedUris;
  }
  return uri ? [uri] : [];
}
