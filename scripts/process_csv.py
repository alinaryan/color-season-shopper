#!/usr/bin/env python3
import csv, argparse
from app.season_matcher import dominant_hex_colors, match_season_for_colors, load_palettes

def main():
    ap = argparse.ArgumentParser(description="Batch score products for color seasons")
    ap.add_argument("--input", "-i", required=True, help="CSV with product_name, product_url, image_path")
    ap.add_argument("--output", "-o", required=True, help="Output CSV path")
    ap.add_argument("--palettes", "-p", default="data/palettes.json", help="Palettes JSON path")
    ap.add_argument("--colors", "-k", type=int, default=5, help="Number of dominant colors to extract")
    args = ap.parse_args()

    palettes = load_palettes(args.palettes)
    rows_out = []

    with open(args.input, "r", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            name = row.get("product_name", "")
            url = row.get("product_url", "")
            img_path = row.get("image_path", "")
            try:
                colors = dominant_hex_colors(img_path, n_colors=args.colors)
                season, score, _pairs = match_season_for_colors(colors, palettes)
                rows_out.append({
                    "product_name": name,
                    "product_url": url,
                    "image_path": img_path,
                    "dominant_hexes": ",".join(colors),
                    "best_season": season or "",
                    "match_score_CIE76": round(score, 2) if season else ""
                })
            except Exception:
                rows_out.append({
                    "product_name": name,
                    "product_url": url,
                    "image_path": img_path,
                    "dominant_hexes": "",
                    "best_season": "",
                    "match_score_CIE76": ""
                })

    with open(args.output, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[
            "product_name","product_url","image_path","dominant_hexes","best_season","match_score_CIE76"
        ])
        w.writeheader()
        w.writerows(rows_out)

if __name__ == "__main__":
    main()

