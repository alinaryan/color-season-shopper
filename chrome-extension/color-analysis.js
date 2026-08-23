var ColorAnalysis = (function () {
  "use strict";

  // ---- Color space conversions ----

  function hexToRgb(hexStr) {
    hexStr = hexStr.trim().replace(/^#/, "");
    if (hexStr.length === 3) {
      hexStr = hexStr[0] + hexStr[0] + hexStr[1] + hexStr[1] + hexStr[2] + hexStr[2];
    }
    return [
      parseInt(hexStr.substring(0, 2), 16),
      parseInt(hexStr.substring(2, 4), 16),
      parseInt(hexStr.substring(4, 6), 16),
    ];
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map(function (c) {
          var hex = Math.round(c).toString(16);
          return hex.length === 1 ? "0" + hex : hex;
        })
        .join("")
    );
  }

  function invGamma(u) {
    return u > 0.04045
      ? Math.pow((u + 0.055) / 1.055, 2.4)
      : u / 12.92;
  }

  function srgbToXyz(r, g, b) {
    r = invGamma(r / 255);
    g = invGamma(g / 255);
    b = invGamma(b / 255);
    return [
      r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
      r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
      r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
    ];
  }

  var REF_WHITE = [0.95047, 1.00000, 1.08883]; // D65

  function labF(t) {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  }

  function xyzToLab(X, Y, Z) {
    var fx = labF(X / REF_WHITE[0]);
    var fy = labF(Y / REF_WHITE[1]);
    var fz = labF(Z / REF_WHITE[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labFInv(t) {
    return t > 6 / 29 ? t * t * t : (t - 16 / 116) / 7.787;
  }

  function labToXyz(L, a, b) {
    var fy = (L + 16) / 116;
    var fx = a / 500 + fy;
    var fz = fy - b / 200;
    return [
      REF_WHITE[0] * labFInv(fx),
      REF_WHITE[1] * labFInv(fy),
      REF_WHITE[2] * labFInv(fz),
    ];
  }

  function gammaEncode(u) {
    return u > 0.0031308
      ? 1.055 * Math.pow(u, 1 / 2.4) - 0.055
      : 12.92 * u;
  }

  function xyzToSrgb(X, Y, Z) {
    var r = gammaEncode(X *  3.2404542 + Y * -1.5371385 + Z * -0.4985314);
    var g = gammaEncode(X * -0.9692660 + Y *  1.8760108 + Z *  0.0415560);
    var b = gammaEncode(X *  0.0556434 + Y * -0.2040259 + Z *  1.0572252);
    return [
      Math.max(0, Math.min(255, Math.round(r * 255))),
      Math.max(0, Math.min(255, Math.round(g * 255))),
      Math.max(0, Math.min(255, Math.round(b * 255))),
    ];
  }

  function labToHex(L, a, b) {
    var xyz = labToXyz(L, a, b);
    var rgb = xyzToSrgb(xyz[0], xyz[1], xyz[2]);
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }

  function hexToLab(hexStr) {
    var rgb = hexToRgb(hexStr);
    var xyz = srgbToXyz(rgb[0], rgb[1], rgb[2]);
    return xyzToLab(xyz[0], xyz[1], xyz[2]);
  }

  function deltaE76(lab1, lab2) {
    var dL = lab1[0] - lab2[0];
    var da = lab1[1] - lab2[1];
    var db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  // ---- Product type classification ----

  // "dress" needs a compound-aware pattern: \bdress\b misses shirtdress,
  // sundress, and similar, which are common in real product names. The
  // optional prefix is enumerated rather than \w* so that "address" and
  // "headdress" do not match.
  var FULL_RE = /\b(?:shirt|sun|sweater|slip|maxi|midi|mini|shift|wrap|tank|jumper|cami|sheath|cocktail)?dress(?:es)?\b|\b(?:jumpsuit|romper|playsuit|gown|bodysuit|coverall|onesie)\b/i;
  var TOP_RE = /\b(jacket|blazer|coat|vest|hoodie|sweater|cardigan|pullover|blouse|shirt|top|tee|tank|polo|cape|shrug|bolero|parka|anorak|windbreaker|fleece|sweatshirt|tunic|camisole|bralette|bustier|henley|crewneck)\b/i;
  var BOTTOM_RE = /\b(jeans?|pants?|trousers?|skirt|shorts|leggings|joggers?|chinos?|culottes?|palazzo|capri|bermuda|slacks)\b/i;
  var ACCESSORY_RE = /\b(shoes?|sneakers?|boots?|sandals?|loafers?|mules?|heels?|flats?|pumps?|oxfords?|espadrilles?|clogs?|slippers?|handbag|purse|tote|clutch|crossbody|satchel|backpack|wallet|wristlet|scarf|scarves|shawl|wrap|stole|hat|beanie|beret|fedora|cap|visor|headband|bandana|sunglasses|glasses|eyewear|jewelry|necklace|bracelet|earrings?|ring|anklet|brooch|pendant|choker|watch|watches|belt|belts|tie|ties|bow\s?tie|necktie|gloves?|mittens?|socks?|stockings?|tights?|swimsuit|bikini|tankini|swim\s?trunks)\b/i;

  function classifyProductType(title) {
    if (!title) return "unknown";
    if (FULL_RE.test(title)) return "full";
    if (TOP_RE.test(title)) return "top";
    if (BOTTOM_RE.test(title)) return "bottom";
    if (ACCESSORY_RE.test(title)) return "accessory";
    return "unknown";
  }

  // ---- Background rejection tuning ----

  // ΔE76 threshold for rejecting pixels that match detected border/background colors.
  // Lower = stricter (only reject very close matches). Higher = more aggressive.
  // Try 18 (tight), 25 (default), or 30 (aggressive) against your test set.
  var BG_REJECT_DE_THRESHOLD = 25;

  // Verbose background-detection logging. Keep false on main; flip to true
  // locally when tuning BG_REJECT_DE_THRESHOLD against a test set.
  var BG_DEBUG = false;

  // ---- Confidence / abstain tuning ----

  // Max garment-to-palette ΔE76 for the best season before we declare "no strong match"
  // (state d). Also serves as the gate between states (b) and (d): if bestDE exceeds
  // this, close siblings are meaningless since no palette fits well. Intentionally one
  // knob for both roles — split into two constants if tuning them independently is needed.
  var LOW_CONFIDENCE_DE_THRESHOLD = 28;

  // Min gap (ΔE) between the best season and the runner-up to call it a single confident
  // winner (state a). If the runner-up is within this margin AND bestDE is good, the
  // result is siblings (state b) instead. Measures season-to-season score spread.
  var SIBLING_MARGIN_DE = 5;

  // Min pairwise ΔE76 between extracted garment colors to consider them "distinct."
  // Measures how different the garment's own colors are from each other — not garment
  // vs palette. Independent of LOW_CONFIDENCE_DE_THRESHOLD.
  var PATTERN_DE_THRESHOLD = 40;

  // Minimum weight for a color to count as "significant" in pattern detection (primary
  // check). A fallback also checks all colors regardless of weight when no single color
  // dominates (top weight < 60%).
  var PATTERN_MIN_WEIGHT = 0.10;

  // Max ΔE for a detected garment color to count as "matching" a swatch in the user's
  // season palette. Used only for personalized pattern verdicts.
  var PATTERN_PALETTE_MATCH_DE = 20;

  // How many of the detected colors must match the user's palette to say "has your colors."
  var PATTERN_MATCH_COUNT = 2;

  // ---- Canvas-based color extraction ----

  function imageToCanvas(imageSource, maxDim, region) {
    maxDim = maxDim || 200;
    var sw = imageSource.naturalWidth || imageSource.width;
    var sh = imageSource.naturalHeight || imageSource.height;

    var sx = 0, sy = 0, sWidth = sw, sHeight = sh;

    if (region === "upper") {
      // Upper torso: top 15-55% of image, center 60% width
      // Catches tops, cardigans, jackets, upper dress bodice
      var insetX = Math.round(sw * 0.20);
      sx = insetX;
      sy = Math.round(sh * 0.15);
      sWidth = sw - insetX * 2;
      sHeight = Math.round(sh * 0.40);
    } else if (region === "middle") {
      // Mid body: 30-65% of image, center 70% width
      var insetX2 = Math.round(sw * 0.15);
      sx = insetX2;
      sy = Math.round(sh * 0.30);
      sWidth = sw - insetX2 * 2;
      sHeight = Math.round(sh * 0.35);
    } else if (region === "lower") {
      // Lower body: 55-90% of image, center 70% width
      var insetX3 = Math.round(sw * 0.15);
      sx = insetX3;
      sy = Math.round(sh * 0.55);
      sWidth = sw - insetX3 * 2;
      sHeight = Math.round(sh * 0.35);
    } else if (region === "center") {
      // Center body: 20-80% height, center 60% width
      // For full-body garments (dresses, jumpsuits) — avoids head/face and feet
      var insetX4 = Math.round(sw * 0.20);
      sx = insetX4;
      sy = Math.round(sh * 0.20);
      sWidth = sw - insetX4 * 2;
      sHeight = Math.round(sh * 0.60);
    }

    if (sWidth < 20) { sWidth = sw; sx = 0; }
    if (sHeight < 20) { sHeight = sh; sy = 0; }

    var scale = Math.min(1, maxDim / Math.max(sWidth, sHeight));
    var cw = Math.round(sWidth * scale);
    var ch = Math.round(sHeight * scale);
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imageSource, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
    return canvas;
  }

  function isSkinTone(r, g, b) {
    if (r <= g || r <= b) return false;
    if (r < 50) return false;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var chroma = max - min;
    if (chroma < 15 || chroma > 110) return false;
    var sat = chroma / max;
    if (sat < 0.15 || sat > 0.75) return false;
    var hue = 60 * ((g - b) / chroma);
    if (hue < 0) hue += 360;
    return hue >= 5 && hue <= 50;
  }

  function isNeutralGrey(r, g, b) {
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var chroma = max - min;

    // Mid-brightness perfect neutrals are edge anti-aliasing artifacts;
    // near-black (max < 80) is a valid garment color (black clothes)
    if (chroma < 3 && max >= 80) return true;

    // Dark greys with some color cast are valid garment colors (charcoal, slate)
    if (max < 160) return false;

    // Light backgrounds: warm-tinted studio greys (e.g., beige/cream backdrop)
    if (max > 200 && chroma < 20) return true;

    // Light greys with very low chroma (likely background)
    if (chroma < 10) return true;

    return false;
  }

  function sampleRegion(imageSource, maxDim, region, keepWhite, filterSkin, bgLabs) {
    var canvas = imageToCanvas(imageSource, maxDim, region);
    var ctx = canvas.getContext("2d");
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var pixels = imageData.data;
    var buckets = {};
    for (var i = 0; i < pixels.length; i += 4) {
      var r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 128) continue;
      if (filterSkin && isSkinTone(r, g, b)) continue;
      if (!keepWhite) {
        if (r > 240 && g > 240 && b > 240) continue;
        if (isNeutralGrey(r, g, b)) continue;
        if (bgLabs && bgLabs.length > 0) {
          var xyz = srgbToXyz(r, g, b);
          var pxLab = xyzToLab(xyz[0], xyz[1], xyz[2]);
          var isBg = false;
          for (var bi = 0; bi < bgLabs.length; bi++) {
            if (deltaE76(pxLab, bgLabs[bi]) < BG_REJECT_DE_THRESHOLD) {
              isBg = true;
              break;
            }
          }
          if (isBg) continue;
        }
      }
      var qr = r >> 3, qg = g >> 3, qb = b >> 3;
      var key = (qr << 10) | (qg << 5) | qb;
      if (!buckets[key]) { buckets[key] = { count: 0, rSum: 0, gSum: 0, bSum: 0 }; }
      buckets[key].count++;
      buckets[key].rSum += r;
      buckets[key].gSum += g;
      buckets[key].bSum += b;
    }
    return buckets;
  }

  function isWhiteBackground(imageSource, maxDim) {
    // Detect true white/near-white e-commerce flat-lay backgrounds.
    // Must be bright (>230), neutral (low chroma), and cover a significant area.
    // Cream, beige, and light tan studio backdrops should NOT trigger this.
    var canvas = imageToCanvas(imageSource, maxDim || 100, null);
    var ctx = canvas.getContext("2d");
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var total = 0, white = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      total++;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 230 && g > 230 && b > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 15) white++;
    }
    return total > 0 && (white / total) > 0.35;
  }

  function detectBackgroundColors(imageSource, maxDim) {
    var canvas = imageToCanvas(imageSource, maxDim || 100, null);
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var data = ctx.getImageData(0, 0, w, h).data;

    // Sample the outer ~5% border on each edge
    var borderX = Math.max(2, Math.round(w * 0.05));
    var borderY = Math.max(2, Math.round(h * 0.05));

    var buckets = {};
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var isBorder = (x < borderX || x >= w - borderX || y < borderY || y >= h - borderY);
        if (!isBorder) continue;

        var idx = (y * w + x) * 4;
        var r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a < 128) continue;

        var qr = r >> 3, qg = g >> 3, qb = b >> 3;
        var key = (qr << 10) | (qg << 5) | qb;
        if (!buckets[key]) { buckets[key] = { count: 0, rSum: 0, gSum: 0, bSum: 0 }; }
        buckets[key].count++;
        buckets[key].rSum += r;
        buckets[key].gSum += g;
        buckets[key].bSum += b;
      }
    }

    var sorted = Object.values(buckets);
    sorted.sort(function (a, b) { return b.count - a.count; });

    // Take top 3 border colors, convert to Lab
    var bgLabs = [];
    var bgHexes = [];
    for (var i = 0; i < Math.min(3, sorted.length); i++) {
      var bk = sorted[i];
      var avgR = Math.round(bk.rSum / bk.count);
      var avgG = Math.round(bk.gSum / bk.count);
      var avgB = Math.round(bk.bSum / bk.count);
      // Skip near-white — already handled by the existing white pixel filter
      if (avgR > 240 && avgG > 240 && avgB > 240) continue;
      var hex = rgbToHex(avgR, avgG, avgB);
      bgLabs.push(hexToLab(hex));
      bgHexes.push(hex);
    }

    if (BG_DEBUG && bgHexes.length > 0) {
      console.log("[CSS bg-detect] border colors:", bgHexes.join(", "),
        "threshold:", BG_REJECT_DE_THRESHOLD);
    }

    return bgLabs;
  }

  function mergeWeightedBuckets(primaryBuckets, secondaryBuckets, primaryWeight) {
    var merged = {};
    var keys = new Set(Object.keys(primaryBuckets).concat(Object.keys(secondaryBuckets)));
    keys.forEach(function (key) {
      var p = primaryBuckets[key] || { count: 0, rSum: 0, gSum: 0, bSum: 0 };
      var s = secondaryBuckets[key] || { count: 0, rSum: 0, gSum: 0, bSum: 0 };
      merged[key] = {
        count: p.count * primaryWeight + s.count,
        rSum: p.rSum * primaryWeight + s.rSum,
        gSum: p.gSum * primaryWeight + s.gSum,
        bSum: p.bSum * primaryWeight + s.bSum,
      };
    });
    return merged;
  }

  function deduplicateByLab(colors, threshold) {
    if (colors.length <= 1) return colors;
    var merged = [];
    for (var i = 0; i < colors.length; i++) {
      var c = colors[i];
      var cLab = hexToLab(c.hex);
      var foundMatch = false;
      for (var j = 0; j < merged.length; j++) {
        var m = merged[j];
        if (deltaE76(m._lab, cLab) < threshold) {
          var totalW = m.weight + c.weight;
          merged[j] = {
            hex: labToHex(
              (m._lab[0] * m.weight + cLab[0] * c.weight) / totalW,
              (m._lab[1] * m.weight + cLab[1] * c.weight) / totalW,
              (m._lab[2] * m.weight + cLab[2] * c.weight) / totalW
            ),
            weight: totalW,
            _lab: [
              (m._lab[0] * m.weight + cLab[0] * c.weight) / totalW,
              (m._lab[1] * m.weight + cLab[1] * c.weight) / totalW,
              (m._lab[2] * m.weight + cLab[2] * c.weight) / totalW,
            ],
          };
          foundMatch = true;
          break;
        }
      }
      if (!foundMatch) {
        merged.push({ hex: c.hex, weight: c.weight, _lab: cLab });
      }
    }
    return merged.map(function (m) { return { hex: m.hex, weight: m.weight }; });
  }

  function countBucketPixels(buckets) {
    var total = 0;
    var keys = Object.keys(buckets);
    for (var i = 0; i < keys.length; i++) total += buckets[keys[i]].count;
    return total;
  }

  function sampleGarmentRegion(imageSource, maxDim, region, bgLabs) {
    var canvas = imageToCanvas(imageSource, maxDim, region);
    var ctx = canvas.getContext("2d");
    var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var pxData = imgData.data;
    var totalOpaque = 0;
    for (var k = 0; k < pxData.length; k += 4) {
      if (pxData[k + 3] >= 128) totalOpaque++;
    }

    // Tier 1: filter white + grey + skin + background
    var buckets = sampleRegion(imageSource, maxDim, region, false, true, bgLabs);
    var t1 = countBucketPixels(buckets);
    if (t1 >= Math.max(200, totalOpaque * 0.10)) {
      if (BG_DEBUG) console.log("[bg] tier 1 used:", t1, "of", totalOpaque);
      buckets._tier = 1;
      return buckets;
    }

    // Tier 2: filter white + grey + skin (no background)
    buckets = sampleRegion(imageSource, maxDim, region, false, true, null);
    var t2 = countBucketPixels(buckets);
    if (t2 >= Math.max(200, totalOpaque * 0.35)) {
      if (BG_DEBUG) console.log("[bg] tier 2 used:", t2, "of", totalOpaque);
      buckets._tier = 2;
      return buckets;
    }

    // Tier 3: keep white, filter skin (garment is likely white/off-white)
    buckets = sampleRegion(imageSource, maxDim, region, true, true, null);
    var t3 = countBucketPixels(buckets);
    if (t3 >= Math.max(200, totalOpaque * 0.10)) {
      // Check if result is overwhelmingly white — if so, the skin filter
      // probably ate an earth-tone garment (khaki, tan, camel). Re-try without skin.
      var whiteCount = 0;
      var keys3 = Object.keys(buckets);
      for (var wi = 0; wi < keys3.length; wi++) {
        var bkt = buckets[keys3[wi]];
        var avgR = bkt.rSum / bkt.count, avgG = bkt.gSum / bkt.count, avgB = bkt.bSum / bkt.count;
        if (avgR > 230 && avgG > 230 && avgB > 230) whiteCount += bkt.count;
      }
      if (whiteCount / t3 < 0.90) {
        if (BG_DEBUG) console.log("[bg] tier 3 used:", t3, "of", totalOpaque);
        buckets._tier = 3;
        return buckets;
      }
      if (BG_DEBUG) console.log("[bg] tier 3 was >90% white, trying tier 3b (no skin filter)");
    }

    // Tier 3b: keep white, no skin filter (earth-tone garment on white bg)
    // Then strip white buckets since we know bg is white
    buckets = sampleRegion(imageSource, maxDim, region, true, false, null);
    var keys3b = Object.keys(buckets);
    for (var si = 0; si < keys3b.length; si++) {
      var sb = buckets[keys3b[si]];
      if (!sb || !sb.count) continue;
      var sR = sb.rSum / sb.count, sG = sb.gSum / sb.count, sB = sb.bSum / sb.count;
      if (sR > 240 && sG > 240 && sB > 240) delete buckets[keys3b[si]];
    }
    if (BG_DEBUG) console.log("[bg] tier 3b used:", countBucketPixels(buckets), "of", totalOpaque);
    buckets._tier = "3b";
    return buckets;
  }

  function extractDominantColors(imageSource, nColors, maxDim, opts) {
    nColors = nColors || 5;
    maxDim = maxDim || 200;
    var productType = (opts && opts.productType) || "unknown";

    var sorted;

    var whiteBg = isWhiteBackground(imageSource, maxDim);
    var bgLabs = whiteBg ? [] : detectBackgroundColors(imageSource, maxDim);

    var rawBuckets;
    if (productType === "top") {
      if (whiteBg) {
        rawBuckets = sampleGarmentRegion(imageSource, maxDim, null, bgLabs);
      } else {
        rawBuckets = mergeWeightedBuckets(
          sampleGarmentRegion(imageSource, maxDim, "upper", bgLabs),
          sampleGarmentRegion(imageSource, maxDim, "middle", bgLabs), 2);
      }
    } else if (productType === "bottom") {
      if (whiteBg) {
        rawBuckets = sampleGarmentRegion(imageSource, maxDim, null, bgLabs);
      } else {
        rawBuckets = sampleGarmentRegion(imageSource, maxDim, "lower", bgLabs);
      }
    } else if (productType === "full") {
      rawBuckets = sampleGarmentRegion(imageSource, maxDim, "center", bgLabs);
    } else if (whiteBg) {
      rawBuckets = sampleGarmentRegion(imageSource, maxDim, null, bgLabs);
    } else {
      rawBuckets = sampleRegion(imageSource, maxDim, null, false, false, bgLabs);
    }
    var usedTier = rawBuckets._tier || 0;
    delete rawBuckets._tier;
    sorted = Object.values(rawBuckets);
    sorted.sort(function (a, b) { return b.count - a.count; });

    if (sorted.length === 0) return [];

    var totalSurviving = 0;
    for (var k = 0; k < sorted.length; k++) totalSurviving += sorted[k].count;
    if (totalSurviving === 0) totalSurviving = 1;

    var extractCount = nColors * 3;
    var results = [];
    var seen = {};
    for (var j = 0; j < sorted.length && results.length < extractCount; j++) {
      var bucket = sorted[j];
      var avgR = Math.round(bucket.rSum / bucket.count);
      var avgG = Math.round(bucket.gSum / bucket.count);
      var avgB = Math.round(bucket.bSum / bucket.count);
      var hex = rgbToHex(avgR, avgG, avgB);
      if (!seen[hex]) {
        seen[hex] = true;
        results.push({ hex: hex, weight: bucket.count / totalSurviving });
      }
    }

    var deduped = deduplicateByLab(results, 12);
    deduped.sort(function (a, b) { return b.weight - a.weight; });
    var final = deduped.slice(0, nColors);

    // Attach detected background colors for debug inspection
    var bgHexes = bgLabs.map(function (lab) { return labToHex(lab[0], lab[1], lab[2]); });
    final._bgColors = bgHexes;
    final._tier = usedTier;

    return final;
  }

  // ---- Season ranking ----

  var SEASON_ORDER = {
    "Light Spring": 0, "True Spring": 1, "Bright Spring": 2,
    "Light Summer": 3, "Cool Summer": 4, "Soft Summer": 5,
    "Soft Autumn": 6, "Warm Autumn": 7, "Deep Autumn": 8,
    "Bright Winter": 9, "Cool Winter": 10, "Deep Winter": 11,
  };
  function rankSeasons(itemColors, palettes) {
    if (!itemColors || itemColors.length === 0) return [];

    var items = itemColors.map(function (c) {
      if (typeof c === "string") return { lab: hexToLab(c), weight: 1 };
      return { lab: hexToLab(c.hex), weight: c.weight };
    });

    var totalWeight = 0;
    for (var w = 0; w < items.length; w++) totalWeight += items[w].weight;
    if (totalWeight === 0) totalWeight = 1;

    var avgChroma = 0;
    for (var ci = 0; ci < items.length; ci++) {
      var ca = items[ci].lab[1], cb = items[ci].lab[2];
      var ch = Math.sqrt(ca * ca + cb * cb);
      avgChroma += ch * (items[ci].weight / totalWeight);
      if (ch < 5) {
        items[ci].lab = [items[ci].lab[0], 0, 0];
      }
    }
    var stabilityMargin = Math.max(3, 12 - avgChroma * 0.3);

    var rankings = [];
    var seasons = Object.keys(palettes);
    for (var s = 0; s < seasons.length; s++) {
      var season = seasons[s];
      var chips = palettes[season];
      if (!chips || chips.length === 0) continue;
      var palLabs = chips.map(hexToLab);

      var weightedDist = 0;
      for (var i = 0; i < items.length; i++) {
        var minDist = Infinity;
        for (var p = 0; p < palLabs.length; p++) {
          var d = deltaE76(items[i].lab, palLabs[p]);
          if (d < minDist) minDist = d;
        }
        weightedDist += minDist * (items[i].weight / totalWeight);
      }
      rankings.push([season, weightedDist]);
    }

    rankings.sort(function (a, b) {
      var diff = a[1] - b[1];
      if (Math.abs(diff) < stabilityMargin) {
        return (SEASON_ORDER[a[0]] || 0) - (SEASON_ORDER[b[0]] || 0);
      }
      return diff;
    });
    return rankings;
  }

  // ---- Pattern personalization ----

  // For a pattern garment, check how many detected colors match the user's season palette.
  // Returns { matchCount, matchedHexes } where matchedHexes are the garment colors that
  // fell within PATTERN_PALETTE_MATCH_DE of any swatch. Reuses hexToLab + deltaE76.
  // TODO v0.2: weight by vertical position (neckline > hem) instead of treating all equal.
  function checkPatternForSeason(colors, paletteSwatches) {
    var paletteLabs = [];
    for (var p = 0; p < paletteSwatches.length; p++) {
      paletteLabs.push(hexToLab(paletteSwatches[p]));
    }
    var matchCount = 0;
    var matchedHexes = [];
    for (var i = 0; i < colors.length; i++) {
      var cLab = hexToLab(colors[i].hex);
      for (var j = 0; j < paletteLabs.length; j++) {
        if (deltaE76(cLab, paletteLabs[j]) <= PATTERN_PALETTE_MATCH_DE) {
          matchCount++;
          matchedHexes.push(colors[i].hex);
          break;
        }
      }
    }
    return { matchCount: matchCount, matchedHexes: matchedHexes };
  }

  // ---- Confidence classification ----

  function classifyConfidence(colors, ranking) {
    if (!ranking || ranking.length === 0) {
      return {
        state: "no-match", bestSeason: null, bestDE: Infinity,
        seasons: [], scores: [], maxPairDE: 0,
        display: { match: false, suppress: true, label: null, sublabel: "No strong season match" }
      };
    }

    var bestSeason = ranking[0][0];
    var bestDE = ranking[0][1];

    // --- Pattern detection (checked before quality gate) ---
    var significant = [];
    for (var i = 0; i < colors.length; i++) {
      if (colors[i].weight >= PATTERN_MIN_WEIGHT) {
        significant.push(hexToLab(colors[i].hex));
      }
    }

    var maxPairDE = 0;
    if (significant.length >= 3) {
      for (var a = 0; a < significant.length; a++) {
        for (var b = a + 1; b < significant.length; b++) {
          var d = deltaE76(significant[a], significant[b]);
          if (d > maxPairDE) maxPairDE = d;
        }
      }
    }
    var isPattern = significant.length >= 3 && maxPairDE > PATTERN_DE_THRESHOLD;

    if (!isPattern && colors.length >= 3) {
      var allLabs = [];
      for (var ci = 0; ci < Math.min(colors.length, 5); ci++) {
        allLabs.push(hexToLab(colors[ci].hex));
      }
      var maxAllDE = 0;
      for (var ai = 0; ai < allLabs.length; ai++) {
        for (var bi = ai + 1; bi < allLabs.length; bi++) {
          var dd = deltaE76(allLabs[ai], allLabs[bi]);
          if (dd > maxAllDE) maxAllDE = dd;
        }
      }
      if (maxAllDE > maxPairDE) maxPairDE = maxAllDE;
      isPattern = maxAllDE > PATTERN_DE_THRESHOLD && colors[0].weight < 0.60;
    }

    // (c) Pattern — spans families
    if (isPattern) {
      return {
        state: "pattern", bestSeason: bestSeason, bestDE: bestDE,
        seasons: [], scores: [], maxPairDE: maxPairDE,
        display: { match: false, suppress: true, label: "Multi-color pattern", sublabel: null }
      };
    }

    // (d) No strong match — best palette ΔE too high
    if (bestDE > LOW_CONFIDENCE_DE_THRESHOLD) {
      return {
        state: "no-match", bestSeason: bestSeason, bestDE: bestDE,
        seasons: [], scores: [], maxPairDE: maxPairDE,
        display: { match: false, suppress: true, label: null, sublabel: "No strong season match" }
      };
    }

    // --- Sibling collection: everything within SIBLING_MARGIN_DE of best, max 3 ---
    var siblingEntries = [ranking[0]];
    for (var s = 1; s < Math.min(ranking.length, 3); s++) {
      if (ranking[s][1] - bestDE <= SIBLING_MARGIN_DE) {
        siblingEntries.push(ranking[s]);
      }
    }
    var seasons = siblingEntries.map(function (r) { return r[0]; });
    var scores = siblingEntries.map(function (r) { return r[1]; });

    // (a) vs (b): gap-to-runner-up > SIBLING_MARGIN_DE → single confident winner
    if (siblingEntries.length < 2) {
      return {
        state: "confident", bestSeason: bestSeason, bestDE: bestDE,
        seasons: seasons, scores: scores, maxPairDE: maxPairDE,
        display: { match: true, suppress: false, label: bestSeason, sublabel: null }
      };
    }

    // (b) Siblings — good fit, close cluster
    var siblingLabel = seasons.join(" / ");
    return {
      state: "siblings", bestSeason: bestSeason, bestDE: bestDE,
      seasons: seasons, scores: scores, maxPairDE: maxPairDE,
      display: { match: true, suppress: false, label: siblingLabel, sublabel: null }
    };
  }

  // ---- Season quiz: centroid scoring ----

  // Each season is a point in 3D space: [temperature, value, chroma]
  // temperature: -3 (very cool) to +3 (very warm)
  // value: -3 (very deep) to +3 (very light)
  // chroma: -3 (very muted) to +3 (very bright/clear)
  var SEASON_CENTROIDS = {
    "Light Spring":   [  1,  3,  1 ],
    "True Spring":    [  3,  1,  1 ],
    "Bright Spring":  [  1,  1,  3 ],
    "Light Summer":   [ -1,  3, -1 ],
    "Cool Summer":    [ -3,  1, -1 ],
    "Soft Summer":    [ -1,  0, -3 ],
    "Soft Autumn":    [  1,  0, -3 ],
    "Warm Autumn":    [  3, -1, -1 ],
    "Deep Autumn":    [  1, -3, -1 ],
    "Bright Winter":  [ -1, -1,  3 ],
    "Cool Winter":    [ -3, -1,  1 ],
    "Deep Winter":    [ -1, -3,  1 ],
  };

  function determineSeason(answers) {
    // Accumulate scores on 3 axes from quiz answers
    var temp = 0, val = 0, chroma = 0;

    // Q1: Gold/silver jewelry → temperature
    if (answers.q1 === "gold")   temp += 2;
    if (answers.q1 === "silver") temp -= 2;
    // "both" = neutral, no shift

    // Q2: Natural hair color → temperature + value
    if (answers.q2 === "light-warm") { temp += 1; val += 2; }
    if (answers.q2 === "light-cool") { temp -= 1; val += 2; }
    if (answers.q2 === "dark-warm")  { temp += 1; val -= 2; }
    if (answers.q2 === "dark-cool")  { temp -= 1; val -= 2; }

    // Q3: Black test → chroma/contrast
    if (answers.q3 === "great") chroma += 2;
    if (answers.q3 === "ok")    chroma += 0;
    if (answers.q3 === "harsh") chroma -= 2;

    // Q4: Compliment colors → season family (temp + chroma)
    if (answers.q4 === "spring") { temp += 1; chroma += 1; }
    if (answers.q4 === "summer") { temp -= 1; chroma -= 1; }
    if (answers.q4 === "autumn") { temp += 1; chroma -= 1; }
    if (answers.q4 === "winter") { temp -= 1; chroma += 1; }

    // Q5: Overall depth → value
    if (answers.q5 === "light")  val += 2;
    if (answers.q5 === "medium") val += 0;
    if (answers.q5 === "deep")   val -= 2;

    // Find closest season centroid by Euclidean distance
    var bestSeason = null;
    var bestDist = Infinity;
    var point = [temp, val, chroma];

    var seasons = Object.keys(SEASON_CENTROIDS);
    for (var i = 0; i < seasons.length; i++) {
      var c = SEASON_CENTROIDS[seasons[i]];
      var dist = Math.sqrt(
        Math.pow(point[0] - c[0], 2) +
        Math.pow(point[1] - c[1], 2) +
        Math.pow(point[2] - c[2], 2)
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestSeason = seasons[i];
      }
    }
    return bestSeason;
  }

  // ---- Public API ----

  return {
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    srgbToXyz: srgbToXyz,
    xyzToLab: xyzToLab,
    hexToLab: hexToLab,
    labToHex: labToHex,
    deltaE76: deltaE76,
    classifyProductType: classifyProductType,
    extractDominantColors: extractDominantColors,
    detectBackgroundColors: detectBackgroundColors,
    isWhiteBackground: isWhiteBackground,
    rankSeasons: rankSeasons,
    classifyConfidence: classifyConfidence,
    checkPatternForSeason: checkPatternForSeason,
    get BG_DEBUG() { return BG_DEBUG; },
    set BG_DEBUG(v) { BG_DEBUG = v; },
    get BG_REJECT_DE_THRESHOLD() { return BG_REJECT_DE_THRESHOLD; },
    set BG_REJECT_DE_THRESHOLD(v) { BG_REJECT_DE_THRESHOLD = v; },
    get LOW_CONFIDENCE_DE_THRESHOLD() { return LOW_CONFIDENCE_DE_THRESHOLD; },
    set LOW_CONFIDENCE_DE_THRESHOLD(v) { LOW_CONFIDENCE_DE_THRESHOLD = v; },
    get PATTERN_DE_THRESHOLD() { return PATTERN_DE_THRESHOLD; },
    set PATTERN_DE_THRESHOLD(v) { PATTERN_DE_THRESHOLD = v; },
    get PATTERN_MIN_WEIGHT() { return PATTERN_MIN_WEIGHT; },
    set PATTERN_MIN_WEIGHT(v) { PATTERN_MIN_WEIGHT = v; },
    get SIBLING_MARGIN_DE() { return SIBLING_MARGIN_DE; },
    set SIBLING_MARGIN_DE(v) { SIBLING_MARGIN_DE = v; },
    get PATTERN_PALETTE_MATCH_DE() { return PATTERN_PALETTE_MATCH_DE; },
    set PATTERN_PALETTE_MATCH_DE(v) { PATTERN_PALETTE_MATCH_DE = v; },
    get PATTERN_MATCH_COUNT() { return PATTERN_MATCH_COUNT; },
    set PATTERN_MATCH_COUNT(v) { PATTERN_MATCH_COUNT = v; },
    determineSeason: determineSeason,
  };
})();
