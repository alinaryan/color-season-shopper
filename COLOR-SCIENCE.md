# Color Science: How Season Matching Works

This document explains the color analysis pipeline used by Color Season Shopper to match garment colors to seasonal palettes.

## The 12-Season System

Seasonal color analysis divides personal coloring into 12 seasons based on three axes:

- **Temperature** (warm vs. cool) -- whether gold or silver tones are more flattering
- **Value** (light vs. deep) -- overall lightness or darkness of natural coloring
- **Chroma** (muted vs. bright) -- how vivid or soft the most flattering colors are

Each season has a curated palette of 8 reference swatches. The system finds which palette a garment's colors are closest to.

| Family | Seasons |
|--------|---------|
| Spring (warm, bright) | Light Spring, True Spring, Bright Spring |
| Summer (cool, soft) | Light Summer, Cool Summer, Soft Summer |
| Autumn (warm, muted) | Soft Autumn, Warm Autumn, Deep Autumn |
| Winter (cool, bright) | Bright Winter, Cool Winter, Deep Winter |

Palette swatches are defined in `chrome-extension/palettes.json`, loaded at runtime by both the content script and the popup.

## Color Space Pipeline

All color comparison happens in CIE Lab color space, which models human color perception. Two colors with the same Euclidean distance in Lab look equally different to the human eye, regardless of hue.

### Conversion chain

```
Hex string ("#8AA3B5")
  --> sRGB integers (138, 163, 181)
  --> Linear RGB (inverse gamma correction)
  --> CIE XYZ (D65 illuminant, sRGB primaries)
  --> CIE Lab (L=lightness, a=green-red, b=blue-yellow)
```

Key constants:
- **D65 reference white:** (0.95047, 1.00000, 1.08883)
- **sRGB-to-XYZ matrix:** the standard IEC 61966-2-1 coefficients
- **Gamma correction:** threshold at 0.04045, exponent 2.4

These constants live in `chrome-extension/color-analysis.js`.

### Color distance

Color difference uses **Delta E 76 (CIE76)**: the Euclidean distance between two Lab points.

```
deltaE76 = sqrt( (L1-L2)^2 + (a1-a2)^2 + (b1-b2)^2 )
```

A Delta E of ~2.3 is the just-noticeable difference threshold. In practice:
- deltaE < 5: colors look very similar
- deltaE 5-15: noticeable but related
- deltaE > 25: clearly different colors

## Dominant Color Extraction

The extension has to isolate garment colors automatically from product photography, with no user input about which part of the image is the garment.

**Pixel bucketing.** Each pixel is quantized to a 15-bit bucket by shifting RGB channels right 3 bits (32 levels per channel). Buckets accumulate pixel count and running RGB sums. The top buckets by count become the dominant colors, with weight proportional to pixel count.

**Background filtering.** Two filters remove non-garment pixels:
- White pixels (R, G, B all > 240) -- product photo backgrounds
- Neutral greys (max channel > 160 AND low chroma < 10-20) -- studio backdrops, warm-tinted surfaces. Dark greys (max < 160) are preserved as valid garment colors like charcoal and slate.

**Two-pass fallback.** If less than 35% of opaque pixels survive filtering, the garment itself is probably white or very light. The region is re-sampled without any filtering, letting the white garment color through.

**Region-based sampling.** When the image has a non-white background (model photography), the extension samples specific image regions based on the product type parsed from the title:

| Product type | Region sampled | Image area |
|---|---|---|
| Top (shirt, jacket, etc.) | Upper + middle | Center 60% width, top 15-65% height |
| Bottom (jeans, shorts, etc.) | Lower only | Center 70% width, bottom 55-90% height |
| Full (dress, jumpsuit, etc.) | Center | Center 60% width, 20-80% height |
| Unknown | Full image | Entire image |

When the image has a white background (flat-lay product photos), top and bottom types use full-image sampling since the garment is the only non-white element and region selection could miss it.

**Lab-space deduplication.** Extracted colors within deltaE 12 of each other are merged (weighted average in Lab space), preventing near-duplicate colors from fragmenting the weight across seasons.

## Season Ranking

### Core algorithm

For each season's palette:
1. For each garment color, find the closest palette swatch (minimum deltaE76)
2. Average those minimum distances across all garment colors

Lower average = closer match. The top result is "Best for", the next two are "Also works for."

### Robustness adjustments

Three adjustments make the ranking hold up on real product photography:

**Weighted averaging.** Garment colors are weighted by pixel proportion instead of equal weight. A garment that is 80% navy and 20% white buttons weights the navy 4x more.

**Neutral normalization.** Colors with CIE chroma (sqrt(a^2 + b^2)) below 5 have their a and b values snapped to zero. This prevents measurement noise in truly neutral colors (black, white, grey) from creating arbitrary season preferences based on tiny hue shifts.

**Adaptive stability margin.** When two seasons score within a margin, a deterministic tiebreaker (fixed season order) is used instead of letting floating-point noise decide. The margin adapts to chroma: wider for neutral garments (up to 12 deltaE) where many seasons are legitimately close, tighter for saturated garments (down to 3 deltaE) where the best match is more distinct.

```
stabilityMargin = max(3, 12 - avgChroma * 0.3)
```

## Season Quiz

The quiz maps 5 questions to a 3D point (temperature, value, chroma) and finds the nearest season centroid by Euclidean distance. Each season's centroid is a hand-tuned point in the [-3, +3] range on all three axes. This is a simplified approximation of professional color analysis.

## Known Limitations

- **deltaE76 vs. deltaE2000:** CIE76 is simpler but less perceptually uniform than CIEDE2000, particularly for saturated colors and blues. Planned for a future upgrade.
- **8 swatches per season:** Professional palettes have 40+ swatches. The compact 8-swatch set trades coverage for speed but may under-represent edge colors within a season.
- **No garment segmentation:** The extension uses heuristic region selection and background filtering rather than ML-based garment segmentation. This works well for standard e-commerce photography but can struggle with unusual compositions.
- **Product type from title text only:** Classification depends on the page having a parseable product name with a garment keyword. Unrecognized items default to full-image analysis.
