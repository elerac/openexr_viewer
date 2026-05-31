import { describe, expect, it } from 'vitest';
import {
  pickDefaultRecognizedCandidate,
  recognizeLayerChannels,
  type ChannelRecognitionConfig,
  type RecognizedChannelCandidate
} from '../src/channel-recognition';
import { createDefaultChannelRecognitionSettings } from '../src/channel-recognition-settings';
import { serializeDisplaySelectionKey } from '../src/display-model';
import { MUELLER_MATRIX_ELEMENTS } from '../src/mueller';

function visibleCandidates(
  channelNames: readonly string[],
  split = false,
  config: ChannelRecognitionConfig = {}
): RecognizedChannelCandidate[] {
  return recognizeLayerChannels([...channelNames], config).candidates
    .filter((candidate) => split ? candidate.availability.split : candidate.availability.merged)
    .filter((candidate) => split || !candidate.metadata.hiddenInMergedChannelView)
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
}

function visibleKeys(
  channelNames: readonly string[],
  split = false,
  config: ChannelRecognitionConfig = {}
): string[] {
  return visibleCandidates(channelNames, split, config).map((candidate) => candidate.key);
}

function findCandidate(
  channelNames: readonly string[],
  key: string,
  config: ChannelRecognitionConfig = {}
): RecognizedChannelCandidate | null {
  return recognizeLayerChannels([...channelNames], config).candidates.find((candidate) => candidate.key === key) ?? null;
}

function selectionKey(candidate: RecognizedChannelCandidate | null): string | null {
  return candidate ? serializeDisplaySelectionKey(candidate.selection) : null;
}

function defaultSelectionKey(channelNames: readonly string[], config: ChannelRecognitionConfig = {}): string | null {
  const candidate = pickDefaultRecognizedCandidate(recognizeLayerChannels([...channelNames], config));
  return candidate ? serializeDisplaySelectionKey(candidate.selection) : null;
}

function withRecognitionDisabled(...ids: Array<keyof ReturnType<typeof createDefaultChannelRecognitionSettings>>): ChannelRecognitionConfig {
  const channelRecognitionSettings = createDefaultChannelRecognitionSettings();
  for (const id of ids) {
    channelRecognitionSettings[id] = false;
  }
  return { channelRecognitionSettings };
}

