var ColorAnalysis = (function () {
  "use strict";

  // ---- Color space conversions (ported from app/season_matcher.py) ----

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
      // Catches dress skirts, waist details, longer garments
      var insetX2 = Math.round(sw * 0.15);
      sx = insetX2;
      sy = Math.round(sh * 0.30);
      sWidth = sw - insetX2 * 2;
      sHeight = Math.round(sh * 0.35);
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
    ctx.drawImage(imageSource, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
    return canvas;
  }

  function isNeutralGrey(r, g, b) {
    // Reject true neutrals (grey/white/off-white backgrounds) but keep
    // muted colors like sage green, dusty rose, slate blue.
    // True neutrals: all channels within a very tight range of each other.
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var chroma = max - min;

    // Pure greys: channels nearly identical
    if (chroma < 8) return true;

    // Near-white backgrounds (very light, very low saturation)
    if (max > 225 && chroma < 15) return true;

    return false;
  }

  function sampleRegion(imageSource, maxDim, region) {
    var canvas = imageToCanvas(imageSource, maxDim, region);
    var ctx = canvas.getContext("2d");
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var pixels = imageData.data;
    var buckets = {};
    for (var i = 0; i < pixels.length; i += 4) {
      var r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 128) continue;
      if (r > 240 && g > 240 && b > 240) continue;
      if (r < 16 && g < 16 && b < 16) continue;
      if (isNeutralGrey(r, g, b)) continue;
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
    // Check if the image has a white/light background (product-only flat lay).
    // Sample the full image and count white-ish pixels vs total.
    var canvas = imageToCanvas(imageSource, maxDim || 100, null);
    var ctx = canvas.getContext("2d");
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var total = 0, white = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      total++;
      if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) white++;
    }
    return total > 0 && (white / total) > 0.25;
  }

  function extractDominantColors(imageSource, nColors, maxDim) {
    nColors = nColors || 5;
    maxDim = maxDim || 200;

    var sorted;

    if (isWhiteBackground(imageSource, maxDim)) {
      // Product-only image on white background — analyze the whole image,
      // the white/grey filter will remove the background automatically.
      // No need for torso-focused cropping.
      sorted = Object.values(sampleRegion(imageSource, maxDim, null));
      sorted.sort(function (a, b) { return b.count - a.count; });
    } else {
      // Model shot — use dual-region sampling focused on the torso.
      // Upper region (tops/jackets) gets 2x weight over middle region
      // (dress skirts). Both skip the bottom where pants/shoes live.
      var upperBuckets = sampleRegion(imageSource, maxDim, "upper");
      var midBuckets = sampleRegion(imageSource, maxDim, "middle");

      var merged = {};
      var keys = new Set(Object.keys(upperBuckets).concat(Object.keys(midBuckets)));
      keys.forEach(function (key) {
        var u = upperBuckets[key] || { count: 0, rSum: 0, gSum: 0, bSum: 0 };
        var m = midBuckets[key] || { count: 0, rSum: 0, gSum: 0, bSum: 0 };
        merged[key] = {
          count: u.count * 2 + m.count,
          rSum: u.rSum * 2 + m.rSum,
          gSum: u.gSum * 2 + m.gSum,
          bSum: u.bSum * 2 + m.bSum,
        };
      });
      sorted = Object.values(merged);
      sorted.sort(function (a, b) { return b.count - a.count; });
    }

    if (sorted.length === 0) return [];

    var totalSurviving = 0;
    for (var k = 0; k < sorted.length; k++) totalSurviving += sorted[k].count;
    if (totalSurviving === 0) totalSurviving = 1;

    var results = [];
    var seen = {};
    for (var j = 0; j < sorted.length && results.length < nColors; j++) {
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
    return results;
  }

  // ---- Season ranking ----

  function rankSeasons(itemColors, palettes) {
    // itemColors: array of {hex, weight} or plain hex strings
    if (!itemColors || itemColors.length === 0) return [];

    var items = itemColors.map(function (c) {
      if (typeof c === "string") return { lab: hexToLab(c), weight: 1 };
      return { lab: hexToLab(c.hex), weight: c.weight };
    });

    // Normalize weights so they sum to 1
    var totalWeight = 0;
    for (var w = 0; w < items.length; w++) totalWeight += items[w].weight;
    if (totalWeight === 0) totalWeight = 1;

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
      return a[1] - b[1];
    });
    return rankings;
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
    deltaE76: deltaE76,
    extractDominantColors: extractDominantColors,
    isWhiteBackground: isWhiteBackground,
    rankSeasons: rankSeasons,
    determineSeason: determineSeason,
  };
})();
