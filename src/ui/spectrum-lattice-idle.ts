import { DisposableBag, type Disposable } from '../lifecycle';

interface SpectrumLatticeIdleElements {
  viewerContainer: HTMLElement;
  canvas: HTMLCanvasElement;
  idle: HTMLElement;
}

interface SpectrumLatticeUniforms {
  resolution: WebGLUniformLocation;
  pointer: WebGLUniformLocation;
  time: WebGLUniformLocation;
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

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

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

  fragColor = vec4(col, 1.0);
}
`;

export class SpectrumLatticeIdleController implements Disposable {
  private readonly disposables = new DisposableBag();
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quad: WebGLBuffer | null = null;
  private uniforms: SpectrumLatticeUniforms | null = null;
  private animationFrameId: number | null = null;
  private initialized = false;
  private visible = false;
  private disposed = false;
  private pointer = { x: 0.5, y: 0.5 };
  private targetPointer = { x: 0.5, y: 0.5 };

  constructor(private readonly elements: SpectrumLatticeIdleElements) {
    this.disposables.addEventListener(this.elements.viewerContainer, 'pointermove', (event) => {
      const rect = this.elements.viewerContainer.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      this.targetPointer = {
        x: clamp01((event.clientX - rect.left) / rect.width),
        y: clamp01(1 - (event.clientY - rect.top) / rect.height)
      };
    }, { passive: true });
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) {
      return;
    }

    this.visible = visible;
    this.elements.viewerContainer.classList.toggle('is-spectrum-lattice-idle', visible);
    this.elements.canvas.classList.toggle('hidden', !visible);
    this.elements.idle.classList.toggle('hidden', !visible);

    if (visible) {
      this.start();
    } else {
      this.stop();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stop();
    this.disposables.dispose();
    this.deleteGlResources();
  }

  private start(): void {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.gl || !this.program || !this.uniforms) {
      return;
    }

    this.renderFrame(performance.now());
  }

  private stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private initialize(): void {
    this.initialized = true;

    try {
      const gl = this.elements.canvas.getContext('webgl2', {
        antialias: false,
        powerPreference: 'high-performance'
      });
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
        time: getRequiredUniformLocation(gl, program, 'uTime')
      };
      this.elements.canvas.classList.remove('spectrum-lattice-canvas--fallback');
    } catch {
      this.deleteGlResources();
      this.useFallback();
    }
  }

  private readonly renderFrame = (now: number): void => {
    if (!this.visible || !this.gl || !this.program || !this.uniforms) {
      return;
    }

    const gl = this.gl;
    const t = now * 0.001;
    this.resizeCanvas();
    this.pointer.x += (this.targetPointer.x - this.pointer.x) * 0.055;
    this.pointer.y += (this.targetPointer.y - this.pointer.y) * 0.055;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uniforms.resolution, this.elements.canvas.width, this.elements.canvas.height);
    gl.uniform2f(this.uniforms.pointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(this.uniforms.time, t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private resizeCanvas(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }

    const rect = this.elements.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (this.elements.canvas.width === width && this.elements.canvas.height === height) {
      return;
    }

    this.elements.canvas.width = width;
    this.elements.canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  private useFallback(): void {
    this.elements.canvas.classList.add('spectrum-lattice-canvas--fallback');
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
