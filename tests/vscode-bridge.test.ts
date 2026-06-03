// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  VSCODE_BRIDGE_CHANNEL,
  decodeBytesFromVscodeBridge,
  encodeBytesForVscodeBridge,
  createVscodeBridgeError,
  createVscodeBridgeErrorPayload,
  isVscodeBridgeExtensionMessage,
  isVscodeBridgeResponseMessage,
  isVscodeBridgeWebviewMessage
} from '../src/platform/vscode-bridge';
import { vscodeHost } from '../src/platform/vscode-host';

describe('VS Code bridge', () => {
  it('classifies bridge messages by direction', () => {
    expect(isVscodeBridgeWebviewMessage({
      channel: VSCODE_BRIDGE_CHANNEL,
      type: 'ready'
    })).toBe(true);
    expect(isVscodeBridgeExtensionMessage({
      channel: VSCODE_BRIDGE_CHANNEL,
      type: 'openEntries',
      entries: []
    })).toBe(true);
    expect(isVscodeBridgeResponseMessage({
      channel: VSCODE_BRIDGE_CHANNEL,
      type: 'response',
      id: 1,
      ok: true
    })).toBe(true);
    expect(isVscodeBridgeWebviewMessage({ channel: 'other', type: 'ready' })).toBe(false);
  });

  it('round-trips path file provider requests through acquireVsCodeApi', async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = vi.fn(() => ({
      postMessage
    }));

    const promise = vscodeHost.pathFileProvider!.readExrFile('grant-1');

    expect(postMessage).toHaveBeenCalledWith({
      channel: VSCODE_BRIDGE_CHANNEL,
      type: 'request',
      id: expect.any(Number),
      request: {
        type: 'readExrFile',
        grantId: 'grant-1'
      }
    });
    const id = postMessage.mock.calls[0]![0].id as number;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        channel: VSCODE_BRIDGE_CHANNEL,
        type: 'response',
        id,
        ok: true,
        value: {
          grantId: 'grant-1',
          bytes: encodeBytesForVscodeBridge(new Uint8Array([0x76, 0x2f, 0x31, 0x01]))
        }
      }
    }));

    await expect(promise).resolves.toEqual({
      grantId: 'grant-1',
      bytes: new Uint8Array([0x76, 0x2f, 0x31, 0x01])
    });
  });

  it('serializes bridge bytes with explicit base64 payloads', () => {
    const bytes = new Uint8Array([0x76, 0x2f, 0x31, 0x01, 255]);
    const encoded = encodeBytesForVscodeBridge(bytes);

    expect(encoded).toEqual({
      encoding: 'base64',
      data: 'di8xAf8=',
      byteLength: 5
    });
    expect(decodeBytesFromVscodeBridge(encoded)).toEqual(bytes);
  });

  it('normalizes bridge errors', () => {
    const payload = createVscodeBridgeErrorPayload(Object.assign(new Error('Missing.'), { code: 'notFound' }));
    const error = createVscodeBridgeError(payload);

    expect(payload).toEqual({ message: 'Missing.', code: 'notFound' });
    expect(error.message).toBe('Missing.');
    expect(error.code).toBe('notFound');
  });
});
