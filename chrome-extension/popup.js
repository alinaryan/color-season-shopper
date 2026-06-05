(function () {
  "use strict";

  var palettes = null;
  var userSeason = null;

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
            fetchAndAnalyze(response.imageUrl);
          });
        }
      );
    });
  }

  function fetchAndAnalyze(imageUrl) {
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

        var colors = ColorAnalysis.extractDominantColors(img, 5);
        if (!colors || colors.length === 0) {
          showError("Could not extract colors from this image. Try a different product.");
          return;
        }

        var ranking = ColorAnalysis.rankSeasons(colors, palettes);
        if (!ranking || ranking.length === 0) {
          showError("Could not determine a season match.");
          return;
        }

        renderResults(img.src, colors, ranking);
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

  function renderResults(imageSrc, colors, ranking) {
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

    var best = ranking[0];
    document.getElementById("best-season").textContent = best[0];
    document.getElementById("best-score").textContent = "ΔE " + best[1].toFixed(1);

    // User match indicator
    var indicator = document.getElementById("user-match-indicator");
    if (userSeason) {
      indicator.classList.remove("hidden", "is-match", "not-match");
      if (best[0] === userSeason) {
        indicator.classList.add("is-match");
        indicator.textContent = "This is in your season!";
      } else {
        indicator.classList.add("not-match");
        indicator.textContent = "Your season is " + userSeason;
      }
    } else {
      indicator.classList.add("hidden");
    }

    // Also works for
    var alsoContainer = document.getElementById("also-works");
    var alsoList = document.getElementById("also-list");
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

    // All seasons
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

  // ---- Quiz ----

  function setupQuiz() {
    var radios = document.querySelectorAll('#season-quiz input[type="radio"]');
    var submitBtn = document.getElementById("quiz-submit");

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
      chrome.storage.local.set({ userSeason: name }, function () {
        userSeason = name;
        updateSeasonTab();
        // Re-render analysis results if visible
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
    });

    document.getElementById("retake-btn").addEventListener("click", function () {
      document.getElementById("season-saved").classList.add("hidden");
      document.getElementById("season-quiz").classList.remove("hidden");
      document.getElementById("quiz-result").classList.add("hidden");
      // Reset radios
      radios.forEach(function (r) { r.checked = false; });
      submitBtn.disabled = true;
    });
  }

  function showQuizResult(season) {
    var resultDiv = document.getElementById("quiz-result");
    resultDiv.classList.remove("hidden");
    document.getElementById("quiz-result-name").textContent = season;

    var paletteContainer = document.getElementById("quiz-result-palette");
    renderPaletteChips(paletteContainer, season);
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
