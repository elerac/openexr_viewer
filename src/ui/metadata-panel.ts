import type { ExrMetadataEntry } from '../types';
import type { MetadataPanelElements } from './elements';

export function setMetadata(
  elements: MetadataPanelElements,
  metadata: ExrMetadataEntry[] | null
): void {
  if (!metadata || metadata.length === 0) {
    elements.metadataEmptyState.classList.remove('hidden');
    elements.metadataTable.classList.add('hidden');
    elements.metadataTable.replaceChildren();
    return;
  }

  elements.metadataEmptyState.classList.add('hidden');
  elements.metadataTable.classList.remove('hidden');
  elements.metadataTable.replaceChildren(
    ...metadata.map((item) => {
      const row = document.createElement('div');
      row.className = 'metadata-row';

      const key = document.createElement('span');
      key.className = 'metadata-key';
      key.textContent = item.label;

      const value = document.createElement('span');
      value.className = 'metadata-value';
      value.textContent = item.value;

      row.append(key, value);
      return row;
    })
  );
}
