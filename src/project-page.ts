import { buildFullViewerUrl } from './embed/embed-params';
import type { EmbedViewerStateSnapshot } from './embed/embed-state';
import './project-page.css';

const KAIST_SCENE27_REFLECTANCE_URL =
  'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/scene27_reflectance.exr';
const POLANALYSER_SPOONS_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/spoons.exr';
const OWL_SPHERES_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr';
const BROWN_PHOTOSTUDIO_PANORAMA_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';

const CBOX_RGB_INSPECTION_STATE: EmbedViewerStateSnapshot = {
  viewerMode: 'image',
  view: {
    zoom: 180,
    panX: 195.5,
    panY: 169.5
  },
  lockedPixel: {
    ix: 195,
    iy: 169
  }
};

const DEPTH_INSPECTION_STATE: EmbedViewerStateSnapshot = {
  viewerMode: 'depth',
  depthChannel: 'Z',
  depthFocalLengthPx: 960,
  depthPointSizePx: 2,
  view: {
    depthYawDeg: -5.3,
    depthPitchDeg: 0.65,
    depthZoom: 2
  },
  lockedPixel: {
    ix: 406,
    iy: 300
  }
};

const HYPERSPECTRAL_INSPECTION_STATE: EmbedViewerStateSnapshot = {
  viewerMode: 'image',
  lockedPixel: {
    ix: 2216,
    iy: 1189
  }
};

const PANORAMA_INSPECTION_STATE: EmbedViewerStateSnapshot = {
  viewerMode: 'panorama',
  view: {
    panoramaYawDeg: 5.37,
    panoramaPitchDeg: -34,
    panoramaHfovDeg: 180
  }
};

const GALLERY_LAUNCHES: Record<string, { src: string; state?: EmbedViewerStateSnapshot | null }> = {
  rgb: {
    src: resolveAssetUrl('cbox_rgb.exr'),
    state: CBOX_RGB_INSPECTION_STATE
  },
  spoons: {
    src: POLANALYSER_SPOONS_STOKES_URL,
    state: null
  },
  depth: {
    src: resolveAssetUrl('middlebury_chess1_rgb_z.exr'),
    state: DEPTH_INSPECTION_STATE
  },
  hyperspectral: {
    src: KAIST_SCENE27_REFLECTANCE_URL,
    state: HYPERSPECTRAL_INSPECTION_STATE
  },
  stokes: {
    src: OWL_SPHERES_LINEAR_STOKES_URL,
    state: null
  },
  panorama: {
    src: BROWN_PHOTOSTUDIO_PANORAMA_URL,
    state: PANORAMA_INSPECTION_STATE
  }
};

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-gallery-launch]')) {
  const launch = GALLERY_LAUNCHES[link.dataset.galleryLaunch ?? ''];
  if (!launch) {
    continue;
  }

  link.href = buildFullViewerUrl({
    baseUrl: `${import.meta.env.BASE_URL}app/`,
    src: launch.src,
    state: launch.state
  });
}

const embedViewers = document.querySelectorAll('prismifold-viewer[data-responsive-height]');
const mobileEmbedHeightQuery = window.matchMedia('(max-width: 620px)');

function syncEmbedViewerHeight(): void {
  for (const embedViewer of embedViewers) {
    embedViewer.setAttribute('height', mobileEmbedHeightQuery.matches ? '280' : '360');
  }
}

syncEmbedViewerHeight();
mobileEmbedHeightQuery.addEventListener('change', syncEmbedViewerHeight);

function resolveAssetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).toString();
}
