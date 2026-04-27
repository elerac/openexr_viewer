// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpectrumLatticeRenderer, type SpectrumLatticeBlend } from '../src/ui/spectrum-lattice-renderer';
import {
  SPECTRUM_LATTICE_MOTION_ANIMATE,
  SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM
} from '../src/spectrum-lattice-motion';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('SpectrumLatticeRenderer', () => {
  it('animates idle, then freezes to an active frame and emits background blend updates', () => {
    const animation = installAnimationFrameMock();
    const { canvas, gl, renderer, blends } = createHarness();

    renderer.setMode('idle');
    expect(blends.at(-1)).toEqual({ checkerOpacity: 0, gridOpacity: 1 });
    animation.flushNext(100);
    animation.flushNext(200);

    animation.setNow(200);
    renderer.setMode('active');
    expect(canvas.classList.contains('hidden')).toBe(false);
    expect(animation.queuedFrameCount()).toBe(1);

    animation.flushNext(300);
    const firstBlend = blends.at(-1)!;
    animation.flushNext(400);
    const secondBlend = blends.at(-1)!;
    animation.flushNext(500);
    const thirdBlend = blends.at(-1)!;

    const times = readTimeUniforms(gl);
    const activeDeltas = [
      times.at(-3)! - times.at(-4)!,
      times.at(-2)! - times.at(-3)!,
      times.at(-1)! - times.at(-2)!
    ];
    expect(activeDeltas[0]).toBeGreaterThan(0);
    expect(activeDeltas[0]).toBeGreaterThan(activeDeltas[1]);
    expect(activeDeltas[1]).toBeGreaterThan(activeDeltas[2]);
    expect(firstBlend.checkerOpacity).toBeGreaterThan(0);
    expect(secondBlend.checkerOpacity).toBeGreaterThan(firstBlend.checkerOpacity);
    expect(thirdBlend.checkerOpacity).toBeGreaterThan(secondBlend.checkerOpacity);
    expect(firstBlend.gridOpacity).toBeLessThan(1);
    expect(secondBlend.gridOpacity).toBeLessThan(firstBlend.gridOpacity);
    expect(thirdBlend.gridOpacity).toBeLessThan(secondBlend.gridOpacity);

    animation.flushNext(3300);
    expect(animation.queuedFrameCount()).toBe(0);
    expect(animation.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(readBrightnessUniforms(gl).at(-1)).toBeCloseTo(0.75);
    expect(blends.at(-1)).toEqual({ checkerOpacity: 1, gridOpacity: 0 });
  });

  it('finishes the active blend if animation frames stall during transition', () => {
    vi.useFakeTimers();
    const animation = installAnimationFrameMock();
    const { canvas, renderer, blends } = createHarness();

    renderer.setMode('idle');
    animation.setNow(100);
    renderer.setMode('active');

    expect(canvas.classList.contains('hidden')).toBe(false);
    expect(animation.queuedFrameCount()).toBe(1);
    expect(blends.at(-1)).not.toEqual({ checkerOpacity: 1, gridOpacity: 0 });

    vi.advanceTimersByTime(3100);

    expect(blends.at(-1)).toEqual({ checkerOpacity: 1, gridOpacity: 0 });
    expect(animation.queuedFrameCount()).toBe(0);
    expect(animation.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('redraws a frozen active frame when resized', () => {
    const { canvas, gl, renderer } = createHarness();

    renderer.setMode('active');
    const drawCount = gl.drawArrays.mock.calls.length;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 640, height: 320, left: 0, top: 0 })
    });

    renderer.resize();

    expect(gl.drawArrays.mock.calls.length).toBe(drawCount + 1);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(320);
  });

  it('uses defined shader math for Windows Chrome ANGLE portability', () => {
    const { gl, renderer } = createHarness();

    renderer.setMode('idle');

    const fragmentSource = readSpectrumFragmentShaderSource(gl);
    expect(fragmentSource).toContain('1.0 - smoothstep(0.72, 1.0, x)');
    expect(fragmentSource).not.toContain('smoothstep(1.0, 0.72, x)');
    expect(fragmentSource).toContain('pow(max(col, vec3(0.0)), vec3(0.92))');
    expect(fragmentSource).toContain('pow(max(perceived, vec3(0.0)), vec3(PERCEPTUAL_GAMMA))');
    expect(fragmentSource).not.toMatch(/\bpow\s*\(\s*col\s*,/);
    expect(fragmentSource).not.toMatch(/\bpow\s*\(\s*perceived\s*,/);
  });

  it('keeps fallback and blend state usable when WebGL is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const canvas = document.createElement('canvas');
    const blends: Array<SpectrumLatticeBlend | null> = [];
    const renderer = new SpectrumLatticeRenderer({
      canvas,
      onBlendChange: (blend) => {
        blends.push(blend);
      }
    });

    renderer.setMode('idle');
    expect(canvas.classList.contains('hidden')).toBe(false);
    expect(canvas.classList.contains('spectrum-lattice-canvas--fallback')).toBe(true);
    expect(blends.at(-1)).toEqual({ checkerOpacity: 0, gridOpacity: 1 });

    renderer.setMode('disabled');
    expect(canvas.classList.contains('hidden')).toBe(true);
    expect(blends.at(-1)).toBeNull();
  });

  it('honors explicit follow-system reduced motion by drawing idle once without scheduling animation', () => {
    const animation = installAnimationFrameMock();
    installReducedMotionPreference(true);
    const { gl, renderer, blends } = createHarness();

    renderer.setMotionPreference(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);
    renderer.setMode('idle');

    expect(animation.queuedFrameCount()).toBe(0);
    expect(animation.requestAnimationFrame).not.toHaveBeenCalled();
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(blends.at(-1)).toEqual({ checkerOpacity: 0, gridOpacity: 1 });
  });

  it('animates idle under reduced motion by default', () => {
    const animation = installAnimationFrameMock();
    installReducedMotionPreference(true);
    const { gl, renderer } = createHarness();

    renderer.setMode('idle');

    expect(animation.queuedFrameCount()).toBe(1);
    expect(animation.requestAnimationFrame).toHaveBeenCalledTimes(1);

    animation.flushNext(100);
    animation.flushNext(250);

    const times = readTimeUniforms(gl);
    expect(times.at(-1)! - times.at(-2)!).toBeGreaterThan(0);
  });

  it('starts and stops idle animation when the motion preference changes under reduced motion', () => {
    const animation = installAnimationFrameMock();
    installReducedMotionPreference(true);
    const { gl, renderer } = createHarness();

    renderer.setMotionPreference(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);
    renderer.setMode('idle');
    expect(animation.queuedFrameCount()).toBe(0);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);

    renderer.setMotionPreference(SPECTRUM_LATTICE_MOTION_ANIMATE);
    expect(animation.queuedFrameCount()).toBe(1);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);

    animation.flushNext(100);
    expect(animation.queuedFrameCount()).toBe(1);

    renderer.setMotionPreference(SPECTRUM_LATTICE_MOTION_FOLLOW_SYSTEM);
    expect(animation.queuedFrameCount()).toBe(0);
    expect(animation.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(gl.drawArrays).toHaveBeenCalledTimes(4);
  });

  it('falls back on context loss and reinitializes on restore', () => {
    const animation = installAnimationFrameMock();
    const { canvas, gl, renderer } = createHarness();

    renderer.setMode('idle');
    expect(canvas.classList.contains('spectrum-lattice-canvas--fallback')).toBe(false);
    expect(animation.queuedFrameCount()).toBe(1);

    const lostEvent = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lostEvent);
    expect(lostEvent.defaultPrevented).toBe(true);
    expect(canvas.classList.contains('spectrum-lattice-canvas--fallback')).toBe(true);
    expect(animation.queuedFrameCount()).toBe(0);
    expect(gl.deleteProgram).toHaveBeenCalled();

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(canvas.classList.contains('spectrum-lattice-canvas--fallback')).toBe(false);
    expect(animation.queuedFrameCount()).toBe(1);
  });

  it('cancels animation, releases resources, and hides canvas on disposal', () => {
    const animation = installAnimationFrameMock();
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const { canvas, gl, renderer, blends } = createHarness();

    renderer.setMode('idle');
    renderer.dispose();

    expect(canvas.classList.contains('hidden')).toBe(true);
    expect(blends.at(-1)).toBeNull();
    expect(animation.queuedFrameCount()).toBe(0);
    expect(animation.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(removeWindowListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(gl.deleteBuffer).toHaveBeenCalled();
    expect(gl.deleteVertexArray).toHaveBeenCalled();
    expect(gl.deleteProgram).toHaveBeenCalled();
  });
});

function installAnimationFrameMock(): {
  requestAnimationFrame: ReturnType<typeof vi.fn>;
  cancelAnimationFrame: ReturnType<typeof vi.fn>;
  setNow: (now: number) => void;
  flushNext: (now: number) => void;
  queuedFrameCount: () => number;
} {
  let nowMs = 0;
  let nextFrameId = 1;
  let queuedFrames: Array<{ id: number; callback: FrameRequestCallback }> = [];
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    queuedFrames.push({ id, callback });
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => {
    queuedFrames = queuedFrames.filter((frame) => frame.id !== id);
  });

  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    setNow: (nextNow: number) => {
      nowMs = nextNow;
    },
    flushNext: (nextNow: number) => {
      nowMs = nextNow;
      const [frame] = queuedFrames;
      if (!frame) {
        throw new Error('No queued animation frame to flush.');
      }
      queuedFrames = queuedFrames.slice(1);
      frame.callback(nextNow);
    },
    queuedFrameCount: () => queuedFrames.length
  };
}

