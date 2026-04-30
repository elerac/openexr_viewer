import { describe, expect, it } from 'vitest';
import {
  errorResource,
  getSuccessValue,
  idleResource,
  isPendingMatch,
  pendingResource,
  staleResource,
  successResource,
  toViewerError
} from '../src/async-resource';

describe('async resource helpers', () => {
  it('matches only the active pending key and request id', () => {
    const resource = pendingResource<string>('range:1', 7);

    expect(isPendingMatch(resource, 'range:1', 7)).toBe(true);
    expect(isPendingMatch(resource, 'range:1', null)).toBe(false);
    expect(isPendingMatch(resource, 'range:1', 8)).toBe(false);
    expect(isPendingMatch(resource, 'range:2', 7)).toBe(false);
    expect(isPendingMatch(successResource('range:1', 'done'), 'range:1', 7)).toBe(false);
  });

  it('keeps stale resources readable without treating them as pending completions', () => {
    const resource = staleResource('range:2', { min: 0, max: 1 });

    expect(getSuccessValue(resource)).toEqual({ min: 0, max: 1 });
    expect(isPendingMatch(resource, 'range:2', 7)).toBe(false);
  });

  it('normalizes errors into viewer error resources', () => {
    const cause = new Error('decode failed');
    const fromError = toViewerError(cause, 'fallback', 'decode');
    expect(fromError).toEqual({
      message: 'decode failed',
      code: 'decode',
      cause
    });

    expect(errorResource('preview:1', 'preview failed')).toEqual({
      status: 'error',
      key: 'preview:1',
      error: { message: 'preview failed' }
    });
    expect(toViewerError(undefined, 'fallback')).toEqual({ message: 'fallback' });
  });

  it('unwraps only success and stale values', () => {
    expect(getSuccessValue(idleResource<string>())).toBeUndefined();
    expect(getSuccessValue(pendingResource<string>('preview:1', 1))).toBeUndefined();
    expect(getSuccessValue(successResource('preview:1', 'data'))).toBe('data');
  });
});
