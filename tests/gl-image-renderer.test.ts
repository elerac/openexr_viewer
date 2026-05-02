// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __debugGetMaterializedChannel, __debugGetMaterializedChannelCount } from '../src/channel-storage';
import { buildDisplaySourceBinding, getDisplaySourceBindingChannelNames } from '../src/display/bindings';
import { resolveDisplaySourceModeUniformValue } from '../src/display/gpu-bindings';
import { buildSelectedDisplayTexture } from '../src/display/materialize-cpu';
import { clampPanoramaProjectionPitch } from '../src/interaction/panorama-geometry';
import { GlImageRenderer } from '../src/rendering/gl-image-renderer';
import { createEmptyRoiInteractionState } from '../src/view-state';
import { createInitialState } from '../src/viewer-store';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createStokesSelection,
  createLayerFromChannels,
  createInterleavedLayerFromChannels
} from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gl image renderer', () => {
  it('uploads only the channels required by the active selection and only uploads newly required channels later', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6],
      A: [0.25, 0.5],
      Z: [10, 20]
    });

    const firstUploadedChannels = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelRgbSelection('R', 'G', 'B'))
    );

    const texImageCallsAfterFirstUpload = gl.texImage2D.mock.calls.length;

    const secondUploadedChannels = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['Z', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelMonoSelection('Z', 'A'))
    );

    expect(firstUploadedChannels).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 8 },
      { channelName: 'G', textureBytes: 8, materializedBytes: 8 },
      { channelName: 'B', textureBytes: 8, materializedBytes: 8 }
    ]);
    expect(secondUploadedChannels).toEqual([
      { channelName: 'Z', textureBytes: 8, materializedBytes: 8 },
      { channelName: 'A', textureBytes: 8, materializedBytes: 8 }
    ]);
    expect(texImageCallsAfterFirstUpload).toBe(5);
    expect(gl.texImage2D).toHaveBeenCalledTimes(7);
    expect(gl.createTexture).toHaveBeenCalledTimes(7);
  });

  it('uploads interleaved source textures from lazily materialized dense channel buffers', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    const uploads = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);

    expect(layer.channelStorage.kind).toBe('interleaved-f32');
    expect(uploads).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 8 },
      { channelName: 'G', textureBytes: 8, materializedBytes: 8 },
      { channelName: 'B', textureBytes: 8, materializedBytes: 8 }
    ]);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(3);
    expect(gl.texImage2D.mock.calls[2]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'R')
    );
    expect(gl.texImage2D.mock.calls[3]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'G')
    );
    expect(gl.texImage2D.mock.calls[4]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'B')
    );
  });

  it('reports planar source uploads without additional materialized CPU bytes', () => {
    const { renderer } = createHarness();
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4]
    });

    const uploads = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);

    expect(layer.channelStorage.kind).toBe('planar-f32');
    expect(uploads).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 0 },
      { channelName: 'G', textureBytes: 8, materializedBytes: 0 }
    ]);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('discards materialized interleaved CPU data when source texture upload fails', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2]
    });
    gl.texImage2D.mockImplementationOnce(() => {
      throw new Error('upload failed');
    });

    expect(() => {
      renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R']);
    }).toThrow('upload failed');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual([]);
  });

  it('discards one resident channel at a time and prunes empty session containers', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);

    expect(__debugGetMaterializedChannelCount(layer)).toBe(2);

    renderer.discardChannelSourceTexture('session-1', 0, 'R');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual(['G']);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);

    renderer.discardChannelSourceTexture('session-1', 0, 'G');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(getLayerTexturesBySession(renderer).has('session-1')).toBe(false);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('deletes owned GL resources exactly once', () => {
    const { renderer, gl } = createHarness();

    renderer.dispose();
    renderer.dispose();

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });

  it('clears the default framebuffer and drops the prepared image state', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.resize(320, 180);

    renderer.clearImage();

    expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 320, 180);
    expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);
    expect(() => renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 1
    })).toThrow('No prepared image is active for export.');
  });

  it('reuses export framebuffers and textures when the export size is unchanged', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.set([1, 2, 3, 255, 4, 5, 6, 255]);
    });

    const first = renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 1
    });
    const framebuffersAfterFirst = gl.createFramebuffer.mock.calls.length;
    const texturesAfterFirst = gl.createTexture.mock.calls.length;

    const second = renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 1
    });

    expect(first).toEqual({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])
    });
    expect(second).toEqual(first);
    expect(gl.createFramebuffer.mock.calls.length).toBe(framebuffersAfterFirst);
    expect(gl.createTexture.mock.calls.length).toBe(texturesAfterFirst);
  });

  it('reads the source-sized export buffer without resampling', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2, 3, 4],
      G: [1, 2, 3, 4],
      B: [1, 2, 3, 4]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(2);
      expect(height).toBe(2);
      data.set([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    });

    const pixels = renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2
    });

    expect(gl.blitFramebuffer).not.toHaveBeenCalled();
    expect(pixels).toEqual({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([70, 80, 90, 255, 100, 110, 120, 255, 10, 20, 30, 255, 40, 50, 60, 255])
    });
  });

  it('renders the onscreen viewer with an opaque checker while preserving transparent export mode', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1],
      G: [0],
      B: [0],
      A: [0.5]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      1,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );

    renderer.render(state);

    expect(lastUniform1iValue(gl, 'uCompositeCheckerboard')).toBe(1);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(0);

    gl.uniform1i.mockClear();
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.set([255, 0, 0, 128]);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 1,
      sourceHeight: 1
    });

    expect(lastUniform1iValue(gl, 'uCompositeCheckerboard')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(1);
  });

  it('keeps full-image RGB exports opaque while making screenshot backgrounds transparent', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.fill(255);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2
    });

    expect(lastUniform1iValue(gl, 'uCompositeCheckerboard')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(0);

    gl.uniform1i.mockClear();

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(lastUniform1iValue(gl, 'uCompositeCheckerboard')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(1);
  });

  it('renders bounded export pixels into the requested output dimensions', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1, 1, 0, 0, 1],
      G: [0, 1, 0, 1, 0, 1, 0, 1],
      B: [0, 0, 1, 1, 0, 0, 1, 1],
      A: [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 4, 2, layer, ['R', 'G', 'B', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      4,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.resize(320, 180);
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(2);
      expect(height).toBe(1);
      data.set([10, 20, 30, 128, 40, 50, 60, 255]);
    });

    const pixels = renderer.readExportPixels({
      state,
      sourceWidth: 4,
      sourceHeight: 2,
      outputWidth: 2,
      outputHeight: 1
    });

    expect(pixels).toEqual({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 128, 40, 50, 60, 255])
    });
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 320, 180);
    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([2, 1]);
    expect(lastUniform2fValue(gl, 'uPan')).toEqual([2, 1]);
    expect(lastUniform1fValue(gl, 'uZoom')).toBe(0.5);
    expect(lastUniform1iValue(gl, 'uCompositeCheckerboard')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(1);
  });

  it('renders screenshot exports from the selected image viewer region', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1]
    });
    const state = {
      ...createInitialState(),
      zoom: 3,
      panX: 8,
      panY: 9,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(40);
      expect(height).toBe(20);
      data.fill(255);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([200, 100]);
    expect(lastUniform2fValue(gl, 'uOutputSize')).toEqual([40, 20]);
    expect(lastUniform2fValue(gl, 'uScreenOrigin')).toEqual([20, 10]);
    expect(lastUniform2fValue(gl, 'uPan')).toEqual([8, 9]);
    expect(lastUniform1fValue(gl, 'uZoom')).toBe(6);
  });

  it('renders screenshot exports through the panorama pass when panorama mode is active', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1]
    });
    const state = {
      ...createInitialState(),
      viewerMode: 'panorama' as const,
      panoramaYawDeg: 17,
      panoramaPitchDeg: 90,
      panoramaHfovDeg: 90,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([200, 100]);
    expect(lastUniform2fValue(gl, 'uScreenOrigin')).toEqual([20, 10]);
    expect(lastUniform1fValue(gl, 'uPanoramaYawDeg')).toBe(17);
    expect(lastUniform1fValue(gl, 'uPanoramaPitchDeg')).toBeCloseTo(clampPanoramaProjectionPitch(90), 7);
    expect(lastUniform1fValue(gl, 'uPanoramaHfovDeg')).toBe(90);
  });

  it('anchors checkerboard rendering to the viewport origin instead of the canvas origin', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1],
      G: [1],
      B: [1]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      1,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.resize(320, 180, 48.5, 12.25);

    renderer.render(state);

    expect(lastUniform2fValue(gl, 'uViewportOrigin')).toEqual([48.5, 12.25]);

    gl.uniform2f.mockClear();
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.set([255, 255, 255, 255]);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 1,
      sourceHeight: 1
    });

    expect(lastUniform2fValue(gl, 'uViewportOrigin')).toEqual([0, 0]);
  });

  it('keeps CPU materialization and shader-facing bindings aligned for display modes', () => {
    const { renderer, gl } = createHarness();
    const cases = [
      {
        label: 'rgb',
        layer: createLayerFromChannels({ R: [0.25], G: [0.5], B: [1] }),
        selection: createChannelRgbSelection('R', 'G', 'B'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [0.25, 0.5, 1, 1]
      },
      {
        label: 'mono alpha',
        layer: createLayerFromChannels({ Y: [0.75], A: [0.5] }),
        selection: createChannelMonoSelection('Y', 'A'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [0.75, 0.75, 0.75, 0.5]
      },
      {
        label: 'scalar stokes',
        layer: createLayerFromChannels({ S0: [1], S1: [0], S2: [1], S3: [0] }),
        selection: createStokesSelection('aolp'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [Math.PI / 4, Math.PI / 4, Math.PI / 4, 1]
      },
      {
        label: 'grouped rgb stokes',
        layer: createLayerFromChannels({
          'S0.R': [1], 'S0.G': [2], 'S0.B': [4],
          'S1.R': [1], 'S1.G': [1], 'S1.B': [2],
          'S2.R': [0], 'S2.G': [Math.sqrt(3)], 'S2.B': [0],
          'S3.R': [0], 'S3.G': [0], 'S3.B': [0]
        }),
        selection: createStokesSelection('dolp', 'stokesRgb'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [1, 1, 0.5, 1]
      },
      {
        label: 'grouped rgb stokes colormap',
        layer: createLayerFromChannels({
          'S0.R': [1], 'S0.G': [2], 'S0.B': [4],
          'S1.R': [1], 'S1.G': [1], 'S1.B': [2],
          'S2.R': [0], 'S2.G': [Math.sqrt(3)], 'S2.B': [0],
          'S3.R': [0], 'S3.G': [0], 'S3.B': [0]
        }),
        selection: createStokesSelection('dolp', 'stokesRgb'),
        visualizationMode: 'colormap' as const,
        expectedPixel: [
          0.8480879693007776,
          0.8480879693007776,
          0.8480879693007776,
          1
        ]
      }
    ];

    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index];
      const binding = buildDisplaySourceBinding(item.layer, item.selection, item.visualizationMode);
      const cpuTexture = buildSelectedDisplayTexture(item.layer, 1, 1, item.selection, item.visualizationMode);
      const state = {
        ...createInitialState(),
        visualizationMode: item.visualizationMode,
        displaySelection: item.selection,
        hoveredPixel: null,
        draftRoi: null,
        roiInteraction: createEmptyRoiInteractionState()
      };

      renderer.ensureLayerChannelsResident(
        `session-${index}`,
        0,
        1,
        1,
        item.layer,
        getDisplaySourceBindingChannelNames(binding)
      );
      renderer.setDisplaySelectionBindings(`session-${index}`, 0, 1, 1, binding);
      gl.readPixels.mockImplementationOnce((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
        data.set([index, index + 1, index + 2, 255]);
      });

      const pixels = renderer.readExportPixels({
        state,
        sourceWidth: 1,
        sourceHeight: 1
      });

      expect(item.label).toBeTruthy();
      expect(lastUniform1iValue(gl, 'uDisplayMode')).toBe(resolveDisplaySourceModeUniformValue(binding.mode));
      expect(pixels.data).toEqual(new Uint8ClampedArray([index, index + 1, index + 2, 255]));
      for (let channel = 0; channel < item.expectedPixel.length; channel += 1) {
        expect(cpuTexture[channel]).toBeCloseTo(item.expectedPixel[channel], 6);
      }
    }
  });
});

