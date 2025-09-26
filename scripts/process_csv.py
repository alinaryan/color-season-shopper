#!/usr/bin/env python3
"""
Batch-score product images against color-season palettes.

Input CSV schema (header row required):
    product_name, product_url, image_path

Output CSV columns:
    product_name, product_url, image_path, dominant_hexes, best_for, also_works_for, score_CIE76

Notes:
- Uses dominant_hex_colors() to extract garment colors.
- Uses rank_seasons() to compute a full ranking; we write the best season and the 2 runners-up.
- 'score_CIE76' is the average ΔE76 distance for the best season (lower = closer).
"""

import csv
import argparse
import os
from app.season_matcher import dominant_hex_colors, rank_seasons, load_palettes

def main():
    ap = argparse.ArgumentParser(description="Batch score products for color seasons")
    ap.add_argument("--input", "-i", required=True, help="CSV with product_name, product_url, image_path")
    ap.add_argument("--output", "-o", required=True, help="Output CSV path")
    ap.add_argument("--palettes", "-p", default="data/palettes.json", help="Palettes JSON path")
    ap.add_argument("--colors", "-k", type=int, default=5, help="Number of dominant colors to extract")
    ap.add_argument("--topn", "-n", type=int, default=3, help="How many top seasons to report (best+also_works_for)")
    args = ap.parse_args()

    # Basic input validation
    if not os.path.exists(args.input):
        raise SystemExit(f"[error] Input CSV does not exist: {args.input}")
    palettes = load_palettes(args.palettes)

    rows_out = []

    with open(args.input, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Sanity check for required columns
        required = {"product_name", "product_url", "image_path"}
        missing = required - set([h.strip() for h in reader.fieldnames or []])
        if missing:
            raise SystemExit(f"[error] Missing required CSV columns: {', '.join(sorted(missing))}")

        for row in reader:
            name = (row.get("product_name") or "").strip()
            url = (row.get("product_url") or "").strip()
            img_path = (row.get("image_path") or "").strip()

            # Default blank result row (used on error)
            blank = {
                "product_name": name,
                "product_url": url,
                "image_path": img_path,
                "dominant_hexes": "",
                "best_for": "",
                "also_works_for": "",
                "score_CIE76": ""
            }

            try:
                if not img_path or not os.path.exists(img_path):
                    # Skip if file missing
                    rows_out.append(blank)
                    continue

                # Extract dominant colors (no crop in batch mode)
                hexes = dominant_hex_colors(img_path, n_colors=args.colors)
                if not hexes:
                    rows_out.append(blank)
                    continue

                # Rank seasons (lower score = closer)
                ranking = rank_seasons(hexes, palettes)
                if not ranking:
                    rows_out.append(blank)
                    continue

                top = ranking[: max(1, args.topn)]
                best_season, best_score = top[0]
                others = [s for (s, _sc) in top[1:]]

                rows_out.append({
                    "product_name": name,
                    "product_url": url,
                    "image_path": img_path,
                    "dominant_hexes": ",".join(hexes),
                    "best_for": best_season,
                    "also_works_for": " | ".join(others) if others else "",
                    "score_CIE76": f"{best_score:.2f}"
                })

            except Exception:
                # Keep the batch resilient; if one row fails, write a blank-ish entry and keep going
                rows_out.append(blank)

    # Write output CSV
    out_fields = [
        "product_name", "product_url", "image_path",
        "dominant_hexes", "best_for", "also_works_for", "score_CIE76"
    ]
    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields)
        writer.writeheader()
        writer.writerows(rows_out)

if __name__ == "__main__":
    main()
