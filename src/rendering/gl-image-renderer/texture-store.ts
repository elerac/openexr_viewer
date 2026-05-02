import { discardMaterializedChannel, getChannelDenseArray } from '../../channel-storage';
import {
  DISPLAY_SOURCE_SLOT_COUNT,
  type DisplaySourceBinding
} from '../../display/bindings';
import type { ResidentChannelUpload } from '../../display-cache';
import type { DecodedLayer } from '../../types';
import type { GlImageRendererState, LayerSourceTextures } from './types';

export function createZeroTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const zeroTexture = gl.createTexture();
  if (!zeroTexture) {
    throw new Error('Failed to create zero texture.');
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, zeroTexture);
  configureSourceTexture(gl);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R32F,
    1,
    1,
    0,
    gl.RED,
    gl.FLOAT,
    new Float32Array([0])
  );

  return zeroTexture;
}

export function ensureLayerChannelsResident(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  layer: DecodedLayer,
  channelNames: string[]
): ResidentChannelUpload[] {
  const layerTextures = getOrCreateLayerSourceTextures(state, sessionId, layerIndex, width, height, layer);
  const uploads: ResidentChannelUpload[] = [];

  for (const channelName of channelNames) {
    if (!channelName || layerTextures.textureByChannel.has(channelName)) {
      continue;
    }

    if (layer.channelStorage.channelIndexByName[channelName] === undefined) {
      continue;
    }

    const denseChannel = getChannelDenseArray(layer, channelName);
    if (!denseChannel) {
      continue;
    }

    const materializedBytes = layer.channelStorage.kind === 'interleaved-f32' ? denseChannel.byteLength : 0;
    let texture: WebGLTexture | null = null;
    try {
      texture = state.gl.createTexture();
      if (!texture) {
        throw new Error('Failed to create source texture.');
      }

      state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
      configureSourceTexture(state.gl);
      state.gl.texImage2D(
        state.gl.TEXTURE_2D,
        0,
        state.gl.R32F,
        width,
        height,
        0,
        state.gl.RED,
        state.gl.FLOAT,
        denseChannel
      );
      layerTextures.textureByChannel.set(channelName, texture);
      uploads.push({
        channelName,
        textureBytes: predictR32fTextureBytes(width, height),
        materializedBytes
      });
    } catch (error) {
      if (texture) {
        state.gl.deleteTexture(texture);
      }
      if (layer.channelStorage.kind === 'interleaved-f32') {
        discardMaterializedChannel(layer, channelName);
      }
      throw error;
    }
  }

  return uploads;
}

export function setDisplaySelectionBindings(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  binding: DisplaySourceBinding
): void {
  state.imageSize = { width, height };
  state.activeBinding = binding;

  const layerTextures = state.layerTexturesBySession.get(sessionId)?.get(layerIndex) ?? null;
  for (let slotIndex = 0; slotIndex < DISPLAY_SOURCE_SLOT_COUNT; slotIndex += 1) {
    const channelName = binding.slots[slotIndex];
    const texture = channelName
      ? layerTextures?.textureByChannel.get(channelName) ?? state.zeroTexture
      : state.zeroTexture;
    state.gl.activeTexture(state.gl.TEXTURE0 + slotIndex);
    state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
  }
}

export function discardSessionTextures(state: GlImageRendererState, sessionId: string): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  for (const layerIndex of [...sessionLayers.keys()]) {
    discardLayerSourceTextures(state, sessionId, layerIndex);
  }
}

export function discardLayerSourceTextures(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number
): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  const layerTextures = sessionLayers.get(layerIndex);
  if (!layerTextures) {
    return;
  }

  for (const channelName of [...layerTextures.textureByChannel.keys()]) {
    discardChannelSourceTexture(state, sessionId, layerIndex, channelName);
  }
}

export function discardChannelSourceTexture(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  channelName: string
): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  const layerTextures = sessionLayers.get(layerIndex);
  if (!layerTextures) {
    return;
  }

  const texture = layerTextures.textureByChannel.get(channelName);
  if (!texture) {
    return;
  }

  state.gl.deleteTexture(texture);
  layerTextures.textureByChannel.delete(channelName);
  discardMaterializedChannel(layerTextures.layer, channelName);

  if (layerTextures.textureByChannel.size > 0) {
    return;
  }

  sessionLayers.delete(layerIndex);
  if (sessionLayers.size === 0) {
    state.layerTexturesBySession.delete(sessionId);
  }
}

function configureSourceTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function predictR32fTextureBytes(width: number, height: number): number {
  return Math.max(0, width * height * Float32Array.BYTES_PER_ELEMENT);
}

function getOrCreateLayerSourceTextures(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  layer: DecodedLayer
): LayerSourceTextures {
  let sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    sessionLayers = new Map<number, LayerSourceTextures>();
    state.layerTexturesBySession.set(sessionId, sessionLayers);
  }

  const existingLayerTextures = sessionLayers.get(layerIndex);
  if (existingLayerTextures && existingLayerTextures.width === width && existingLayerTextures.height === height) {
    return existingLayerTextures;
  }

  if (existingLayerTextures) {
    discardLayerSourceTextures(state, sessionId, layerIndex);
  }

  const nextLayerTextures: LayerSourceTextures = {
    layer,
    width,
    height,
    textureByChannel: new Map<string, WebGLTexture>()
  };
  sessionLayers.set(layerIndex, nextLayerTextures);
  return nextLayerTextures;
}
