# OpenEXR Viewer (Web, Browser-based)

Browser-based OpenEXR viewer for graphics/computer-vision workflows, with tev-like interaction and exact value inspection.

[![OpenEXR Viewer thumbnail](https://elerac.github.io/openexr_viewer/thumbnail.jpg)](https://elerac.github.io/openexr_viewer/)

## Current MVP Features

- OpenEXR decode via a browser-safe `exrs` WASM adapter with full layer/channel extraction.
- Built-in Gallery sample: `Gallery > cbox_rgb.exr`.
- Local EXR load via `File > Open...` or drag/drop (drag-and-drop supports multiple files and recursive folder drops in one action).
- Recursive folder EXR load via `File > Open Folder...`; all `.exr` files under the selected folder are appended as sessions.
- `File > Export...` exports the full active image to LDR PNG with the current layer, channel/stokes selection, exposure, colormap, and alpha settings applied.
- `File > Export Colormap...` exports any registered colormap as a standalone PNG gradient with configurable colormap, size, orientation, and filename.
- `View > Image viewer` / `Panorama viewer` switches between the existing 2D image view and an equirectangular panorama projection suitable for 360-degree environment maps and HDRIs.
- `Shift` + left-drag in `Image viewer` creates a persistent rectangular ROI for measurement.
- Multi-image sessions:
  - New image opens as active while previously opened images are kept in memory.
  - `Opened Images` list allows switching active image by filename.
  - Multi-layer EXRs expose a `Layer` selector, and session state follows the implementation: selected layer is preserved per opened session, while display channel mapping, the active probe position, and the committed ROI carry across session switches when valid for the target image. The active viewer mode is preserved across session switches, and each session remembers separate image-view and panorama-view camera state.
  - Reorder opened images directly by click-hold-moving a filename row in the `Opened Images` list.
  - Retained layer source textures use a real GPU-resident LRU cache budget instead of an active-session-only policy. The currently bound display channels stay protected; other retained layer textures, including other layers from the active EXR, remain evictable under the global budget. The default retained-cache cap is `256 MB`, configurable from the top-bar `Settings` menu with fixed presets (`64`, `128`, `256`, `512`, `1024` MB).
  - Per-file row `Reload` action re-decodes the selected session from its original source.
  - `File > Reload All` re-decodes all opened sessions from their original sources.
  - Per-file row `Close` action closes the selected filename entry.
  - `File > Close All` closes all opened sessions at once.
  - Duplicate filenames are disambiguated as `name.exr (2)`, `name.exr (3)`, etc.
- Visible loading indicator while large EXR files are decoding/loading.
- ROI inspector:
  - Shows bounds, size, total pixels, per-channel valid sample counts, and `min` / `mean` / `max` for the active display selection.
  - ROI survives view-mode switches, carries across image switches and new loads, clamps to the target image bounds when needed, and can be cleared from the Inspector.
- Exposure control: slider + numeric input (`-10` to `+10` EV, step `0.1`).
- Visualization mode buttons:
  - `None` is the default RGB display path.
  - `Colormap` maps current display luminance over the full active image through the selected NumPy LUT palette.
  - Built-in palettes are listed in `public/colormaps/manifest.json` and stored as static `.npy` files in the same directory.
  - The app accepts LUT arrays with shape `(N, 3)` or `(N, 4)` and dtype `float32`, `float64`, or `uint8`.
  - Exposure controls are hidden in `Colormap` mode because exposure does not affect that display path.
  - `Palette` selects the active LUT without rebuilding the EXR display texture.
  - `vmin`/`vmax` can be adjusted with one dual-handle slider or numeric inputs.
  - `Auto Range` has two modes: highlighted always-auto mode follows each image/layer/channel, while one-time/manual mode preserves the current min/max across targets.
  - `Zero Center` keeps the range symmetric around zero (`min=-v`, `max=v`), and in auto mode uses `v=max(abs(min), abs(max))`.
  - Angle Stokes colormaps expose a paired degree modulation toggle: AoLP can be modulated by DoLP, CoP by DoCP, and ToP by DoP. CoP and ToP modulation default to on; AoLP defaults to off.
  - Leaves raw numeric probe values unchanged.
- Nearest-neighbor rendering at all zoom levels (no interpolation).
- Zoom range: `0.125x` to `512x`, wheel zoom anchored to cursor.
- Pan with left mouse drag.
- Panorama viewer:
  - Projects the current display texture onto a sphere using equirectangular sampling.
  - Left drag orbits the camera; mouse wheel changes horizontal FOV from `1` to `120` degrees.
  - The Inspector probe remains available through panorama ray-to-pixel lookup.
  - Existing ROIs remain stored but cannot be created or edited until you return to `Image viewer`.
  - Panorama mode does not draw on-canvas pixel value overlays.
  - On-canvas probe rectangles remain hidden in panorama mode.
- Probe:
  - Hover pixel readout in the Inspector.
  - Click to lock/unlock probe pixel.
  - Values are raw linear EXR channel values (pre-exposure, pre-display transform).
  - EXR header metadata is shown below the probe values for the active image/layer, including common attributes such as compression, data/display windows, line order, channels, type, capture date, renderer/integrator, and compatible custom attributes.
- On-image pixel labels at high zoom:
  - RGB values shown inside image pixels.
  - 3-channel values stacked vertically.
  - Label colors follow channel mapping (`R`, `G`, `B`).
  - Panorama mode reuses the same value formatting, but only draws labels for source pixels with a stable, sufficiently large projected footprint.
- Channel controls:
  - `Channel` selector for grouped channels such as `HOGE.R/G/B`, `FUGA.R/G/B`; grouped RGB remains the default display when available.
  - Alpha is applied to normal channel displays when a matching companion exists: bare `R/G/B` and bare scalar channels use bare `A`, while namespaced channels such as `beauty.R` or `depth.Z` use `beauty.A` or `depth.A`. Collapsed channel choices group alpha into labels such as `RGBA`, `mask,A`, and `beauty.RGBA` instead of showing the companion alpha separately.
  - Auxiliary channels such as `Z`, masks, and custom AOVs are selectable directly and display as grayscale by mapping that source channel into all three display channels, which makes `Colormap` operate on that channel directly.
  - `Split RGB` switches RGB groups to separate `R`, `G`, `B`, and `A` entries when alpha exists. Split entries are hidden by default, merged RGB rows are hidden while split mode is active, and scalar alpha pairs such as `mask,A` split into separate `mask` and `A` entries. Turning the toggle off while a split channel is selected switches back to that channel's merged RGB group or scalar alpha pair.
  - Stokes layers with `S0/S1/S2/S3` expose derived `Stokes S1/S0`, `Stokes S2/S0`, `Stokes S3/S0`, `Stokes AoLP`, `Stokes DoP`, `Stokes DoLP`, `Stokes DoCP`, `Stokes CoP`, and `Stokes ToP` entries. Scalar AoLP uses HSV over `[0, pi]`; degree parameters use Black-Red over `[0, 1]`; CoP and ToP use signed ellipticity angle over `[-pi/4, pi/4]`. CoP enables `Zero Center` by default. Switching within the same Stokes colormap group, such as DoP/DoLP/DoCP or S1/S0/S2/S0/S3/S0, preserves the current palette, `vmin`/`vmax`, auto/manual mode, and zero-center setting.
  - RGB Stokes layers with `S0.R/G/B` through `S3.R/G/B` expose grouped `S1/S0.RGB`, `S2/S0.RGB`, `S3/S0.RGB`, `AoLP.RGB`, `DoP.RGB`, `DoLP.RGB`, `DoCP.RGB`, `CoP.RGB`, and `ToP.RGB` entries. In `None`, grouped entries derive the selected Stokes parameter independently for `R`, `G`, and `B`; in `Colormap`, grouped entries keep the Rec.709 mono-derived visualization. `Split RGB` exposes per-component entries such as `S1/S0.R`, `AoLP.G`, and `DoP.B`.
  - When a selected layer does not expose the previous channel mapping, the viewer falls back to bare `R/G/B`, then the first RGB group, then the first non-alpha channel as grayscale.
- Reset button resets view and display state, including exposure.

## UI Layout

- Left panel: open files, channel view, and parts/layers controls.
- Center: image viewer canvas.
- Right side: `Inspector`.

## Tech Stack

- Vite + Vanilla TypeScript
- WebGL2 renderer
- `exrs` (WASM OpenEXR decoder)
- Vitest (unit/integration-style tests)
- Playwright (smoke E2E)

## Requirements

- Node.js 20+
- npm
- Modern browser with WebGL2

## Local Development

```bash
npm install
npm run dev
```

Open the local Vite URL (usually `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

Output is generated in `dist/` and is static-hosting ready.

## GitHub Pages

This project is prepared for GitHub Pages at:

```text
https://elerac.github.io/openexr_viewer/
```

GitHub Pages should use GitHub Actions as the publishing source. The workflow builds with `GITHUB_PAGES=true`, which sets the Vite base path to `/openexr_viewer/`, uploads the generated `dist/` directory as the Pages artifact, and deploys it. Keep `dist/` uncommitted; it is generated by the action.

## Tests

Run unit tests:

```bash
npm run test
```

Run E2E smoke test:

```bash
npx playwright install
npm run test:e2e
```

## Controls

- `Opened Images` selector: switch active image session by filename.
- `Layer` selector: switch the active layer for the selected multi-layer EXR.
- `Opened Images` list: click-hold-move a filename row to reorder.
- `Gallery > cbox_rgb.exr`: open the built-in Cornell box sample and append it as a new session.
- `File > Open...`: open one EXR file and append it as a new session.
- `File > Open Folder...`: recursively open every `.exr` file under the selected folder and append them as new sessions.
- Drag/drop: drop one or more `.exr` files, or drop a folder to recursively load every `.exr` under it.
- `File > Export...`: export the active image to PNG with optional downscaling.
- `File > Export Colormap...`: export a registered colormap to a PNG gradient with selectable colormap, `width`, `height`, `orientation`, and filename.
- `Settings > Cache Budget`: choose the retained display-cache cap from `64`, `128`, `256`, `512`, or `1024` MB. The value persists in `localStorage`.
- `View > Image viewer` / `Panorama viewer`: switch between planar image viewing and spherical panorama viewing.
- Per-file row `Reload` action: reload and re-decode that entry in `Opened Images`.
- `File > Reload All`: reload and re-decode all opened image entries.
- Per-file row `Close` action: close that entry in `Opened Images`.
- `File > Close All`: close all opened image entries.
- Mouse wheel: zoom around cursor.
- Left drag: pan.
- In `Panorama viewer`, mouse wheel changes horizontal FOV and left drag orbits yaw/pitch.
- Hover: live probe sample.
- Left click: lock/unlock probe.
- `Shift` + left drag in `Image viewer`: create or replace the current ROI.

## Implementation Notes

- Display path: normal RGB uses `linear * 2^EV`, then sRGB encode for screen; colormap mode maps raw display luminance through the selected `.npy` LUT. Channel-display alpha is composited over the viewer checkerboard in both RGB and colormap modes. When `Split RGB` is enabled, separate `R`, `G`, and `B` channel choices duplicate the selected source into RGB, so display luminance equals that channel value. Split RGB Stokes entries derive the selected parameter from only the chosen component's Stokes channels before duplicating the scalar into RGB. Grouped RGB Stokes entries derive `R`, `G`, and `B` independently in `None`, but collapse to the existing Rec.709-derived mono path in `Colormap`. For angle Stokes modulation, the LUT color is converted to HSV, its value component is multiplied by the clamped paired degree value, and the result is converted back to RGB.
- Panorama path: the same display texture is reused, but the fragment shader interprets it as an equirectangular environment map, casts a view ray from yaw/pitch/HFOV, and fetches the matching source pixel with nearest-neighbor sampling before applying the normal RGB or colormap display transform.
- Colormap authoring in Python:
  ```python
  import numpy as np

  lut = np.array([
      [1.0, 0.0, 0.0],
      [0.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
  ], dtype=np.float32)

  np.save("public/colormaps/red_black_green.npy", lut)
  loaded = np.load("public/colormaps/red_black_green.npy")
  ```
  Register the file in `public/colormaps/manifest.json`:
  ```json
  {
    "colormaps": [
      {
        "label": "Red / Black / Green",
        "file": "red_black_green.npy"
      }
    ]
  }
  ```
- Texture sampling uses `NEAREST` for both `MIN_FILTER` and `MAG_FILTER`.
- EXR WASM is initialized through a local adapter module backed by a vendored wasm loader, avoiding app-level deep imports into `exrs` internals.
- EXR metadata is parsed directly from header bytes before pixel decode because the current WASM decoder only exposes dimensions, layers, channels, and pixel data. Metadata parse failures do not block image loading.
- Performance path for large images/channel sets:
  - channel selector DOM updates are throttled to selection/image changes only,
  - retained layer source textures are kept under a configurable GPU-resident LRU memory budget, with protection limited to the currently bound display channels,
  - the active display texture buffer is reused across channel and layer switches,
  - GPU upload uses `texSubImage2D` for same-size updates.
