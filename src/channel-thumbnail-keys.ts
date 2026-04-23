import { serializeDisplaySelectionKey, type DisplaySelection, type StokesDegreeModulationState } from './display-model';

export function serializeChannelThumbnailContextKey(
  sessionId: string,
  activeLayer: number,
  selection: DisplaySelection | string
): string {
  const selectionKey = typeof selection === 'string' ? selection : serializeDisplaySelectionKey(selection);
  return `session:${sessionId}|layer:${activeLayer}|selection:${selectionKey}`;
}

export function serializeChannelThumbnailRequestKey(args: {
  sessionId: string;
  activeLayer: number;
  selection: DisplaySelection | string;
  exposureEv: number;
  stokesDegreeModulation: StokesDegreeModulationState;
}): string {
  return `${serializeChannelThumbnailContextKey(args.sessionId, args.activeLayer, args.selection)}|exposure:${serializeExposureEv(args.exposureEv)}|modulation:${serializeStokesDegreeModulationKey(args.stokesDegreeModulation)}`;
}

export function buildChannelThumbnailSessionPrefix(sessionId: string): string {
  return `session:${sessionId}|`;
}

function serializeExposureEv(exposureEv: number): string {
  return Number.isFinite(exposureEv) ? String(exposureEv) : '0';
}

function serializeStokesDegreeModulationKey(modulation: StokesDegreeModulationState): string {
  return [
    `aolp:${modulation.aolp ? '1' : '0'}`,
    `cop:${modulation.cop ? '1' : '0'}`,
    `top:${modulation.top ? '1' : '0'}`
  ].join(',');
}
