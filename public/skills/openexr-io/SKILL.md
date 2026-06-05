---
name: openexr-io
description: OpenEXR image I/O guidance for choosing channel names, channel-recognition grouping patterns, and Python read/write snippets using OpenImageIO. Use when creating, inspecting, converting, validating, or documenting .exr files for predictable channel grouping or OpenEXR interoperability.
---

# OpenEXR I/O

## Core Guidance

Prefer simple, conventional OpenEXR files before relying on custom recognition rules.

- Include `R/G/B` or `R/G/B/A` when the image has natural color channels. This is recommended for interoperability, not required for specialized data-only files.
- Use `zip` or `piz` for strict lossless output.
- Prefer the channel names below. Treat custom channel-recognition regexes as an escape hatch; generated files should not depend on user customization.

## Channel Names

Use exact suffixes and complete groups. Prefixes such as `hoge` and `fuga` are placeholders; replace them with any stable name that belongs to the data.

- Main color: `R`, `G`, `B`, optional `A`.
- Named color group: `hoge.R`, `hoge.G`, `hoge.B`, optional `hoge.A`.
- Alpha companions: bare `A`, or matching-prefix names such as `hoge.A` for `hoge.R/G/B` and `fuga.A` for `fuga.Z`.
- Depth: prefer `Z`; depth-like names ending in `.Z`, such as `hogeDepth.Z`, are recognized by default. Use positive finite values for depth projection.
- XYZ component groups: `hoge.X`, `hoge.Y`, `hoge.Z`. Generic XYZ groups are displayed as component groups.
- Position maps: prefer complete triplets `P.X`, `P.Y`, `P.Z` for canonical 3D position data. `Position.X/Y/Z` and `position.X/Y/Z` are also recognized by default.
- Normal maps: `N.X/Y/Z`, `normal.X/Y/Z`, or names ending in `_normal.X/Y/Z`. Normal-map recognition takes precedence over generic XYZ grouping.
- UV component groups: `fuga.U`, `fuga.V`, optional `fuga.A`.
- Mueller matrices: complete `M00` through `M33`; suffixed scalar Mueller can use `M00.hoge` through `M33.hoge`; RGB Mueller uses `M00.R/G/B` through `M33.R/G/B`.

## Regex Recommendations

- RGB group patterns should include `base`, `r`, `g`, `b`, and `a` captures, and match names like `R/G/B/A` and `hoge.R/G/B/A`.
- Position-map patterns should include `base`, `x`, `y`, and `z` captures, and match complete triplets like `P.X/Y/Z`, `Position.X/Y/Z`, and `position.X/Y/Z`.
- Spectral-series patterns should include `wavelength`, with optional `series`, and match names like `400nm`, `hoge.400nm`, and `hoge400nm`.
- Scalar Stokes patterns should include one or more of `s0`, `s1`, `s2`, `s3`, with optional `suffix`.
- RGB Stokes patterns should include one or more of `s0`, `s1`, `s2`, `s3`, plus one or more of `r`, `g`, `b`.
- Spectral Stokes patterns should include one or more of `s0`, `s1`, `s2`, `s3`, plus `wavelength`.
- Mueller scalar patterns should include `element`, with optional `suffix`; Mueller RGB patterns should include `element` plus one or more of `r`, `g`, `b`.
- Alpha-companion patterns should include `a` or `alpha`, with optional `base`, and match names like `A`, `Alpha`, `hoge.A`, and `hoge.Alpha`.

Example regex patterns:

```text
component.rgb: ^(?<base>.+)_(?:(?<r>[rR]ed)|(?<g>[gG]reen)|(?<b>[bB]lue)|(?<a>[aA]lpha))$
spectral.series: ^(?:(?<series>hoge|fuga)\.)?(?<wavelength>\d+(?:[.,]\d+)?)[nN][mM]$
stokes.scalar: ^(?:(?<s0>[sS]0)|(?<s1>[sS]1)|(?<s2>[sS]2)|(?<s3>[sS]3))(?:\.(?<suffix>hoge|fuga))?$
```

## Spectral Channels

