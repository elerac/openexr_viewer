import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shaderFiles = [
  '../src/rendering/shaders/exr-image.frag.glsl',
  '../src/rendering/shaders/panorama-image.frag.glsl'
] as const;

describe('shader source regressions', () => {
  it.each(shaderFiles)('%s avoids dynamic sampler indexing and reserved sample identifiers', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');

    expect(source).not.toMatch(/uSourceTextures\[(?!\d+\])/);
    expect(source).not.toMatch(/\bDisplaySample\s+sample\b/);
    expect(source).not.toMatch(/\bsample\./);
    expect(source).toContain('uniform float uDisplayGamma;');
    expect(source).toContain('uniform bool uMaskInvalidStokesVectors;');
    expect(source).toContain('uniform bool uWarnInvalidValues;');
    expect(source).toContain('uniform float uInvalidValueWarningPhase;');
    expect(source).toContain('linearToDisplayGamma');
    expect(source).toContain('sign(linear) * pow(abs(linear)');
    expect(source).toContain('const float STOKES_VECTOR_VALIDITY_RTOL = 1.0e-8;');
    expect(source).not.toContain('STOKES_VECTOR_VALIDITY_ATOL');
    expect(source).toContain(
      's0Squared - (s1 * s1 + s2 * s2 + s3 * s3) >= -abs(STOKES_VECTOR_VALIDITY_RTOL) * s0Squared'
    );
    expect(source).toContain('uMaskInvalidStokesVectors && !isPhysicallyValidStokesVector');
    expect(source).toContain('bool invalidValue;');
    expect(source).toContain('applyInvalidValueWarning');
    expect(source).toContain('DISPLAY_MODE_STOKES_SPECTRAL_RGB');
    expect(source).toContain('readSpectralStokesRgbDisplaySample');
  });
});
