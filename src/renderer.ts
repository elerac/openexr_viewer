import { imageToScreen } from './interaction';
import { resolveActiveProbePixel } from './probe';
import { isStokesDegreeModulationEnabled } from './state';
import { ImagePixel, ViewerState, ViewportInfo } from './types';

const VALUE_LABEL_ZOOM_THRESHOLD = 28;
const MAX_VALUE_LABELS = 1800;

const VERTEX_SOURCE = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D uColormapTexture;
uniform vec2 uViewport;
uniform vec2 uImageSize;
uniform vec2 uPan;
uniform float uZoom;
uniform float uExposure;
uniform bool uUseColormap;
uniform float uColormapMin;
uniform float uColormapMax;
uniform ivec2 uColormapTextureSize;
uniform int uColormapEntryCount;
uniform bool uUseStokesDegreeModulation;
out vec4 outColor;

vec3 linearToSrgb(vec3 linear) {
  vec3 lo = linear * 12.92;
  vec3 hi = 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055;
  bvec3 cutoff = lessThan(linear, vec3(0.0031308));
  return vec3(
    cutoff.r ? lo.r : hi.r,
    cutoff.g ? lo.g : hi.g,
    cutoff.b ? lo.b : hi.b
  );
}

vec3 checker(vec2 screen) {
  float tile = mod(floor(screen.x / 16.0) + floor(screen.y / 16.0), 2.0);
  return mix(vec3(0.09), vec3(0.12), tile);
}

ivec2 colormapCoord(int index) {
  int width = max(uColormapTextureSize.x, 1);
  return ivec2(index - (index / width) * width, index / width);
}

vec3 sampleColormap(float value, float vmin, float vmax) {
  if (vmax <= vmin || uColormapEntryCount < 2 || uColormapTextureSize.x <= 0 || uColormapTextureSize.y <= 0) {
    return vec3(0.0);
  }

  float t = clamp((value - vmin) / (vmax - vmin), 0.0, 1.0);
  float lutIndex = t * float(uColormapEntryCount - 1);
  int index0 = int(floor(lutIndex));
  int index1 = min(index0 + 1, uColormapEntryCount - 1);
  float f = lutIndex - float(index0);
  vec3 color0 = texelFetch(uColormapTexture, colormapCoord(index0), 0).rgb;
  vec3 color1 = texelFetch(uColormapTexture, colormapCoord(index1), 0).rgb;
  return mix(color0, color1, f);
}

vec3 rgbToHsv(vec3 c) {
  float maxValue = max(max(c.r, c.g), c.b);
  float minValue = min(min(c.r, c.g), c.b);
  float delta = maxValue - minValue;
  float hue = 0.0;
  if (delta > 0.0) {
    if (maxValue == c.r) {
      hue = mod((c.g - c.b) / delta, 6.0);
    } else if (maxValue == c.g) {
      hue = (c.b - c.r) / delta + 2.0;
    } else {
      hue = (c.r - c.g) / delta + 4.0;
    }
    hue /= 6.0;
    if (hue < 0.0) {
      hue += 1.0;
    }
  }

  float saturation = maxValue == 0.0 ? 0.0 : delta / maxValue;
  return vec3(hue, saturation, maxValue);
}

