# OpenEXR Viewer (Web, Browser-based)

Browser-based OpenEXR viewer for graphics/computer-vision workflows, with tev-like interaction and exact value inspection.

![OpenEXR Viewer thumbnail](https://elerac.github.io/openexr_viewer/thumbnail.jpg)

## Current MVP Features

- OpenEXR decode via a browser-safe `exrs` WASM adapter with full layer/channel extraction.
- Auto-loads `public/cbox_rgb.exr` at startup.
- Local EXR load via `File > Open...` or drag/drop (drag-and-drop supports multiple files in one action).
- Multi-image sessions:
  - New image opens as active while previously opened images are kept in memory.
  - `Opened Images` list allows switching active image by filename.
  - Multi-layer EXRs expose a `Layer` selector, and session state follows the implementation: selected layer is preserved per opened session, while zoom/pan, display channel mapping, and the active probe position carry across session switches when valid for the target image.
  - Reorder opened images directly by click-hold-moving a filename row in the `Opened Images` list.
  - Per-file row `Reload` action re-decodes the selected session from its original source.
  - `File > Reload All` re-decodes all opened sessions from their original sources.
  - Per-file row `Close` action closes the selected filename entry.
  - `File > Close All` closes all opened sessions at once.
  - Duplicate filenames are disambiguated as `name.exr (2)`, `name.exr (3)`, etc.
- Visible loading indicator while large EXR files are decoding/loading.
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
  - Leaves histogram and raw numeric probe values unchanged.
- Nearest-neighbor rendering at all zoom levels (no interpolation).
- Zoom range: `0.125x` to `512x`, wheel zoom anchored to cursor.
- Pan with left mouse drag.
- Probe:
  - Hover pixel readout in the Inspector.
  - Click to lock/unlock probe pixel.
  - Values are raw linear EXR channel values (pre-exposure, pre-display transform).
  - EXR header metadata is shown below the probe values for the active image/layer, including common attributes such as compression, data/display windows, line order, channels, type, capture date, renderer/integrator, and compatible custom attributes.
- On-image pixel labels at high zoom:
  - RGB values shown inside image pixels.
  - 3-channel values stacked vertically.
  - Label colors follow channel mapping (`R`, `G`, `B`).
- Histogram panel:
  - Uses 2048 bins for higher detail.
  - RGB images: separate `R/G/B` channel histograms.
  - Non-RGB images: luminance histogram fallback.
  - Default `X` axis uses `EV` (`log2(value)`, with `0 EV = 1.0`).
  - `Y` axis defaults to `linear` and can switch to `sqrt` or `log`.
  - Histogram controls expose `X: EV/Linear` and `Y: Sqrt/Log/Linear`.
  - Shows X-axis tick marks and tick labels inside the histogram; in `EV` mode the bins use EV/log2 spacing while tick labels show the corresponding linear values.
  - Not affected by exposure slider.
- Channel controls:
  - `Channel` selector for grouped channels such as `HOGE.R/G/B`, `FUGA.R/G/B`; grouped RGB remains the default display when available.
  - Alpha is applied to normal channel displays when a matching companion exists: bare `R/G/B` and bare scalar channels use bare `A`, while namespaced channels such as `beauty.R` or `depth.Z` use `beauty.A` or `depth.A`. Collapsed channel choices group alpha into labels such as `R,G,B,A`, `mask,A`, and `beauty.(R,G,B,A)` instead of showing the companion alpha separately.
  - Auxiliary channels such as `Z`, masks, and custom AOVs are selectable directly and display as grayscale by mapping that source channel into all three display channels, which makes `Colormap` operate on that channel directly.
  - `Split RGB` switches RGB groups to separate `R`, `G`, `B`, and `A` entries when alpha exists. Split entries are hidden by default, merged RGB rows are hidden while split mode is active, and scalar alpha pairs such as `mask,A` split into separate `mask` and `A` entries. Turning the toggle off while a split channel is selected switches back to that channel's merged RGB group or scalar alpha pair.
  - Stokes layers with `S0/S1/S2/S3` expose derived `Stokes S1/S0`, `Stokes S2/S0`, `Stokes S3/S0`, `Stokes AoLP`, `Stokes DoP`, `Stokes DoLP`, `Stokes DoCP`, `Stokes CoP`, and `Stokes ToP` entries. Scalar AoLP uses HSV over `[0, pi]`; degree parameters use Black-Red over `[0, 1]`; CoP and ToP use signed ellipticity angle over `[-pi/4, pi/4]`. CoP enables `Zero Center` by default. Switching within the same Stokes colormap group, such as DoP/DoLP/DoCP or S1/S0/S2/S0/S3/S0, preserves the current palette, `vmin`/`vmax`, auto/manual mode, and zero-center setting.
  - RGB Stokes layers with `S0.R/G/B` through `S3.R/G/B` expose grouped `S1/S0.(R,G,B)`, `S2/S0.(R,G,B)`, `S3/S0.(R,G,B)`, `AoLP.(R,G,B)`, `DoP.(R,G,B)`, `DoLP.(R,G,B)`, `DoCP.(R,G,B)`, `CoP.(R,G,B)`, and `ToP.(R,G,B)` entries; grouped entries keep the Rec.709 mono-derived visualization, while `Split RGB` exposes per-component entries such as `S1/S0.R`, `AoLP.G`, and `DoP.B`.
  - When a selected layer does not expose the previous channel mapping, the viewer falls back to bare `R/G/B`, then the first RGB group, then the first non-alpha channel as grayscale.
- Reset button resets view and display state, including exposure.
  - Reset also restores histogram axes to the default mode (`X = EV`, `Y = Linear`).

## UI Layout

- Left panel: open files, channel view, and parts/layers controls.
- Center: image viewer canvas.
- Right side: `Histogram` panel above `Inspector`.

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
- `File > Open...`: open one EXR file and append it as a new session.
- Per-file row `Reload` action: reload and re-decode that entry in `Opened Images`.
- `File > Reload All`: reload and re-decode all opened image entries.
- Per-file row `Close` action: close that entry in `Opened Images`.
- `File > Close All`: close all opened image entries.
- Mouse wheel: zoom around cursor.
- Left drag: pan.
- Hover: live probe sample.
- Left click: lock/unlock probe.

## Implementation Notes

- Display path: normal RGB uses `linear * 2^EV`, then sRGB encode for screen; colormap mode maps raw display luminance through the selected `.npy` LUT. Channel-display alpha is composited over the viewer checkerboard in both RGB and colormap modes. When `Split RGB` is enabled, separate `R`, `G`, and `B` channel choices duplicate the selected source into RGB, so display luminance equals that channel value. Split RGB Stokes entries derive the selected parameter from only the chosen component's Stokes channels before duplicating the scalar into RGB. For angle Stokes modulation, the LUT color is converted to HSV, its value component is multiplied by the clamped paired degree value, and the result is converted back to RGB.
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
  - only the active session keeps a cached display texture buffer in memory,
  - the active display texture buffer is reused across channel and layer switches,
  - GPU upload uses `texSubImage2D` for same-size updates.
