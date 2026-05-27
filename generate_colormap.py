import json
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

import polanalyser as pa


def main():
    # Keep polanalyser import for registration side-effects (e.g. CoP/ToP colormaps).
    _ = pa

    colormap_defs = [
        {"name": "viridis", "label": "Viridis", "file": "viridis.npy"},
        {"name": "RdBu", "label": "RdBu", "file": "RdBu.npy", "diverging": True},
        {"name": "hsv", "label": "HSV", "file": "hsv.npy"},
        {"name": "dop", "label": "Black-Red", "file": "black-red.npy"},
        {"name": "cop", "label": "Yellow-Black-Blue", "file": "yellow-black-blue.npy"},
        {"name": "top", "label": "Yellow-Cyan-Yellow", "file": "yellow-cyan-yellow.npy", "diverging": True},
        {"name": "coolwarm", "label": "coolwarm", "file": "coolwarm.npy", "diverging": True},
    ]

    colormap_dir = Path("public/colormaps")
    manifest_path = colormap_dir / "manifest.json"

    expected_files = {entry["file"] for entry in colormap_defs}

    # Delete unmanaged colormap npy files.
    removed_files = []
    for npy_path in colormap_dir.glob("*.npy"):
        if npy_path.name not in expected_files:
            npy_path.unlink()
            removed_files.append(npy_path.name)

    # Regenerate (overwrite) every managed colormap npy file.
    for entry in colormap_defs:
        cmap = plt.get_cmap(entry["name"])
        data = cmap(np.linspace(0, 1, 256))[:, :3].astype(np.float32)  # (256, 3)
        np.save(colormap_dir / entry["file"], data)

    # Overwrite manifest with only the managed colormaps.
    manifest = {
        "colormaps": [
            {
                "label": entry["label"],
                "file": entry["file"],
                **({"diverging": True} if entry.get("diverging") else {}),
            }
            for entry in colormap_defs
        ]
    }
    with manifest_path.open("w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Wrote {len(colormap_defs)} colormaps to manifest.")
    if removed_files:
        print("Deleted unmanaged npy files:")
        for name in sorted(removed_files):
            print(f"- {name}")
    else:
        print("No unmanaged npy files found.")


if __name__ == "__main__":
    main()
