// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDisplaySourceBinding } from '../src/display-texture';
import { GlImageRenderer } from '../src/rendering/gl-image-renderer';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createLayerFromChannels
} from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gl image renderer', () => {
  it('uploads source textures once per session layer, returns texture bytes, and rebinds selections without re-uploading', () => {
    const { renderer, gl } = createHarness();
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    const firstUploadBytes = renderer.ensureLayerSourceTextures('session-1', 0, 2, 1, layer);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelRgbSelection('R', 'G', 'B'))
    );

    const texImageCallsAfterFirstUpload = gl.texImage2D.mock.calls.length;

    const secondUploadBytes = renderer.ensureLayerSourceTextures('session-1', 0, 2, 1, layer);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelMonoSelection('G'))
    );

    expect(firstUploadBytes).toBe(2 * 1 * 3 * Float32Array.BYTES_PER_ELEMENT);
    expect(secondUploadBytes).toBe(firstUploadBytes);
    expect(texImageCallsAfterFirstUpload).toBe(5);
    expect(gl.texImage2D).toHaveBeenCalledTimes(5);
    expect(gl.createTexture).toHaveBeenCalledTimes(5);
  });

  it('uploads planar source textures directly from decoded channel buffers', () => {
    const { renderer, gl } = createHarness();
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    renderer.ensureLayerSourceTextures('session-1', 0, 2, 1, layer);

    expect(layer.channelStorage.kind).toBe('planar-f32');
    expect(gl.texImage2D.mock.calls[2]?.[8]).toBe(
      layer.channelStorage.kind === 'planar-f32' ? layer.channelStorage.pixelsByChannel.R : null
    );
    expect(gl.texImage2D.mock.calls[3]?.[8]).toBe(
      layer.channelStorage.kind === 'planar-f32' ? layer.channelStorage.pixelsByChannel.G : null
    );
    expect(gl.texImage2D.mock.calls[4]?.[8]).toBe(
      layer.channelStorage.kind === 'planar-f32' ? layer.channelStorage.pixelsByChannel.B : null
    );
  });

  it('discards one resident layer at a time and prunes empty session containers', () => {
    const { renderer, gl } = createHarness();
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    renderer.ensureLayerSourceTextures('session-1', 0, 2, 1, layer);
    renderer.ensureLayerSourceTextures('session-1', 1, 2, 1, layer);

    renderer.discardLayerSourceTextures('session-1', 0);

    expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(getLayerTexturesBySession(renderer).get('session-1')?.has(0)).toBe(false);
    expect(getLayerTexturesBySession(renderer).get('session-1')?.has(1)).toBe(true);

    renderer.discardLayerSourceTextures('session-1', 1);

    expect(gl.deleteTexture).toHaveBeenCalledTimes(6);
    expect(getLayerTexturesBySession(renderer).has('session-1')).toBe(false);
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
