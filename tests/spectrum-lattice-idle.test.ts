// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpectrumLatticeIdleController } from '../src/ui/spectrum-lattice-idle';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('SpectrumLatticeIdleController', () => {
  it('gradually slows to a frozen active background after leaving idle', () => {
    const animation = installAnimationFrameMock();
    const { controller, gl } = createHarness();

    controller.setState({ themeEnabled: true, idle: true });
    expect(readBackgroundBlend(controller)).toEqual({ checker: 0, spectrumGrid: 1 });
    animation.flushNext(100);
    animation.flushNext(200);

    animation.setNow(200);
    controller.setState({ themeEnabled: true, idle: false });

    expect(animation.cancelAnimationFrame).not.toHaveBeenCalled();
    expect(animation.queuedFrameCount()).toBe(1);

    animation.flushNext(300);
    const firstBlend = readBackgroundBlend(controller);
    animation.flushNext(400);
    const secondBlend = readBackgroundBlend(controller);
    animation.flushNext(500);
    const thirdBlend = readBackgroundBlend(controller);

    const times = readTimeUniforms(gl);
    const activeDeltas = [
      times.at(-3)! - times.at(-4)!,
      times.at(-2)! - times.at(-3)!,
      times.at(-1)! - times.at(-2)!
    ];
    expect(activeDeltas[0]).toBeGreaterThan(0);
    expect(activeDeltas[0]).toBeGreaterThan(activeDeltas[1]);
    expect(activeDeltas[1]).toBeGreaterThan(activeDeltas[2]);

    const activeBrightness = readBrightnessUniforms(gl);
    const activeBrightnessSteps = activeBrightness.slice(-3);
    expect(activeBrightnessSteps[0]).toBeLessThan(1);
    expect(activeBrightnessSteps[0]).toBeGreaterThan(activeBrightnessSteps[1]);
    expect(activeBrightnessSteps[1]).toBeGreaterThan(activeBrightnessSteps[2]);
    expect(activeBrightnessSteps[2]).toBeGreaterThan(0.55);
    expect(firstBlend.checker).toBeGreaterThan(0);
    expect(secondBlend.checker).toBeGreaterThan(firstBlend.checker);
    expect(thirdBlend.checker).toBeGreaterThan(secondBlend.checker);
    expect(firstBlend.spectrumGrid).toBeLessThan(1);
    expect(secondBlend.spectrumGrid).toBeLessThan(firstBlend.spectrumGrid);
    expect(thirdBlend.spectrumGrid).toBeLessThan(secondBlend.spectrumGrid);

    animation.flushNext(3300);

    expect(animation.queuedFrameCount()).toBe(0);
    expect(animation.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(readBrightnessUniforms(gl).at(-1)).toBeCloseTo(0.55);
    expect(readBackgroundBlend(controller)).toEqual({ checker: 1, spectrumGrid: 0 });
  });

  it('eases back up from the frozen active frame when returning to idle', () => {
    const animation = installAnimationFrameMock();
    const { controller, elements, gl } = createHarness();

    controller.setState({ themeEnabled: true, idle: true });
    animation.flushNext(100);
    animation.flushNext(200);
    animation.setNow(200);
    controller.setState({ themeEnabled: true, idle: false });
    animation.flushNext(3300);

    const frozenTime = readTimeUniforms(gl).at(-1);
    animation.setNow(3700);
    controller.setState({ themeEnabled: true, idle: true });

    expect(elements.appShell.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(elements.mainLayout.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(elements.viewerContainer.classList.contains('is-spectrum-lattice-idle')).toBe(true);
    expect(elements.idle.classList.contains('hidden')).toBe(false);
    expect(readTimeUniforms(gl).at(-1)).toBe(frozenTime);
    expect(readBrightnessUniforms(gl).at(-1)).toBeCloseTo(0.55);
    expect(readBackgroundBlend(controller)).toEqual({ checker: 1, spectrumGrid: 0 });

    animation.flushNext(3800);
    const firstBlend = readBackgroundBlend(controller);
    animation.flushNext(3900);
    const secondBlend = readBackgroundBlend(controller);
    animation.flushNext(4000);
    const thirdBlend = readBackgroundBlend(controller);

    const times = readTimeUniforms(gl);
    const resumeDeltas = [
      times.at(-3)! - times.at(-4)!,
      times.at(-2)! - times.at(-3)!,
      times.at(-1)! - times.at(-2)!
    ];
    expect(resumeDeltas[0]).toBeGreaterThan(0);
    expect(resumeDeltas[1]).toBeGreaterThan(resumeDeltas[0]);
    expect(resumeDeltas[2]).toBeGreaterThan(resumeDeltas[1]);

    const resumeBrightness = readBrightnessUniforms(gl).slice(-3);
    expect(resumeBrightness[0]).toBeGreaterThan(0.55);
    expect(resumeBrightness[1]).toBeGreaterThan(resumeBrightness[0]);
    expect(resumeBrightness[2]).toBeGreaterThan(resumeBrightness[1]);
    expect(firstBlend.checker).toBeLessThan(1);
    expect(secondBlend.checker).toBeLessThan(firstBlend.checker);
    expect(thirdBlend.checker).toBeLessThan(secondBlend.checker);
    expect(firstBlend.spectrumGrid).toBeGreaterThan(0);
    expect(secondBlend.spectrumGrid).toBeGreaterThan(firstBlend.spectrumGrid);
    expect(thirdBlend.spectrumGrid).toBeGreaterThan(secondBlend.spectrumGrid);

    animation.flushNext(6800);
    expect(readBrightnessUniforms(gl).at(-1)).toBeCloseTo(1);
    expect(readBackgroundBlend(controller)).toEqual({ checker: 0, spectrumGrid: 1 });
  });

  it('renders a static frame without scheduling animation when entering active from disabled', () => {
    const animation = installAnimationFrameMock();
    const { controller, elements, gl } = createHarness();

    controller.setState({ themeEnabled: true, idle: false });

    expect(readTimeUniforms(gl)).toEqual([18]);
    expect(readBrightnessUniforms(gl)).toEqual([0.55]);
    expect(animation.requestAnimationFrame).not.toHaveBeenCalled();
    expect(readBackgroundBlend(controller)).toEqual({ checker: 1, spectrumGrid: 0 });
    expect(elements.canvas.classList.contains('hidden')).toBe(false);
    expect(elements.idle.classList.contains('hidden')).toBe(true);

    controller.setState({ themeEnabled: false, idle: false });

    expect(readBackgroundBlendStyle(controller)).toEqual({ checker: '', spectrumGrid: '' });
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

function createHarness(): {
  controller: SpectrumLatticeIdleController;
  elements: {
    appShell: HTMLElement;
    mainLayout: HTMLElement;
    viewerContainer: HTMLElement;
    canvas: HTMLCanvasElement;
    idle: HTMLElement;
  };
  gl: ReturnType<typeof createWebGlContextMock>;
} {
  const gl = createWebGlContextMock();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === 'webgl2') {
      return gl;
    }
    return null;
  });

  const appShell = document.createElement('div');
  const mainLayout = document.createElement('div');
  const viewerContainer = document.createElement('div');
  const canvas = document.createElement('canvas');
  const idle = document.createElement('div');
  canvas.classList.add('hidden');
  idle.classList.add('hidden');
  document.body.append(appShell, mainLayout, viewerContainer, canvas, idle);

  return {
    controller: new SpectrumLatticeIdleController({
      appShell,
      mainLayout,
      viewerContainer,
      canvas,
      idle
    }),
    elements: {
      appShell,
      mainLayout,
      viewerContainer,
      canvas,
      idle
    },
    gl
  };
}

function readTimeUniforms(gl: ReturnType<typeof createWebGlContextMock>): number[] {
  return readUniform1fValues(gl, 'uTime');
}

function readBrightnessUniforms(gl: ReturnType<typeof createWebGlContextMock>): number[] {
  return readUniform1fValues(gl, 'uPerceivedBrightness');
}

function readBackgroundBlend(controller: SpectrumLatticeIdleController): { checker: number; spectrumGrid: number } {
  const style = readBackgroundBlendStyle(controller);
  return {
    checker: Number(style.checker),
    spectrumGrid: Number(style.spectrumGrid)
  };
}

function readBackgroundBlendStyle(
  controller: SpectrumLatticeIdleController
): { checker: string; spectrumGrid: string } {
  const viewerContainer = (
    controller as unknown as {
      elements: { viewerContainer: HTMLElement };
    }
  ).elements.viewerContainer;
  return {
    checker: viewerContainer.style.getPropertyValue('--spectrum-checker-opacity'),
    spectrumGrid: viewerContainer.style.getPropertyValue('--spectrum-grid-opacity')
  };
}

function readUniform1fValues(gl: ReturnType<typeof createWebGlContextMock>, name: string): number[] {
  return gl.uniform1f.mock.calls
    .filter(([location]) => (location as { name?: string } | null)?.name === name)
    .map((call) => call[1] as number);
}

function createWebGlContextMock(): WebGL2RenderingContext & {
  uniform1f: ReturnType<typeof vi.fn>;
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
    uniform1f: ReturnType<typeof vi.fn>;
  };
}
