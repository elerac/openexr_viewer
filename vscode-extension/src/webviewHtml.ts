import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';

export async function buildPrismifoldWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): Promise<string> {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'prismifold');
  const appIndex = vscode.Uri.joinPath(mediaRoot, 'app', 'index.html');
  const appBase = ensureTrailingSlash(webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'app')).toString());
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `base-uri ${webview.cspSource}`,
    `img-src ${webview.cspSource} data: blob: https:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval' blob:`,
    `worker-src blob:`,
    `connect-src ${webview.cspSource} data: blob: https:`
  ].join('; ');

  const source = await readFile(appIndex.fsPath, 'utf8');
  return source
    .replace(
      /\b(src|href)="(\.\.\/assets\/[^"]+)"/g,
      (_match, attribute: string, relativePath: string) => {
        const assetName = relativePath.replace(/^\.\.\/assets\//, '');
        const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'assets', assetName)).toString();
        return `${attribute}="${escapeHtml(assetUri)}"`;
      }
    )
    .replace(
      /<head>/i,
      `<head>
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
    <base href="${escapeHtml(appBase)}">`
    )
    .replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
