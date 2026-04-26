// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { ChannelPanel } from '../src/ui/channel-panel';
import { LayerPanel } from '../src/ui/layer-panel';
import { renderEmptyListMessage } from '../src/ui/render-helpers';

describe('image browser panels', () => {
  it('clears parts/layers rows without rendering a placeholder when there is no active image', () => {
    const list = document.createElement('div');
    const count = document.createElement('span');
    const panel = new LayerPanel(
      {
        layerControl: document.createElement('div'),
        layerSelect: document.createElement('select'),
        partsLayersList: list,
        partsLayersCount: count
      },
      {
        onLayerChange: vi.fn()
      }
    );

    panel.setLayerOptions([], 0);
    expect(list.textContent).toBe('No parts');

    panel.clearForNoImage();

    expect(count.textContent).toBe('0');
    expect(list.textContent).toBe('');
    expect(list.children).toHaveLength(0);
    expect(list.classList.contains('is-disabled')).toBe(true);
  });

  it('keeps the channel view no-channels placeholder when there is no active image', () => {
    const list = document.createElement('div');
    const count = document.createElement('span');
    const panel = new ChannelPanel(
      {
        rgbSplitToggleButton: document.createElement('button'),
        rgbGroupSelect: document.createElement('select'),
        channelViewList: list,
        channelViewCount: count
      },
      {
        onChannelViewChange: vi.fn(),
        onChannelViewRowClick: vi.fn(),
        onSplitToggle: vi.fn()
      }
    );

    panel.setRgbGroupOptions([], null);
    expect(list.textContent).toBe('No channels');

    panel.clearForNoImage();

    expect(count.textContent).toBe('0');
    expect(list.textContent).toBe('No channels');
    expect(list.children).toHaveLength(1);
    expect(list.classList.contains('is-disabled')).toBe(true);
  });

  it('applies the same disabled-state class when the parts/layers placeholder is intentionally shown', () => {
    const layerList = document.createElement('div');
    const channelList = document.createElement('div');
    const layerPanel = new LayerPanel(
      {
        layerControl: document.createElement('div'),
        layerSelect: document.createElement('select'),
        partsLayersList: layerList,
        partsLayersCount: document.createElement('span')
      },
      {
        onLayerChange: vi.fn()
      }
    );
    const channelPanel = new ChannelPanel(
      {
        rgbSplitToggleButton: document.createElement('button'),
        rgbGroupSelect: document.createElement('select'),
        channelViewList: channelList,
        channelViewCount: document.createElement('span')
      },
      {
        onChannelViewChange: vi.fn(),
        onChannelViewRowClick: vi.fn(),
        onSplitToggle: vi.fn()
      }
    );

    layerPanel.setLayerOptions([], 0);
    channelPanel.setRgbGroupOptions([], null);

    expect(layerList.textContent).toBe('No parts');
    expect(channelList.textContent).toBe('No channels');
    expect(layerList.classList.contains('is-disabled')).toBe(true);
    expect(channelList.classList.contains('is-disabled')).toBe(true);
  });

  it('keeps an identical empty placeholder node during repeated renders', () => {
    const list = document.createElement('div');

    renderEmptyListMessage(list, 'No open files');
    const firstPlaceholder = list.firstElementChild;
    renderEmptyListMessage(list, 'No open files');

    expect(list.firstElementChild).toBe(firstPlaceholder);
    expect(list.textContent).toBe('No open files');
  });
});
