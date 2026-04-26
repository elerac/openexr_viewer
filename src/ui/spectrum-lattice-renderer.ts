import { DisposableBag, type Disposable } from '../lifecycle';

export type SpectrumLatticeMode = 'disabled' | 'idle' | 'active';

export interface SpectrumLatticeBlend {
  checkerOpacity: number;
  gridOpacity: number;
}

interface SpectrumLatticeRendererArgs {
  canvas: HTMLCanvasElement;
  onBlendChange?: (blend: SpectrumLatticeBlend | null) => void;
}

interface SpectrumLatticeUniforms {
  resolution: WebGLUniformLocation;
  pointer: WebGLUniformLocation;
  time: WebGLUniformLocation;
  perceivedBrightness: WebGLUniformLocation;
}

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 position;
out vec2 vUv;

void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uPerceivedBrightness;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float PERCEPTUAL_GAMMA = 2.2;
const float INVERSE_PERCEPTUAL_GAMMA = 1.0 / PERCEPTUAL_GAMMA;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 spectral(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = 0.5 + 0.5 * cos(TAU * (x + vec3(0.02, 0.35, 0.68)));
  c *= smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.72, x);
  c += vec3(0.02, 0.06, 0.09);
  return pow(c, vec3(1.18));
}

vec2 rotate(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c) * p;
}

float gridLine(vec2 p, float scale, float width) {
  vec2 q = abs(fract(p * scale - 0.5) - 0.5) / fwidth(p * scale);
  float line = min(q.x, q.y);
  return 1.0 - smoothstep(width, width + 1.0, line);
}

vec3 vignette(vec2 uv, vec3 col) {
  float d = distance(uv, vec2(0.5));
  col *= 1.08 - 0.86 * smoothstep(0.2, 0.78, d);
  return col;
}

vec3 spectrumLattice(vec2 p, vec2 uv, float t, vec2 m) {
  vec2 q = rotate(p, 0.16 * sin(t * 0.09));

  float carrier = sin((q.x * 22.0 + 1.8 * sin(q.y * 9.0 + t * 0.45)) + t * 0.35);
  float bands = 0.5 + 0.5 * sin((q.x + q.y * 0.12) * 8.0 + carrier * 0.9 + t * 0.18);
  float lattice = gridLine(q + 0.025 * vec2(sin(t * 0.3), cos(t * 0.2)), 10.0, 0.78);
  float phase = 0.45 + 0.55 * sin(10.0 * length(q - m * 0.28) - t * 0.75);

  vec3 col = spectral(bands + 0.08 * phase);
  col *= 0.18 + 0.55 * smoothstep(-0.8, 1.0, carrier);
  col += vec3(0.05, 0.35, 0.42) * lattice * (0.25 + 0.75 * phase);
  return col;
}

