import { applyRenderEffects } from '../viewer-app-render-effects';
import {
  applyActiveColormapLutEffects,
  applyChannelThumbnailEffects,
  applySessionResourceEffects,
  syncInteractionCoordinator
} from '../viewer-app-state-effects';
import { applyUiEffects } from '../viewer-app-ui-effects';
import { ViewerAppCore } from '../viewer-app-core';
import type { BootstrapServices } from './create-services';
import type { ViewerUi } from '../../ui/viewer-ui';

interface RegisterBootstrapEffectsArgs {
  core: ViewerAppCore;
  ui: ViewerUi;
  services: BootstrapServices;
  isDisposed: () => boolean;
}

export function registerBootstrapEffects({
  core,
  ui,
  services,
  isDisposed
}: RegisterBootstrapEffectsArgs): Array<() => void> {
  const unsubscribers: Array<() => void> = [];

  unsubscribers.push(core.subscribeState((transition) => {
    if (isDisposed()) {
      return;
    }

    syncInteractionCoordinator(services.interactionCoordinator, transition);
    applySessionResourceEffects(transition, core, services.renderCache, services.thumbnailService);
    applyChannelThumbnailEffects(transition, core, services.channelThumbnailService);
    applyActiveColormapLutEffects(transition, services.displayController);
  }));
  unsubscribers.push(core.subscribeUi((transition) => {
    if (isDisposed()) {
      return;
    }

    applyUiEffects(ui, transition);
  }));
  unsubscribers.push(core.subscribeRender((transition) => {
    if (isDisposed()) {
      return;
    }

    applyRenderEffects(core, ui, services.renderer, services.renderCache, transition);
  }));

  return unsubscribers;
}