function createHarness(): {
  renderer: GlImageRenderer;
  gl: ReturnType<typeof createWebGlContextMock>;
} {
  const gl = createWebGlContextMock();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === 'webgl2') {
      return gl;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  const renderer = new GlImageRenderer(canvas);
  expect(getContext).toHaveBeenCalledWith('webgl2', { antialias: false });
  return {
    renderer,
    gl
  };
}

function getLayerTexturesBySession(renderer: GlImageRenderer): Map<string, Map<number, unknown>> {
  return (renderer as unknown as { layerTexturesBySession: Map<string, Map<number, unknown>> }).layerTexturesBySession;
}

function getLayerTextureChannels(renderer: GlImageRenderer, sessionId: string, layerIndex: number): string[] {
  const layerTextures = getLayerTexturesBySession(renderer).get(sessionId)?.get(layerIndex) as {
    textureByChannel: Map<string, unknown>;
  } | undefined;
  return [...(layerTextures?.textureByChannel.keys() ?? [])];
}

function lastUniform1iValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): number | undefined {
  const calls = gl.uniform1i.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  return calls.at(-1)?.[1] as number | undefined;
}

function lastUniform1fValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): number | undefined {
  const calls = gl.uniform1f.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  return calls.at(-1)?.[1] as number | undefined;
}

