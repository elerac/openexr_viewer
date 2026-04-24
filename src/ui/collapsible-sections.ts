import { DisposableBag, type Disposable } from '../lifecycle';
import type { CollapsibleSectionsElements } from './elements';

interface ReadoutSectionElements {
  toggle: HTMLButtonElement;
  content: HTMLElement;
}

export class CollapsibleSectionsController implements Disposable {
  private readonly disposables = new DisposableBag();
  private disposed = false;

  constructor(private readonly elements: CollapsibleSectionsElements) {
    this.bindImageBrowserToggle(this.elements.openedFilesToggle, this.elements.openedFilesList);
    this.bindImageBrowserToggle(this.elements.partsLayersToggle, this.elements.partsLayersList);
    this.bindImageBrowserToggle(this.elements.channelViewToggle, this.elements.channelViewList);
    this.bindReadoutSection({ toggle: this.elements.metadataToggle, content: this.elements.metadataContent });
    this.bindReadoutSection({ toggle: this.elements.probeToggle, content: this.elements.probeContent });
    this.bindReadoutSection({ toggle: this.elements.roiToggle, content: this.elements.roiContent });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  private bindImageBrowserToggle(toggle: HTMLButtonElement, content: HTMLElement): void {
    this.disposables.addEventListener(toggle, 'click', () => {
      const collapsed = toggle.getAttribute('aria-expanded') === 'true';
      this.setImageBrowserCollapsed(toggle, content, collapsed);
    });
  }

  private setImageBrowserCollapsed(toggle: HTMLButtonElement, content: HTMLElement, collapsed: boolean): void {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    content.hidden = collapsed;
    content.closest('.image-browser-section')?.classList.toggle('is-collapsed', collapsed);
  }

  private bindReadoutSection(section: ReadoutSectionElements): void {
    this.setReadoutSectionCollapsed(section, false);
    this.disposables.addEventListener(section.toggle, 'click', () => {
      const collapsed = section.toggle.getAttribute('aria-expanded') === 'true';
      this.setReadoutSectionCollapsed(section, collapsed);
    });
  }

  private setReadoutSectionCollapsed(section: ReadoutSectionElements, collapsed: boolean): void {
    section.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    section.toggle.setAttribute(
      'aria-label',
      `${collapsed ? 'Expand' : 'Collapse'} ${getReadoutSectionName(section.toggle)} section`
    );
    section.content.hidden = collapsed;
    section.content.closest('.readout-block')?.classList.toggle('is-collapsed', collapsed);
  }
}

function getReadoutSectionName(toggle: HTMLButtonElement): string {
  return toggle.closest('.readout-block')?.querySelector('h2')?.textContent?.trim() ?? 'readout';
}
