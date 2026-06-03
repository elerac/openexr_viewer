import * as vscode from 'vscode';
import { PrismifoldSessionManager } from './sessionManager';
import type { DesktopCommandId } from './protocol';

const VIEW_TYPE = 'prismifold.exrViewer';

class PrismifoldDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}

  dispose(): void {}
}

class PrismifoldEditorProvider implements vscode.CustomReadonlyEditorProvider<PrismifoldDocument> {
  constructor(private readonly manager: PrismifoldSessionManager) {}

  async openCustomDocument(uri: vscode.Uri): Promise<PrismifoldDocument> {
    return new PrismifoldDocument(uri);
  }

  async resolveCustomEditor(
    document: PrismifoldDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    await this.manager.createCustomEditorSession(webviewPanel, document.uri);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const manager = new PrismifoldSessionManager(context);

  context.subscriptions.push(vscode.window.registerCustomEditorProvider(
    VIEW_TYPE,
    new PrismifoldEditorProvider(manager),
    {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  ));

  context.subscriptions.push(
    vscode.commands.registerCommand('prismifold.openFile', (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      void manager.openFileCommand(uri, selectedUris);
    }),
    vscode.commands.registerCommand('prismifold.openFolder', (uri?: vscode.Uri) => {
      void manager.openFolderCommand(uri);
    }),
    registerDesktopCommand('prismifold.exportImage', 'exportImage', manager),
    registerDesktopCommand('prismifold.exportScreenshot', 'exportScreenshot', manager),
    registerDesktopCommand('prismifold.exportBatch', 'exportBatch', manager),
    registerDesktopCommand('prismifold.exportColormap', 'exportColormap', manager),
    registerDesktopCommand('prismifold.reloadAll', 'reloadAll', manager),
    registerDesktopCommand('prismifold.closeAll', 'closeAll', manager),
    registerDesktopCommand('prismifold.showMetadata', 'metadata', manager),
    registerDesktopCommand('prismifold.openSettings', 'settings', manager),
    registerDesktopCommand('prismifold.viewImage', 'viewerModeImage', manager),
    registerDesktopCommand('prismifold.viewPanorama', 'viewerModePanorama', manager),
    registerDesktopCommand('prismifold.viewDepth', 'viewerModeDepth', manager),
    registerDesktopCommand('prismifold.toggleRulers', 'toggleRulers', manager),
    registerDesktopCommand('prismifold.splitVertical', 'paneSplitVertical', manager),
    registerDesktopCommand('prismifold.splitHorizontal', 'paneSplitHorizontal', manager),
    registerDesktopCommand('prismifold.resetPanes', 'paneReset', manager)
  );
}

export function deactivate(): void {}

function registerDesktopCommand(
  vscodeCommandId: string,
  desktopCommandId: DesktopCommandId,
  manager: PrismifoldSessionManager
): vscode.Disposable {
  return vscode.commands.registerCommand(vscodeCommandId, () => {
    manager.postDesktopCommand(desktopCommandId);
  });
}