function lastUniform2fValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): [number, number] | undefined {
  const calls = gl.uniform2f.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  const lastCall = calls.at(-1);
  if (!lastCall) {
    return undefined;
  }
  return [lastCall[1] as number, lastCall[2] as number];
}

function createWebGlContextMock(): WebGL2RenderingContext & {
  texImage2D: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  createFramebuffer: ReturnType<typeof vi.fn>;
  deleteTexture: ReturnType<typeof vi.fn>;
  deleteProgram: ReturnType<typeof vi.fn>;
  deleteVertexArray: ReturnType<typeof vi.fn>;
  readPixels: ReturnType<typeof vi.fn>;
  uniform1i: ReturnType<typeof vi.fn>;
  uniform1f: ReturnType<typeof vi.fn>;
  uniform2f: ReturnType<typeof vi.fn>;
  clearColor: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  const programs = [{ id: 'program-1' }, { id: 'program-2' }];
  const shaders = [{ id: 'shader-1' }, { id: 'shader-2' }, { id: 'shader-3' }, { id: 'shader-4' }];
  const textures = [
    { id: 'texture-1' },
    { id: 'texture-2' },
    { id: 'texture-3' },
    { id: 'texture-4' },
    { id: 'texture-5' }
  ];
  const framebuffers = [{ id: 'framebuffer-1' }, { id: 'framebuffer-2' }];
  const vaos = [{ id: 'vao-1' }];

  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    UNPACK_ALIGNMENT: 0x0cf5,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_BUFFER_BIT: 0x00004000,
    MAX_TEXTURE_SIZE: 4096,
    MAX_TEXTURE_IMAGE_UNITS: 16,
    createVertexArray: vi.fn(() => vaos.shift() ?? { id: 'vao-extra' }),
    createTexture: vi.fn(() => textures.shift() ?? { id: 'texture-extra' }),
    createFramebuffer: vi.fn(() => framebuffers.shift() ?? { id: 'framebuffer-extra' }),
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
    bindVertexArray: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    blitFramebuffer: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    useProgram: vi.fn(),
    uniform1i: vi.fn(),
    uniform1iv: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform2i: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    readPixels: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn((_program, name: string) => ({ name })),
    getParameter: vi.fn((parameter) => {
      if (parameter === 16) {
        return 16;
      }
      return 4096;
    }),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteVertexArray: vi.fn()
  } as unknown as WebGL2RenderingContext & {
    texImage2D: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    createFramebuffer: ReturnType<typeof vi.fn>;
    readPixels: ReturnType<typeof vi.fn>;
    uniform1i: ReturnType<typeof vi.fn>;
    uniform1f: ReturnType<typeof vi.fn>;
    uniform2f: ReturnType<typeof vi.fn>;
    blitFramebuffer: ReturnType<typeof vi.fn>;
    deleteTexture: ReturnType<typeof vi.fn>;
    deleteFramebuffer: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    deleteVertexArray: ReturnType<typeof vi.fn>;
    clearColor: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
}
