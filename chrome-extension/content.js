(function () {
  "use strict";

  if (window.__colorSeasonShopperLoaded) return;
  window.__colorSeasonShopperLoaded = true;

  var CACHE_VERSION = 9;

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

  var BANNER_DOMAINS = ["afterpay", "klarna", "clearpay", "sezzle", "affirm", "paypal",
    "facebook", "instagram", "twitter", "tiktok", "pinterest", "youtube", "google-analytics",
    "doubleclick", "adsrv", "cdn.shopify.com/s/files/1/0000"];

  function isBannerImage(src) {
    if (!src) return false;
    var lower = src.toLowerCase();
    return BANNER_DOMAINS.some(function (d) { return lower.includes(d); });
  }

  function genericProductImageDetection() {
    var excludeSelector = "nav, header, footer, [role='navigation'], [role='banner'], " +
      '[class*="recommend"], [class*="Recommend"], [class*="carousel"], ' +
      '[class*="youMight"], [class*="YouMight"], iframe, [class*="afterpay"], ' +
      '[class*="Afterpay"], [class*="klarna"], [class*="Klarna"], [class*="payment"], ' +
      '[class*="Payment"], [class*="banner"], [class*="Banner"], [class*="promo"], [class*="Promo"]';
    var excludeEls = document.querySelectorAll(excludeSelector);
    var excludeSet = new Set();
    excludeEls.forEach(function (el) { excludeSet.add(el); });

    function isExcluded(el) {
      var dominated = false;
      excludeSet.forEach(function (ex) { if (ex.contains(el)) dominated = true; });
      return dominated;
    }

    // Strategy 1: Find the largest visible product image on the page.
    // Prefer portrait-oriented images (product photos) over landscape (banners).
    var best = null, bestArea = 0;
    var allImgs = document.querySelectorAll("img");
    for (var j = 0; j < allImgs.length; j++) {
      var el = allImgs[j];
      var w = el.naturalWidth || el.width;
      var h = el.naturalHeight || el.height;
      if (w < 150 || h < 150) continue;
      if (!el.offsetParent) continue;
      if (isExcluded(el)) continue;
      if (isBannerImage(el.src)) continue;
      var ratio = h / w;
      if (ratio < 0.7) continue;
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

  // ---- URL normalization for caching ----

  function normalizeProductUrl(url) {
    try {
      var u = new URL(url, window.location.origin);
      return u.origin + u.pathname;
    } catch (e) {
      return url;
    }
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
    // Generic: detect product grids on any e-commerce site
    return "generic";
  }

  function detectProductListingImages() {
    var pageType = detectPageType();
    var results = [];

    if (pageType === "amazon-plp") {
      var cards = document.querySelectorAll('div.s-result-item[data-component-type="s-search-result"]');
      cards.forEach(function (card) {
        var img = card.querySelector("img.s-image");
        if (img && img.src) {
          var hiRes = img.src.replace(/\._[A-Z0-9_,]+_\./, "._AC_SX400_.");
          var productTitle = img.alt || "";
          if (!productTitle) {
            var titleEl = card.querySelector("h2");
            productTitle = titleEl ? titleEl.textContent.trim() : "";
          }
          var productLink = card.querySelector("h2 a, a[href*='/dp/']");
          var productUrl = productLink ? productLink.href : "";
          results.push({ element: card, imageUrl: hiRes, imgElement: img, productTitle: productTitle, productUrl: productUrl });
        }
      });
      addAmazonCarouselProducts(results);
      return results;
    }

    if (pageType === "amazon-pdp") {
      var mainTitleEl = document.querySelector("#productTitle, #title span");
      var mainTitle = mainTitleEl ? mainTitleEl.textContent.trim() : "";
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
          results.push({ element: container, imageUrl: hiRes, imgElement: img, productTitle: mainTitle });
        }
      });
      addAmazonCarouselProducts(results);
      return results;
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
          var titleEl = card.querySelector('h3, h2, a[class*="title"], a[class*="Title"], [class*="product-title"]');
          var productTitle = titleEl ? titleEl.textContent.trim() : "";
          var productLink = card.querySelector("a[href]");
          var productUrl = productLink ? productLink.href : "";
          results.push({ element: card, imageUrl: img.src, imgElement: img, productTitle: productTitle, productUrl: productUrl });
        }
      });
      return results;
    }

    // Generic: find product grids on any e-commerce site.
    // Look for repeated card-like containers with images and prices.
    results = detectGenericProductGrid();
    if (window.location.hostname.includes("amazon.")) {
      addAmazonCarouselProducts(results);
    }
    return results;
  }

  function detectGenericProductGrid() {
    var results = [];
    var isAmazon = window.location.hostname.includes("amazon.");
    var excludeSelector = "nav, header, footer, [role='navigation'], [role='banner']";
    if (!isAmazon) {
      excludeSelector += ', [class*="recommend"], [class*="carousel"], [class*="youMight"]';
    }
    var excludeEls = document.querySelectorAll(excludeSelector);
    var excludeSet = new Set();
    excludeEls.forEach(function (el) { excludeSet.add(el); });

    // Find all links that point to product URLs
    var productPatterns = [/\/product/i, /\/dp\//i, /\/p\//i, /\/item\//i, /\/prd\//i, /\/shop\//i, /\/products\//i];
    var seen = new Set();

    var links = document.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.href || "";
      if (!href || seen.has(href)) continue;

      var isProduct = productPatterns.some(function (p) { return p.test(href); });
      if (!isProduct) continue;

      var img = link.querySelector("img");
      if (!img || !img.src) continue;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (w < 80 || h < 80) continue;

      // Skip if inside excluded sections
      var inExcl = false;
      excludeSet.forEach(function (ex) { if (ex.contains(img)) inExcl = true; });
      if (inExcl) continue;

      // Use the link or its parent as the card container
      var card = link.closest("article, li, [class*='product'], [class*='Product'], [class*='card'], [class*='Card']") || link;
      if (seen.has(card)) continue;
      seen.add(href);
      seen.add(card);

      var titleEl = card.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="Title"], [class*="Name"]');
      var productTitle = titleEl ? titleEl.textContent.trim() : "";
      if (!productTitle) {
        var linkText = link.textContent.trim();
        if (linkText.length > 3 && linkText.length < 200) productTitle = linkText;
      }
      results.push({ element: card, imageUrl: img.src, imgElement: img, productTitle: productTitle, productUrl: href });
    }

    return results;
  }

  function addAmazonCarouselProducts(results) {
    var seenElements = new Set();
    results.forEach(function (r) { seenElements.add(r.element); });

    var carouselImgs = document.querySelectorAll(
      '.a-carousel-card a[href*="/dp/"] img, ' +
      '[class*="a-carousel"] a[href*="/dp/"] img'
    );
    carouselImgs.forEach(function (img) {
      if (!img || !img.src) return;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (w < 60 || h < 60) return;

      var link = img.closest('a[href*="/dp/"]');
      if (!link) return;
      var card = img.closest(".a-carousel-card") || link;
      if (seenElements.has(card)) return;
      seenElements.add(card);

      var hiRes = img.src.replace(/\._[A-Z0-9_,]+_\./, "._AC_SX400_.");
      var title = img.alt || "";
      results.push({
        element: card,
        imageUrl: hiRes,
        imgElement: img,
        productTitle: title,
        productUrl: link.href,
      });
    });
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

  function analyzeAndBadge(imgElement, imageUrl, userSeason, palettes, productTitle) {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, function (response) {
      if (!response || !response.dataUrl) return;
      var tempImg = new Image();
      tempImg.onload = function () {
        try {
          var productType = productTitle ? ColorAnalysis.classifyProductType(productTitle) : "unknown";
          var colors = ColorAnalysis.extractDominantColors(tempImg, 5, undefined, { productType: productType });
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

  function enqueueAnalysis(imgElement, imageUrl, userSeason, palettes, productTitle, productUrl) {
    if (activeCount < MAX_CONCURRENT) {
      activeCount++;
      analyzeAndBadgeThrottled(imgElement, imageUrl, userSeason, palettes, productTitle, productUrl);
    } else {
      queue.push({ imgElement: imgElement, imageUrl: imageUrl, userSeason: userSeason, palettes: palettes, productTitle: productTitle || "", productUrl: productUrl || "" });
    }
  }

  function analyzeAndBadgeThrottled(imgElement, imageUrl, userSeason, palettes, productTitle, productUrl) {
    var cacheKey = productUrl ? normalizeProductUrl(productUrl) : null;

    if (cacheKey) {
      chrome.storage.local.get(["plpSeasonCache"], function (data) {
        var cache = data.plpSeasonCache || {};
        var cached = cache[cacheKey];
        if (cached && cached.v === CACHE_VERSION && Date.now() - cached.ts < 86400000 && cached.ranking && cached.ranking.length > 0) {
          var cachedConf = ColorAnalysis.classifyConfidence(cached.colors || [], cached.ranking);
          if (!cachedConf.display.suppress && cachedConf.display.label) {
            injectBadge(imgElement, cachedConf.display.label, userSeason);
          }
          onAnalysisDone();
          return;
        }
        performAnalysis(imgElement, imageUrl, userSeason, palettes, productTitle, cacheKey);
      });
    } else {
      performAnalysis(imgElement, imageUrl, userSeason, palettes, productTitle, null);
    }
  }

  function performAnalysis(imgElement, imageUrl, userSeason, palettes, productTitle, cacheKey) {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, function (response) {
      if (!response || !response.dataUrl) {
        onAnalysisDone();
        return;
      }
      var tempImg = new Image();
      tempImg.onload = function () {
        try {
          var productType = productTitle ? ColorAnalysis.classifyProductType(productTitle) : "unknown";
          var colors = ColorAnalysis.extractDominantColors(tempImg, 5, undefined, { productType: productType });
          var ranking = ColorAnalysis.rankSeasons(colors, palettes);
          if (ranking.length > 0) {
            var confidence = ColorAnalysis.classifyConfidence(colors, ranking);
            if (ColorAnalysis.BG_DEBUG) {
              console.log("[CSS bg-result]",
                ranking[0][0], "| confidence:", confidence.state,
                "| bg:", (colors._bgColors || []).join(", "),
                "| garment:", colors.map(function (c) { return c.hex; }).join(", "),
                "| title:", (productTitle || "").substring(0, 60));
            }
            if (confidence.display.suppress) {
              onAnalysisDone();
              return;
            }
            if (!confidence.display.label) {
              onAnalysisDone();
              return;
            }
            var badgeLabel = confidence.display.label;
            injectBadge(imgElement, badgeLabel, userSeason);
            if (cacheKey) {
              chrome.storage.local.get(["plpSeasonCache"], function (data) {
                var cache = data.plpSeasonCache || {};
                if (Object.keys(cache).length > 200) cache = {};
                cache[cacheKey] = {
                  v: CACHE_VERSION,
                  ranking: ranking,
                  colors: colors.map(function (c) { return { hex: c.hex, weight: c.weight }; }),
                  ts: Date.now(),
                };
                chrome.storage.local.set({ plpSeasonCache: cache });
              });
            }
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
      analyzeAndBadgeThrottled(next.imgElement, next.imageUrl, next.userSeason, next.palettes, next.productTitle, next.productUrl);
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
              var titleForClassification = info.productTitle || (info.imgElement && info.imgElement.alt) || "";
              var productType = ColorAnalysis.classifyProductType(titleForClassification);
              if (productType === "unknown") return;
              enqueueAnalysis(info.imgElement, info.imageUrl, userSeason, palettes, info.productTitle, info.productUrl);
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

  // Amazon puts a screen-reader-only heading above the real product title, so
  // a visible element is preferred when one is available.
  function isVisibleTitle(el) {
    if (!el.offsetParent) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Ordered most specific first. A generic "h1" must come last: querySelector
  // returns the first match in document order, not the most relevant one, so
  // leading with it picks up whatever heading a page happens to render first.
  var TITLE_SELECTORS = [
    "#productTitle",
    '[class*="product-title"]',
    '[class*="ProductTitle"]',
    '[class*="product-name"]',
    '[class*="ProductName"]',
    "#title span",
    "h1",
  ];

  function detectProductTitle() {
    var i, j, els, text;
    var fallback = "";

    for (i = 0; i < TITLE_SELECTORS.length; i++) {
      els = document.querySelectorAll(TITLE_SELECTORS[i]);
      for (j = 0; j < els.length; j++) {
        text = els[j].textContent.trim();
        if (text.length <= 2) continue;
        if (isVisibleTitle(els[j])) return text;
        if (!fallback) fallback = text;
      }
    }

    var og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.trim();

    // Nothing visible matched — better a hidden title than none at all.
    return fallback;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "GET_PRODUCT_IMAGE") {
      var imageUrl = detectProductImage();
      var allImageUrls = detectAllProductImages();
      var productTitle = detectProductTitle();
      var cacheKey = normalizeProductUrl(window.location.href);
      chrome.storage.local.get(["plpSeasonCache"], function (data) {
        var cache = data.plpSeasonCache || {};
        var cached = cache[cacheKey] || null;
        if (cached && (cached.v !== CACHE_VERSION || Date.now() - cached.ts > 86400000)) cached = null;
        sendResponse({
          imageUrl: imageUrl,
          allImageUrls: allImageUrls,
          productTitle: productTitle,
          cachedResult: cached,
        });
      });
      return true;
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
