"""
Core: extract dominant colors from an image (optionally cropped) and rank color-season matches.

Public API:
- dominant_hex_colors(image_or_path, n_colors=5, crop_box=None) -> List[str]
- rank_seasons(item_hexes, palettes) -> List[tuple[str, float]]  # sorted by closeness (lower = better match)
- load_palettes(json_path=None) -> Dict[str, List[str]]
"""

from typing import List, Tuple, Dict, Optional, Union
from PIL import Image
import math, json, os

# ---------- sRGB/Hex → Lab conversions ----------

def hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """
    Convert a hex string (e.g. "#8aa3b5" or "#abc") into an (R, G, B) tuple of ints [0–255].
    """
    hex_str = hex_str.strip().lstrip("#")
    if len(hex_str) == 3:  # expand shorthand like "#abc" → "#aabbcc"
        hex_str = "".join([c * 2 for c in hex_str])
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))


def srgb_to_xyz(r: float, g: float, b: float) -> Tuple[float, float, float]:
    """
    Convert sRGB (0–255) values into CIE XYZ color space.
    Applies gamma correction so brightness is human-perceptual.
    """
    # normalize to 0–1
    r, g, b = [x / 255.0 for x in (r, g, b)]

    # gamma correction
    def inv_gamma(u): 
        return ((u + 0.055) / 1.055) ** 2.4 if u > 0.04045 else u / 12.92
    r, g, b = inv_gamma(r), inv_gamma(g), inv_gamma(b)

    # linear transformation from sRGB → XYZ (D65 illuminant)
    X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    return (X, Y, Z)


def xyz_to_lab(X: float, Y: float, Z: float) -> Tuple[float, float, float]:
    """
    Convert XYZ into CIE Lab (perceptual color space).
    Lab channels: L = lightness, a = green–red, b = blue–yellow.
    """
    # reference white (D65)
    Xn, Yn, Zn = 0.95047, 1.00000, 1.08883  

    def f(t): 
        return t ** (1/3) if t > 0.008856 else (7.787 * t + 16/116)

    # normalize against reference white
    x, y, z = X / Xn, Y / Yn, Z / Zn
    fx, fy, fz = f(x), f(y), f(z)

    # compute Lab
    L = 116 * fy - 16
    a = 500 * (fx - fy)
    b = 200 * (fy - fz)
    return (L, a, b)


def hex_to_lab(hex_str: str) -> Tuple[float, float, float]:
    """
    Shortcut: convert a hex string → Lab coordinates.
    """
    r, g, b = hex_to_rgb(hex_str)
    return xyz_to_lab(*srgb_to_xyz(r, g, b))


def deltaE76(lab1: Tuple[float, float, float], lab2: Tuple[float, float, float]) -> float:
    """
    Compute Delta-E (1976) color difference between two Lab values.
    Lower = more similar. ΔE ≈ 2.3 is the just-noticeable-difference threshold.
    """
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(lab1, lab2)))


# ---------- Palettes ----------

DEFAULT_PALETTES = {
    "Light Spring":  ["#FAEBD7", "#FFD966", "#ECA299", "#E3A274", "#B5E7D0", "#A8D8EA", "#F7C8D0", "#C9E4A6"],
    "True Spring":   ["#FF7F50", "#FFD700", "#40E0D0", "#FF6347", "#7CCD7C", "#FFAA80", "#CD853F", "#FFFFF0"],
    "Bright Spring": ["#FF6F61", "#00B8A9", "#FFD166", "#EF476F", "#06D6A0", "#118AB2", "#FFC43D", "#E6399B"],

    "Light Summer":  ["#B7D7EA", "#E8BFC5", "#B5D4C9", "#C5B8D9", "#CFE5F2", "#F0C5D0", "#C3D8E8", "#D8D2EE"],
    "Cool Summer":   ["#7AA0C4", "#C4899A", "#7BA68C", "#9C84D9", "#6F93B0", "#BB6FA9", "#8FB1AA", "#A3B9D2"],
    "Soft Summer":   ["#8AA3B5", "#C4868E", "#998CBD", "#6E9B9B", "#9FB3C8", "#B9A5B6", "#ADB7A3", "#9E5B5B"],

    "Soft Autumn":   ["#9A8F7A", "#C4968C", "#758451", "#6B8E8E", "#B69B7D", "#B8A045", "#A18F7F", "#8A7F6B"],
    "Warm Autumn":   ["#B5651D", "#BD6543", "#6B6B3A", "#D4A017", "#800000", "#367588", "#C68642", "#FAEBD7"],
    "Deep Autumn":   ["#3E2723", "#4A5400", "#800020", "#8A3324", "#005F5F", "#B8860B", "#3C1414", "#0B3B24"],

    "Bright Winter": ["#00A3E0", "#0057B8", "#008A3E", "#CC0033", "#7C3AED", "#F0F0F5", "#00B3E6", "#FF1493"],
    "Cool Winter":   ["#000000", "#FFFFFF", "#CC0000", "#002FA7", "#FF1493", "#008A3E", "#FFB6C1", "#000080"],
    "Deep Winter":   ["#1B365D", "#9B111E", "#006B3C", "#5F2566", "#000000", "#F0F0F5", "#002FA7", "#6C1D45"],
}


