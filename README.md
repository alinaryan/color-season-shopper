# 🎨 Color Season Shopper

**Color Season Shopper** is a Chrome extension that tells you which seasonal color palette a garment fits — so you can tell at a glance whether that sweater is actually your color.

It runs while you browse, reads product images off the page, and badges the ones that match your season. Matching uses color science in CIE Lab space (ΔE76) against **12 color seasons** (Sci/ART system).

---

## ✨ What It Does

- **Take the quiz once** in the popup to set your season — it's stored locally and used to highlight your matches.
- **Badges on listing and detail pages**, so you can scan a grid of products without opening each one.
- **Per-site image detection** for Amazon and Nordstrom, plus a generic fallback that works on most e-commerce sites.
- **Knows when to stay quiet** — it rejects background colors, filters skin tones, detects patterns, and abstains entirely when it isn't confident, rather than guessing.
- **Manual analysis** in the popup for any image on the current page.

---

## 🚀 Install (development)

The extension is unpacked — no build step, no dependencies, no zip needed:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `chrome-extension/` directory

Reload the extension from that same page after making changes.

> **Note:** the manifest requests broad host access (`https://*/*`) so the extension can be tested on any store during development.

---

## 📊 How It Works (the math)

- Extract dominant colors from the product image → convert to CIE Lab color space.
- Compare garment colors against each palette using ΔE76 (Euclidean distance in Lab).
- Lower ΔE = closer visual match.
- Return the closest palette as "Best for" and the next two as "Also works for."

Before scoring, the extension isolates the garment: it detects and rejects background colors, filters out skin tones, weights the garment region based on the product type parsed from the title, and suppresses the badge entirely when the best match isn't clearly better than its neighbors.

See [COLOR-SCIENCE.md](COLOR-SCIENCE.md) for the full pipeline — conversion chain, thresholds, and known limitations.

---

## 🛣️ Roadmap

✅ Color extraction + palette ranking

✅ 12-season palettes (Sci/ART)

✅ Background rejection + confidence thresholds

⏩ Smarter color difference (ΔE2000)

⏩ ML-based garment segmentation

⏩ Chrome Web Store release

---

## 📜 License

Copyright © 2026 Alina Ryan. All rights reserved.

This project is provided for demonstration and evaluation purposes only.  
No part of this repository, including code, documentation, or other content,  
may be copied, modified, distributed, or used for commercial purposes  
without prior written permission from the author.
