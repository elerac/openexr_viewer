import { type Locator, type Page } from '@playwright/test';

export interface ProbeCoords {
  x: number;
  y: number;
}

export async function readProbeCoords(probeCoords: Locator): Promise<ProbeCoords | null> {
  const text = (await probeCoords.textContent())?.trim() ?? '';
  const match = /^x +(\d+) {3}y +(\d+)$/.exec(text);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2])
  };
}

export async function setExposureValue(exposureValue: Locator, value: string): Promise<void> {
  await exposureValue.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

export async function readImagePixel(
  image: Locator,
  x: number,
  y: number
): Promise<[number, number, number, number]> {
  return await image.evaluate(async (node, point) => {
    const element = node as HTMLImageElement;
    if (!element.complete || element.naturalWidth === 0 || element.naturalHeight === 0) {
      await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Failed to load thumbnail image.'));
        };
        const cleanup = () => {
          element.removeEventListener('load', onLoad);
          element.removeEventListener('error', onError);
        };

        element.addEventListener('load', onLoad, { once: true });
        element.addEventListener('error', onError, { once: true });
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create a 2D canvas context.');
    }

    context.drawImage(element, 0, 0);
    return Array.from(context.getImageData(point.x, point.y, 1, 1).data) as [number, number, number, number];
  }, { x, y });
}

export async function resolveViewerPoint(
  viewer: Locator,
  xRatio: number,
  yRatio: number
): Promise<{ x: number; y: number }> {
  const box = await viewer.boundingBox();
  if (!box) {
    throw new Error('Viewer container is not visible.');
  }

  return {
    x: box.x + box.width * xRatio,
    y: box.y + box.height * yRatio
  };
}

export async function dragBy(page: Page, locator: Locator, dx: number, dy: number): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Target is not visible.');
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

export async function dragViewerRoi(
  page: Page,
  viewer: Locator,
  start: { xRatio: number; yRatio: number },
  end: { xRatio: number; yRatio: number }
): Promise<void> {
  const box = await viewer.boundingBox();
  if (!box) {
    throw new Error('Viewer container is not visible.');
  }

  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width * start.xRatio, box.y + box.height * start.yRatio);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end.xRatio, box.y + box.height * end.yRatio, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}