def load_palettes(json_path: Optional[str] = None) -> Dict[str, List[str]]:
    """
    Load palettes from a JSON file if provided.
    Falls back to DEFAULT_PALETTES if no JSON file is found.
    """
    if json_path and os.path.exists(json_path):
        with open(json_path, "r") as f:
            return json.load(f)
    return DEFAULT_PALETTES


# ---------- Dominant color extraction ----------

def _open_image(image_or_path: Union[str, Image.Image]) -> Image.Image:
    """
    Utility: open an image from a path or pass through if already a Pillow Image.
    """
    return image_or_path if isinstance(image_or_path, Image.Image) else Image.open(image_or_path)


def dominant_hex_colors(
    image_or_path: Union[str, Image.Image],
    n_colors: int = 5,
    crop_box: Optional[Tuple[int,int,int,int]] = None
) -> List[str]:
    """
    Extract up to n_colors dominant hex values from an image.

    Args:
        image_or_path: str path or Pillow Image.
        n_colors: number of colors to extract (default 5).
        crop_box: optional (left, top, right, bottom) to crop before analysis.

    Returns:
        List of hex color strings (e.g. ["#8aa3b5", "#c7c1b3", ...]).
    """
    im = _open_image(image_or_path).convert("RGB")
    if crop_box:
        im = im.crop(crop_box)

    # resize to speed up processing
    im = im.copy()
    im.thumbnail((300, 300))

    # quantize to palette of n_colors
    pal_im = im.convert("P", palette=Image.ADAPTIVE, colors=n_colors)
    palette = pal_im.getpalette()[: n_colors * 3]
    color_counts = pal_im.getcolors() or []
    color_counts.sort(reverse=True, key=lambda x: x[0])

    hexes: List[str] = []
    for count, idx in color_counts[:n_colors]:
        # map palette index back to RGB
        r = palette[idx * 3 + 0] if idx * 3 + 2 < len(palette) else 0
        g = palette[idx * 3 + 1] if idx * 3 + 2 < len(palette) else 0
        b = palette[idx * 3 + 2] if idx * 3 + 2 < len(palette) else 0
        hexes.append(f"#{r:02x}{g:02x}{b:02x}")

    # dedupe while preserving order
    out, seen = [], set()
    for h in hexes:
        if h not in seen:
            out.append(h); seen.add(h)
    return out


# ---------- Ranking ----------

def rank_seasons(item_hexes: List[str], palettes: Dict[str, List[str]]) -> List[Tuple[str, float]]:
    """
    Rank color seasons for a given list of garment hex colors.

    For each garment color:
      - find the closest swatch in a season’s palette (min ΔE).
    Then average those distances across all garment colors.
    Lower average ΔE = closer match.

    Args:
        item_hexes: list of extracted garment hex colors.
        palettes: dict of {season: [hex swatches]}.

    Returns:
        Sorted list of (season, score), where score = average ΔE.
    """
    item_labs = [hex_to_lab(h) for h in item_hexes] or []
    if not item_labs:
        return []

    rankings: List[Tuple[str, float]] = []
    for season, chips in palettes.items():
        plabs = [hex_to_lab(h) for h in chips]
        if not plabs:
            continue
        # for each garment color, find closest palette color
        dists = [min(deltaE76(c, p) for p in plabs) for c in item_labs]
        score = sum(dists) / len(dists)
        rankings.append((season, score))

    return sorted(rankings, key=lambda t: t[1])