Use wavelength channel names ending in `nm`. Use at least two unique wavelengths so spectral samples can be sorted numerically and grouped as a series.

- Bare series: `400nm`, `500nm`, `600nm` forms one spectral series.
- Named series: `hoge.400nm`, `hoge.500nm`, `hoge.600nm` becomes a separate grouped series keyed by `hoge`.
- Decimal wavelengths are accepted with a point or comma, such as `532.5nm` or `532,5nm`.
- Keep units in the channel name. Do not write wavelength names without the `nm` suffix if you expect automatic spectral grouping.

## Stokes Channels

Use `S0`, `S1`, `S2`, and optionally `S3`. Keep Stokes components in complete, matching sets.

- Scalar Stokes: use `S0`, `S1`, and `S2` as the minimum complete linear Stokes set; add `S3` when circular or full Stokes data is available.
- Suffixed scalar Stokes: use matching suffixes for related scalar sets, such as `S0.hoge`, `S1.hoge`, `S2.hoge`, and optional `S3.hoge`.
- RGB Stokes: use complete RGB component sets, such as `S0.R/G/B`, `S1.R/G/B`, and `S2.R/G/B`; add `S3.R/G/B` when full RGB Stokes data is available.
- Spectral Stokes: use one complete `S0/S1/S2` set per wavelength, such as `S0.500nm`, `S1.500nm`, and `S2.500nm`; use at least two wavelengths for a spectral Stokes series. Add `S3.<wavelength>nm` for every wavelength when full spectral Stokes data is available.

## Compression

Use OpenEXR compression names as lowercase OIIO strings.

- `zip`: lossless zlib compression in 16-scanline blocks. Use as a dependable default for many generated images.
- `piz`: lossless wavelet-based compression. Prefer for photographic, grainy, or high-frequency images when size matters.
- `zips`: lossless zlib compression one scanline at a time. Use when scanline-local access matters.

## Basic OpenImageIO Python

Read metadata and pixels:

```python
from pathlib import Path

import numpy as np
import OpenImageIO as oiio


def imread_exr(path: Path) -> np.ndarray:
    image_input = oiio.ImageInput.open(str(path))
    if image_input is None:
        raise RuntimeError(f"Failed to open {path}")

    try:
        pixels = image_input.read_image(format=oiio.FLOAT)
        if pixels is None:
            raise RuntimeError(f"Failed to read {path}: {image_input.geterror()}")
    finally:
        image_input.close()

    return np.asarray(pixels, dtype=np.float32)
```

Write named channels with lossless compression:

```python
from pathlib import Path

import numpy as np
import OpenImageIO as oiio


def imwrite_exr(path: Path, pixels: np.ndarray, channel_names: list[str], compression: str = "zip") -> None:
    pixels = np.asarray(pixels, dtype=np.float32)
    if pixels.ndim != 3:
        raise ValueError(f"Expected HxWxC pixels, got {pixels.shape}")

    height, width, channels = pixels.shape
    if channels != len(channel_names):
        raise ValueError(f"Data has {channels} channels, names has {len(channel_names)}")

    spec = oiio.ImageSpec(width, height, channels, oiio.FLOAT)
    spec.channelnames = tuple(channel_names)
    spec.attribute("compression", compression)  # "zip" or "piz" for strict lossless output.

    if "A" in channel_names:
        spec.alpha_channel = channel_names.index("A")
    if "Z" in channel_names:
        spec.z_channel = channel_names.index("Z")

    path.parent.mkdir(parents=True, exist_ok=True)
    output = oiio.ImageOutput.create(str(path))
    if output is None:
        raise RuntimeError(f"Failed to create OpenEXR output for {path}")

    try:
        if not output.open(str(path), spec):
            raise RuntimeError(f"Failed to open {path}: {output.geterror()}")
        if not output.write_image(pixels):
            raise RuntimeError(f"Failed to write {path}: {output.geterror()}")
    finally:
        output.close()
```

Verify readback by channel-name presence and numeric tolerance, not by assuming arbitrary channel order is identical. The OpenEXR library may store channels in lexicographic order; OIIO treats `R/G/B/A/Z` specially and presents those first in conventional order when present.
