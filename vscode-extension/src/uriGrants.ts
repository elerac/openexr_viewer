import path from 'node:path';
import * as vscode from 'vscode';
import type { DesktopFileBytes, DesktopFileEntry } from './protocol';

interface GrantRecord {
  grantId: string;
  uri: vscode.Uri;
}

export class UriGrantStore {
  private nextGrantId = 1;
  private readonly grantsById = new Map<string, vscode.Uri>();
  private readonly grantsByUri = new Map<string, GrantRecord>();

  async createEntries(uris: readonly vscode.Uri[]): Promise<DesktopFileEntry[]> {
    const entries: DesktopFileEntry[] = [];
    for (const uri of uris) {
      const info = await this.tryStat(uri);
      if (!info || info.type !== vscode.FileType.File || !isExrUri(uri)) {
        continue;
      }
      entries.push(this.createEntry(uri, info.size));
    }
    return entries;
  }

  async resolveExrPaths(paths: readonly string[]): Promise<DesktopFileEntry[]> {
    const entries: DesktopFileEntry[] = [];
    for (const value of paths) {
      const uri = this.resolveUri(value);
      const info = await this.tryStat(uri);
      if (!info) {
        continue;
      }
      if (info.type === vscode.FileType.Directory) {
        entries.push(...await this.listExrFolder(uri));
      } else if (info.type === vscode.FileType.File && isExrUri(uri)) {
        entries.push(this.createEntry(uri, info.size));
      }
    }
    return entries;
  }

  async listExrFolderPath(value: string): Promise<DesktopFileEntry[]> {
    return await this.listExrFolder(this.resolveUri(value));
  }

  async listExrFolder(uri: vscode.Uri): Promise<DesktopFileEntry[]> {
    const entries: DesktopFileEntry[] = [];
    await this.walkFolder(uri, entries);
    entries.sort((a, b) => (a.relativePath ?? a.displayPath ?? a.path).localeCompare(b.relativePath ?? b.displayPath ?? b.path));
    return entries;
  }

  async openRecentFile(pathValue: string): Promise<DesktopFileEntry> {
    const entries = await this.resolveExrPaths([pathValue]);
    const entry = entries[0];
    if (!entry) {
      throw createBridgeError('notFound', 'Recent EXR file was not found.');
    }
    return entry;
  }

  async readExrFile(grantId: string): Promise<DesktopFileBytes> {
    const uri = this.grantsById.get(grantId);
    if (!uri) {
      throw createBridgeError('notFound', 'EXR file grant was not found.');
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return {
      grantId,
      bytes
    };
  }

  private async walkFolder(uri: vscode.Uri, entries: DesktopFileEntry[]): Promise<void> {
    let children: [string, vscode.FileType][];
    try {
      children = await vscode.workspace.fs.readDirectory(uri);
    } catch (error) {
      throw createBridgeError('io', error instanceof Error ? error.message : 'Failed to read EXR folder.');
    }

    for (const [name, type] of children) {
      const child = vscode.Uri.joinPath(uri, name);
      if (type === vscode.FileType.Directory) {
        await this.walkFolder(child, entries);
      } else if (type === vscode.FileType.File && isExrUri(child)) {
        const info = await this.tryStat(child);
        entries.push(this.createEntry(child, info?.size ?? 0));
      }
    }
  }

  private createEntry(uri: vscode.Uri, fileSizeBytes: number): DesktopFileEntry {
    const record = this.getOrCreateGrant(uri);
    const relativePath = getWorkspaceRelativePath(uri);
    return {
      grantId: record.grantId,
      path: uri.toString(),
      filename: getUriBasename(uri),
      displayPath: getDisplayPath(uri),
      ...(relativePath ? { relativePath } : {}),
      fileSizeBytes
    };
  }

  private getOrCreateGrant(uri: vscode.Uri): GrantRecord {
    const key = uri.toString();
    const existing = this.grantsByUri.get(key);
    if (existing) {
      return existing;
    }
    const grant: GrantRecord = {
      grantId: `vscode:${this.nextGrantId++}`,
      uri
    };
    this.grantsByUri.set(key, grant);
    this.grantsById.set(grant.grantId, uri);
    return grant;
  }

  private resolveUri(value: string): vscode.Uri {
    for (const [grantId, uri] of this.grantsById) {
      if (grantId === value || uri.toString() === value || uri.fsPath === value) {
        return uri;
      }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return vscode.Uri.parse(value);
    }
    return vscode.Uri.file(value);
  }

  private async tryStat(uri: vscode.Uri): Promise<vscode.FileStat | null> {
    try {
      return await vscode.workspace.fs.stat(uri);
    } catch {
      return null;
    }
  }
}

export function isExrUri(uri: vscode.Uri): boolean {
  return getUriBasename(uri).toLowerCase().endsWith('.exr');
}

function getUriBasename(uri: vscode.Uri): string {
  const source = uri.scheme === 'file' ? uri.fsPath : uri.path;
  return path.basename(source) || 'image.exr';
}

function getDisplayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

function getWorkspaceRelativePath(uri: vscode.Uri): string | null {
  const relative = vscode.workspace.asRelativePath(uri, false);
  const displayPath = getDisplayPath(uri);
  return relative && relative !== displayPath ? relative : null;
}

function createBridgeError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}