void main() {
  vec2 uv = vUv;
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
  vec2 pointer = (uPointer - 0.5) * vec2(
    uResolution.x / min(uResolution.x, uResolution.y),
    uResolution.y / min(uResolution.x, uResolution.y)
  );

  vec3 col = spectrumLattice(p, uv, uTime, pointer);

  float dust = hash21(gl_FragCoord.xy + floor(uTime * 12.0)) - 0.5;
  float scanline = 0.965 + 0.035 * sin(gl_FragCoord.y * PI);
  col += dust * 0.015;
  col *= scanline;
  col = vignette(uv, col);
  col = 1.0 - exp(-col * 1.15);
  col = pow(col, vec3(0.92));
  vec3 perceived = pow(max(col, vec3(0.0)), vec3(INVERSE_PERCEPTUAL_GAMMA));
  perceived *= uPerceivedBrightness;
  col = pow(perceived, vec3(PERCEPTUAL_GAMMA));

  fragColor = vec4(col, 1.0);
}
`;

const DEFAULT_FRAME_TIME_SECONDS = 18.0;
const SPECTRUM_LATTICE_TRANSITION_MS = 3000;
const IDLE_PERCEIVED_BRIGHTNESS = 1.0;
const ACTIVE_PERCEIVED_BRIGHTNESS = 0.6;
const IDLE_CHECKER_OPACITY = 0;
const IDLE_SPECTRUM_GRID_OPACITY = 1;
const ACTIVE_CHECKER_OPACITY = 1;
const ACTIVE_SPECTRUM_GRID_OPACITY = 0;

export class SpectrumLatticeRenderer implements Disposable {
  private readonly disposables = new DisposableBag();
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quad: WebGLBuffer | null = null;
  private uniforms: SpectrumLatticeUniforms | null = null;
  private animationFrameId: number | null = null;
  private initialized = false;
  private canvasVisible = false;
  private animationActive = false;
  private mode: SpectrumLatticeMode = 'disabled';
  private disposed = false;
  private pointer = { x: 0.5, y: 0.5 };
  private targetPointer = { x: 0.5, y: 0.5 };
  private lastTimeSeconds = DEFAULT_FRAME_TIME_SECONDS;
  private lastFrameNowMs: number | null = null;
  private motionSpeed = 0;
  private targetMotionSpeed = 0;
  private transitionStartSpeed = 0;
  private perceivedBrightness = ACTIVE_PERCEIVED_BRIGHTNESS;
  private targetPerceivedBrightness = ACTIVE_PERCEIVED_BRIGHTNESS;
  private transitionStartPerceivedBrightness = ACTIVE_PERCEIVED_BRIGHTNESS;
  private checkerOpacity = ACTIVE_CHECKER_OPACITY;
  private targetCheckerOpacity = ACTIVE_CHECKER_OPACITY;
  private transitionStartCheckerOpacity = ACTIVE_CHECKER_OPACITY;
  private spectrumGridOpacity = ACTIVE_SPECTRUM_GRID_OPACITY;
  private targetSpectrumGridOpacity = ACTIVE_SPECTRUM_GRID_OPACITY;
  private transitionStartSpectrumGridOpacity = ACTIVE_SPECTRUM_GRID_OPACITY;
  private transitionStartNowMs: number | null = null;
  private pointerTrackingActive = false;
  private reducedMotion = false;

  constructor(private readonly args: SpectrumLatticeRendererArgs) {
    this.hideCanvas();
    this.reducedMotion = readReducedMotionPreference();
    this.args.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.disposables.add(() => {
      this.args.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    });
    this.args.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.disposables.add(() => {
      this.args.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    });
    this.disposables.addEventListener(document, 'visibilitychange', this.handleVisibilityChange);
  }

  setMode(nextMode: SpectrumLatticeMode): void {
    if (this.disposed) {
      return;
    }

    if (this.mode === nextMode) {
      return;
    }

    const previousMode = this.mode;
    this.mode = nextMode;
    if (nextMode === 'idle') {
      this.setCanvasVisible(true);
      this.enterIdle(previousMode);
      return;
    }

    if (nextMode === 'active') {
      this.setCanvasVisible(true);
      this.enterActive(previousMode);
      return;
    }

    this.setCanvasVisible(false);
    this.emitBlend(null);
  }

  resize(): void {
    if (this.disposed || !this.canvasVisible || !this.initialized) {
      return;
    }

    if (!this.gl || !this.program || !this.uniforms) {
      return;
    }

    this.renderStaticFrame(this.lastTimeSeconds);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.mode = 'disabled';
    this.setCanvasVisible(false);
    this.disposables.dispose();
    this.deleteGlResources();
  }

  private setCanvasVisible(visible: boolean): void {
    this.canvasVisible = visible;
    this.args.canvas.classList.toggle('hidden', !visible);
    this.setPointerTracking(visible);

    if (!visible) {
      this.stop();
      this.emitBlend(null);
    }
  }

  private hideCanvas(): void {
    this.args.canvas.classList.add('hidden');
  }

  private enterIdle(previousMode: SpectrumLatticeMode): void {
    if (!this.initialized) {
      this.initialize();
    }

    const now = performance.now();
    if (!this.gl || !this.program || !this.uniforms) {
      this.setMotionState(1, IDLE_PERCEIVED_BRIGHTNESS, IDLE_CHECKER_OPACITY, IDLE_SPECTRUM_GRID_OPACITY);
      return;
    }

    if (previousMode === 'active' && !this.reducedMotion) {
      this.transitionMotionTo(
        1,
        IDLE_PERCEIVED_BRIGHTNESS,
        IDLE_CHECKER_OPACITY,
        IDLE_SPECTRUM_GRID_OPACITY,
        now
      );
    } else {
      this.setMotionState(1, IDLE_PERCEIVED_BRIGHTNESS, IDLE_CHECKER_OPACITY, IDLE_SPECTRUM_GRID_OPACITY);
    }
    if (this.reducedMotion) {
      this.renderStaticFrame(this.lastTimeSeconds);
      this.stop();
    } else {
      this.startAnimation(now);
    }
  }

  private enterActive(previousMode: SpectrumLatticeMode): void {
    if (!this.initialized) {
      this.initialize();
    }

    const now = performance.now();
    if (!this.gl || !this.program || !this.uniforms) {
      this.setMotionState(
        0,
        ACTIVE_PERCEIVED_BRIGHTNESS,
        ACTIVE_CHECKER_OPACITY,
        ACTIVE_SPECTRUM_GRID_OPACITY
      );
      return;
    }

    if (previousMode === 'idle' && !this.reducedMotion) {
      this.transitionMotionTo(
        0,
        ACTIVE_PERCEIVED_BRIGHTNESS,
        ACTIVE_CHECKER_OPACITY,
        ACTIVE_SPECTRUM_GRID_OPACITY,
        now
      );
      this.startAnimation(now);
      return;
    }

    this.setMotionState(
      0,
      ACTIVE_PERCEIVED_BRIGHTNESS,
      ACTIVE_CHECKER_OPACITY,
      ACTIVE_SPECTRUM_GRID_OPACITY
    );
    this.lastFrameNowMs = null;
    this.renderStaticFrame(this.lastTimeSeconds);
    this.stop();
  }

  private startAnimation(now: number): void {
    this.animationActive = true;
    if (this.animationFrameId === null) {
      this.renderFrame(now);
    }
  }

  private stop(): void {
    this.animationActive = false;
    this.lastFrameNowMs = null;
    this.transitionStartNowMs = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private setMotionState(
    speed: number,
    perceivedBrightness: number,
    checkerOpacity: number,
    spectrumGridOpacity: number
  ): void {
    this.motionSpeed = speed;
    this.targetMotionSpeed = speed;
    this.transitionStartSpeed = speed;
    this.perceivedBrightness = perceivedBrightness;
    this.targetPerceivedBrightness = perceivedBrightness;
    this.transitionStartPerceivedBrightness = perceivedBrightness;
    this.checkerOpacity = checkerOpacity;
    this.targetCheckerOpacity = checkerOpacity;
    this.transitionStartCheckerOpacity = checkerOpacity;
    this.spectrumGridOpacity = spectrumGridOpacity;
    this.targetSpectrumGridOpacity = spectrumGridOpacity;
    this.transitionStartSpectrumGridOpacity = spectrumGridOpacity;
    this.transitionStartNowMs = null;
    this.lastFrameNowMs = null;
    this.emitCurrentBlend();
  }

  private transitionMotionTo(
    targetSpeed: number,
    targetPerceivedBrightness: number,
    targetCheckerOpacity: number,
    targetSpectrumGridOpacity: number,
    now: number
  ): void {
    this.updateMotionState(now);
    this.targetMotionSpeed = targetSpeed;
    this.transitionStartSpeed = this.motionSpeed;
    this.targetPerceivedBrightness = targetPerceivedBrightness;
    this.transitionStartPerceivedBrightness = this.perceivedBrightness;
    this.targetCheckerOpacity = targetCheckerOpacity;
    this.transitionStartCheckerOpacity = this.checkerOpacity;
    this.targetSpectrumGridOpacity = targetSpectrumGridOpacity;
    this.transitionStartSpectrumGridOpacity = this.spectrumGridOpacity;
    this.transitionStartNowMs = now;
  }

  private initialize(): void {
    this.initialized = true;

    try {
      const gl = this.args.canvas.getContext('webgl2', { antialias: false });
      if (!gl) {
        this.useFallback();
        return;
      }

      const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
      const vao = gl.createVertexArray();
      const quad = gl.createBuffer();
      if (!vao || !quad) {
        throw new Error('Unable to allocate Spectrum lattice geometry.');
      }

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.gl = gl;
      this.program = program;
      this.vao = vao;
      this.quad = quad;
      this.uniforms = {
        resolution: getRequiredUniformLocation(gl, program, 'uResolution'),
        pointer: getRequiredUniformLocation(gl, program, 'uPointer'),
        time: getRequiredUniformLocation(gl, program, 'uTime'),
        perceivedBrightness: getRequiredUniformLocation(gl, program, 'uPerceivedBrightness')
      };
      this.args.canvas.classList.remove('spectrum-lattice-canvas--fallback');
    } catch {
      this.deleteGlResources();
      this.useFallback();
    }
  }

  private readonly renderFrame = (now: number): void => {
    if (!this.animationActive || !this.canvasVisible) {
      return;
    }

    this.updateMotionState(now);
    this.pointer.x += (this.targetPointer.x - this.pointer.x) * 0.055;
    this.pointer.y += (this.targetPointer.y - this.pointer.y) * 0.055;

    this.renderStaticFrame(this.lastTimeSeconds);
    if (this.mode === 'active' && this.targetMotionSpeed === 0 && this.motionSpeed === 0) {
      this.stop();
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private updateMotionState(now: number): void {
    if (this.transitionStartNowMs !== null) {
      const progress = clamp01((now - this.transitionStartNowMs) / SPECTRUM_LATTICE_TRANSITION_MS);
      const easedProgress = smoothstep(progress);
      this.motionSpeed = lerp(this.transitionStartSpeed, this.targetMotionSpeed, easedProgress);
      this.perceivedBrightness = lerp(
        this.transitionStartPerceivedBrightness,
        this.targetPerceivedBrightness,
        easedProgress
      );
      this.checkerOpacity = lerp(
        this.transitionStartCheckerOpacity,
        this.targetCheckerOpacity,
        easedProgress
      );
      this.spectrumGridOpacity = lerp(
        this.transitionStartSpectrumGridOpacity,
        this.targetSpectrumGridOpacity,
        easedProgress
      );
      if (progress >= 1) {
        this.motionSpeed = this.targetMotionSpeed;
        this.perceivedBrightness = this.targetPerceivedBrightness;
        this.checkerOpacity = this.targetCheckerOpacity;
        this.spectrumGridOpacity = this.targetSpectrumGridOpacity;
        this.transitionStartNowMs = null;
      }
    }

    if (this.lastFrameNowMs !== null) {
      const deltaSeconds = Math.max(0, (now - this.lastFrameNowMs) * 0.001);
      this.lastTimeSeconds += deltaSeconds * this.motionSpeed;
    }
    this.lastFrameNowMs = now;
    this.emitCurrentBlend();
  }

  private emitCurrentBlend(): void {
    this.emitBlend({
      checkerOpacity: this.checkerOpacity,
      gridOpacity: this.spectrumGridOpacity
    });
  }

  private emitBlend(blend: SpectrumLatticeBlend | null): void {
    this.args.onBlendChange?.(blend);
  }

  private renderStaticFrame(timeSeconds: number): void {
    if (!this.gl || !this.program || !this.uniforms) {
      return;
    }

    const gl = this.gl;
    this.resizeCanvas();
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uniforms.resolution, this.args.canvas.width, this.args.canvas.height);
    gl.uniform2f(this.uniforms.pointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(this.uniforms.time, timeSeconds);
    gl.uniform1f(this.uniforms.perceivedBrightness, this.perceivedBrightness);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private resizeCanvas(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }

    const rect = this.args.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (this.args.canvas.width === width && this.args.canvas.height === height) {
      return;
    }

    this.args.canvas.width = width;
    this.args.canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  private useFallback(): void {
    this.args.canvas.classList.add('spectrum-lattice-canvas--fallback');
  }

  private deleteGlResources(): void {
    if (!this.gl) {
      return;
    }

    this.gl.deleteBuffer(this.quad);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.quad = null;
    this.vao = null;
    this.program = null;
    this.uniforms = null;
    this.gl = null;
  }

  private setPointerTracking(active: boolean): void {
    if (this.pointerTrackingActive === active) {
      return;
    }

    this.pointerTrackingActive = active;
    if (active) {
      window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    } else {
      window.removeEventListener('pointermove', this.handlePointerMove);
    }
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.args.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    this.targetPointer = {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01(1 - (event.clientY - rect.top) / rect.height)
    };
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.stop();
    this.deleteGlResources();
    this.initialized = false;
    this.useFallback();
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed || this.mode === 'disabled') {
      return;
    }

    this.initialized = false;
    this.initialize();
    this.resize();
    if (this.mode === 'idle' && !this.reducedMotion) {
      this.startAnimation(performance.now());
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.disposed || this.mode === 'disabled') {
      return;
    }

    if (document.visibilityState === 'hidden') {
      this.stop();
      return;
    }

    if (this.mode === 'idle' && !this.reducedMotion) {
      this.startAnimation(performance.now());
    } else {
      this.renderStaticFrame(this.lastTimeSeconds);
    }
  };
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexShaderSource: string,
  fragmentShaderSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to create Spectrum lattice shader program.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown shader link error.';
    gl.deleteProgram(program);
    throw new Error(`Spectrum lattice shader link failed: ${log}`);
  }

  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to create Spectrum lattice shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error.';
    gl.deleteShader(shader);
    throw new Error(`Spectrum lattice shader compile failed: ${log}`);
  }

  return shader;
}

function getRequiredUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Spectrum lattice uniform not found: ${name}`);
  }
  return location;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function readReducedMotionPreference(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
