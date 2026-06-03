from __future__ import annotations

import re
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import OpenImageIO as oiio


SCENE_URL = "https://vision.middlebury.edu/stereo/data/scenes2021/data/chess1"
RAW_DIR = Path("output/middlebury_chess1_raw")
OUTPUT_PATH = Path("public/middlebury_chess1_rgb_z.exr")
OUTPUT_SCALE = 0.5

DOWNLOADS = {
    "im0.png": f"{SCENE_URL}/im0.png",
    "disp0.pfm": f"{SCENE_URL}/disp0.pfm",
    "calib.txt": f"{SCENE_URL}/calib.txt",
}


def download_if_missing(path: Path, url: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"Using cached {path}")
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, path)


def read_rgb_png(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Failed to read RGB image: {path}")

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return (rgb.astype(np.float32) / 255.0).astype(np.float32)


def _read_non_comment_line(file_obj) -> str:
    while True:
        line = file_obj.readline()
        if not line:
            raise ValueError("Unexpected end of PFM file")

        text = line.decode("ascii").strip()
        if text and not text.startswith("#"):
            return text


def read_pfm(path: Path) -> np.ndarray:
    with path.open("rb") as file_obj:
        header = _read_non_comment_line(file_obj)
        if header not in {"Pf", "PF"}:
            raise ValueError(f"Unsupported PFM header {header!r} in {path}")

        dimensions = _read_non_comment_line(file_obj).split()
        if len(dimensions) != 2:
            raise ValueError(f"Invalid PFM dimensions in {path}: {dimensions}")

        width, height = (int(value) for value in dimensions)
        scale = float(_read_non_comment_line(file_obj))
        dtype = "<f4" if scale < 0 else ">f4"
        channels = 1 if header == "Pf" else 3
        expected_values = width * height * channels

        data = np.fromfile(file_obj, dtype=dtype, count=expected_values)
        if data.size != expected_values:
            raise ValueError(f"Expected {expected_values} PFM values in {path}, got {data.size}")

    shape = (height, width) if channels == 1 else (height, width, channels)
    image = data.reshape(shape)
    return np.flipud(image).astype(np.float32)


def parse_calibration(path: Path) -> tuple[float, float, float]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()

    cam0 = values.get("cam0")
    if cam0 is None:
        raise ValueError(f"Missing cam0 in {path}")

    matrix_values = [float(value) for value in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", cam0)]
    if len(matrix_values) != 9:
        raise ValueError(f"Expected 9 cam0 matrix values in {path}, got {len(matrix_values)}")

    focal_px = matrix_values[0]
    baseline_mm = float(values["baseline"])
    doffs_px = float(values["doffs"])
    return focal_px, baseline_mm, doffs_px


def disparity_to_depth_m(disparity: np.ndarray, focal_px: float, baseline_mm: float, doffs_px: float) -> np.ndarray:
    denominator = disparity + np.float32(doffs_px)
    valid = np.isfinite(disparity) & (denominator > 0.0)

    depth = np.full(disparity.shape, np.nan, dtype=np.float32)
    depth[valid] = (baseline_mm * focal_px / denominator[valid] / 1000.0).astype(np.float32)
    return depth


def scaled_size(width: int, height: int, scale: float) -> tuple[int, int]:
    if not np.isfinite(scale) or scale <= 0.0:
        raise ValueError(f"Expected positive finite output scale, got {scale}")

    return max(1, round(width * scale)), max(1, round(height * scale))


def resize_rgb(rgb: np.ndarray, scale: float) -> np.ndarray:
    height, width = rgb.shape[:2]
    output_width, output_height = scaled_size(width, height, scale)
    if output_width == width and output_height == height:
        return rgb.copy()

    return cv2.resize(rgb, (output_width, output_height), interpolation=cv2.INTER_AREA).astype(np.float32)


def resize_depth_finite_weighted(depth_m: np.ndarray, scale: float) -> np.ndarray:
    height, width = depth_m.shape
    output_width, output_height = scaled_size(width, height, scale)
    if output_width == width and output_height == height:
        return depth_m.copy()

    valid = np.isfinite(depth_m)
    weights = valid.astype(np.float32)
    weighted_depth = np.where(valid, depth_m, 0.0).astype(np.float32)

    resized_weights = cv2.resize(weights, (output_width, output_height), interpolation=cv2.INTER_AREA)
    resized_weighted_depth = cv2.resize(
        weighted_depth,
        (output_width, output_height),
        interpolation=cv2.INTER_AREA,
    )

    resized_depth = np.full((output_height, output_width), np.nan, dtype=np.float32)
    np.divide(
        resized_weighted_depth,
        resized_weights,
        out=resized_depth,
        where=resized_weights > 0.0,
    )
    return resized_depth


def write_rgb_z_exr(path: Path, rgb: np.ndarray, depth_m: np.ndarray) -> None:
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError(f"Expected HxWx3 RGB array, got {rgb.shape}")
    if depth_m.shape != rgb.shape[:2]:
        raise ValueError(f"Depth shape {depth_m.shape} does not match RGB shape {rgb.shape[:2]}")

    pixels = np.dstack([rgb, depth_m]).astype(np.float32)
    height, width, channel_count = pixels.shape

    spec = oiio.ImageSpec(width, height, channel_count, oiio.FLOAT)
    spec.channelnames = ("R", "G", "B", "Z")

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


def verify_exr(path: Path, expected_shape: tuple[int, int]) -> None:
    image_input = oiio.ImageInput.open(str(path))
    if image_input is None:
        raise RuntimeError(f"Failed to open generated EXR: {path}")

    expected_height, expected_width = expected_shape
    try:
        spec = image_input.spec()
        if spec.width != expected_width or spec.height != expected_height:
            raise RuntimeError(
                f"Expected {expected_width}x{expected_height} EXR, got {spec.width}x{spec.height}"
            )

        channel_names = list(spec.channelnames)
        if channel_names != ["R", "G", "B", "Z"]:
            raise RuntimeError(f"Expected channels ['R', 'G', 'B', 'Z'], got {channel_names}")

        pixels = image_input.read_image(format=oiio.FLOAT)
        if pixels is None:
            raise RuntimeError(f"Failed to read generated EXR pixels: {image_input.geterror()}")
    finally:
        image_input.close()

    pixels = np.asarray(pixels)
    rgb = pixels[:, :, :3]
    z = pixels[:, :, 3]

    if not np.isfinite(rgb).all():
        raise RuntimeError("RGB contains non-finite values")
    if float(rgb.min()) < 0.0 or float(rgb.max()) > 1.0:
        raise RuntimeError(f"RGB is outside [0, 1]: min={rgb.min()}, max={rgb.max()}")

    finite_z = z[np.isfinite(z)]
    if finite_z.size == 0:
        raise RuntimeError("Z channel has no finite values")
    if not (finite_z > 0.0).all():
        raise RuntimeError("Z channel contains non-positive finite values")

    invalid_count = int(np.size(z) - finite_z.size)
    print(
        f"Verified {path}: {spec.width}x{spec.height}, channels={channel_names}, "
        f"Z range={finite_z.min():.4f}..{finite_z.max():.4f} m, invalid={invalid_count}"
    )


def main() -> None:
    for filename, url in DOWNLOADS.items():
        download_if_missing(RAW_DIR / filename, url)

    rgb = read_rgb_png(RAW_DIR / "im0.png")
    disparity = read_pfm(RAW_DIR / "disp0.pfm")
    focal_px, baseline_mm, doffs_px = parse_calibration(RAW_DIR / "calib.txt")

    if disparity.shape != rgb.shape[:2]:
        raise RuntimeError(f"Disparity shape {disparity.shape} does not match RGB shape {rgb.shape[:2]}")

    depth_m = disparity_to_depth_m(disparity, focal_px, baseline_mm, doffs_px)
    output_rgb = resize_rgb(rgb, OUTPUT_SCALE)
    output_depth_m = resize_depth_finite_weighted(depth_m, OUTPUT_SCALE)

    write_rgb_z_exr(OUTPUT_PATH, output_rgb, output_depth_m)
    verify_exr(OUTPUT_PATH, output_rgb.shape[:2])


if __name__ == "__main__":
    main()
