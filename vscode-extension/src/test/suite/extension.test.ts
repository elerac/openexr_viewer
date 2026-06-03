import assert from 'node:assert';
import path from 'node:path';
import * as vscode from 'vscode';

suite('Prismifold extension', () => {
  test('registers Prismifold commands', async () => {
    const extension = vscode.extensions.getExtension('elerac.prismifold-vscode');
    assert.ok(extension);
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('prismifold.openFile'));
    assert.ok(commands.includes('prismifold.openFolder'));
    assert.ok(commands.includes('prismifold.exportImage'));
  });

  test('opens an EXR with the custom editor', async () => {
    const fixture = vscode.Uri.file(path.resolve(__dirname, '..', '..', '..', '..', 'public', 'cbox_rgb.exr'));

    await vscode.commands.executeCommand('vscode.openWith', fixture, 'prismifold.exrViewer');
    await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === 'prismifold.exrViewer' &&
        tab.input.uri.toString() === fixture.toString();
    });

    await vscode.commands.executeCommand('prismifold.viewImage');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for VS Code condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
