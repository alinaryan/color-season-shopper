(function () {
  "use strict";

  var palettes = null;
  var userSeason = null;
  var CACHE_VERSION = 8;

  // ---- Init ----

  document.addEventListener("DOMContentLoaded", function () {
    loadPalettes();
    loadUserSeason();
    setupTabs();
    setupQuiz();
    setupRetry();
    setupPinHint();
    startAnalysis();
  });

  function loadPalettes() {
    fetch("palettes.json")
      .then(function (r) { return r.json(); })
      .then(function (data) { palettes = data; });
  }

  function loadUserSeason() {
    chrome.storage.local.get(["userSeason"], function (data) {
      userSeason = data.userSeason || null;
      updateSeasonTab();
    });
  }

  // ---- Tabs ----

  function setupTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        document.querySelectorAll(".tab-content").forEach(function (c) {
          c.classList.remove("active");
        });
        document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
      });
    });
  }

  // ---- Pin hint ----

  function setupPinHint() {
    chrome.storage.local.get(["pinHintDismissed"], function (data) {
      if (!data.pinHintDismissed) {
        document.getElementById("pin-hint").classList.remove("hidden");
      }
    });
    document.getElementById("pin-dismiss").addEventListener("click", function () {
      document.getElementById("pin-hint").classList.add("hidden");
      chrome.storage.local.set({ pinHintDismissed: true });
    });
  }

  function normalizeUrl(url) {
    try {
      var u = new URL(url);
      return u.origin + u.pathname;
    } catch (e) {
      return url;
    }
  }

  // ---- Analysis ----

  function setupRetry() {
    document.getElementById("retry-btn").addEventListener("click", startAnalysis);
  }

  function startAnalysis() {
    showState("loading");

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return showError("No active tab found.");
      var tab = tabs[0];

      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: ["color-analysis.js", "content.js"],
        },
        function () {
          if (chrome.runtime.lastError) {
            showError("Cannot analyze this page. Try a product page on Amazon or Nordstrom.");
            return;
          }
          chrome.tabs.sendMessage(tab.id, { type: "GET_PRODUCT_IMAGE" }, function (response) {
            if (chrome.runtime.lastError || !response || !response.imageUrl) {
              showError("No product image found on this page. Try a product detail page.");
              return;
            }
            if (response.cachedResult && response.cachedResult.v === CACHE_VERSION && !ColorAnalysis.BG_DEBUG) {
              fetchImageAndRenderCached(response.imageUrl, response.cachedResult);
              return;
            }
            fetchAndAnalyze(response.imageUrl, response.productTitle, tab.url);
          });
        }
      );
    });
  }

  function fetchImageAndRenderCached(imageUrl, cached) {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, function (response) {
      var imgSrc = (response && response.dataUrl) ? response.dataUrl : "";
      var confidence = ColorAnalysis.classifyConfidence(cached.colors, cached.ranking);
      renderResults(imgSrc, cached.colors, cached.ranking, confidence);
    });
  }

  function fetchAndAnalyze(imageUrl, productTitle, tabUrl) {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: imageUrl }, function (response) {
      if (chrome.runtime.lastError || !response || !response.dataUrl) {
        showError("Could not load the product image.");
        return;
      }

      var img = new Image();
      img.onload = function () {
        if (!palettes) {
          showError("Palettes not loaded yet. Please try again.");
          return;
        }

        var productType = productTitle ? ColorAnalysis.classifyProductType(productTitle) : "unknown";
        var colors = ColorAnalysis.extractDominantColors(img, 5, undefined, { productType: productType });
        if (!colors || colors.length === 0) {
          showError("Could not extract colors from this image. Try a different product.");
          return;
        }

        var ranking = ColorAnalysis.rankSeasons(colors, palettes);
        if (!ranking || ranking.length === 0) {
          showError("Could not determine a season match.");
          return;
        }

        var confidence = ColorAnalysis.classifyConfidence(colors, ranking);
        renderResults(img.src, colors, ranking, confidence);
        showDebugPanel(productTitle, productType, colors, ranking, imageUrl, img, confidence);

        if (tabUrl) {
          var cacheKey = normalizeUrl(tabUrl);
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
      };
      img.onerror = function () {
        showError("Failed to decode the product image.");
      };
      img.src = response.dataUrl;
    });
  }

  // ---- Rendering ----

  function showState(state) {
    ["analyze-loading", "analyze-empty", "analyze-error", "analyze-results"].forEach(function (id) {
      document.getElementById(id).classList.add("hidden");
    });
    if (state === "loading") document.getElementById("analyze-loading").classList.remove("hidden");
    if (state === "empty") document.getElementById("analyze-empty").classList.remove("hidden");
    if (state === "error") document.getElementById("analyze-error").classList.remove("hidden");
    if (state === "results") document.getElementById("analyze-results").classList.remove("hidden");
  }

  function showError(msg) {
    document.getElementById("error-message").textContent = msg;
    showState("error");
  }

  function renderResults(imageSrc, colors, ranking, confidence) {
    showState("results");

    document.getElementById("product-thumb").src = imageSrc;

    var chipsContainer = document.getElementById("color-chips");
    chipsContainer.innerHTML = "";
    colors.forEach(function (c) {
      var hex = typeof c === "string" ? c : c.hex;
      var chip = document.createElement("div");
      chip.className = "color-chip";
      chip.style.backgroundColor = hex;
      chip.setAttribute("data-hex", hex);
      chip.title = hex;
      chipsContainer.appendChild(chip);
    });

    var seasonCard = document.getElementById("season-result");
    var bestLabel = document.querySelector(".best-match .label");
    var bestSeason = document.getElementById("best-season");
    var bestScore = document.getElementById("best-score");
    var indicator = document.getElementById("user-match-indicator");
    var alsoContainer = document.getElementById("also-works");
    var alsoList = document.getElementById("also-list");
    var disp = confidence.display;

    if (!disp.match) {
      // States (c) and (d) — not a match
      bestLabel.textContent = "";
      bestSeason.textContent = disp.sublabel || disp.label;
      bestScore.textContent = confidence.state === "no-match" ? "ΔE " + confidence.bestDE.toFixed(1) : "";
      seasonCard.classList.add("abstain");
      alsoContainer.classList.add("hidden");

      if (confidence.state === "pattern" && userSeason && palettes && palettes[userSeason]) {
        var patternResult = ColorAnalysis.checkPatternForSeason(colors, palettes[userSeason]);
        if (patternResult.matchCount >= ColorAnalysis.PATTERN_MATCH_COUNT) {
          indicator.classList.remove("hidden", "is-match", "not-match");
          indicator.classList.add("is-match");
          indicator.textContent = "Has colors that work for you";
        } else {
          indicator.classList.remove("hidden", "is-match", "not-match");
          indicator.classList.add("not-match");
          indicator.textContent = "Leans away from your colors";
        }
        // Highlight which detected color chips matched the user's palette
        var chips = chipsContainer.querySelectorAll(".color-chip");
        for (var ci = 0; ci < chips.length; ci++) {
          var chipHex = chips[ci].getAttribute("data-hex");
          if (patternResult.matchedHexes.indexOf(chipHex) >= 0) {
            chips[ci].style.outline = "2px solid #16a34a";
            chips[ci].style.outlineOffset = "2px";
          }
        }
      } else {
        indicator.classList.add("hidden");
      }

    } else if (confidence.state === "siblings") {
      // State (b) — match, multiple siblings
      bestLabel.textContent = "Works for";
      bestSeason.textContent = disp.label;
      bestScore.textContent = "ΔE " + confidence.bestDE.toFixed(1);
      seasonCard.classList.remove("abstain");

      if (userSeason) {
        indicator.classList.remove("hidden", "is-match", "not-match");
        if (confidence.seasons.indexOf(userSeason) >= 0) {
          indicator.classList.add("is-match");
          indicator.textContent = "This is in your season!";
        } else {
          indicator.classList.add("not-match");
          indicator.textContent = "Your season is " + userSeason;
        }
      } else {
        indicator.classList.add("hidden");
      }

      // Show non-best siblings in also-works
      if (confidence.seasons.length > 1) {
        alsoContainer.classList.remove("hidden");
        alsoList.innerHTML = "";
        for (var si = 1; si < confidence.seasons.length; si++) {
          var span = document.createElement("span");
          span.className = "also-item";
          span.textContent = confidence.seasons[si] + " (ΔE " + confidence.scores[si].toFixed(1) + ")";
          alsoList.appendChild(span);
        }
      } else {
        alsoContainer.classList.add("hidden");
      }

    } else {
      // State (a) — confident single match
      bestLabel.textContent = "Best match";
      bestSeason.textContent = disp.label;
      bestScore.textContent = "ΔE " + confidence.bestDE.toFixed(1);
      seasonCard.classList.remove("abstain");

      if (userSeason) {
        indicator.classList.remove("hidden", "is-match", "not-match");
        if (confidence.bestSeason === userSeason) {
          indicator.classList.add("is-match");
          indicator.textContent = "This is in your season!";
        } else {
          indicator.classList.add("not-match");
          indicator.textContent = "Your season is " + userSeason;
        }
      } else {
        indicator.classList.add("hidden");
      }

      if (ranking.length > 1) {
        alsoContainer.classList.remove("hidden");
        alsoList.innerHTML = "";
        var runners = ranking.slice(1, 3);
        runners.forEach(function (entry) {
          var span = document.createElement("span");
          span.className = "also-item";
          span.textContent = entry[0] + " (ΔE " + entry[1].toFixed(1) + ")";
          alsoList.appendChild(span);
        });
      } else {
        alsoContainer.classList.add("hidden");
      }
    }

    // All seasons (always shown)
    var allContainer = document.getElementById("all-seasons");
    allContainer.innerHTML = "";
    ranking.forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "all-season-row";
      row.innerHTML =
        '<span class="name">' + entry[0] + "</span>" +
        '<span class="de-score">ΔE ' + entry[1].toFixed(1) + "</span>";
      allContainer.appendChild(row);
    });
  }

  function showDebugPanel(productTitle, productType, colors, ranking, imageUrl, imgEl, confidence) {
    var panel = document.getElementById("debug-panel");
    var content = document.getElementById("debug-content");
    if (!panel || !content) return;

    var bgColors = colors._bgColors || [];
    var whiteBg = imgEl ? ColorAnalysis.isWhiteBackground(imgEl, 200) : "n/a";

    var lines = [];
    if (imageUrl) {
      var shortUrl = imageUrl.length > 80 ? imageUrl.substring(0, 80) + "..." : imageUrl;
      lines.push("image: " + shortUrl);
    }
    lines.push("title: " + (productTitle || "(none)").substring(0, 80));
    lines.push("type: " + productType);
    lines.push("whiteBg: " + whiteBg + (whiteBg ? " (border detection skipped)" : " (border detection ran)"));

    if (bgColors.length > 0) {
      var bgSwatches = bgColors.map(function (hex) {
        return '<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:' + hex + ';vertical-align:middle;margin:0 2px;border:1px solid #444;"></span>' + hex;
      }).join("  ");
      lines.push("border bg: " + bgSwatches);
    } else {
      lines.push("border bg: (none — white bg or no colored border detected)");
    }

    lines.push("threshold: ΔE " + (ColorAnalysis.BG_REJECT_DE_THRESHOLD || "n/a"));
    lines.push("sampling tier: " + (colors._tier || "?"));

    var garmentSwatches = colors.map(function (c) {
      var hex = typeof c === "string" ? c : c.hex;
      var w = typeof c === "string" ? "" : " (" + (c.weight * 100).toFixed(0) + "%)";
      return '<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:' + hex + ';vertical-align:middle;margin:0 2px;border:1px solid #444;"></span>' + hex + w;
    }).join("  ");
    lines.push("garment: " + garmentSwatches);

    if (confidence) {
      var confStr = confidence.state;
      if (confidence.state === "siblings") confStr += " (" + confidence.seasons.join(", ") + ")";
      if (confidence.state === "pattern") confStr += " (maxPairΔE: " + (confidence.maxPairDE || 0).toFixed(1) + ")";
      if (confidence.state === "no-match") confStr += " (bestΔE: " + (confidence.bestDE || 0).toFixed(1) + ")";
      confStr += " | display: " + (confidence.display.match ? "match" : "no-match");
      if (confidence.display.suppress) confStr += " [suppressed]";
      lines.push("confidence: " + confStr);
    }

    content.innerHTML = lines.join("<br>");
    panel.classList.remove("hidden");
  }

  // ---- Quiz ----

  var ALL_SEASONS = [
    "Light Spring", "True Spring", "Bright Spring",
    "Light Summer", "Cool Summer", "Soft Summer",
    "Soft Autumn", "Warm Autumn", "Deep Autumn",
    "Bright Winter", "Cool Winter", "Deep Winter",
  ];

  function setupQuiz() {
    var radios = document.querySelectorAll('#season-quiz input[type="radio"]');
    var submitBtn = document.getElementById("quiz-submit");

    // -- Toggle between quiz and picker --
    var toggleQuizBtn = document.getElementById("toggle-quiz");
    var togglePickBtn = document.getElementById("toggle-pick");
    var quizQuestions = document.getElementById("quiz-questions");
    var pickerDiv = document.getElementById("season-picker");

    toggleQuizBtn.addEventListener("click", function () {
      toggleQuizBtn.classList.add("active");
      togglePickBtn.classList.remove("active");
      quizQuestions.classList.remove("hidden");
      pickerDiv.classList.add("hidden");
    });

    togglePickBtn.addEventListener("click", function () {
      togglePickBtn.classList.add("active");
      toggleQuizBtn.classList.remove("active");
      pickerDiv.classList.remove("hidden");
      quizQuestions.classList.add("hidden");
    });

    // -- Build season picker list --
    var pickerList = document.getElementById("season-picker-list");
    var pickerSaveBtn = document.getElementById("picker-save-btn");
    var pickedSeason = null;

    function waitForPalettes(cb) {
      if (palettes) return cb();
      setTimeout(function () { waitForPalettes(cb); }, 100);
    }

    waitForPalettes(function () {
      ALL_SEASONS.forEach(function (season) {
        var option = document.createElement("div");
        option.className = "season-pick-option";

        var label = document.createElement("span");
        label.textContent = season;
        option.appendChild(label);

        var swatches = document.createElement("span");
        swatches.className = "pick-swatches";
        var colors = (palettes[season] || []).slice(0, 5);
        colors.forEach(function (hex) {
          var swatch = document.createElement("span");
          swatch.className = "pick-swatch";
          swatch.style.backgroundColor = hex;
          swatches.appendChild(swatch);
        });
        option.appendChild(swatches);

        option.addEventListener("click", function () {
          pickerList.querySelectorAll(".season-pick-option").forEach(function (o) {
            o.classList.remove("selected");
          });
          option.classList.add("selected");
          pickedSeason = season;
          pickerSaveBtn.disabled = false;
        });

        pickerList.appendChild(option);
      });
    });

    pickerSaveBtn.addEventListener("click", function () {
      if (!pickedSeason) return;
      saveSeason(pickedSeason);
    });

    // -- Quiz radios --
    radios.forEach(function (radio) {
      radio.addEventListener("change", function () {
        var answered = new Set();
        radios.forEach(function (r) {
          if (r.checked) answered.add(r.name);
        });
        submitBtn.disabled = answered.size < 5;
      });
    });

    submitBtn.addEventListener("click", function () {
      var answers = {};
      radios.forEach(function (r) {
        if (r.checked) answers[r.name] = r.value;
      });
      if (!answers.q1 || !answers.q2 || !answers.q3 || !answers.q4 || !answers.q5) return;

      var season = ColorAnalysis.determineSeason(answers);
      showQuizResult(season);
    });

    document.getElementById("save-season-btn").addEventListener("click", function () {
      var name = document.getElementById("quiz-result-name").textContent;
      saveSeason(name);
    });

    document.getElementById("retake-btn").addEventListener("click", function () {
      document.getElementById("season-saved").classList.add("hidden");
      document.getElementById("season-quiz").classList.remove("hidden");
      document.getElementById("quiz-result").classList.add("hidden");
      // Reset to quiz view
      toggleQuizBtn.classList.add("active");
      togglePickBtn.classList.remove("active");
      quizQuestions.classList.remove("hidden");
      pickerDiv.classList.add("hidden");
      radios.forEach(function (r) { r.checked = false; });
      submitBtn.disabled = true;
      pickerList.querySelectorAll(".season-pick-option").forEach(function (o) {
        o.classList.remove("selected");
      });
      pickerSaveBtn.disabled = true;
      pickedSeason = null;
    });
  }

  function saveSeason(name) {
    chrome.storage.local.set({ userSeason: name }, function () {
      userSeason = name;
      updateSeasonTab();
      var indicator = document.getElementById("user-match-indicator");
      var bestEl = document.getElementById("best-season");
      if (bestEl.textContent) {
        indicator.classList.remove("hidden", "is-match", "not-match");
        if (bestEl.textContent === userSeason) {
          indicator.classList.add("is-match");
          indicator.textContent = "This is in your season!";
        } else {
          indicator.classList.add("not-match");
          indicator.textContent = "Your season is " + userSeason;
        }
      }
    });
  }

  function showQuizResult(season) {
    var resultDiv = document.getElementById("quiz-result");
    resultDiv.classList.remove("hidden");
    document.getElementById("quiz-result-name").textContent = season;

    var paletteContainer = document.getElementById("quiz-result-palette");
    renderPaletteChips(paletteContainer, season);

    resultDiv.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updateSeasonTab() {
    var savedDiv = document.getElementById("season-saved");
    var quizDiv = document.getElementById("season-quiz");

    if (userSeason) {
      savedDiv.classList.remove("hidden");
      quizDiv.classList.add("hidden");
      document.getElementById("saved-season-name").textContent = userSeason;
      var paletteContainer = document.getElementById("saved-palette");
      renderPaletteChips(paletteContainer, userSeason);
    } else {
      savedDiv.classList.add("hidden");
      quizDiv.classList.remove("hidden");
    }
  }

  function renderPaletteChips(container, season) {
    container.innerHTML = "";
    if (!palettes || !palettes[season]) return;
    palettes[season].forEach(function (hex) {
      var chip = document.createElement("div");
      chip.className = "color-chip color-chip-small";
      chip.style.backgroundColor = hex;
      chip.title = hex;
      container.appendChild(chip);
    });
  }
})();
