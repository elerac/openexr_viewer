import { describe, expect, it, vi } from 'vitest';
import { applyUiEffects } from '../src/app/viewer-app-ui-effects';
import { ViewerUiInvalidationFlags } from '../src/app/viewer-app-ui';
import type { ViewerUiTransition } from '../src/app/viewer-app-types';
import type { ViewerUi } from '../src/ui/viewer-ui';

describe('viewer app ui effects', () => {
  it('clears the colormap gradient when the active lut becomes unavailable', () => {
    const ui = {
      setColormapGradient: vi.fn()
    } as unknown as ViewerUi;

    applyUiEffects(ui, {
      invalidation: ViewerUiInvalidationFlags.ColormapGradient,
      snapshot: {
        activeColormapLut: null
      }
    } as ViewerUiTransition);

    expect(ui.setColormapGradient).toHaveBeenCalledWith(null);
  });
});