function installReducedMotionPreference(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
}

function createHarness(): {
  canvas: HTMLCanvasElement;
  renderer: SpectrumLatticeRenderer;
  gl: ReturnType<typeof createWebGlContextMock>;
  blends: Array<SpectrumLatticeBlend | null>;
} {
  const gl = createWebGlContextMock();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === 'webgl2') {
      return gl;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 320, height: 180, left: 0, top: 0 })
  });
  document.body.append(canvas);
  const blends: Array<SpectrumLatticeBlend | null> = [];

  return {
    canvas,
    renderer: new SpectrumLatticeRenderer({
      canvas,
      onBlendChange: (blend) => {
        blends.push(blend);
      }
    }),
    gl,
    blends
  };
}

function readTimeUniforms(gl: ReturnType<typeof createWebGlContextMock>): number[] {
  return readUniform1fValues(gl, 'uTime');
}

function readBrightnessUniforms(gl: ReturnType<typeof createWebGlContextMock>): number[] {
  return readUniform1fValues(gl, 'uPerceivedBrightness');
}

function readUniform1fValues(gl: ReturnType<typeof createWebGlContextMock>, name: string): number[] {
  return gl.uniform1f.mock.calls
    .filter(([location]) => (location as { name?: string } | null)?.name === name)
    .map((call) => call[1] as number);
}

