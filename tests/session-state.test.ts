import { describe, expect, it } from 'vitest';
import {
  buildSessionDisplayName,
  persistActiveSessionState,
  pickNextSessionIndexAfterRemoval
} from '../src/session-state';
import { ViewerState } from '../src/types';
import { createViewerState } from './helpers/state-fixtures';

describe('session state', () => {
  it('builds disambiguated session labels for duplicate filenames', () => {
    const first = buildSessionDisplayName('sample.exr', []);
    const second = buildSessionDisplayName('sample.exr', ['sample.exr']);
    const third = buildSessionDisplayName('sample.exr', ['sample.exr', 'other.exr', 'sample.exr']);

    expect(first).toBe('sample.exr');
    expect(second).toBe('sample.exr (2)');
    expect(third).toBe('sample.exr (3)');
  });

  it('selects nearest next index after closing active session', () => {
    expect(pickNextSessionIndexAfterRemoval(1, 2)).toBe(1);
    expect(pickNextSessionIndexAfterRemoval(2, 2)).toBe(1);
    expect(pickNextSessionIndexAfterRemoval(0, 1)).toBe(0);
    expect(pickNextSessionIndexAfterRemoval(0, 0)).toBe(-1);
  });

  it('persists active session state without mutating others', () => {
    const baseState: ViewerState = createViewerState({
      displayR: 'R',
      displayG: 'G',
      displayB: 'B'
    });

    const sessions = [
      { id: 'a', state: { ...baseState, exposureEv: -1 } },
      { id: 'b', state: { ...baseState, exposureEv: 2 } }
    ];

    persistActiveSessionState(sessions, 'a', { ...baseState, exposureEv: 3, zoom: 5 });

    expect(sessions[0].state.exposureEv).toBe(3);
    expect(sessions[0].state.zoom).toBe(5);
    expect(sessions[1].state.exposureEv).toBe(2);
  });
});
