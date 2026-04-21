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
  });
});