function readSpectrumFragmentShaderSource(gl: ReturnType<typeof createWebGlContextMock>): string {
  const source = gl.shaderSource.mock.calls
    .map((call) => call[1] as string)
    .find((shaderSource) => shaderSource.includes('out vec4 fragColor'));
  if (!source) {
    throw new Error('Spectrum lattice fragment shader source was not compiled.');
  }

  return source;
}

function createWebGlContextMock(): WebGL2RenderingContext & {
  shaderSource: ReturnType<typeof vi.fn>;
  uniform1f: ReturnType<typeof vi.fn>;
  drawArrays: ReturnType<typeof vi.fn>;
} {
  const programs = [{ id: 'program-1' }];
  const shaders = [{ id: 'shader-1' }, { id: 'shader-2' }];
  const vaos = [{ id: 'vao-1' }];
  const buffers = [{ id: 'buffer-1' }];

  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
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
    createVertexArray: vi.fn(() => vaos.shift() ?? { id: 'vao-extra' }),
    createBuffer: vi.fn(() => buffers.shift() ?? { id: 'buffer-extra' }),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program, name: string) => ({ name })),
    useProgram: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    drawArrays: vi.fn(),
    viewport: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn()
  } as unknown as WebGL2RenderingContext & {
    shaderSource: ReturnType<typeof vi.fn>;
    uniform1f: ReturnType<typeof vi.fn>;
    drawArrays: ReturnType<typeof vi.fn>;
  };
}
