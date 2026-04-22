#version 300 es
precision highp float;

uniform sampler2D uSourceTextures[12];
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
uniform int uDisplayMode;
uniform int uStokesParameter;
uniform bool uUseStokesDegreeModulation;
uniform bool uUseImageAlpha;
uniform bool uCompositeCheckerboard;
uniform int uAlphaOutputMode;
out vec4 outColor;

const int DISPLAY_MODE_EMPTY = 0;
const int DISPLAY_MODE_CHANNEL_RGB = 1;
const int DISPLAY_MODE_CHANNEL_MONO = 2;
const int DISPLAY_MODE_STOKES_DIRECT = 3;
const int DISPLAY_MODE_STOKES_RGB_LUMINANCE = 4;
const int ALPHA_OUTPUT_OPAQUE = 0;
const int ALPHA_OUTPUT_STRAIGHT = 1;
const int ALPHA_OUTPUT_PREMULTIPLIED = 2;

const int STOKES_PARAMETER_AOLP = 0;
const int STOKES_PARAMETER_DOLP = 1;
const int STOKES_PARAMETER_DOP = 2;
const int STOKES_PARAMETER_DOCP = 3;
const int STOKES_PARAMETER_COP = 4;
const int STOKES_PARAMETER_TOP = 5;
const int STOKES_PARAMETER_S1_OVER_S0 = 6;
const int STOKES_PARAMETER_S2_OVER_S0 = 7;
const int STOKES_PARAMETER_S3_OVER_S0 = 8;

const float PI = 3.1415926535897932384626433832795;
const float REC709_LUMINANCE_WEIGHT_R = 0.2126;
const float REC709_LUMINANCE_WEIGHT_G = 0.7152;
const float REC709_LUMINANCE_WEIGHT_B = 0.0722;
const float SRGB_TRANSFER_CUTOFF = 0.0031308;
const float SRGB_TRANSFER_LINEAR_SCALE = 12.92;
const float SRGB_TRANSFER_ENCODED_SCALE = 1.055;
const float SRGB_TRANSFER_ENCODED_OFFSET = 0.055;
const float SRGB_TRANSFER_GAMMA = 2.4;

struct DisplaySample {
  vec3 linear;
  float alpha;
  vec4 stokes;
};

bool isFiniteValue(float value) {
  return !(isnan(value) || isinf(value));
}

float sanitizeDisplayValue(float value) {
  return isFiniteValue(value) ? value : 0.0;
}

float sanitizeAlphaValue(float value) {
  return isFiniteValue(value) ? clamp(value, 0.0, 1.0) : 0.0;
}

float computeRec709Luminance(float r, float g, float b) {
  return REC709_LUMINANCE_WEIGHT_R * r +
    REC709_LUMINANCE_WEIGHT_G * g +
    REC709_LUMINANCE_WEIGHT_B * b;
}

vec3 linearToSrgb(vec3 linear) {
  vec3 lo = linear * SRGB_TRANSFER_LINEAR_SCALE;
  vec3 hi = SRGB_TRANSFER_ENCODED_SCALE * pow(linear, vec3(1.0 / SRGB_TRANSFER_GAMMA)) - SRGB_TRANSFER_ENCODED_OFFSET;
  bvec3 cutoff = lessThanEqual(linear, vec3(SRGB_TRANSFER_CUTOFF));
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

vec4 backgroundColor(vec2 screen) {
  if (uCompositeCheckerboard) {
    return vec4(checker(screen), 1.0);
  }

  if (uAlphaOutputMode == ALPHA_OUTPUT_OPAQUE) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }

  return vec4(0.0);
}

