# Prismifold

Prismifold is a multichannel image viewer for computational imaging, rendering, and vision workflows. It reveals the rich structure of images that contain more than color, including polarization, spectral, panoramas, depth, and AOVs.

[![Prismifold thumbnail](https://elerac.github.io/prismifold/thumbnail.jpg)](https://elerac.github.io/prismifold/app/)

## Features

- OpenEXR decode via a browser-safe `exrs` WASM adapter with full layer/channel extraction.
- Gallery samples: local `Gallery > cbox_rgb.exr` and `Gallery > Middlebury Stereo > middlebury_chess1_rgb_z.exr`, plus remote `Gallery > Beachball > multipart.0001.exr`, Poly Haven HDRIs under `Gallery > Poly Haven`, KAIST hyperspectral samples under `Gallery > KAIST Hyperspectral`, and Polanalyser Stokes samples under `Gallery > Polanalyser`; remote samples require network access.
- Local EXR load via `File > Open...` or drag/drop (drag-and-drop supports multiple files and recursive folder drops in one action).
- Recursive folder EXR load via `File > Open Folder...`; all `.exr` files under the selected folder are appended as sessions.
- `File > Export...` exports the full active display to PNG at display image size with configurable PNG compression and current channel/stokes, exposure/gamma, colormap, and alpha settings applied.
- `File > Export Screenshot...` exports an image-viewer or panorama-viewer screenshot region to PNG; multiple screenshot regions export as a ZIP, with optional reproduction JSON.
- `File > Export Batch...` exports selected file/channel combinations as a ZIP of PNG images.
- `File > Export Colormap...` exports any registered colormap as a standalone PNG gradient with configurable colormap, size, orientation, and filename.
- Right-click `Copy Image` copies the current display image to the clipboard.
- `View > Image viewer` / `Panorama viewer` switches between the existing 2D image view and an equirectangular panorama projection suitable for 360-degree environment maps and HDRIs.
- `View > Rulers` toggles pixel rulers in `Image viewer`.
- `Window` controls include normal/full-screen preview plus single-pane, vertical split, and horizontal split viewer layouts.
- Top-bar quick actions include Auto Fit, Auto Exposure, invalid-value warning, screenshot export, Metadata, app fullscreen, and the Settings gear.
- `Shift` + left-drag in `Image viewer` creates or replaces a persistent rectangular ROI for measurement; drag an existing ROI body or handles to edit it. ROI creation/editing is disabled in `Panorama viewer`.
- Multi-image sessions:
  - New image opens as active while previously opened images are kept in memory.
  - `Open Files` list allows switching active image by filename; rows show thumbnails/status and support filtering, inline rename, drag reorder, and drag-to-viewer-pane assignment.
  - Multi-layer EXR state is preserved per opened session. Display channel mapping, the active probe position, and the committed ROI carry across session switches when valid for the target image. The active viewer mode is preserved across session switches, and each session remembers separate image-view and panorama-view camera state.
  - When Auto Fit selected images is enabled, image-mode session switches and new loads fit to the viewer instead of carrying previous pan/zoom; this does not apply in `Panorama viewer`. Colormap state carries only when the display selection remains compatible.
  - Decoded CPU pixels are included in the displayed memory usage. The LRU budget evicts retained display CPU/GPU channel resources, so decoded-only usage can exceed the selected cap. The default cap is `256 MB`, configurable from `Settings` dialog > `Memory Budget` with fixed presets (`64`, `128`, `256`, `512`, `1024` MB).
  - Per-file row `Reload` action re-decodes the selected session from its original source.
  - `File > Reload All` re-decodes all opened sessions from their original sources.
  - Per-file row `Close` action closes the selected filename entry.
  - `File > Close All` closes all opened sessions at once.
  - Duplicate filenames are disambiguated as `name.exr (2)`, `name.exr (3)`, etc.
- Visible loading indicator while large EXR files are decoding/loading.
- ROI inspector:
  - Shows bounds, size, total pixels, per-channel valid sample counts, and `min` / `mean` / `max` for the active display selection.
  - ROI survives view-mode switches, carries across image switches and new loads, clamps to the target image bounds when needed, and can be cleared from the Inspector.
- Display controls:
  - `None` is the default RGB display path and exposes Exposure and Gamma controls. Exposure uses slider + numeric input (`-10` to `+10` EV, step `0.1`).
  - `Colormap` maps current display luminance over the full active image through the selected NumPy LUT palette.
  - Built-in palettes are listed in `public/colormaps/manifest.json` and stored as static `.npy` files in the same directory.
  - The app accepts LUT arrays with shape `(N, 3)` or `(N, 4)` and dtype `float32`, `float64`, or `uint8`.
  - RGB Exposure/Gamma controls are hidden in `Colormap` mode; colormap mode exposes separate EV/Gamma controls that affect LUT mapping.
  - `Palette` selects the active LUT without rebuilding the EXR display texture.
  - `vmin`/`vmax` can be adjusted with one dual-handle slider or numeric inputs.
  - `Auto Range` has two modes: highlighted always-auto mode follows each image/layer/channel, while one-time/manual mode preserves the current min/max across targets. Dynamic auto ranges use `v=max(abs(min), abs(max))` and map to `[-v, v]`.
  - Selecting a diverging palette auto-enables `Zero Center`, which keeps manual ranges symmetric around zero (`min=-v`, `max=v`) and also applies to fixed Stokes colormap defaults.
  - `Reverse` flips the active colormap ramp.
  - Angle Stokes colormaps expose a paired degree modulation toggle: AoLP can be modulated by DoLP, CoP by DoCP, and ToP by DoP. AoLP also lets the modulation target be `V` (HSV value) or `S` (HSV saturation), defaulting to `V`. CoP and ToP modulation default to on; AoLP defaults to off.
  - Leaves raw numeric probe values unchanged.
- Nearest-neighbor rendering at all zoom levels (no interpolation).
- Zoom range: `0.03125x` to `512x`, wheel zoom anchored to cursor.
- Pan with left mouse drag.
- Panorama viewer:
  - Projects the current display texture onto a sphere using equirectangular sampling.
  - Left drag orbits the camera; `W/A/S/D` also orbit yaw/pitch; mouse wheel changes horizontal FOV from `1` to `180` degrees, with the widest range transitioning to a hemispherical projection.
  - The Inspector probe remains available through panorama ray-to-pixel lookup.
  - Existing ROIs remain stored but cannot be created or edited until you return to `Image viewer`.
  - Panorama mode does not draw on-canvas pixel value overlays.
  - On-canvas probe rectangles remain hidden in panorama mode.
- Probe:
  - Hover pixel readout in the Inspector.
  - Click to lock/unlock probe pixel.
  - Values are raw linear EXR channel values (pre-exposure, pre-display transform).
- Metadata:
  - The top-bar Metadata dialog shows EXR header metadata for the active image/layer, including common attributes such as compression, data/display windows, line order, channels, type, capture date, renderer/integrator, and compatible custom attributes.
- On-image pixel labels at high zoom:
  - RGB values shown inside image pixels.
  - 3-channel values stacked vertically.
  - Label colors follow channel mapping (`R`, `G`, `B`).
  - Panorama mode reuses the same value formatting, but only draws labels for source pixels with a stable, sufficiently large projected footprint.
- Channel controls:
  - Bottom channel thumbnail strip selects grouped channels such as `HOGE.R/G/B`, `FUGA.R/G/B`, `normal.X/Y/Z`, and `motion.U/V`; grouped RGB remains the default display when available, while XYZ and UV groups are used when no RGB group is available. XYZ maps `X/Y/Z` to display red/green/blue, and UV maps `U/V` to display red/green with blue fixed at zero.
  - Alpha is applied to normal channel displays when a matching companion exists: bare `R/G/B` and bare scalar channels use bare `A`, while namespaced channels such as `beauty.R` or `depth.Z` use `beauty.A` or `depth.A`. Collapsed channel choices group alpha into labels such as `RGBA`, `mask,A`, and `beauty.RGBA` instead of showing the companion alpha separately.
  - Auxiliary channels such as `Z`, masks, and custom AOVs are selectable directly and display as grayscale by mapping that source channel into all three display channels, which makes `Colormap` operate on that channel directly.
  - Expandable channel stacks expose split component entries for RGB, XYZ, and UV groups plus `A` when alpha exists. Scalar alpha pairs such as `mask,A` expose separate `mask` and `A` entries in expanded stacks.
  - Spectral wavelength series are grouped into a `Spectral RGB` entry by default using the built-in spectral-to-RGB conversion; expandable stacks expose individual wavelength channels.
  - Stokes layers with `S0/S1/S2/S3` expose derived `Stokes S1/S0`, `Stokes S2/S0`, `Stokes S3/S0`, `Stokes AoLP`, `Stokes DoP`, `Stokes DoLP`, `Stokes DoCP`, `Stokes CoP`, and `Stokes ToP` entries. Complete non-RGB suffixed sets such as `S0.Y/S1.Y/S2.Y/S3.Y` are also exposed as scalar Stokes entries with suffixed labels such as `Stokes AoLP.Y`, while spectral Stokes sets such as `S0.500nm/S1.500nm/S2.500nm/S3.500nm` are grouped into entries such as `S1/S0 Spectral RGB` and expanded into per-wavelength entries such as `S1/S0.500nm`. Scalar AoLP uses HSV over `[0, pi]`; degree parameters use Black-Red over `[0, 1]`; CoP and ToP use signed ellipticity angle over `[-pi/4, pi/4]`. CoP enables `Zero Center` by default. Switching within the same Stokes colormap group, such as DoP/DoLP/DoCP or S1/S0/S2/S0/S3/S0, preserves the current palette, `vmin`/`vmax`, auto/manual mode, and zero-center setting.
  - RGB Stokes layers with `S0.R/G/B` through `S3.R/G/B` expose grouped `S1/S0.RGB`, `S2/S0.RGB`, `S3/S0.RGB`, `AoLP.RGB`, `DoP.RGB`, `DoLP.RGB`, `DoCP.RGB`, `CoP.RGB`, and `ToP.RGB` entries. In `None`, grouped entries derive the selected Stokes parameter independently for `R`, `G`, and `B`; in `Colormap`, grouped entries keep the Rec.709 mono-derived visualization. Expanded stacks expose per-component entries such as `S1/S0.R`, `AoLP.G`, and `DoP.B`.
  - Mueller matrix layers with complete `M00` through `M33` channel sets expose a `Mueller Matrix` entry rendered as a row-major 4x4 grayscale grid with no separator pixels. Complete non-RGB suffixed sets such as `M00.Y` through `M33.Y` expose suffixed entries such as `Mueller Matrix.Y`. RGB Mueller sets with `M00.R/G/B` through `M33.R/G/B` expose a grouped `Mueller Matrix.RGB` entry, and expanded stacks expose per-component entries such as `Mueller Matrix.R`.
  - When a selected layer does not expose the previous channel mapping, the viewer falls back to the first non-Mueller RGB group, then RGB Mueller, then the first RGB group, then XYZ/UV, then spectral RGB when available, then exact `Y`, then grayscale, then a complete Mueller matrix grid, then the first non-alpha channel.
- Double-clicking the Display heading resets visualization mode/palette, RGB exposure/gamma, colormap EV/gamma/range/zero-center/reverse, without changing channel selection or view.

## Sample data attribution

`public/middlebury_chess1_rgb_z.exr` is a half-resolution OpenEXR conversion of RGB plus metric depth from the `chess1` scene in the [Middlebury 2021 mobile stereo datasets](https://vision.middlebury.edu/stereo/data/scenes2021/). Middlebury grants permission to use and publish images and disparity maps on its dataset site and requests citing paper [5] for the 2014/2021 datasets; see the [Middlebury stereo dataset citation guidance](https://vision.middlebury.edu/stereo/data/).

## UI Layout

- Left panel: `Open Files`.
- Center: image viewer canvas.
- Bottom panel: channel thumbnails.
- Right side: Display, Probe, Spectral, ROI, View, and Image Stats panels.

## Tech Stack

- Vite + Vanilla TypeScript
- WebGL2 renderer
- `exrs` (WASM OpenEXR decoder)
- Vitest (unit/integration-style tests)
- Playwright (workflow E2E)

## Requirements

- Node.js 20+
- npm
- Modern browser with WebGL2

## Local Development

```bash
npm install
npm run dev
```

Open the local Vite URL (usually `http://localhost:5173`) for the project page, or `http://localhost:5173/app/` for the viewer app.

## Build

```bash
npm run build
npm run preview
```

Output is generated in `dist/` and is static-hosting ready.

## Desktop App

Prerequisites:

- Node.js 20+ and npm 10+
- Rust stable (`rustc` and `cargo`)
- Tauri platform prerequisites for your OS

Build the desktop app locally:

```bash
npm install
npm run desktop:build
```

On macOS, the local unsigned app and DMG are generated under `src-tauri/target/release/bundle/`. Generated desktop bundles and build outputs should stay uncommitted.

On Windows, the installed executable is `Prismifold.exe`. The installer registers Prismifold as an OpenEXR `.exr` handler candidate, but Windows requires the user to choose the default app: open **Settings > Apps > Default apps > Choose defaults by file type > .exr** and select Prismifold, or right-click an `.exr` file and use **Open with**. Older builds may not appear automatically; browse to the installed `Prismifold.exe` if needed.

Stable desktop installers are published from tagged GitHub Releases. Push a tag named `vX.Y.Z` where `X.Y.Z` matches `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`; the desktop workflow builds the Windows x64 NSIS installer and macOS Apple Silicon DMG, attaches checksums, and publishes the release.

Latest desktop download URLs:

```text
Windows x64: https://github.com/elerac/prismifold/releases/latest/download/Prismifold-windows-x64-setup.exe
macOS arm64: https://github.com/elerac/prismifold/releases/latest/download/Prismifold-macos-arm64.dmg
Releases:    https://github.com/elerac/prismifold/releases/latest
```

## GitHub Pages

This project is prepared for GitHub Pages with a project page and app route:

```text
Project page: https://elerac.github.io/prismifold/
Viewer app:   https://elerac.github.io/prismifold/app/
```

Open a remote EXR directly with `?src=<exr-url>`, for example `https://elerac.github.io/prismifold/app/?src=https://elerac.github.io/prismifold/cbox_rgb.exr`. The EXR host must allow browser CORS requests.

GitHub Pages should use GitHub Actions as the publishing source. The repository now uses a dedicated `CI` workflow for lint, typecheck, coverage, Playwright, and build checks on pushes, and the Pages workflow deploys only after `CI` succeeds on `main` or when triggered manually. The Pages build runs with `GITHUB_PAGES=true`, which sets the Vite base path to `/prismifold/`, builds the landing page at the project root and the viewer at `/app/`, uploads the generated `dist/` directory as the Pages artifact, and deploys it. Keep `dist/` uncommitted; it is generated by the action.

## Tests

Run the local quality gates:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
```

Run Playwright E2E tests:

```bash
npx playwright install
npm run test:e2e
```

## HTML and JS Embeds

The embed wrapper registers `<prismifold-viewer>` and `window.Prismifold`.

### HTML custom element

Load the deployed wrapper script, then add the custom element:

```html
<script src="https://elerac.github.io/prismifold/embed/prismifold.js"></script>

<prismifold-viewer
  src="https://elerac.github.io/prismifold/cbox_rgb.exr"
  name="Cornell Box"
  width="640"
  height="420">
</prismifold-viewer>
```

Common attributes:

| Attribute | Description |
| --- | --- |
| `src` | EXR URL to load. |
| `name` | Embedded source label and opened file name when applicable. |
| `view` | Initial mode: `image`, `panorama`, or `depth`. |
| `auto-load` | Set to `false` to defer loading until the embedded `Click to load image` button is clicked. Defaults to `true`. |
| `width` / `height` | CSS sizes; numeric values become pixels. Defaults: `100%` / `320px`. |
| `viewer-url` | Viewer deployment URL, needed if the wrapper script is served from another location. |
| `source-origin` | Loading policy: `auto`, `parent`, or `viewer`. |
| `bottom-panel` | Embed bottom content: `probe`, `channels`, or `none`. Defaults to `probe`. |

The embed supports pan, zoom, hover probe or compact channel selection, and an `Open full viewer` button.

### JavaScript API

Use `Prismifold.create(target, options)` for dynamic sources:

```html
<div id="viewer"></div>
<script src="https://elerac.github.io/prismifold/embed/prismifold.js"></script>
<script>
  const viewer = Prismifold.create('#viewer', {
    src: './public/cbox_rgb.exr',
    name: 'Cornell Box',
    width: 640,
    height: 420,
    bottomPanel: 'channels',
    autoLoad: true,
    viewerUrl: 'https://elerac.github.io/prismifold/app/'
  });
</script>
```

Controller methods:

| Method | Description |
| --- | --- |
| `loadUrl(src, options)` | Load an EXR URL; options include `name`, `view`, and `sourceOrigin`. |
| `loadFile(file, options)` | Load a browser `File` from user-selected or dropped files. |
| `setView(view)` | Switch to `image`, `panorama`, or `depth`. |
| `destroy()` | Remove the embedded viewer. |

### Source loading and CORS

- In `auto` mode, relative and `blob:` URLs are fetched by the embedding page; absolute remote URLs load in the viewer.
- Use `source-origin="parent"` / `sourceOrigin: 'parent'` or `source-origin="viewer"` / `sourceOrigin: 'viewer'` to force
  either side.
- Remote viewer-loaded files must be CORS-readable by the viewer origin, such as `https://elerac.github.io`.
- Direct `file://` relative EXR loading is not browser-portable. Use a local HTTP server for URL-based examples, or
  `loadFile(file)` for local files.

## Controls

- `Open Files` list: switch active image session by filename, filter rows, rename rows inline, or drag rows to reorder/assign to a split pane.
- `Alt/Option+Up/Down`: reorder the active `Open Files` row.
- `Gallery > cbox_rgb.exr` / `Middlebury Stereo > middlebury_chess1_rgb_z.exr` / `Beachball > multipart.0001.exr` / `Poly Haven` / `KAIST Hyperspectral` / `Polanalyser`: open a gallery sample and append it as a new session. Remote samples require network access.
- `File > Open...`: open one EXR file and append it as a new session.
- `File > Open Folder...`: recursively open every `.exr` file under the selected folder and append them as new sessions.
- Drag/drop: drop one or more `.exr` files, or drop a folder to recursively load every `.exr` under it.
- `File > Export...`: export the active full display to PNG at display image size, with configurable PNG compression.
- `File > Export Screenshot...`: select and export screenshot regions from Image or Panorama viewer; multiple regions export as a ZIP.
- `File > Export Batch...`: export selected file/channel combinations as a ZIP of PNG images; the batch dialog has its own `Split RGB` option.
- `File > Export Colormap...`: export a registered colormap to a PNG gradient with selectable colormap, `width`, `height`, `orientation`, and filename.
- Right-click viewer menu > `Copy Image`: copy the current display image to the clipboard.
- Settings dialog > `Memory Budget`: choose the retained display CPU/GPU residency budget from `64`, `128`, `256`, `512`, or `1024` MB. Displayed usage also includes decoded CPU pixels. The value persists in `localStorage`.
- Settings dialog: configure theme, spectrum lattice motion, spectral grouping default, Stokes defaults/visibility, invalid Stokes masking, auto exposure percentile, and image load workers.
- `View > Image viewer` / `Panorama viewer`: switch between planar image viewing and spherical panorama viewing.
- `View > Rulers`: toggle pixel rulers in Image viewer.
- `Window > Full Screen Preview`: show the viewer in browser fullscreen/fallback preview mode.
- `Window > Single Pane` / `Split Vertically` / `Split Horizontally`: reset or split the viewer panes. `Cmd+D` splits vertically, and `Cmd+Shift+D` splits horizontally.
- Per-file row `Reload` action: reload and re-decode that entry in `Open Files`.
- `File > Reload All`: reload and re-decode all opened image entries.
- Per-file row `Close` action: close that entry in `Open Files`.
- `File > Close All`: close all opened image entries.
- Mouse wheel: zoom around cursor.
- `+` / `-`: zoom in/out.
- Left drag: pan in Image viewer.
- `W/A/S/D`: pan in Image viewer.
- In `Panorama viewer`, mouse wheel changes horizontal FOV, left drag orbits yaw/pitch, and `W/A/S/D` also orbit yaw/pitch.
- `Ctrl/Cmd+S`: open `File > Export...`.
- Hover: live probe sample.
- Left click: lock/unlock probe.
- `Shift` + left drag in `Image viewer`: create or replace the current ROI; drag the existing ROI body/handles to edit it.

## Implementation Notes

- Display path: normal RGB uses `linear * 2^EV`, then display-gamma encode for screen; colormap mode maps display luminance through the selected `.npy` LUT after colormap EV/gamma, range, zero-center, and reverse settings. Channel-display alpha is composited over the viewer checkerboard on screen in both RGB and colormap modes; exports preserve image alpha when present. When split component entries are selected, separate `R`, `G`, and `B` channel choices duplicate the selected source into RGB, so display luminance equals that channel value. Grouped XYZ uses the same direct component display path as RGB, and grouped UV binds `U` and `V` to red and green while leaving blue at zero. Split component Stokes entries derive the selected parameter from only the chosen component's Stokes channels before duplicating the scalar into RGB. Grouped RGB Stokes entries derive `R`, `G`, and `B` independently in `None`, but collapse to the existing Rec.709-derived mono path in `Colormap`. For angle Stokes modulation, the LUT color is converted to HSV, its value component is multiplied by the clamped paired degree value, and the result is converted back to RGB; AoLP can instead multiply HSV saturation when `S` modulation is selected.
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
  - channel thumbnail DOM updates are throttled to selection/image changes only,
  - decoded CPU pixels are tracked in displayed memory usage, while the configurable LRU budget evicts retained display CPU/GPU channel resources with eviction protection limited to the currently bound display channels,
  - the active display texture buffer is reused across channel and layer switches,
  - GPU upload uses `texSubImage2D` for same-size updates.
