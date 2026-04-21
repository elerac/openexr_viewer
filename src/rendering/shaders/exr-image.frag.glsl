#version 300 es
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
uniform bool uUseImageAlpha;
out vec4 outColor;

const float REC709_LUMINANCE_WEIGHT_R = 0.2126;
const float REC709_LUMINANCE_WEIGHT_G = 0.7152;
const float REC709_LUMINANCE_WEIGHT_B = 0.0722;
const float SRGB_TRANSFER_CUTOFF = 0.0031308;
const float SRGB_TRANSFER_LINEAR_SCALE = 12.92;
const float SRGB_TRANSFER_ENCODED_SCALE = 1.055;
const float SRGB_TRANSFER_ENCODED_OFFSET = 0.055;
const float SRGB_TRANSFER_GAMMA = 2.4;

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
  float imageAlpha = uUseImageAlpha ? clamp(texel.a, 0.0, 1.0) : 1.0;
  if (uUseColormap) {
    float luminance = dot(linear, vec3(
      REC709_LUMINANCE_WEIGHT_R,
      REC709_LUMINANCE_WEIGHT_G,
      REC709_LUMINANCE_WEIGHT_B
    ));
    vec3 color = sampleColormap(luminance, uColormapMin, uColormapMax);
    if (uUseStokesDegreeModulation) {
      vec3 hsv = rgbToHsv(color);
      hsv.z *= clamp(texel.a, 0.0, 1.0);
      color = hsvToRgb(hsv);
    }
    outColor = vec4(mix(checker(screen), color, imageAlpha), 1.0);
    return;
  }

  linear = max(linear * exp2(uExposure), vec3(0.0));
  vec3 srgb = linearToSrgb(linear);

  outColor = vec4(mix(checker(screen), srgb, imageAlpha), 1.0);
}
