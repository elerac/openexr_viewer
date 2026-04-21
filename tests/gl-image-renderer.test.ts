// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlImageRenderer } from '../src/rendering/gl-image-renderer';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gl image renderer disposal', () => {
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

function createWebGlContextMock(): WebGL2RenderingContext & {
  deleteTexture: ReturnType<typeof vi.fn>;
  deleteProgram: ReturnType<typeof vi.fn>;
  deleteVertexArray: ReturnType<typeof vi.fn>;
} {
  const programs = [{ id: 'program-1' }, { id: 'program-2' }];
  const shaders = [{ id: 'shader-1' }, { id: 'shader-2' }, { id: 'shader-3' }, { id: 'shader-4' }];
  const textures = [{ id: 'texture-1' }, { id: 'texture-2' }];
  const vaos = [{ id: 'vao-1' }];

  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
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
    RGBA32F: 0x8814,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    MAX_TEXTURE_SIZE: 4096,
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
    texSubImage2D: vi.fn(),
    useProgram: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform2i: vi.fn(),
    drawArrays: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn(() => ({ id: 'uniform' })),
    getParameter: vi.fn(() => 4096),
    deleteTexture: vi.fn(),
    deleteVertexArray: vi.fn()
  } as unknown as WebGL2RenderingContext & {
    deleteTexture: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    deleteVertexArray: ReturnType<typeof vi.fn>;
  };
}
