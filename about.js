(function () {
  "use strict";

  /* ============================================================
   *  CONSTANTS & STATE
   * ============================================================ */
  var DEFAULT_COLS = 14;
  var ZOOMOUT_TARGET_COLS = 48;
  var ZOOMOUT_DURATION = 1600;   // ms
  var FILL_PER_FRAME = 28;       // cells filled per rAF tick (laion zoom-out only)
  var LAION_STAGGER_MS = 1800;   // stagger window for gradual laion cell appearance
  var PROMPT_STAGGER_MS = 3000;  // total window for staggered prompt appearance
  var PROMPT_CROSSFADE_MS = 3000; // total window for prompt→prompt in-place swap
  var LAION_FADEOUT_STAGGER_MS = 2500; // stagger window for fading out individual LAION cells
  var LAION_FADEOUT_SETTLE_MS = 1000;  // extra wait after last cell fade-out before prompt fill

  var gridState = { cols: DEFAULT_COLS };
  var gridMode = "empty";        // "empty" | "laion" | "laion-zoomout" | "prompt"
  var activationToken = 0;       // incremented on every step change
  var zoomRafId = null;          // requestAnimationFrame handle for zoom
  var fillRafId = null;          // requestAnimationFrame handle for cell-fill queue

  var textEl = document.getElementById("aboutText");
  var promptEl = document.getElementById("aboutPrompt");
  var scrollContainer = document.getElementById("aboutScroll");
  var gridEl = document.getElementById("aboutGrid");

  var cells = [];
  var pendingTimers = [];
  var currentStepId = null;

  var laionPool = [];
  var laionReady = false;
  var laionShuffled = [];
  var laionFilledCount = 0;

  /* ============================================================
   *  SHARED IMAGE CACHE  (also used by landing.js)
   * ============================================================ */
  if (!window.__imageCache) window.__imageCache = {};
  var imageCache = window.__imageCache;

  /**
   * Load an image via shared cache.  Returns a Promise that resolves
   * with the HTMLImageElement or rejects on error.
   * Uses img.decode() when available for off-screen decoding.
   */
  function loadImage(src) {
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
      img.onerror = function () {
        console.warn("[about] image not found:", src);
        delete imageCache[src];
        reject(new Error("Failed to load: " + src));
      };
      img.src = src;
    });
    imageCache[src] = p;
    return p;
  }

  /* ============================================================
   *  DYNAMIC GRID HELPERS
   * ============================================================ */
  function getVisibleCellCount() {
    var cellSize = window.innerWidth / gridState.cols;
    var rows = Math.ceil(window.innerHeight / cellSize) + 1;
    return gridState.cols * rows;
  }

  function setGridCols(cols) {
    gridState.cols = cols;
    gridEl.style.setProperty("--cols", cols);
    var needed = getVisibleCellCount();

    // Remove excess cells so align-content:center doesn't push
    // filled rows out of the viewport after a zoom-out → prompt switch
    while (cells.length > needed) {
      var removed = cells.pop();
      gridEl.removeChild(removed.el);
    }

    while (cells.length < needed) {
      var cell = document.createElement("div");
      cell.className = "about-grid-cell";
      var img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      cell.appendChild(img);
      var cap = document.createElement("span");
      cap.className = "about-grid-caption";
      cell.appendChild(cap);
      gridEl.appendChild(cell);
      cells.push({ el: cell, img: img, caption: cap });
    }
  }

  /* ============================================================
   *  CANCELLATION
   * ============================================================ */
  function cancelZoomAnimation() {
    if (zoomRafId !== null) {
      cancelAnimationFrame(zoomRafId);
      zoomRafId = null;
    }
    gridEl.style.transform = "";
  }

  function cancelFillQueue() {
    if (fillRafId !== null) {
      cancelAnimationFrame(fillRafId);
      fillRafId = null;
    }
  }

  function cancelPending() {
    pendingTimers.forEach(function (id) { clearTimeout(id); });
    pendingTimers = [];
    cancelZoomAnimation();
    cancelFillQueue();
  }

  function stripGridClasses() {
    gridEl.classList.remove("is-zooming-out");
    gridEl.classList.remove("is-transitioning");
    gridEl.classList.remove("is-dense");
    gridEl.style.transform = "";
  }

  /* ============================================================
   *  CELL RESET HELPER
   * ============================================================ */
  function resetCell(img) {
    img.onload = null;
    img.onerror = null;
    img.classList.remove("is-loaded");
    img.removeAttribute("src");
  }

  /* ============================================================
   *  RESET HELPERS (mode-aware)
   * ============================================================ */
  function resetGridForMode(newMode) {
    cancelPending();
    stripGridClasses();

    if (newMode === "laion" || newMode === "laion-zoomout") {
      if (gridMode === "prompt" || gridMode === "empty") {
        setGridCols(DEFAULT_COLS);
        clearGrid();
      }
    } else if (newMode === "prompt") {
      // handled by caller
    } else {
      setGridCols(DEFAULT_COLS);
      clearGrid();
    }

    gridMode = newMode;
  }

  /* ============================================================
   *  BOOT  — with response.ok checks and error logging
   * ============================================================ */
  Promise.all([
    fetch("js/about-data.json").then(function (r) {
      if (!r.ok) throw new Error("about-data.json fetch failed: " + r.status);
      return r.json();
    }),
    fetch("about/laionb/laion_datamerge.csv").then(function (r) {
      if (!r.ok) throw new Error("laion CSV fetch failed: " + r.status);
      return r.text();
    })
  ]).then(function (results) {
    var data = results[0];
    var csvText = results[1];
    parseLaionCSV(csvText);
    init(data.steps);
  }).catch(function (err) {
    console.error("[about] boot failed:", err);
  });

  /* ---- CSV parser ---- */
  function parseLaionCSV(text) {
    var lines = text.split("\n");
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var firstComma = line.indexOf(",");
      var secondComma = line.indexOf(",", firstComma + 1);
      var thirdComma = line.indexOf(",", secondComma + 1);
      if (thirdComma === -1) continue;
      var filename = line.substring(firstComma + 1, secondComma);
      var caption = line.substring(thirdComma + 1);
      if (caption.charAt(0) === '"' && caption.charAt(caption.length - 1) === '"') {
        caption = caption.substring(1, caption.length - 1);
      }
      laionPool.push({ src: "about/laionb/" + filename, caption: caption });
    }
    laionShuffled = shuffleArray(laionPool);
    laionReady = true;
  }

  /* ============================================================
   *  INIT
   * ============================================================ */
  function init(steps) {
    setGridCols(DEFAULT_COLS);

    steps.forEach(function (step, i) {
      var section = document.createElement("div");
      section.className = "about-section";
      section.dataset.index = i;

      // Embed text content directly inside the section
      var card = document.createElement("div");
      card.className = "about-section__card";

      if (step.text) {
        var p = document.createElement("p");
        p.className = "about-section__text";
        p.textContent = step.text;
        card.appendChild(p);
      }
      if (step.prompt) {
        var pr = document.createElement("p");
        pr.className = "about-section__prompt";
        pr.textContent = step.prompt;
        card.appendChild(pr);
      }

      section.appendChild(card);
      scrollContainer.appendChild(section);
    });

    activate(steps[0]);

    var sections = scrollContainer.querySelectorAll(".about-section");
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var idx = Number(entry.target.dataset.index);
          activate(steps[idx]);
        });
      },
      { threshold: 0.5 }
    );
    sections.forEach(function (s) { observer.observe(s); });

    var sentinel = document.createElement("div");
    sentinel.className = "about-section about-section--sentinel";
    sentinel.style.height = "40vh";
    scrollContainer.appendChild(sentinel);

    var sentinelObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { goToIndex(); }
        });
      },
      { threshold: 0.6 }
    );
    sentinelObserver.observe(sentinel);

    /* Debounced resize handler */
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        setGridCols(gridState.cols); // recalculates cell count
        if (gridMode === "laion" || gridMode === "laion-zoomout") {
          fillAllEmptyCellsImmediate();
        }
      }, 200);
    });
  }

  /* ============================================================
   *  TRANSITION TO INDEX
   * ============================================================ */
  var isLeavingAbout = false;

  function goToIndex() {
    if (isLeavingAbout) return;
    isLeavingAbout = true;

    var overlay = document.querySelector(".about-exit-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "about-exit-overlay";
      document.body.appendChild(overlay);
    }
    void overlay.offsetWidth;
    overlay.classList.add("is-active");
    overlay.addEventListener("transitionend", function () {
      window.location.href = "index.html";
    });
  }

  /* ============================================================
   *  STEP ACTIVATION  (central dispatcher)
   * ============================================================ */
  function activate(step) {
    if (step.id === currentStepId) return;
    currentStepId = step.id;

    activationToken++;
    var token = activationToken;

    var prevMode = gridMode;
    cancelPending();

    console.log("[STEP]", step.id, step.type, step.images ? step.images.length + " imgs" : "");

    // Dispatch to mode-specific handler
    if (step.type === "laion") {
      enterLaionMode(step, token, prevMode);
    } else if (step.type === "laion-zoomout") {
      enterLaionZoomoutMode(step, token, prevMode);
    } else if ((step.images && step.images.length > 0) || step.type === "prompt") {
      enterPromptMode(step, token, prevMode);
    } else {
      enterEmptyMode(token);
    }
  }

  /* ============================================================
   *  ENTER: empty / intro
   * ============================================================ */
  function enterEmptyMode(token) {
    console.log("[MODE] entering EMPTY");
    resetGridForMode("empty");
  }

  /* ============================================================
   *  ENTER: laion (normal density steps)
   * ============================================================ */
  function enterLaionMode(step, token, prevMode) {
    if (!laionReady) return;
    console.log("[MODE] entering LAION");

    stripGridClasses();

    if (prevMode !== "laion" || gridState.cols !== DEFAULT_COLS) {
      cancelZoomAnimation();
      setGridCols(DEFAULT_COLS);
      clearGrid();
      gridMode = "laion";
    } else {
      gridMode = "laion";
    }

    var cellCount = getVisibleCellCount();
    var density = (typeof step.laionDensity === "number") ? step.laionDensity : 0;
    var targetCount = Math.round(density * cellCount);
    var showCaptions = !!step.showCaptions;

    if (density === 0) {
      clearGrid();
      hideCaptions();
      laionFilledCount = 0;
      return;
    }

    var toFill = Math.max(0, targetCount - laionFilledCount);
    if (toFill > 0) {
      fillLaionCellsStaggered(toFill, token);
    }

    if (showCaptions) {
      revealCaptionsProgressively(token);
    }
  }

  /* ============================================================
   *  ENTER: laion-zoomout  (smooth rAF animation)
   * ============================================================ */
  function enterLaionZoomoutMode(step, token, prevMode) {
    if (!laionReady) return;
    console.log("[MODE] entering LAION-ZOOMOUT");

    stripGridClasses();
    cancelZoomAnimation();

    gridMode = "laion-zoomout";
    hideCaptions();

    // Dense grid — disable per-image transitions for performance
    gridEl.classList.add("is-dense");

    if (!(prevMode === "laion" && gridState.cols === DEFAULT_COLS)) {
      setGridCols(DEFAULT_COLS);
      clearGrid();
    }

    fillAllEmptyCellsImmediate();

    var tid = setTimeout(function () {
      if (token !== activationToken) return;
      animateGridZoomOut(DEFAULT_COLS, ZOOMOUT_TARGET_COLS, ZOOMOUT_DURATION, token);
    }, 200);
    pendingTimers.push(tid);
  }

  /* --- Smooth zoom-out driven by requestAnimationFrame --- */
  function animateGridZoomOut(fromCols, toCols, duration, token) {
    gridEl.classList.add("is-zooming-out");
    var startTime = performance.now();

    function frame(now) {
      if (token !== activationToken) return;

      var t = Math.min(1, (now - startTime) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var exactCols = fromCols + (toCols - fromCols) * eased;
      var intCols = Math.round(exactCols);

      if (intCols !== gridState.cols) {
        setGridCols(intCols);
        fillAllEmptyCellsImmediate();
      }

      var scale = intCols / exactCols;
      gridEl.style.transform = "scale(" + scale + ")";

      if (t < 1) {
        zoomRafId = requestAnimationFrame(frame);
      } else {
        zoomRafId = null;
        gridEl.style.transform = "";
        setGridCols(toCols);
        fillAllEmptyCellsImmediate();
      }
    }

    zoomRafId = requestAnimationFrame(frame);
  }

  /* --- Fill every visible empty cell immediately (LAION dense/zoom) --- */
  function fillAllEmptyCellsImmediate() {
    var visible = getVisibleCellCount();
    var limit = Math.min(cells.length, visible);
    for (var i = 0; i < limit; i++) {
      if (!cells[i].img.getAttribute("src")) {
        var item = laionShuffled[laionFilledCount % laionShuffled.length];
        assignCellImmediate(i, item.src, item.caption);
        laionFilledCount++;
      }
    }
  }

  /**
   * Assign an image to a cell immediately (no decode wait).
   * Used during zoom-out where speed beats visual smoothness.
   */
  function assignCellImmediate(cellIndex, src, captionText) {
    var c = cells[cellIndex];
    resetCell(c.img);
    c.caption.textContent = captionText || "";
    c.caption.classList.remove("is-visible");
    c.img.classList.add("is-loaded");
    c.img.onerror = function () {
      console.warn("[LAION 404]", src);
      resetCell(c.img);
      return;
    };
    c.img.src = src;
  }

  /* ============================================================
   *  ENTER: prompt mode
   *  — Reuses existing cells, updates src in-place via rAF queue.
   *  — No unnecessary clearGrid(); only resets what's needed.
   * ============================================================ */
  function enterPromptMode(step, token, prevMode) {
    var images = step.images || [];
    var comingFromLaion = (prevMode === "laion" || prevMode === "laion-zoomout");
    var comingFromPrompt = (prevMode === "prompt");

    cancelFillQueue();
    cancelZoomAnimation();

    if (comingFromLaion) {
      // ---- LAION → PROMPT: stagger-fade each LAION cell out, then fill prompt ----
      gridMode = "prompt";

      // Phase 1: stagger-remove is-loaded from each cell over LAION_FADEOUT_STAGGER_MS
      //          CSS opacity transition on each img handles the visual fade
      var indices = shuffledIndices(cells.length);
      for (var k = 0; k < indices.length; k++) {
        (function (ci, delay) {
          var tid = setTimeout(function () {
            if (token !== activationToken) return;
            var c = cells[ci];
            if (c) {
              c.img.onload = null;
              c.img.onerror = null;
              c.img.classList.remove("is-loaded");
            }
          }, delay);
          pendingTimers.push(tid);
        })(indices[k], Math.random() * LAION_FADEOUT_STAGGER_MS);
      }

      // Phase 2: after all fades complete, clear DOM and stagger-fill prompt
      var totalWait = LAION_FADEOUT_STAGGER_MS + LAION_FADEOUT_SETTLE_MS;
      var tid2 = setTimeout(function () {
        if (token !== activationToken) return;
        stripGridClasses();
        setGridCols(DEFAULT_COLS);
        clearGrid();
        hideCaptions();
        if (images.length > 0) {
          fillPromptStaggered(images, token);
        }
      }, totalWait);
      pendingTimers.push(tid2);

    } else if (comingFromPrompt) {
      // ---- PROMPT → PROMPT: in-place crossfade, no grid clear ----
      gridMode = "prompt";
      hideCaptions();
      if (images.length > 0) {
        crossfadePromptCells(images, token);
      }

    } else {
      // ---- Direct entry (e.g. page load on a prompt step) ----
      stripGridClasses();
      setGridCols(DEFAULT_COLS);
      resetCellStates();
      hideCaptions();
      gridMode = "prompt";
      if (images.length > 0) {
        fillPromptStaggered(images, token);
      }
    }
  }

  /* ============================================================
   *  STAGGERED CELL-FILL: LAION  (progressive density steps)
   *  Each new cell gets a random delay for gradual appearance.
   * ============================================================ */
  function fillLaionCellsStaggered(count, token) {
    var emptyCells = [];
    var cellCount = Math.min(cells.length, getVisibleCellCount());
    for (var i = 0; i < cellCount; i++) {
      if (!cells[i].img.getAttribute("src")) {
        emptyCells.push(i);
      }
    }
    var shuffled = shuffleArray(emptyCells);
    var toFill = shuffled.slice(0, count);

    for (var j = 0; j < toFill.length; j++) {
      (function (cellIdx, itemIdx, delay) {
        var tid = setTimeout(function () {
          if (token !== activationToken) return;
          var item = laionShuffled[itemIdx % laionShuffled.length];
          assignCellWithDecode(cellIdx, item.src, item.caption, token);
        }, delay);
        pendingTimers.push(tid);
      })(toFill[j], laionFilledCount + j, Math.random() * LAION_STAGGER_MS);
    }

    laionFilledCount += toFill.length;
  }

  /* ============================================================
   *  STAGGERED CELL-FILL: PROMPT
   *  Each cell gets a random delay so images pop in one-by-one
   *  in a natural, cascading pattern.
   * ============================================================ */
  function fillPromptStaggered(images, token) {
    hideCaptions();
    laionFilledCount = 0;
    var cellCount = getVisibleCellCount();
    var cols = gridState.cols;
    var imageQueue = buildSpacedQueue(images, cellCount, cols);
    var order = shuffledIndices(cellCount);

    for (var i = 0; i < order.length; i++) {
      schedulePromptCell(order[i], imageQueue[order[i]], token);
    }
  }

  /** Schedule a single prompt cell with a random delay */
  function schedulePromptCell(cellIndex, src, token) {
    var delay = Math.random() * PROMPT_STAGGER_MS;
    var tid = setTimeout(function () {
      if (token !== activationToken) return;
      assignCellWithDecode(cellIndex, src, "", token);
    }, delay);
    pendingTimers.push(tid);
  }

  /* ============================================================
   *  IN-PLACE CROSSFADE: PROMPT → PROMPT
   *  Each cell fades out its old image, swaps src, and fades back in
   *  at a random time within PROMPT_CROSSFADE_MS.  The grid is never
   *  cleared, so there’s always something visible.
   * ============================================================ */
  function crossfadePromptCells(images, token) {
    var cellCount = getVisibleCellCount();
    var cols = gridState.cols;
    var imageQueue = buildSpacedQueue(images, cellCount, cols);
    var order = shuffledIndices(cellCount);

    for (var i = 0; i < order.length; i++) {
      scheduleCrossfadeCell(order[i], imageQueue[order[i]], token);
    }
  }

  /** Crossfade a single cell: fade-out → swap src → fade-in */
  function scheduleCrossfadeCell(cellIndex, newSrc, token) {
    var delay = Math.random() * PROMPT_CROSSFADE_MS;
    var tid = setTimeout(function () {
      if (token !== activationToken) return;
      var c = cells[cellIndex];
      if (!c) return;
      var img = c.img;

      // If already showing the correct image, skip
      if (img.getAttribute("src") === newSrc && img.classList.contains("is-loaded")) {
        return;
      }

      // Step 1: fade out current image via CSS transition
      img.onload = null;
      img.onerror = null;
      img.classList.remove("is-loaded");

      // Step 2: after CSS fade-out completes (~700ms), swap and fade in
      var tid2 = setTimeout(function () {
        if (token !== activationToken) return;
        assignCellWithDecode(cellIndex, newSrc, "", token);
      }, 750);
      pendingTimers.push(tid2);
    }, delay);
    pendingTimers.push(tid);
  }

  /* ============================================================
   *  UNIFIED IMAGE ASSIGNMENT (decode-aware, token-guarded)
   *  — Uses shared imageCache for instant display of cached images.
   *  — Uses decode() for smooth off-screen decoding when available.
   *  — On error: logs and skips (no infinite retry loop).
   * ============================================================ */
  function assignCellWithDecode(cellIndex, src, captionText, token) {
    var c = cells[cellIndex];
    var img = c.img;

    // Reset previous state — but skip if cell already shows the correct image
    if (img.getAttribute("src") === src && img.classList.contains("is-loaded")) {
      return; // already correct, don't reset
    }
    resetCell(img);
    if (captionText !== undefined) {
      c.caption.textContent = captionText;
      c.caption.classList.remove("is-visible");
    }

    // Load through shared cache, then assign to DOM element
    loadImage(src).then(function () {
      if (token !== activationToken) return;
      img.onload = function () {
        img.onload = null;
        if (token !== activationToken) return;
        img.classList.add("is-loaded");
      };
      img.onerror = function () {
        resetCell(img);
      };
      img.src = src;
      // If already decoded/cached, onload may fire synchronously
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add("is-loaded");
        img.onload = null;
      }
    }).catch(function () {
      // Image failed to load — leave cell empty, no retry
      if (token !== activationToken) return;
      resetCell(img);
    });
  }

  /* ============================================================
   *  LAION CAPTIONS
   * ============================================================ */
  function revealCaptionsProgressively(token) {
    var ready = [];
    var cellCount = Math.min(cells.length, getVisibleCellCount());
    for (var i = 0; i < cellCount; i++) {
      var c = cells[i];
      if (c.img.getAttribute("src") && c.caption.textContent && !c.caption.classList.contains("is-visible")) {
        ready.push(i);
      }
    }
    var shuffled = shuffleArray(ready);
    var batch = 0;
    var batchSize = 8;
    var delay = 80;

    function nextBatch() {
      if (token !== activationToken) return;
      var start = batch * batchSize;
      if (start >= shuffled.length) return;
      var end = Math.min(start + batchSize, shuffled.length);
      for (var i = start; i < end; i++) {
        cells[shuffled[i]].caption.classList.add("is-visible");
      }
      batch++;
      pendingTimers.push(setTimeout(nextBatch, delay));
    }
    pendingTimers.push(setTimeout(nextBatch, 300));
  }

  function hideCaptions() {
    for (var i = 0; i < cells.length; i++) {
      cells[i].caption.classList.remove("is-visible");
      cells[i].caption.textContent = "";
    }
  }

  /* ============================================================
   *  GRID CLEAR & RESET
   * ============================================================ */
  /** Full clear — removes src and all state from every cell */
  function clearGrid() {
    for (var i = 0; i < cells.length; i++) {
      resetCell(cells[i].img);
      cells[i].caption.classList.remove("is-visible");
      cells[i].caption.textContent = "";
    }
    laionFilledCount = 0;
  }

  /** Light reset — hides images in-place without removing src references.
   *  Cheaper than clearGrid; cells can be reused immediately. */
  function resetCellStates() {
    for (var i = 0; i < cells.length; i++) {
      resetCell(cells[i].img);
    }
    laionFilledCount = 0;
  }

  /* ============================================================
   *  PROMPT QUEUE — spaced image distribution to avoid neighbours
   * ============================================================ */
  function buildSpacedQueue(pool, count, cols) {
    var queue = [];
    while (queue.length < count) {
      queue = queue.concat(shuffleArray(pool));
    }
    queue = queue.slice(0, count);
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < count; i++) {
        if (hasNeighborDuplicate(queue, i, cols)) {
          for (var j = i + 2; j < count; j++) {
            if (queue[i] !== queue[j] && !wouldConflict(queue, j, queue[i], cols) && !wouldConflict(queue, i, queue[j], cols)) {
              var tmp = queue[i];
              queue[i] = queue[j];
              queue[j] = tmp;
              break;
            }
          }
        }
      }
    }
    return queue;
  }

  function hasNeighborDuplicate(q, idx, cols) {
    var v = q[idx];
    if (idx % cols !== 0 && q[idx - 1] === v) return true;
    if (idx % cols !== cols - 1 && q[idx + 1] === v) return true;
    if (idx - cols >= 0 && q[idx - cols] === v) return true;
    if (idx + cols < q.length && q[idx + cols] === v) return true;
    return false;
  }

  function wouldConflict(q, idx, newVal, cols) {
    if (idx % cols !== 0 && q[idx - 1] === newVal) return true;
    if (idx % cols !== cols - 1 && q[idx + 1] === newVal) return true;
    if (idx - cols >= 0 && q[idx - cols] === newVal) return true;
    if (idx + cols < q.length && q[idx + cols] === newVal) return true;
    return false;
  }

  /* ---- util ---- */
  function shuffleArray(arr) {
    var a = arr.slice();
    for (var j = a.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = a[j];
      a[j] = a[k];
      a[k] = tmp;
    }
    return a;
  }

  function shuffledIndices(n) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(i);
    return shuffleArray(arr);
  }
})();