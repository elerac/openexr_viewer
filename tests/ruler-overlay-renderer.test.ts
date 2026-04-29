// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { RulerOverlayRenderer } from '../src/rendering/ruler-overlay-renderer';
import { createViewerState } from './helpers/state-fixtures';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('ruler overlay renderer', () => {
  it('clears without drawing when rulers are hidden or no image is active', () => {
    const { renderer, svg, labelOverlay } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.render(createViewerState({ viewerMode: 'image' }), true);

    expect(svg.children).toHaveLength(0);
    expect(labelOverlay.children).toHaveLength(0);

    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({ viewerMode: 'image' }), false);

    expect(svg.children).toHaveLength(0);
    expect(labelOverlay.children).toHaveLength(0);
  });

  it('suppresses ruler drawing in panorama mode', () => {
    const { renderer, svg, labelOverlay } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({ viewerMode: 'panorama' }), true);

    expect(svg.children).toHaveLength(0);
    expect(labelOverlay.children).toHaveLength(0);
  });

  it('draws top and left pixel rulers in image mode', () => {
    const { renderer, svg, labelOverlay } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 1,
      panX: 50,
      panY: 25
    }), true);

    expect(svg.getAttribute('width')).toBe('200');
    expect(svg.getAttribute('height')).toBe('100');
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
    expect(readSvgRects(svg)).toEqual([
      { x: '0', y: '0', width: '200', height: '24' },
      { x: '0', y: '0', width: '24', height: '100' }
    ]);
    expect(readSvgLines(svg)).toEqual(
      expect.arrayContaining([
        { x1: '0', y1: '23.5', x2: '200', y2: '23.5' },
        { x1: '23.5', y1: '0', x2: '23.5', y2: '100' },
        { x1: '50.5', y1: '24', x2: '50.5', y2: '12' },
        { x1: '150.5', y1: '24', x2: '150.5', y2: '12' },
        { x1: '24', y1: '75.5', x2: '12', y2: '75.5' }
      ])
    );
    expect(readLabels(labelOverlay, 'horizontal')).toEqual([
      { text: '0', left: '50px', top: '8px' },
      { text: '100', left: '150px', top: '8px' }
    ]);
    expect(readLabels(labelOverlay, 'vertical')).toEqual([
      { text: '0', left: '8px', top: '32px' },
      { text: '50', left: '8px', top: '75px' }
    ]);
  });

  it('moves tick labels with pan and clamps labels to image bounds', () => {
    const { renderer, svg, labelOverlay } = createRulerHarness();

    renderer.resize(200, 100);
    renderer.setImageSize(100, 50);
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 1,
      panX: 60,
      panY: 25
    }), true);

    expect(readSvgLines(svg)).toEqual(
      expect.arrayContaining([
        { x1: '40.5', y1: '24', x2: '40.5', y2: '12' },
        { x1: '140.5', y1: '24', x2: '140.5', y2: '12' }
      ])
    );
    expect(readLabels(labelOverlay, 'horizontal')).toEqual([
      { text: '0', left: '40px', top: '8px' },
      { text: '100', left: '140px', top: '8px' }
    ]);
    expect(Array.from(labelOverlay.children).map((label) => label.textContent)).not.toContain('-100');
  });
});

function createRulerHarness(): {
  renderer: RulerOverlayRenderer;
  svg: SVGSVGElement;
  labelOverlay: HTMLDivElement;
} {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const labelOverlay = document.createElement('div');

  return {
    renderer: new RulerOverlayRenderer(svg, labelOverlay),
    svg,
    labelOverlay
  };
}

function readSvgRects(svg: SVGSVGElement): Array<{ x: string; y: string; width: string; height: string }> {
  return Array.from(svg.querySelectorAll('rect')).map((rect) => ({
    x: rect.getAttribute('x') ?? '',
    y: rect.getAttribute('y') ?? '',
    width: rect.getAttribute('width') ?? '',
    height: rect.getAttribute('height') ?? ''
  }));
}

function readSvgLines(
  svg: SVGSVGElement
): Array<{ x1: string; y1: string; x2: string; y2: string }> {
  return Array.from(svg.querySelectorAll('line')).map((line) => ({
    x1: line.getAttribute('x1') ?? '',
    y1: line.getAttribute('y1') ?? '',
    x2: line.getAttribute('x2') ?? '',
    y2: line.getAttribute('y2') ?? ''
  }));
}

function readLabels(
  labelOverlay: HTMLElement,
  axis: 'horizontal' | 'vertical'
): Array<{ text: string; left: string; top: string }> {
  return Array.from(labelOverlay.querySelectorAll<HTMLElement>(`.ruler-label--${axis}`)).map((label) => ({
    text: label.textContent ?? '',
    left: label.style.left,
    top: label.style.top
  }));
}
