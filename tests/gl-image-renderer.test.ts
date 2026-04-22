// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __debugGetMaterializedChannel, __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { buildDisplaySourceBinding } from '../src/display-texture';
import { GlImageRenderer } from '../src/rendering/gl-image-renderer';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createInterleavedLayerFromChannels
} from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gl image renderer', () => {
  it('uploads only the channels required by the active selection and only uploads newly required channels later', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6],
      A: [0.25, 0.5],
      Z: [10, 20]
    });

    const firstUploadedChannels = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelRgbSelection('R', 'G', 'B'))
    );

    const texImageCallsAfterFirstUpload = gl.texImage2D.mock.calls.length;

    const secondUploadedChannels = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['Z', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelMonoSelection('Z', 'A'))
    );

    expect(firstUploadedChannels).toEqual(['R', 'G', 'B']);
    expect(secondUploadedChannels).toEqual(['Z', 'A']);
    expect(texImageCallsAfterFirstUpload).toBe(5);
    expect(gl.texImage2D).toHaveBeenCalledTimes(7);
    expect(gl.createTexture).toHaveBeenCalledTimes(7);
  });

  it('uploads interleaved source textures from lazily materialized dense channel buffers', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);

    expect(layer.channelStorage.kind).toBe('interleaved-f32');
    expect(__debugGetMaterializedChannelCount(layer)).toBe(3);
    expect(gl.texImage2D.mock.calls[2]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'R')
    );
    expect(gl.texImage2D.mock.calls[3]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'G')
    );
    expect(gl.texImage2D.mock.calls[4]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'B')
    );
  });

  it('discards one resident channel at a time and prunes empty session containers', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);

    expect(__debugGetMaterializedChannelCount(layer)).toBe(2);

    renderer.discardChannelSourceTexture('session-1', 0, 'R');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual(['G']);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);

    renderer.discardChannelSourceTexture('session-1', 0, 'G');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(getLayerTexturesBySession(renderer).has('session-1')).toBe(false);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('deletes owned GL resources exactly once', () => {
    const { renderer, gl } = createHarness();

    renderer.dispose();
    renderer.dispose();

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });
});

function createHarness(): {
  renderer: GlImageRenderer;
  gl: WebGL2RenderingContext & {
    texImage2D: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    deleteTexture: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    deleteVertexArray: ReturnType<typeof vi.fn>;
  };
} {
  const gl = createWebGlContextMock();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === 'webgl2') {
      return gl;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  return {
    renderer: new GlImageRenderer(canvas),
    gl
  };
}

function getLayerTexturesBySession(renderer: GlImageRenderer): Map<string, Map<number, unknown>> {
  return (renderer as unknown as { layerTexturesBySession: Map<string, Map<number, unknown>> }).layerTexturesBySession;
}

function getLayerTextureChannels(renderer: GlImageRenderer, sessionId: string, layerIndex: number): string[] {
  const layerTextures = getLayerTexturesBySession(renderer).get(sessionId)?.get(layerIndex) as {
    textureByChannel: Map<string, unknown>;
  } | undefined;
  return [...(layerTextures?.textureByChannel.keys() ?? [])];
}

function createWebGlContextMock(): WebGL2RenderingContext & {
  texImage2D: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  deleteTexture: ReturnType<typeof vi.fn>;
  deleteProgram: ReturnType<typeof vi.fn>;
  deleteVertexArray: ReturnType<typeof vi.fn>;
} {
  const programs = [{ id: 'program-1' }, { id: 'program-2' }];
  const shaders = [{ id: 'shader-1' }, { id: 'shader-2' }, { id: 'shader-3' }, { id: 'shader-4' }];
  const textures = [
    { id: 'texture-1' },
    { id: 'texture-2' },
    { id: 'texture-3' },
    { id: 'texture-4' },
    { id: 'texture-5' }
  ];
  const vaos = [{ id: 'vao-1' }];

  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    UNPACK_ALIGNMENT: 0x0cf5,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    MAX_TEXTURE_SIZE: 4096,
    MAX_TEXTURE_IMAGE_UNITS: 16,
    createVertexArray: vi.fn(() => vaos.shift() ?? { id: 'vao-extra' }),
    createTexture: vi.fn(() => textures.shift() ?? { id: 'texture-extra' }),
    createProgram: vi.fn(() => programs.shift() ?? { id: 'program-extra' }),
    createShader: vi.fn(() => shaders.shift() ?? { id: 'shader-extra' }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    bindVertexArray: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    useProgram: vi.fn(),
    uniform1i: vi.fn(),
    uniform1iv: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform2i: vi.fn(),
    drawArrays: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn(() => ({ id: 'uniform' })),
    getParameter: vi.fn((parameter) => {
      if (parameter === 16) {
        return 16;
      }
      return 4096;
    }),
    deleteTexture: vi.fn(),
    deleteVertexArray: vi.fn()
  } as unknown as WebGL2RenderingContext & {
    texImage2D: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    deleteTexture: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    deleteVertexArray: ReturnType<typeof vi.fn>;
  };
}