vec3 hsvToRgb(vec3 hsv) {
  float hue = fract(hsv.x);
  float saturation = clamp(hsv.y, 0.0, 1.0);
  float value = clamp(hsv.z, 0.0, 1.0);
  float c = value * saturation;
  float hp = hue * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  float m = value - c;
  vec3 rgb = vec3(0.0);

  if (hp < 1.0) {
    rgb = vec3(c, x, 0.0);
  } else if (hp < 2.0) {
    rgb = vec3(x, c, 0.0);
  } else if (hp < 3.0) {
    rgb = vec3(0.0, c, x);
  } else if (hp < 4.0) {
    rgb = vec3(0.0, x, c);
  } else if (hp < 5.0) {
    rgb = vec3(x, 0.0, c);
  } else {
    rgb = vec3(c, 0.0, x);
  }

  return rgb + vec3(m);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x - 0.5, uViewport.y - gl_FragCoord.y - 0.5);
  vec2 imagePos = uPan + (screen - uViewport * 0.5) / uZoom;

  if (imagePos.x < 0.0 || imagePos.y < 0.0 || imagePos.x >= uImageSize.x || imagePos.y >= uImageSize.y) {
    outColor = vec4(checker(screen), 1.0);
    return;
  }

  ivec2 pixel = ivec2(floor(imagePos));
  vec4 texel = texelFetch(uTexture, pixel, 0);
  vec3 linear = texel.rgb;
  if (uUseColormap) {
    float luminance = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    vec3 color = sampleColormap(luminance, uColormapMin, uColormapMax);
    if (uUseStokesDegreeModulation) {
      vec3 hsv = rgbToHsv(color);
      hsv.z *= clamp(texel.a, 0.0, 1.0);
      color = hsvToRgb(hsv);
    }
    outColor = vec4(color, 1.0);
    return;
  }

  linear = max(linear * exp2(uExposure), vec3(0.0));
  vec3 srgb = linearToSrgb(linear);

  outColor = vec4(srgb, 1.0);
}
`;

interface Uniforms {
  viewport: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  pan: WebGLUniformLocation;
  zoom: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  useColormap: WebGLUniformLocation;
  colormapMin: WebGLUniformLocation;
  colormapMax: WebGLUniformLocation;
  colormapTextureSize: WebGLUniformLocation;
  colormapEntryCount: WebGLUniformLocation;
  useStokesDegreeModulation: WebGLUniformLocation;
}

export class WebGlExrRenderer {
  private readonly glCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private readonly colormapTexture: WebGLTexture;
  private readonly uniforms: Uniforms;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private imageSize: { width: number; height: number } | null = null;
  private displayTextureData: Float32Array | null = null;
  private colormapTextureSize = { width: 1, height: 1 };
  private colormapEntryCount = 0;

  constructor(glCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) {
    const gl = glCanvas.getContext('webgl2', { antialias: false });
    if (!gl) {
      throw new Error('WebGL2 is required for this viewer.');
    }

    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      throw new Error('Unable to create overlay 2D canvas context.');
    }

    this.glCanvas = glCanvas;
    this.overlayCanvas = overlayCanvas;
    this.overlayContext = overlayContext;
    this.gl = gl;

    this.program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);

    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error('Failed to create vertex array object.');
    }
    this.vao = vao;

    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create texture.');
    }
    this.texture = texture;

    const colormapTexture = gl.createTexture();
    if (!colormapTexture) {
      throw new Error('Failed to create colormap texture.');
    }
    this.colormapTexture = colormapTexture;

    const viewport = gl.getUniformLocation(this.program, 'uViewport');
    const imageSize = gl.getUniformLocation(this.program, 'uImageSize');
    const pan = gl.getUniformLocation(this.program, 'uPan');
    const zoom = gl.getUniformLocation(this.program, 'uZoom');
    const exposure = gl.getUniformLocation(this.program, 'uExposure');
    const useColormap = gl.getUniformLocation(this.program, 'uUseColormap');
    const colormapMin = gl.getUniformLocation(this.program, 'uColormapMin');
    const colormapMax = gl.getUniformLocation(this.program, 'uColormapMax');
    const colormapTextureSize = gl.getUniformLocation(this.program, 'uColormapTextureSize');
    const colormapEntryCount = gl.getUniformLocation(this.program, 'uColormapEntryCount');
    const useStokesDegreeModulation = gl.getUniformLocation(this.program, 'uUseStokesDegreeModulation');

    if (
      !viewport ||
      !imageSize ||
      !pan ||
      !zoom ||
      !exposure ||
      !useColormap ||
      !colormapMin ||
      !colormapMax ||
      !colormapTextureSize ||
      !colormapEntryCount ||
      !useStokesDegreeModulation
    ) {
      throw new Error('Failed to resolve shader uniforms.');
    }

    this.uniforms = {
      viewport,
      imageSize,
      pan,
      zoom,
      exposure,
      useColormap,
      colormapMin,
      colormapMax,
      colormapTextureSize,
      colormapEntryCount,
      useStokesDegreeModulation
    };

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTexture'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255])
    );
    gl.uniform1i(gl.getUniformLocation(this.program, 'uColormapTexture'), 1);
  }

  getViewport(): ViewportInfo {
    return this.viewport;
  }

  getImageSize(): { width: number; height: number } | null {
    return this.imageSize;
  }

  resize(width: number, height: number): void {
    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };

    this.glCanvas.width = this.viewport.width;
    this.glCanvas.height = this.viewport.height;
    this.overlayCanvas.width = this.viewport.width;
    this.overlayCanvas.height = this.viewport.height;

    this.gl.viewport(0, 0, this.viewport.width, this.viewport.height);
  }

  setDisplayTexture(width: number, height: number, rgbaTexture: Float32Array): void {
    const sameSize = this.imageSize?.width === width && this.imageSize?.height === height;
    this.imageSize = { width, height };
    this.displayTextureData = rgbaTexture;
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    if (sameSize) {
      this.gl.texSubImage2D(
        this.gl.TEXTURE_2D,
        0,
        0,
        0,
        width,
        height,
        this.gl.RGBA,
        this.gl.FLOAT,
        rgbaTexture
      );
    } else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA32F,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.FLOAT,
        rgbaTexture
      );
    }
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (!Number.isInteger(entryCount) || entryCount < 2) {
      throw new Error('Colormap texture requires at least 2 entries.');
    }

    const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    const width = Math.min(entryCount, maxTextureSize);
    const height = Math.ceil(entryCount / width);
    if (height > maxTextureSize) {
      throw new Error(`Colormap has too many entries for this GPU (${entryCount}).`);
    }

    const texelCount = width * height;
    const expectedLength = entryCount * 4;
    if (rgba8.length !== expectedLength) {
      throw new Error(`Invalid colormap data length: expected ${expectedLength}, got ${rgba8.length}.`);
    }

    const uploadData = texelCount === entryCount ? rgba8 : new Uint8Array(texelCount * 4);
    if (uploadData !== rgba8) {
      uploadData.set(rgba8);
      const lastColorOffset = (entryCount - 1) * 4;
      for (let index = entryCount; index < texelCount; index += 1) {
        const offset = index * 4;
        uploadData[offset + 0] = rgba8[lastColorOffset + 0];
        uploadData[offset + 1] = rgba8[lastColorOffset + 1];
        uploadData[offset + 2] = rgba8[lastColorOffset + 2];
        uploadData[offset + 3] = rgba8[lastColorOffset + 3];
      }
    }

    this.colormapTextureSize = { width, height };
    this.colormapEntryCount = entryCount;
    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.colormapTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA8,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      uploadData
    );
  }

  clearImage(): void {
    this.imageSize = null;
    this.displayTextureData = null;
  }

  render(state: ViewerState): void {
    this.drawImage(state);
    this.drawOverlay(state);
  }

  private drawImage(state: ViewerState): void {
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

    gl.uniform2f(this.uniforms.viewport, this.viewport.width, this.viewport.height);

    const width = this.imageSize?.width ?? 0;
    const height = this.imageSize?.height ?? 0;
    gl.uniform2f(this.uniforms.imageSize, width, height);
    gl.uniform2f(this.uniforms.pan, state.panX, state.panY);
    gl.uniform1f(this.uniforms.zoom, state.zoom);
    gl.uniform1f(this.uniforms.exposure, state.exposureEv);
    gl.uniform1i(this.uniforms.useColormap, state.visualizationMode === 'colormap' ? 1 : 0);
    gl.uniform1f(this.uniforms.colormapMin, state.colormapRange?.min ?? 0);
    gl.uniform1f(this.uniforms.colormapMax, state.colormapRange?.max ?? 0);
    gl.uniform2i(
      this.uniforms.colormapTextureSize,
      this.colormapTextureSize.width,
      this.colormapTextureSize.height
    );
    gl.uniform1i(this.uniforms.colormapEntryCount, this.colormapEntryCount);
    gl.uniform1i(
      this.uniforms.useStokesDegreeModulation,
      isStokesDegreeModulationEnabled(state, state.stokesDegreeModulation) ? 1 : 0
    );

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drawOverlay(state: ViewerState): void {
    const ctx = this.overlayContext;
    const imageSize = this.imageSize;

    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    if (!imageSize) {
      return;
    }

    if (state.zoom >= VALUE_LABEL_ZOOM_THRESHOLD) {
      this.drawPixelValues(state, imageSize.width, imageSize.height);
    }

    const probe = resolveActiveProbePixel(state.lockedPixel, state.hoveredPixel);
    if (probe) {
      this.drawProbeMarker(state, probe);
    }
  }

  private drawPixelValues(state: ViewerState, imageWidth: number, imageHeight: number): void {
    const data = this.displayTextureData;
    if (!data) {
      return;
    }

    const bounds = visibleBounds(state, this.viewport);
    const startX = Math.max(0, Math.floor(bounds.left));
    const endX = Math.min(imageWidth - 1, Math.ceil(bounds.right));
    const startY = Math.max(0, Math.floor(bounds.top));
    const endY = Math.min(imageHeight - 1, Math.ceil(bounds.bottom));

    if (endX < startX || endY < startY) {
      return;
    }

    const labelCount = (endX - startX + 1) * (endY - startY + 1);
    if (labelCount > MAX_VALUE_LABELS) {
      return;
    }

    const ctx = this.overlayContext;
    const maxTextWidth = Math.max(1, state.zoom - 5);
    const maxTextHeight = Math.max(1, state.zoom - 5);
    const singleChannelDisplay = isSingleChannelDisplay(state);
    const lineCount = singleChannelDisplay ? 1 : 3;
    let fontSize = Math.min(20, state.zoom * 0.33);
    ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;

    const sizingProbe = '-1.2e+3';
    const probeWidth = ctx.measureText(sizingProbe).width;
    if (probeWidth > maxTextWidth) {
      fontSize *= maxTextWidth / probeWidth;
    }

    const maxLineHeight = maxTextHeight / lineCount;
    if (fontSize > maxLineHeight) {
      fontSize = maxLineHeight;
    }

    fontSize = Math.floor(fontSize);
    if (fontSize < 5) {
      return;
    }

    ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    const labelColors = ['rgba(255, 120, 120, 0.96)', 'rgba(120, 255, 140, 0.96)', 'rgba(120, 170, 255, 0.96)'];

    const halfViewWidth = this.viewport.width * 0.5;
    const halfViewHeight = this.viewport.height * 0.5;

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const pixelIndex = y * imageWidth + x;
        const dataIndex = pixelIndex * 4;
        const valueLines = singleChannelDisplay
          ? [
              {
                color: overlayLabelColorForChannel(state.displayR),
                value: formatOverlayValue(data[dataIndex + 0])
              }
            ]
          : [
              { color: labelColors[0], value: formatOverlayValue(data[dataIndex + 0]) },
              { color: labelColors[1], value: formatOverlayValue(data[dataIndex + 1]) },
              { color: labelColors[2], value: formatOverlayValue(data[dataIndex + 2]) }
            ];

        const centerX = (x + 0.5 - state.panX) * state.zoom + halfViewWidth;
        const centerY = (y + 0.5 - state.panY) * state.zoom + halfViewHeight;
        const lineHeight = fontSize;
        const blockHeight = lineHeight * valueLines.length;
        let textY = centerY - blockHeight * 0.5 + lineHeight * 0.5;

        for (let lineIndex = 0; lineIndex < valueLines.length; lineIndex += 1) {
          const line = valueLines[lineIndex];
          ctx.fillStyle = line?.color ?? 'rgba(255, 255, 255, 0.95)';
          ctx.strokeText(line?.value ?? '', centerX, textY);
          ctx.fillText(line?.value ?? '', centerX, textY);
          textY += lineHeight;
        }
      }
    }
  }

  private drawProbeMarker(state: ViewerState, pixel: ImagePixel): void {
    const ctx = this.overlayContext;

    const topLeft = imageToScreen(pixel.ix, pixel.iy, state, this.viewport);

    ctx.strokeStyle = state.lockedPixel ? 'rgba(255, 196, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, state.zoom, state.zoom);
  }
}

function visibleBounds(state: ViewerState, viewport: ViewportInfo): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const halfWidth = viewport.width / (2 * state.zoom);
  const halfHeight = viewport.height / (2 * state.zoom);

  return {
    left: state.panX - halfWidth,
    right: state.panX + halfWidth,
    top: state.panY - halfHeight,
    bottom: state.panY + halfHeight
  };
}

function formatOverlayValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1000)) {
    return value.toExponential(1);
  }

  return value.toPrecision(3);
}

function isSingleChannelDisplay(state: ViewerState): boolean {
  return state.displayR === state.displayG && state.displayG === state.displayB;
}

function overlayLabelColorForChannel(channelName: string): string {
  if (channelName === 'R' || channelName.endsWith('.R')) {
    return 'rgba(255, 120, 120, 0.96)';
  }
  if (channelName === 'G' || channelName.endsWith('.G')) {
    return 'rgba(120, 255, 140, 0.96)';
  }
  if (channelName === 'B' || channelName.endsWith('.B')) {
    return 'rgba(120, 170, 255, 0.96)';
  }
  return 'rgba(255, 255, 255, 0.95)';
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to create shader program.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown shader link error.';
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(`Shader link failed: ${log}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to create shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error.';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }

  return shader;
}