vec4 encodeOutputColor(vec2 screen, vec3 color, float alpha) {
  if (uCompositeCheckerboard) {
    return vec4(mix(checker(screen), color, alpha), 1.0);
  }

  if (uAlphaOutputMode == ALPHA_OUTPUT_PREMULTIPLIED) {
    return vec4(color * alpha, alpha);
  }

  if (uAlphaOutputMode == ALPHA_OUTPUT_STRAIGHT) {
    return vec4(color, alpha);
  }

  return vec4(color, 1.0);
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

float computeStokesAolp(float s1, float s2) {
  if (!isFiniteValue(s1) || !isFiniteValue(s2)) {
    return 0.0;
  }

  float aolp = 0.5 * atan(s2, s1);
  return aolp < 0.0 ? aolp + PI : aolp;
}

float computeStokesDolp(float s0, float s1, float s2) {
  if (!isFiniteValue(s0) || !isFiniteValue(s1) || !isFiniteValue(s2) || s0 == 0.0) {
    return 0.0;
  }

  float dolp = sqrt(s1 * s1 + s2 * s2) / s0;
  return isFiniteValue(dolp) ? dolp : 0.0;
}

float computeStokesDop(float s0, float s1, float s2, float s3) {
  if (!isFiniteValue(s0) || !isFiniteValue(s1) || !isFiniteValue(s2) || !isFiniteValue(s3) || s0 == 0.0) {
    return 0.0;
  }

  float dop = sqrt(s1 * s1 + s2 * s2 + s3 * s3) / s0;
  return isFiniteValue(dop) ? dop : 0.0;
}

float computeStokesDocp(float s0, float s3) {
  if (!isFiniteValue(s0) || !isFiniteValue(s3) || s0 == 0.0) {
    return 0.0;
  }

  float docp = abs(s3) / s0;
  return isFiniteValue(docp) ? docp : 0.0;
}

float computeStokesEang(float s1, float s2, float s3) {
  if (!isFiniteValue(s1) || !isFiniteValue(s2) || !isFiniteValue(s3)) {
    return 0.0;
  }

  return 0.5 * atan(s3, sqrt(s1 * s1 + s2 * s2));
}

float computeStokesNormalizedComponent(float s0, float component) {
  if (!isFiniteValue(s0) || !isFiniteValue(component) || s0 == 0.0) {
    return 0.0;
  }

  float normalized = component / s0;
  return isFiniteValue(normalized) ? normalized : 0.0;
}

float computeStokesDisplayValue(int parameter, float s0, float s1, float s2, float s3) {
  if (parameter == STOKES_PARAMETER_AOLP) {
    return computeStokesAolp(s1, s2);
  }
  if (parameter == STOKES_PARAMETER_DOLP) {
    return computeStokesDolp(s0, s1, s2);
  }
  if (parameter == STOKES_PARAMETER_DOP) {
    return computeStokesDop(s0, s1, s2, s3);
  }
  if (parameter == STOKES_PARAMETER_DOCP) {
    return computeStokesDocp(s0, s3);
  }
  if (parameter == STOKES_PARAMETER_COP) {
    return computeStokesEang(s1, s2, s3);
  }
  if (parameter == STOKES_PARAMETER_TOP) {
    return computeStokesEang(s1, s2, s3);
  }
  if (parameter == STOKES_PARAMETER_S1_OVER_S0) {
    return computeStokesNormalizedComponent(s0, s1);
  }
  if (parameter == STOKES_PARAMETER_S2_OVER_S0) {
    return computeStokesNormalizedComponent(s0, s2);
  }
  if (parameter == STOKES_PARAMETER_S3_OVER_S0) {
    return computeStokesNormalizedComponent(s0, s3);
  }

  return 0.0;
}

float computeStokesDegreeModulationValue(int parameter, float s0, float s1, float s2, float s3) {
  if (parameter == STOKES_PARAMETER_AOLP) {
    return computeStokesDolp(s0, s1, s2);
  }
  if (parameter == STOKES_PARAMETER_COP) {
    return computeStokesDocp(s0, s3);
  }
  if (parameter == STOKES_PARAMETER_TOP) {
    return computeStokesDop(s0, s1, s2, s3);
  }

  return 0.0;
}

float computeStokesDegreeModulationDisplayValue(int parameter, float s0, float s1, float s2, float s3) {
  return clamp(computeStokesDegreeModulationValue(parameter, s0, s1, s2, s3), 0.0, 1.0);
}

float readSource0(ivec2 pixel) {
  return texelFetch(uSourceTextures[0], pixel, 0).r;
}

float readSource1(ivec2 pixel) {
  return texelFetch(uSourceTextures[1], pixel, 0).r;
}

float readSource2(ivec2 pixel) {
  return texelFetch(uSourceTextures[2], pixel, 0).r;
}

float readSource3(ivec2 pixel) {
  return texelFetch(uSourceTextures[3], pixel, 0).r;
}

float readSource4(ivec2 pixel) {
  return texelFetch(uSourceTextures[4], pixel, 0).r;
}

float readSource5(ivec2 pixel) {
  return texelFetch(uSourceTextures[5], pixel, 0).r;
}

float readSource6(ivec2 pixel) {
  return texelFetch(uSourceTextures[6], pixel, 0).r;
}

float readSource7(ivec2 pixel) {
  return texelFetch(uSourceTextures[7], pixel, 0).r;
}

float readSource8(ivec2 pixel) {
  return texelFetch(uSourceTextures[8], pixel, 0).r;
}

float readSource9(ivec2 pixel) {
  return texelFetch(uSourceTextures[9], pixel, 0).r;
}

float readSource10(ivec2 pixel) {
  return texelFetch(uSourceTextures[10], pixel, 0).r;
}

float readSource11(ivec2 pixel) {
  return texelFetch(uSourceTextures[11], pixel, 0).r;
}

vec4 readDirectStokesSample(ivec2 pixel) {
  return vec4(
    readSource0(pixel),
    readSource1(pixel),
    readSource2(pixel),
    readSource3(pixel)
  );
}

vec4 readRgbLuminanceStokesSample(ivec2 pixel) {
  return vec4(
    computeRec709Luminance(
      readSource0(pixel),
      readSource4(pixel),
      readSource8(pixel)
    ),
    computeRec709Luminance(
      readSource1(pixel),
      readSource5(pixel),
      readSource9(pixel)
    ),
    computeRec709Luminance(
      readSource2(pixel),
      readSource6(pixel),
      readSource10(pixel)
    ),
    computeRec709Luminance(
      readSource3(pixel),
      readSource7(pixel),
      readSource11(pixel)
    )
  );
}

DisplaySample createEmptySample() {
  return DisplaySample(vec3(0.0), 1.0, vec4(0.0));
}

DisplaySample readDisplaySample(ivec2 pixel) {
  if (uDisplayMode == DISPLAY_MODE_CHANNEL_RGB) {
    return DisplaySample(
      vec3(
        sanitizeDisplayValue(readSource0(pixel)),
        sanitizeDisplayValue(readSource1(pixel)),
        sanitizeDisplayValue(readSource2(pixel))
      ),
      uUseImageAlpha ? sanitizeAlphaValue(readSource3(pixel)) : 1.0,
      vec4(0.0)
    );
  }

  if (uDisplayMode == DISPLAY_MODE_CHANNEL_MONO) {
    float value = sanitizeDisplayValue(readSource0(pixel));
    return DisplaySample(
      vec3(value),
      uUseImageAlpha ? sanitizeAlphaValue(readSource3(pixel)) : 1.0,
      vec4(0.0)
    );
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_DIRECT) {
    vec4 stokes = readDirectStokesSample(pixel);
    float value = computeStokesDisplayValue(uStokesParameter, stokes.x, stokes.y, stokes.z, stokes.w);
    return DisplaySample(vec3(value), 1.0, stokes);
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_RGB_LUMINANCE) {
    vec4 stokes = readRgbLuminanceStokesSample(pixel);
    float value = computeStokesDisplayValue(uStokesParameter, stokes.x, stokes.y, stokes.z, stokes.w);
    return DisplaySample(vec3(value), 1.0, stokes);
  }

  return createEmptySample();
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x - 0.5, uViewport.y - gl_FragCoord.y - 0.5);
  vec2 imagePos = uPan + (screen - uViewport * 0.5) / uZoom;

  if (imagePos.x < 0.0 || imagePos.y < 0.0 || imagePos.x >= uImageSize.x || imagePos.y >= uImageSize.y) {
    outColor = backgroundColor(screen);
    return;
  }

  ivec2 pixel = ivec2(floor(imagePos));
  DisplaySample displaySample = readDisplaySample(pixel);
  vec3 linear = displaySample.linear;
  float imageAlpha = displaySample.alpha;

  if (uUseColormap) {
    float luminance = computeRec709Luminance(linear.r, linear.g, linear.b);
    vec3 color = sampleColormap(luminance, uColormapMin, uColormapMax);
    if (uUseStokesDegreeModulation) {
      vec3 hsv = rgbToHsv(color);
      hsv.z *= computeStokesDegreeModulationDisplayValue(
        uStokesParameter,
        displaySample.stokes.x,
        displaySample.stokes.y,
        displaySample.stokes.z,
        displaySample.stokes.w
      );
      color = hsvToRgb(hsv);
    }
    outColor = encodeOutputColor(screen, color, imageAlpha);
    return;
  }

  linear = max(linear * exp2(uExposure), vec3(0.0));
  vec3 srgb = linearToSrgb(linear);
  outColor = encodeOutputColor(screen, srgb, imageAlpha);
}
