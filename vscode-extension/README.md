# Prismifold

Prismifold is an OpenEXR viewer for Visual Studio Code. It opens `.exr` files in a readonly custom editor and provides the same multichannel inspection tools as the Prismifold web and desktop viewer.

## Features

- Open `.exr` files directly in VS Code with a readonly custom editor.
- Decode OpenEXR files locally through the packaged Prismifold viewer and WebAssembly runtime.
- Inspect RGB, alpha, depth, masks, AOVs, vector channels, spectral channels, Stokes parameters, and Mueller matrix layers.
- Switch between image, panorama, and depth-oriented viewer modes.
- Adjust exposure, gamma, colormaps, value ranges, zero-center mapping, and invalid-value display.
- Use pixel probes, metadata inspection, pixel rulers, ROI statistics, and high-zoom pixel labels.
- Open a folder of EXR files and keep multiple decoded images in one Prismifold session.
- Export PNG images, screenshot regions, batch ZIPs, and colormap gradients.
- Split the viewer into single, vertical, or horizontal panes for comparison.

## Usage

Open any `.exr` file in VS Code. Prismifold is registered as a custom editor for OpenEXR files.

You can also use the Command Palette:

- `Prismifold: Open EXR File`
- `Prismifold: Open EXR Folder`
- `Prismifold: Export Image`
- `Prismifold: Export Screenshot`
- `Prismifold: Export Batch`
- `Prismifold: Export Colormap`
- `Prismifold: Reload All`
- `Prismifold: Close All`
- `Prismifold: Show Metadata`
- `Prismifold: Image Viewer`
- `Prismifold: Panorama Viewer`
- `Prismifold: Depth Viewer`
- `Prismifold: Toggle Rulers`
- `Prismifold: Split Viewer Vertically`
- `Prismifold: Split Viewer Horizontally`
- `Prismifold: Reset Viewer Panes`

## Readonly Files

Prismifold never writes back to source `.exr` files. Saves are derived exports such as PNG screenshots, PNG image exports, ZIP batch exports, or colormap PNGs.

## Requirements

- VS Code 1.120.0 or newer.
- Desktop VS Code. Web extension support is not included in this first release.
- A machine with WebGL2 support for rendering.

## Privacy

Local EXR files are read through VS Code workspace APIs and decoded inside the Prismifold webview. The extension does not upload local files to a server.

Remote sample gallery entries may request HTTPS resources from their source hosts when selected.

## Links

- Prismifold web app: https://elerac.github.io/prismifold/app/
- Source repository: https://github.com/elerac/openexr_viewer
- Issues: https://github.com/elerac/openexr_viewer/issues