describe('channel recognition', () => {
  it('recognizes RGB/RGBA groups and split children without changing option identity', () => {
    const channelNames = ['beauty.R', 'beauty.G', 'beauty.B', 'beauty.A', 'depth.Z'];
    const group = findCandidate(channelNames, 'group:beauty');

    expect(visibleKeys(channelNames)).toEqual(['group:beauty', 'channel:depth.Z']);
    expect(visibleKeys(channelNames, true)).toEqual([
      'channel:beauty.R',
      'channel:beauty.G',
      'channel:beauty.B',
      'channel:beauty.A',
      'channel:depth.Z'
    ]);
    expect(group).toMatchObject({
      kind: 'componentGroup',
      ruleId: 'component.rgb',
      label: 'beauty.(R,G,B,A)',
      priority: 10,
      splitChildren: [
        'channel:beauty.R',
        'channel:beauty.G',
        'channel:beauty.B',
        'channel:beauty.A'
      ]
    });
    expect(selectionKey(group)).toBe('channelRgb:beauty.R:beauty.G:beauty.B:beauty.A');
  });

  it('gates component recognition rules independently and keeps single-channel fallback available', () => {
    expect(visibleKeys(['R', 'G', 'B', 'vector.X', 'vector.Y', 'vector.Z'], false, withRecognitionDisabled('component.rgb'))).toEqual([
      'groupXYZ:vector',
      'channel:R',
      'channel:G',
      'channel:B'
    ]);
    expect(visibleKeys(['vector.X', 'vector.Y', 'vector.Z'], false, withRecognitionDisabled('component.xyz'))).toEqual([
      'channel:vector.X',
      'channel:vector.Y',
      'channel:vector.Z'
    ]);
    expect(visibleKeys(['normal.X', 'normal.Y', 'normal.Z'], false, withRecognitionDisabled('normal.map', 'component.xyz'))).toEqual([
      'channel:normal.X',
      'channel:normal.Y',
      'channel:normal.Z'
    ]);
    expect(visibleKeys(['U', 'V'], false, withRecognitionDisabled('component.uv'))).toEqual([
      'channel:U',
      'channel:V'
    ]);
  });

  it('recognizes declarative XYZ and UV component groups', () => {
    const channelNames = [
      'vector.X',
      'vector.Y',
      'vector.Z',
      'motion.U',
      'motion.V',
      'motion.A',
      'depth.Z'
    ];
    const xyz = findCandidate(channelNames, 'groupXYZ:vector');
    const uv = findCandidate(channelNames, 'groupUV:motion');

    expect(visibleKeys(channelNames)).toEqual(['groupXYZ:vector', 'groupUV:motion', 'channel:depth.Z']);
    expect(visibleKeys(channelNames, true)).toEqual([
      'channel:vector.X',
      'channel:vector.Y',
      'channel:vector.Z',
      'channel:motion.U',
      'channel:motion.V',
      'channel:motion.A',
      'channel:depth.Z'
    ]);
    expect(selectionKey(xyz)).toBe('channelRgb:vector.X:vector.Y:vector.Z:');
    expect(selectionKey(uv)).toBe('channelRgb:motion.U:motion.V::motion.A');
    expect(selectionKey(findCandidate(['U', 'V'], 'groupUV:'))).toBe('channelRgb:U:V::');
  });

  it('recognizes normal maps and suppresses duplicate XYZ groups while enabled', () => {
    const channelNames = [
      'R',
      'G',
      'B',
      'N.X',
      'N.Y',
      'N.Z',
      'normal.X',
      'normal.Y',
      'normal.Z',
      'normal.A',
      'surface_normal.X',
      'surface_normal.Y',
      'surface_normal.Z',
      'vector.X',
      'vector.Y',
      'vector.Z'
    ];
    const n = findCandidate(channelNames, 'normalMap:N');
    const normal = findCandidate(channelNames, 'normalMap:normal');
    const suffixedNormal = findCandidate(channelNames, 'normalMap:surface_normal');

    expect(visibleKeys(channelNames)).toEqual([
      'group:',
      'normalMap:N',
      'normalMap:normal',
      'normalMap:surface_normal',
      'groupXYZ:vector'
    ]);
    expect(visibleKeys(channelNames)).not.toContain('groupXYZ:N');
    expect(visibleKeys(channelNames)).not.toContain('groupXYZ:normal');
    expect(visibleKeys(channelNames)).not.toContain('groupXYZ:surface_normal');
    expect(visibleKeys(channelNames, true)).toEqual([
      'channel:R',
      'channel:G',
      'channel:B',
      'channel:N.X',
      'channel:N.Y',
      'channel:N.Z',
      'channel:normal.X',
      'channel:normal.Y',
      'channel:normal.Z',
      'channel:normal.A',
      'channel:surface_normal.X',
      'channel:surface_normal.Y',
      'channel:surface_normal.Z',
      'channel:vector.X',
      'channel:vector.Y',
      'channel:vector.Z'
    ]);
    expect(n).toMatchObject({
      kind: 'normalMap',
      ruleId: 'normal.map',
      label: 'N Normal Map',
      priority: 40,
      splitChildren: ['channel:N.X', 'channel:N.Y', 'channel:N.Z']
    });
    expect(selectionKey(n)).toBe('channelRgb:N.X:N.Y:N.Z::normalMap');
    expect(normal).toMatchObject({
      kind: 'normalMap',
      channels: ['normal.X', 'normal.Y', 'normal.Z', 'normal.A']
    });
    expect(selectionKey(normal)).toBe('channelRgb:normal.X:normal.Y:normal.Z:normal.A:normalMap');
    expect(suffixedNormal).toMatchObject({
      kind: 'normalMap',
      channels: ['surface_normal.X', 'surface_normal.Y', 'surface_normal.Z']
    });
    expect(selectionKey(suffixedNormal)).toBe(
      'channelRgb:surface_normal.X:surface_normal.Y:surface_normal.Z::normalMap'
    );
  });

  it('falls back to generic XYZ grouping when normal-map recognition is disabled', () => {
    const config = withRecognitionDisabled('normal.map');

    expect(visibleKeys(['normal.X', 'normal.Y', 'normal.Z'], false, config)).toEqual(['groupXYZ:normal']);
    expect(selectionKey(findCandidate(['normal.X', 'normal.Y', 'normal.Z'], 'groupXYZ:normal', config))).toBe(
      'channelRgb:normal.X:normal.Y:normal.Z:'
    );
  });

  it('recognizes spectral RGB series and hides wavelength children from merged channel view', () => {
    const channelNames = ['410nm', '500nm', '650nm', 'mask'];
    const spectral = findCandidate(channelNames, 'spectralRgb:');
    const wavelength = findCandidate(channelNames, 'channel:410nm');

    expect(visibleKeys(channelNames)).toEqual(['channel:mask', 'spectralRgb:']);
    expect(visibleKeys(channelNames, true)).toEqual([
      'channel:410nm',
      'channel:500nm',
      'channel:650nm',
      'channel:mask'
    ]);
    expect(spectral).toMatchObject({
      kind: 'spectralSeries',
      ruleId: 'spectral.series',
      priority: 50,
      splitChildren: ['channel:410nm', 'channel:500nm', 'channel:650nm']
    });
    expect(wavelength?.metadata.hiddenInMergedChannelView).toBe(true);
    expect(selectionKey(spectral)).toBe('spectralRgb:');
  });

  it('preserves spectral series ordering and duplicate wavelength ordering', () => {
    expect(visibleKeys([
      'hoge.450nm',
      'fuga.450nm',
      'hoge.550nm',
      'fuga.550nm'
    ]).filter((key) => key.startsWith('spectralRgb:'))).toEqual([
      'spectralRgb:hoge',
      'spectralRgb:fuga'
    ]);

    expect(findCandidate(['600nm', 'HOGE500nm', 'FUGA500nm', '400nm'], 'spectralRgb:')?.channels).toEqual([
      '400nm',
      'HOGE500nm',
      'FUGA500nm',
      '600nm'
    ]);
  });

  it('recognizes scalar and RGB Stokes options with S3 availability metadata', () => {
    const linearStokes = ['S0', 'S1', 'S2'];
    const fullStokes = ['S0', 'S1', 'S2', 'S3'];
    const rgbStokes = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B',
      'S3.R', 'S3.G', 'S3.B'
    ];

    expect(visibleKeys(linearStokes).filter((key) => key.startsWith('stokesScalar:'))).toEqual([
      'stokesScalar:s1_over_s0',
      'stokesScalar:s2_over_s0',
      'stokesScalar:aolp',
      'stokesScalar:dop',
      'stokesScalar:dolp'
    ]);
    expect(findCandidate(linearStokes, 'stokesScalar:dop')?.metadata.hasS3).toBe(false);
    expect(visibleKeys(fullStokes).filter((key) => key.startsWith('stokesScalar:'))).toEqual([
      'stokesScalar:s1_over_s0',
      'stokesScalar:s2_over_s0',
      'stokesScalar:s3_over_s0',
      'stokesScalar:aolp',
      'stokesScalar:dop',
      'stokesScalar:dolp',
      'stokesScalar:docp',
      'stokesScalar:cop',
      'stokesScalar:top'
    ]);
    expect(findCandidate(fullStokes, 'stokesScalar:docp')?.metadata.hasS3).toBe(true);
    expect(visibleKeys(rgbStokes).filter((key) => key.startsWith('stokesRgb:') && key.endsWith(':group'))).toContain(
      'stokesRgb:top:group'
    );
    expect(visibleKeys(rgbStokes, true).filter((key) => key.startsWith('stokesRgb:s1_over_s0:'))).toEqual([
      'stokesRgb:s1_over_s0:R',
      'stokesRgb:s1_over_s0:G',
      'stokesRgb:s1_over_s0:B'
    ]);
  });

  it('recognizes spectral Stokes grouped and split presentations', () => {
    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ];

    expect(visibleKeys(channelNames).filter((key) => key.startsWith('spectralRgb:'))).toEqual([
      'spectralRgb:S0',
      'spectralRgb:S1',
      'spectralRgb:S2',
      'spectralRgb:S3'
    ]);
    expect(visibleKeys(channelNames).filter((key) => key.startsWith('stokesSpectralRgb:'))).toContain(
      'stokesSpectralRgb:top:group'
    );
    expect(visibleKeys(channelNames)).not.toContain('stokesScalar:s1_over_s0:400nm');
    expect(visibleKeys(channelNames, true)).toContain('stokesScalar:s1_over_s0:400nm');
  });

  it('hides spectral channels and spectral Stokes candidates when legacy grouping is disabled', () => {
    expect(visibleKeys(['410nm', '500nm', '650nm'], false, {
      spectralRgbGroupingEnabled: false
    })).toEqual(['channel:410nm', 'channel:500nm', 'channel:650nm']);

    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ];
    const keys = visibleKeys(channelNames, false, { spectralRgbGroupingEnabled: false });

    expect(keys.some((key) => key.startsWith('spectralRgb:'))).toBe(false);
    expect(keys.some((key) => key.startsWith('stokesSpectralRgb:'))).toBe(false);
    expect(keys).not.toContain('stokesScalar:s1_over_s0:400nm');
  });

  it('gates spectral series independently from spectral Stokes recognition', () => {
    const channelNames = [
      'S0.400nm', 'S1.400nm', 'S2.400nm', 'S3.400nm',
      'S0.500nm', 'S1.500nm', 'S2.500nm', 'S3.500nm'
    ];

    expect(visibleKeys(channelNames, false, withRecognitionDisabled('spectral.series'))).toContain(
      'stokesSpectralRgb:top:group'
    );
    expect(visibleKeys(channelNames, false, withRecognitionDisabled('spectral.series')).some((key) => key.startsWith('spectralRgb:')))
      .toBe(false);
    expect(visibleKeys(channelNames, false, withRecognitionDisabled('stokes.spectral'))).toContain('spectralRgb:S0');
    expect(visibleKeys(channelNames, false, withRecognitionDisabled('stokes.spectral')).some((key) => key.startsWith('stokesSpectralRgb:')))
      .toBe(false);
    expect(visibleKeys(channelNames, false, withRecognitionDisabled('stokes.spectral')))
      .not.toContain('stokesScalar:s1_over_s0:400nm');
  });

  it('gates Stokes, Mueller, and alpha companion recognition families', () => {
    expect(visibleKeys(['S0', 'S1', 'S2', 'S3'], false, withRecognitionDisabled('stokes.scalar'))
      .some((key) => key.startsWith('stokesScalar:'))).toBe(false);

    const rgbStokes = [
      'S0.R', 'S0.G', 'S0.B',
      'S1.R', 'S1.G', 'S1.B',
      'S2.R', 'S2.G', 'S2.B'
    ];
    expect(visibleKeys(rgbStokes, false, withRecognitionDisabled('stokes.rgb'))
      .some((key) => key.startsWith('stokesRgb:'))).toBe(false);

    expect(visibleKeys(MUELLER_MATRIX_ELEMENTS, false, withRecognitionDisabled('mueller.scalar'))
      .some((key) => key === 'muellerMatrix:')).toBe(false);
    expect(visibleKeys(MUELLER_MATRIX_ELEMENTS.flatMap((element) => [`${element}.R`, `${element}.G`, `${element}.B`]), false, withRecognitionDisabled('mueller.rgb'))
      .some((key) => key === 'muellerMatrixRgb:')).toBe(false);

    expect(selectionKey(findCandidate(['depth.Z', 'depth.A'], 'channel:depth.Z', withRecognitionDisabled('fallback.alphaCompanions'))))
      .toBe('channelMono:depth.Z:');
  });

  it('recognizes scalar and RGB Mueller matrix candidates', () => {
    const scalarNames = [
      ...MUELLER_MATRIX_ELEMENTS,
      ...MUELLER_MATRIX_ELEMENTS.map((element) => `${element}.Y`)
    ];
    const rgbNames = MUELLER_MATRIX_ELEMENTS.flatMap((element) => [
      `${element}.R`,
      `${element}.G`,
      `${element}.B`
    ]);

    expect(visibleKeys(scalarNames).filter((key) => key.startsWith('muellerMatrix'))).toEqual([
      'muellerMatrix:',
      'muellerMatrix:Y'
    ]);
    expect(findCandidate(scalarNames, 'muellerMatrix:Y')?.metadata.channelCount).toBe(16);
    expect(visibleKeys(rgbNames).filter((key) => key.startsWith('muellerMatrix'))).toEqual([
      'muellerMatrixRgb:'
    ]);
    expect(findCandidate(rgbNames, 'muellerMatrixRgb:')?.metadata.channelCount).toBe(48);
    expect(visibleKeys(rgbNames, true).filter((key) => key.startsWith('muellerMatrix'))).toEqual([
      'muellerMatrix:R',
      'muellerMatrix:G',
      'muellerMatrix:B'
    ]);
  });

  it('exposes default priority, exact Y preference, alpha repair candidates, and fallback candidates', () => {
    const rgbMuellerNames = MUELLER_MATRIX_ELEMENTS.flatMap((element) => [
      `${element}.R`,
      `${element}.G`,
      `${element}.B`
    ]);

    expect(defaultSelectionKey(['R', 'G', 'B', 'Y'])).toBe('channelRgb:R:G:B:');
    expect(defaultSelectionKey(['normal.X', 'normal.Y', 'normal.Z', 'Y'])).toBe(
      'channelRgb:normal.X:normal.Y:normal.Z::normalMap'
    );
    expect(defaultSelectionKey(['400nm', '500nm', 'Y'])).toBe('spectralRgb:');
    expect(defaultSelectionKey(['Z', 'Y', 'mask'])).toBe('channelMono:Y:');
    expect(visibleKeys(['Z', 'Y', 'mask'])).toEqual(['channel:Y', 'channel:Z', 'channel:mask']);
    expect(findCandidate(['Z', 'Y', 'mask'], 'channel:Y')?.metadata.defaultReason).toBe('exactY');
    expect(defaultSelectionKey(['foo.Z', 'foo.Y'])).toBe('channelMono:foo.Z:');
    expect(findCandidate(['foo.Z', 'foo.Y'], 'channel:foo.Y')?.metadata.defaultReason).toBe('fallback');
    expect(visibleKeys(['foo.Z', 'foo.Y', 'Y'])).toEqual(['channel:Y', 'channel:foo.Z', 'channel:foo.Y']);
    expect(defaultSelectionKey(rgbMuellerNames)).toBe('muellerMatrixRgb:');
    expect(defaultSelectionKey(MUELLER_MATRIX_ELEMENTS.slice(0, -1))).toBe('channelMono:M00:');
    expect(defaultSelectionKey(['A', 'Z'])).toBe('channelMono:Z:A');

    const mergedDepth = visibleCandidates(['depth.Z', 'depth.A', 'A'])
      .find((candidate) => candidate.key === 'channel:depth.Z');
    const splitDepth = visibleCandidates(['depth.Z', 'depth.A', 'A'], true)
      .find((candidate) => candidate.key === 'channel:depth.Z');
    expect(selectionKey(mergedDepth ?? null)).toBe('channelMono:depth.Z:depth.A');
    expect(selectionKey(splitDepth ?? null)).toBe('channelMono:depth.Z:');
  });
});
