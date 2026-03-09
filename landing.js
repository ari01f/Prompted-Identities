(function () {
  "use strict";

  /* ============================================================
   *  CONSTANTS
   * ============================================================ */
  var FRAME_INTERVAL = 60;       // ms between frames (~16 fps flicker)
  var PRELOAD_MIN = 20;          // start animation after this many landing imgs ready
  var SAMPLE_COUNT = 200;        // landing canvas image subset
  var FALLBACK_TIMEOUT = 12000;  // hard max wait before leaving (ms)
  var LAION_PRELOAD_COUNT = 150; // first N LAION images to warm

  var canvas = document.getElementById("landingCanvas");
  var ctx = canvas.getContext("2d");
  var overlay = document.getElementById("landingOverlay");
  var statusEl = document.querySelector(".landing-status");

  var images = [];     // loaded Image objects (landing canvas)
  var frameIdx = 0;
  var animationId = null;
  var leaving = false;
  var animationStarted = false;

  /* ============================================================
   *  SHARED IMAGE CACHE  (populated here, consumed by about.js)
   * ============================================================ */
  if (!window.__imageCache) window.__imageCache = {};
  var imageCache = window.__imageCache;

  /** Cache-aware preload.  Stores Promise<HTMLImageElement> in shared cache. */
  function cacheImage(src) {
    if (imageCache[src]) return imageCache[src];
    var p = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        if (img.decode) {
          img.decode().then(function () { resolve(img); }, function () { resolve(img); });
        } else {
          resolve(img);
        }
      };
      img.onerror = function () { reject(new Error(src)); };
      img.src = src;
    });
    imageCache[src] = p;
    return p;
  }

  /* ============================================================
   *  BOOT — canvas animation + about preload in parallel
   * ============================================================ */
  var aboutPreloadDone = false;

  // 1) Landing canvas animation
  fetch("landing-data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("landing-data.json: " + r.status);
      return r.json();
    })
    .then(function (paths) {
      var sampled = shuffle(paths).slice(0, SAMPLE_COUNT);
      preloadLandingImages(sampled);
    })
    .catch(function (e) { console.error("[landing] canvas data error:", e); });

  // 2) About asset preload pipeline
  setStatus("loading about assets\u2026");
  var preloadPromise = preloadAboutAssets()
    .then(function () { aboutPreloadDone = true; })
    .catch(function (e) {
      console.warn("[landing] preload incomplete:", e);
      aboutPreloadDone = true;
    });

  // 3) Fallback timeout — never stuck forever
  var fallbackId = setTimeout(function () {
    leave();
  }, FALLBACK_TIMEOUT);

  // When preload finishes, leave if animation already started
  preloadPromise.then(function () {
    setStatus("ready");
    if (animationStarted) {
      setTimeout(leave, 300);
    }
  });

  /* ============================================================
   *  LANDING IMAGE PRELOAD (canvas animation)
   * ============================================================ */
  function preloadLandingImages(paths) {
    var loaded = 0;
    var started = false;

    paths.forEach(function (src) {
      var img = new Image();
      img.onload = function () {
        images.push(img);
        loaded++;
        if (!started && loaded >= PRELOAD_MIN) {
          started = true;
          startAnimation();
        }
      };
      img.onerror = function () { /* skip broken */ };
      img.src = src;
    });
  }

  /* ============================================================
   *  CANVAS ANIMATION
   * ============================================================ */
  function startAnimation() {
    animationStarted = true;
    var first = images[0];
    canvas.width = first.naturalWidth;
    canvas.height = first.naturalHeight;

    function tick() {
      if (images.length === 0) return;
      frameIdx = (frameIdx + 1) % images.length;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(images[frameIdx], 0, 0, canvas.width, canvas.height);
    }

    animationId = setInterval(tick, FRAME_INTERVAL);
    tick();

    if (aboutPreloadDone) {
      setTimeout(leave, 300);
    }
  }

  /* ============================================================
   *  ABOUT ASSET PRELOAD PIPELINE
   *  Fetches JSON + CSV, then warms browser cache + shared
   *  imageCache for prompt images and first LAION subset.
   * ============================================================ */
  function preloadAboutAssets() {
    return Promise.all([
      fetch("js/about-data.json").then(function (r) {
        if (!r.ok) throw new Error("about-data.json: " + r.status);
        return r.json();
      }),
      fetch("about/laionb/laion_datamerge.csv").then(function (r) {
        if (!r.ok) throw new Error("laion CSV: " + r.status);
        return r.text();
      })
    ]).then(function (results) {
      var aboutData = results[0];
      var laionCsvText = results[1];

      // Extract prompt image paths
      var promptImages = [];
      aboutData.steps.forEach(function (step) {
        if (step.images && step.images.length > 0) {
          promptImages = promptImages.concat(step.images);
        }
      });

      // Parse LAION CSV for first N image paths
      var laionPaths = parseLaionPaths(laionCsvText, LAION_PRELOAD_COUNT);

      // Preload prompt images (critical), then LAION subset
      setStatus("warming prompt images\u2026");
      return settleAll(promptImages.map(cacheImage)).then(function () {
        setStatus("warming LAION cache\u2026");
        return settleAll(laionPaths.map(cacheImage));
      });
    });
  }

  /** Like Promise.all but never rejects — waits for all to settle. */
  function settleAll(promises) {
    return Promise.all(promises.map(function (p) {
      return p.then(function () {}, function () {});
    }));
  }

  /* --- Parse LAION CSV and return first N image source paths --- */
  function parseLaionPaths(text, count) {
    var lines = text.split("\n");
    var paths = [];
    for (var i = 1; i < lines.length && paths.length < count; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var firstComma = line.indexOf(",");
      var secondComma = line.indexOf(",", firstComma + 1);
      if (secondComma === -1) continue;
      var filename = line.substring(firstComma + 1, secondComma);
      paths.push("about/laionb/" + filename);
    }
    return paths;
  }

  /* ============================================================
   *  FADE OUT & NAVIGATE
   * ============================================================ */
  function leave() {
    if (leaving) return;
    leaving = true;
    clearTimeout(fallbackId);

    overlay.classList.add("is-leaving");
    overlay.addEventListener("transitionend", function () {
      clearInterval(animationId);
      window.location.href = "about.html";
    });
  }

  /* ============================================================
   *  STATUS TEXT
   * ============================================================ */
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  /* ============================================================
   *  UTIL
   * ============================================================ */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }
})();
