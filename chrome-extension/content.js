(function () {
  "use strict";

  if (window.__colorSeasonShopperLoaded) return;
  window.__colorSeasonShopperLoaded = true;

  // ---- Product image detection ----

  function detectProductImage() {
    var hostname = window.location.hostname;

    if (hostname.includes("amazon.")) return detectAmazonImage();
    if (hostname.includes("nordstrom.com")) return detectNordstromImage();
    return genericProductImageDetection();
  }

  // Return all candidate product image URLs for the popup to choose from.
  // The popup will prefer white-background (flat lay) images.
  function detectAllProductImages() {
    var excludeSelector = "nav, header, footer, [role='navigation'], [role='banner'], " +
      '[class*="recommend"], [class*="Recommend"], [class*="carousel"], ' +
      '[class*="Carousel"], [class*="youMight"], [class*="YouMight"]';
    var excludeEls = document.querySelectorAll(excludeSelector);
    var excludeSet = new Set();
    excludeEls.forEach(function (el) { excludeSet.add(el); });

    var candidates = [];
    var seen = new Set();
    var allImgs = document.querySelectorAll("img");

    for (var i = 0; i < allImgs.length; i++) {
      var img = allImgs[i];
      var src = img.src || img.getAttribute("data-src") || "";
      if (!src || seen.has(src)) continue;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (w < 150 || h < 150) continue;
      var inExcl = false;
      excludeSet.forEach(function (ex) { if (ex.contains(img)) inExcl = true; });
      if (inExcl) continue;
      seen.add(src);
      candidates.push(src);
    }
    return candidates;
  }

  // -- Amazon --

  function detectAmazonImage() {
    var landing = document.getElementById("landingImage");
    if (landing) {
      var hiRes = landing.getAttribute("data-old-hires");
      if (hiRes) return hiRes;
      var dynamic = extractAmazonDynamicImage(landing);
      if (dynamic) return dynamic;
      if (landing.src) return landing.src;
    }
    var sImg = document.querySelector("img.s-image");
    if (sImg && sImg.src) return sImg.src;
    return genericProductImageDetection();
  }

  function extractAmazonDynamicImage(imgEl) {
    var raw = imgEl.getAttribute("data-a-dynamic-image");
    if (!raw) return null;
    try {
      var map = JSON.parse(raw);
      var best = null,
        bestArea = 0;
      for (var url in map) {
        var dims = map[url];
        var area = dims[0] * dims[1];
        if (area > bestArea) {
          bestArea = area;
          best = url;
        }
      }
      return best;
    } catch (e) {
      return null;
    }
  }

  // -- Nordstrom --

  function detectNordstromImage() {
    // Nordstrom PDP URLs follow /s/{product-slug}/{product-id}
    var isPDP = /\/s\/[^/]+\/\d+/.test(window.location.pathname);

    if (isPDP) {
      // Strategy 1: Look for the main product hero image.
      // Nordstrom PDP hero images are large images from their CDN
      // that are NOT inside recommendation/editorial sections.
      var heroImg = findNordstromHeroImage();
      if (heroImg) return heroImg;
    }

    // Strategy 2: Named product-module-image (used on some pages)
    var named = document.querySelector('img[name="product-module-image"]');
    if (named && named.src) return named.src;

    // Strategy 3: og:image meta tag (reliable on PDPs)
    var ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) return ogImage.content;

    return findLargestImageFromCdn("nordstrommedia.com") || genericProductImageDetection();
  }

  function findNordstromHeroImage() {
    // On Nordstrom PDPs, the main product image is typically:
    // - From n.nordstrommedia.com CDN
    // - In the upper portion of the page (not in recommendation carousels)
    // - A large image but NOT inside sections with editorial/promo content
    // - Often inside a button or figure element for zoom
    var imgs = document.querySelectorAll("img");
    var candidates = [];

    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img.src) continue;
      // Must be from Nordstrom's image CDN
      if (!img.src.includes("nordstrommedia.com") && !img.src.includes("nordstrom.com")) continue;

      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      // Product images are tall (portrait orientation) and reasonably large
      if (w < 100 || h < 100) continue;

      // Skip images that are inside recommendation sections, carousels, or editorial blocks
      var parent = img.closest(
        '[class*="recommend"], [class*="Recommend"], [class*="carousel"], ' +
        '[class*="Carousel"], [class*="editorial"], [class*="Editorial"], ' +
        '[class*="youMight"], [class*="YouMight"], [class*="also-like"], ' +
        '[class*="AlsoLike"], [class*="trending"], [class*="Trending"], ' +
        '[data-testid*="recommend"], [data-testid*="carousel"]'
      );
      if (parent) continue;

      // Skip images inside the page footer or header
      if (img.closest("footer, header, nav")) continue;

      // Prefer portrait-oriented images (product shots) over landscape (editorial)
      var aspectRatio = h / w;
      var isPortrait = aspectRatio > 1.1;

      candidates.push({
        src: img.src,
        area: w * h,
        isPortrait: isPortrait,
        yPos: img.getBoundingClientRect().top,
      });
    }

    if (candidates.length === 0) return null;

    // Sort: prefer portrait images near the top of the page, then by size
    candidates.sort(function (a, b) {
      // Portrait images strongly preferred
      if (a.isPortrait !== b.isPortrait) return a.isPortrait ? -1 : 1;
      // Among same orientation, prefer higher on the page (lower y)
      // but only if both are in the visible/near-visible area
      if (a.yPos < 800 && b.yPos < 800) {
        // Both near top — prefer larger
        return b.area - a.area;
      }
      // Prefer the one closer to the top
      return a.yPos - b.yPos;
    });

    return candidates[0].src;
  }

  function findLargestImageFromCdn(cdnDomain) {
    var best = null,
      bestArea = 0;
    var imgs = document.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img.src || !img.src.includes(cdnDomain)) continue;
      // Skip images in recommendation/editorial sections
      if (img.closest('[class*="recommend"], [class*="carousel"], [class*="editorial"], footer, header, nav')) continue;
      var area = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
      if (area > bestArea) {
        bestArea = area;
        best = img.src;
      }
    }
    return best;
  }

  // -- Generic fallback --

  function genericProductImageDetection() {
    var excludeSelector = "nav, header, footer, [role='navigation'], [role='banner'], " +
      '[class*="recommend"], [class*="Recommend"], [class*="carousel"], ' +
      '[class*="youMight"], [class*="YouMight"]';
    var excludeEls = document.querySelectorAll(excludeSelector);
    var excludeSet = new Set();
    excludeEls.forEach(function (el) { excludeSet.add(el); });

    function isExcluded(el) {
      var dominated = false;
      excludeSet.forEach(function (ex) { if (ex.contains(el)) dominated = true; });
      return dominated;
    }

    // Strategy 1: Find the largest visible product image on the page.
    // This works even after SPA color-swatch changes update the img src.
    var best = null, bestArea = 0;
    var allImgs = document.querySelectorAll("img");
    for (var j = 0; j < allImgs.length; j++) {
      var el = allImgs[j];
      var w = el.naturalWidth || el.width;
      var h = el.naturalHeight || el.height;
      if (w < 150 || h < 150) continue;
      if (!el.offsetParent) continue;
      if (isExcluded(el)) continue;
      var area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = el.src;
      }
    }
    if (best) return best;

    // Strategy 2: og:image meta tag (may be stale on SPAs)
    var ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) return ogImage.content;

    return null;
  }

  // ---- Product listing page detection ----

  function detectPageType() {
    var url = window.location.href;
    var hostname = window.location.hostname;
    if (hostname.includes("amazon.")) {
      if (url.includes("/s?") || url.includes("/s/")) return "amazon-plp";
      if (url.includes("/dp/") || url.includes("/gp/product/")) return "amazon-pdp";
    }
    if (hostname.includes("nordstrom.com")) {
      if (url.includes("/sr?") || url.includes("/browse/")) return "nordstrom-plp";
    }
    return null;
  }

  function detectProductListingImages() {
    var pageType = detectPageType();
    var results = [];

    if (pageType === "amazon-plp") {
      var cards = document.querySelectorAll('div.s-result-item[data-component-type="s-search-result"]');
      cards.forEach(function (card) {
        var img = card.querySelector("img.s-image");
        if (img && img.src) {
          // Request a larger version for better color analysis
          var hiRes = img.src.replace(/\._[A-Z0-9_,]+_\./, "._AC_SX400_.");
          results.push({ element: card, imageUrl: hiRes, imgElement: img });
        }
      });
    }

    if (pageType === "amazon-pdp") {
      // Tag color variant thumbnails on product detail pages.
      // Amazon uses various container IDs/classes for color swatches.
      var variantSelectors = [
        '#variation_color_name li img',
        '#tp-inline-twister-dim-values-container img',
        '[id*="color_name"] li img',
        '[id*="colour_name"] li img',
        '.twisterSwatchWrapper img',
        '[data-action="selected-color"] img',
        '#twister-plus-inline-twister-card li img',
      ];
      var variantImages = document.querySelectorAll(variantSelectors.join(", "));
      var seenSrcs = new Set();
      variantImages.forEach(function (img) {
        if (!img.src || seenSrcs.has(img.src)) return;
        seenSrcs.add(img.src);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (w < 20 || h < 20) return;
        var container = img.closest("li") || img.parentElement;
        if (container) {
          var hiRes = img.src.replace(/\._[A-Z0-9_,]+_\./, "._AC_SX300_.");
          results.push({ element: container, imageUrl: hiRes, imgElement: img });
        }
      });
    }

    if (pageType === "nordstrom-plp") {
      var selectors = [
        'article[data-testid*="product"]',
        'div[class*="product-card"]',
        'div[class*="ProductCard"]',
      ];
      var cards2 = document.querySelectorAll(selectors.join(", "));
      cards2.forEach(function (card) {
        var img =
          card.querySelector('img[name="product-module-image"]') ||
          card.querySelector("img");
        if (img && img.src && img.src.includes("nordstrom")) {
          results.push({ element: card, imageUrl: img.src, imgElement: img });
        }
      });
    }

    return results;
  }

  // ---- Badge injection (for PLP inline tagging) ----

  var badgeStyleInjected = false;

  function injectBadgeStyles() {
    if (badgeStyleInjected) return;
    badgeStyleInjected = true;
    var style = document.createElement("style");
    style.textContent =
      ".css-season-badge { position: absolute; bottom: 8px; left: 8px; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; z-index: 100; pointer-events: none; line-height: 1.3; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }" +
      ".css-badge-match { background: rgba(22,163,74,0.92); color: #fff; }" +
      ".css-badge-nomatch { background: rgba(120,120,120,0.78); color: #fff; }" +
      ".css-badge-neutral { background: rgba(59,130,246,0.92); color: #fff; }";
    document.head.appendChild(style);
  }

  function injectBadge(imgElement, bestSeason, userSeason) {
    var parent = imgElement.parentElement;
    if (!parent || parent.querySelector(".css-season-badge")) return;

    injectBadgeStyles();
    parent.style.position = "relative";

    var badge = document.createElement("div");
    badge.className = "css-season-badge";

    // Use shorter labels for small containers (PDP variant thumbnails)
    var parentW = parent.offsetWidth || 200;
    if (parentW < 120) {
      // Abbreviate: "Soft Summer" → "SS", "Bright Winter" → "BW"
      var parts = bestSeason.split(" ");
      badge.textContent = parts.map(function (w) { return w[0]; }).join("");
      badge.title = bestSeason;
      badge.style.fontSize = "9px";
      badge.style.padding = "2px 5px";
    } else {
      badge.textContent = bestSeason;
    }

    if (userSeason) {
      badge.classList.add(bestSeason === userSeason ? "css-badge-match" : "css-badge-nomatch");
    } else {
      badge.classList.add("css-badge-neutral");
    }
    parent.appendChild(badge);
  }

  // ---- PLP badge orchestration ----

  var palettesCache = null;

  function loadPalettes(callback) {
    if (palettesCache) return callback(palettesCache);
    var url = chrome.runtime.getURL("palettes.json");
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        palettesCache = data;
        callback(data);
      })
      .catch(function () { callback(null); });
  }

  function analyzeAndBadge(imgElement, imageUrl, userSeason, palettes) {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, function (response) {
      if (!response || !response.dataUrl) return;
      var tempImg = new Image();
      tempImg.onload = function () {
        try {
          var colors = ColorAnalysis.extractDominantColors(tempImg, 5);
          var ranking = ColorAnalysis.rankSeasons(colors, palettes);
          if (ranking.length > 0) {
            injectBadge(imgElement, ranking[0][0], userSeason);
          }
        } catch (e) {
          // silently skip failed analyses
        }
      };
      tempImg.src = response.dataUrl;
    });
  }

  var MAX_CONCURRENT = 4;
  var activeCount = 0;
  var queue = [];

  function enqueueAnalysis(imgElement, imageUrl, userSeason, palettes) {
    if (activeCount < MAX_CONCURRENT) {
      activeCount++;
      analyzeAndBadgeThrottled(imgElement, imageUrl, userSeason, palettes);
    } else {
      queue.push({ imgElement: imgElement, imageUrl: imageUrl, userSeason: userSeason, palettes: palettes });
    }
  }

  function analyzeAndBadgeThrottled(imgElement, imageUrl, userSeason, palettes) {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, function (response) {
      if (!response || !response.dataUrl) {
        onAnalysisDone();
        return;
      }
      var tempImg = new Image();
      tempImg.onload = function () {
        try {
          var colors = ColorAnalysis.extractDominantColors(tempImg, 5);
          var ranking = ColorAnalysis.rankSeasons(colors, palettes);
          if (ranking.length > 0) {
            injectBadge(imgElement, ranking[0][0], userSeason);
          }
        } catch (e) {}
        onAnalysisDone();
      };
      tempImg.onerror = onAnalysisDone;
      tempImg.src = response.dataUrl;
    });
  }

  function onAnalysisDone() {
    activeCount--;
    if (queue.length > 0) {
      var next = queue.shift();
      activeCount++;
      analyzeAndBadgeThrottled(next.imgElement, next.imageUrl, next.userSeason, next.palettes);
    }
  }

  function initPLPBadges() {
    var pageType = detectPageType();
    if (!pageType) return;

    loadPalettes(function (palettes) {
      if (!palettes) return;

      chrome.storage.local.get(["userSeason"], function (data) {
        var userSeason = data.userSeason || null;
        var processed = new WeakSet();

        var observer = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              var card = entry.target;
              if (processed.has(card)) return;
              processed.add(card);

              // Look up the pre-computed image URL and element for this card
              var info = cardImageMap.get(card);
              if (!info) return;
              enqueueAnalysis(info.imgElement, info.imageUrl, userSeason, palettes);
            });
          },
          { rootMargin: "200px", threshold: 0.1 }
        );

        // Build a map of card element → {imgElement, imageUrl} using the
        // pre-computed hi-res URLs from detectProductListingImages
        var cardImageMap = new Map();
        var items = detectProductListingImages();
        items.forEach(function (item) {
          cardImageMap.set(item.element, item);
          observer.observe(item.element);
        });

        // Watch for infinite scroll additions
        var mutObserver = new MutationObserver(function () {
          var newItems = detectProductListingImages();
          newItems.forEach(function (item) {
            if (!processed.has(item.element)) {
              cardImageMap.set(item.element, item);
              observer.observe(item.element);
            }
          });
        });
        mutObserver.observe(document.body, { childList: true, subtree: true });
      });
    });
  }

  // ---- Message handling ----

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "GET_PRODUCT_IMAGE") {
      sendResponse({
        imageUrl: detectProductImage(),
        allImageUrls: detectAllProductImages(),
      });
    }
    if (msg.type === "GET_PRODUCT_IMAGES_PLP") {
      var images = detectProductListingImages().map(function (item) {
        return item.imageUrl;
      });
      sendResponse({ images: images });
    }
    return true;
  });

  // ---- Auto-init PLP badges ----

  if (document.readyState === "complete" || document.readyState === "interactive") {
    initPLPBadges();
  } else {
    document.addEventListener("DOMContentLoaded", initPLPBadges);
  }
})();
