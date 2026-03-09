//                            ,--.
//                ,---,   ,--/  /|               .--.--.
//        ,---.,`--.' |,---,': / '         ,--, /  /    '.
//       /__./||   :  ::   : '/ /        ,'_ /||  :  /`. /
//  ,---.;  ; |:   |  '|   '   ,    .--. |  | :;  |  |--`
// /___/ \  | ||   :  |'   |  /   ,'_ /| :  . ||  :  ;_
// \   ;  \ ' |'   '  ;|   ;  ;   |  ' | |  . . \  \    `.
//  \   \  \: ||   |  |:   '   \  |  | ' |  | |  `----.   \
//   ;   \  ' .'   :  ;|   |    ' :  | | :  ' ;  __ \  \  |
//    \   \   '|   |  ''   : |.  \|  ; ' |  | ' /  /`--'  /
//     \   `  ;'   :  ||   | '_\.':  | : ;  ; |'--'.     /
//      :   \ |;   |.' '   : |    '  :  `--'   \ `--'---'
//       '---" '---'   ;   |,'    :  ,      .-./
//                     '---'       `--`----'
//                ,---,    ,---,.           .---.    ,---,.,-.----.
//        ,---.,`--.' |  ,'  .' |          /. ./|  ,'  .' |\    /  \
//       /__./||   :  :,---.'   |      .--'.  ' ;,---.'   |;   :    \
//  ,---.;  ; |:   |  '|   |   .'     /__./ \ : ||   |   .'|   | .\ :
// /___/ \  | ||   :  |:   :  |-, .--'.  '   \' .:   :  |-,.   : |: |
// \   ;  \ ' |'   '  ;:   |  ;/|/___/ \ |    ' ':   |  ;/||   |  \ :
//  \   \  \: ||   |  ||   :   .';   \  \;      :|   :   .'|   : .  /
//   ;   \  ' .'   :  ;|   |  |-, \   ;  `      ||   |  |-,;   | |  \
//    \   \   '|   |  ''   :  ;/|  .   \    .\  ;'   :  ;/||   | ;\  \
//     \   `  ;'   :  ||   |    \   \   \   ' \ ||   |    \:   ' | \.'
//      :   \ |;   |.' |   :   .'    :   '  |--" |   :   .':   : :-'
//       '---" '---'   |   | ,'       \   \ ;    |   | ,'  |   |.'
//                     `----'          '---"     `----'    `---'

// christopher pietsch
// @chrispiecom
// 2015-2018

utils.welcome();

// Dataset configuration for model switching
const DATASETS = {
  sdxl_base_1: {
    items: "data/sdxl_base_1/data.csv",
    textures: {
      medium: {
        url: "data/sdxl_base_1/sprites/spritesheet.json",
        size: 128
      },
      detail: {
        url: "data/sdxl_base_1/1024/",
        size: 1024,
        extension: ".png"
      }
    },
    umap: "data/sdxl_base_1/umap.csv"
  },
  V15: {
    items: "data/V15/data.csv",
    textures: {
      medium: {
        url: "data/V15/sprites/spritesheet.json",
        size: 128
      },
      detail: {
        url: "data/V15/1024/",
        size: 1024,
        extension: ".jpg"
      }
    },
    umap: "data/V15/umap.csv"
  }
};

let currentDataset = "sdxl_base_1";

// Expose on window for persistent button handler
window.currentDataset = currentDataset;

var data;
var tags;
var canvas;
var search;
var ping;
var timeline;
var config;

if (Modernizr.webgl && !utils.isMobile()) {
  // Create persistent model switch button FIRST (before any D3 operations)
  createPersistentModelSwitch();
  init();
}

/**
 * Switch dataset and reinitialize all components
 */
function switchDataset(nextDataset) {
  console.log("[switchDataset] Called with:", nextDataset, "Current:", currentDataset);
  
  // Return early if already on this dataset
  if (nextDataset === currentDataset) {
    console.log("[switchDataset] Already on this dataset, returning early");
    return;
  }

  // Guard: config must be loaded first
  if (!config || !config.loader) {
    console.error("[switchDataset] Config not yet loaded, please wait");
    return;
  }

  // Get dataset configuration
  const datasetConfig = DATASETS[nextDataset];
  if (!datasetConfig) {
    console.error("[switchDataset] Unknown dataset:", nextDataset);
    return;
  }

  // Update config loader paths
  config.loader.items = datasetConfig.items;
  config.loader.textures = datasetConfig.textures;

  // Update UMAP URL in layouts if it exists
  if (config.loader.layouts) {
    config.loader.layouts.forEach(layout => {
      if (layout.url && layout.url.includes("umap.csv")) {
        layout.url = datasetConfig.umap;
      }
    });
  }

  // Clear the old canvas and filter UI containers FIRST
  d3.select(".viz").remove();
  d3.selectAll(".viz").remove();
  d3.select(".crossfilter").remove();
  d3.selectAll(".crossfilter").remove();
  d3.select(".tagcloud").remove();
  d3.selectAll(".tagcloud").remove();

  // Reset all filters
  tags.reset();

  // Load new dataset
  const makeUrl = utils.makeUrl;
  const baseUrl = config.baseUrl;

  Loader(makeUrl(baseUrl.path, config.loader.items)).finished(function (newData) {
    console.log("[switchDataset] Loaded new dataset:", nextDataset, "Records:", newData.length);

    // Clean the data
    utils.clean(newData, config);

    // Update data references
    data = newData;

    // Reinitialize canvas with new data
    // Note: Pass empty array for timeline data since we don't use a real timeline
    // (same behavior as SDXL which has no config.loader.timeline defined)
    canvas.init(data, [], config);

    // Reinitialize tags (filters) with new data
    tags.init(data, config);

    // Update layouts
    if (config.loader.layouts) {
      initLayouts(config);
    }

    // Load and assign sprites
    const idToItemsMap = new Map();
    data.forEach(d => {
      if (d.sprite) {
        if (!idToItemsMap.has(d.id)) {
          idToItemsMap.set(d.id, []);
        }
        idToItemsMap.get(d.id).push(d);
      }
    });

    LoaderSprites()
      .progress(function (textures) {
        Object.keys(textures).forEach(id => {
          const items = idToItemsMap.get(id);
          if (items) {
            items.forEach(item => {
              item.sprite.texture = textures[id];
            });
          }
        });
        canvas.wakeup();
      })
      .finished(function () {
        canvas.onhashchange();
      })
      .load(makeUrl(baseUrl.path, config.loader.textures.medium.url));

    // Update button states
    d3.selectAll(".model-button").classed("active", function () {
      return d3.select(this).attr("data-model") === nextDataset;
    });

    // Update current dataset reference
    currentDataset = nextDataset;
    window.currentDataset = currentDataset;

    // Sync reactive dataset on sidebar Vue instance
    if (window.detailVue) {
      window.detailVue.dataset = currentDataset;
    }
    
    // Update persistent button state
    updateModelButtonState();
  });
}

// Expose switchDataset on window
window.switchDataset = switchDataset;

/**
 * Create persistent model switch button on document.body
 * This button cannot be removed by D3 re-renders
 */
function createPersistentModelSwitch() {
  // Only create once
  if (document.getElementById('model-switch-host')) {
    return;
  }

  // Create host container directly on body
  var host = document.createElement('div');
  host.id = 'model-switch-host';
  host.style.cssText = 'position: fixed; top: 15px; right: 12px; z-index: 999999; display: flex; align-items: center; gap: 4px;';

  // Create label
  var label = document.createElement('span');
  label.textContent = 'Stable diffusion model:';
  label.style.cssText = 'font-family: GarabosseParagon, serif; font-size: 12px; color: #000; margin-right: 8px; line-height: 1; display: flex; align-items: center;';
  host.appendChild(label);

  // Create SDXL button
  var btnSdxl = document.createElement('button');
  btnSdxl.id = 'model-switch-btn-sdxl';
  btnSdxl.textContent = 'SDXL';
  btnSdxl.setAttribute('data-model', 'sdxl_base_1');
  btnSdxl.style.cssText = 'padding: 6px 12px; background: #000; color: #fff; border: 0.5px solid #000; cursor: pointer; font-size: 12px; font-weight: 600; font-family: GarabosseParagon, serif;';
  btnSdxl.onclick = function() { window.switchDataset('sdxl_base_1'); };

  // Create V15 button
  var btnV15 = document.createElement('button');
  btnV15.id = 'model-switch-btn-v15';
  btnV15.textContent = 'V15';
  btnV15.setAttribute('data-model', 'V15');
  btnV15.style.cssText = 'padding: 6px 12px; background: #fff; color: #000; border: 0.5px solid #000; cursor: pointer; font-size: 12px; font-weight: 600; font-family: GarabosseParagon, serif;';
  btnV15.onclick = function() { window.switchDataset('V15'); };

  host.appendChild(btnSdxl);
  host.appendChild(btnV15);
  document.body.appendChild(host);

  console.log('[createPersistentModelSwitch] Created persistent button on document.body');
}

/**
 * Update model button visual state based on currentDataset
 */
function updateModelButtonState() {
  var btnSdxl = document.getElementById('model-switch-btn-sdxl');
  var btnV15 = document.getElementById('model-switch-btn-v15');
  
  if (btnSdxl && btnV15) {
    if (window.currentDataset === 'sdxl_base_1') {
      btnSdxl.style.background = '#000';
      btnSdxl.style.color = '#fff';
      btnSdxl.style.borderColor = '#000';
      btnV15.style.background = '#fff';
      btnV15.style.color = '#000';
      btnV15.style.borderColor = '#000';
    } else {
      btnSdxl.style.background = '#fff';
      btnSdxl.style.color = '#000';
      btnSdxl.style.borderColor = '#000';
      btnV15.style.background = '#000';
      btnV15.style.color = '#fff';
      btnV15.style.borderColor = '#000';
    }
  }
}

/**
 * Initialize layouts from config
 * Must be defined at top-level to be callable from both init() and switchDataset()
 */
function initLayouts(config) {
  d3.select(".navi").classed("hide", false);

  config.loader.layouts.forEach((d, i) => {
    // legacy fix for time scales
    if (!d.type && !d.url) {
      d.type = "group";
      d.groupKey = "year";
    }
    if (d.type === "group" && i == 0) {
      canvas.setMode(d);
    } else if (d.url) {
      d3.csv(utils.makeUrl(config.baseUrl.path, d.url), function (tsne) {
        canvas.addTsneData(d.title, tsne, d.scale);
        if (i == 0) canvas.setMode(d);
      });
    }
  });

  if (config.loader.layouts.length == 1) {
    d3.select(".navi").classed("hide", true);
  }

  var s = d3.select(".navi").selectAll(".button").data(config.loader.layouts);
  s.enter()
    .append("div")
    .classed("button", true)
    .classed("space", (d) => d.space)
    .each(function(d) {
      // Prepend ellipse icon
      var img = document.createElement("img");
      img.className = "nav-dot";
      img.src = "img/empty_ellipse.svg";
      this.appendChild(img);
      // Add text label (use display-label map if available)
      var span = document.createElement("span");
      span.textContent = typeof uiLabel === "function" ? uiLabel("views", d.title) : d.title;
      this.appendChild(span);
    });

  s.on("click", function (d) { utils.setMode(d.title, interaction=true) });
  d3.selectAll(".navi .button").classed(
    "active",
    (d) => d.title == config.loader.layouts[0].title
  );
  // Update ellipse icons to match initial active state
  updateNavDots();
}

/**
 * Update nav dot icons based on active state
 */
function updateNavDots() {
  d3.selectAll(".navi .button").each(function() {
    var isActive = d3.select(this).classed("active");
    var img = this.querySelector(".nav-dot");
    if (img) {
      img.src = isActive ? "img/Black_ellipse.svg" : "img/empty_ellipse.svg";
    }
  });
}

function init() {
  canvas = Canvas();
  search = Search();
  timeline = Timeline();
  ping = utils.ping();

  var baseUrl = utils.getDataBaseUrl();
  var makeUrl = utils.makeUrl;

  console.log(baseUrl);

  d3.json(baseUrl.config || "data/config.json", function (loadedConfig) {
    // Assign to global config variable so switchDataset can access it
    config = loadedConfig;
    config.baseUrl = baseUrl;
    utils.initConfig(config);

    // Initialize with dataset configuration from DATASETS constant
    const datasetConfig = DATASETS[currentDataset];
    config.loader.items = datasetConfig.items;
    config.loader.textures = datasetConfig.textures;
    
    // Update UMAP URL in layouts if it exists
    if (config.loader.layouts) {
      config.loader.layouts.forEach(layout => {
        if (layout.url && layout.url.includes("umap.csv")) {
          layout.url = datasetConfig.umap;
        }
      });
    }

    Loader(makeUrl(baseUrl.path, config.loader.timeline)).finished(function (timeline) {
      Loader(makeUrl(baseUrl.path, config.loader.items)).finished(function (data) {
        console.log(data);

        utils.clean(data, config);
        
        if(config.filter && config.filter.type === "crossfilter") {
          tags = Crossfilter();
        } else if(config.filter && config.filter.type === "hierarchical") {
          tags = TagsHierarchical();
        } else {
          tags = Tags();
        }
        tags.init(data, config);
        search.init();
        canvas.init(data, timeline, config);

        if (config.loader.layouts) {
          initLayouts(config);
        } else {
          canvas.setMode({
            title: "Time",
            type: "group",
            groupKey: "year"
          })
        }

        const params = new URLSearchParams(window.location.hash.slice(1));
        if (params.get('ui') === '0') deactivateUI();      

        window.onhashchange = function () {
          var hash = window.location.hash.slice(1);
          var params = new URLSearchParams(hash);
          if(params.get('ui') === '0') deactivateUI();
          canvas.onhashchange();
        }
        
		if (params.has("filter")) {
		  var filter = params.get("filter").split(",")
		  tags.setFilterWords(filter)
		}
		
        //setTimeout(function () {
          // canvas.setView("[GS_2000_28_GM,VII_59_777_x]");
          // canvas.setView("['GS_98_2_GM', 'VII_60_527_x', 'SM_2012-0158', 'VII_59_483_x', 'VII_60_411_x', 'VII_60_230_x']");
          //canvas.setView("['GEM_88_4', 'GS_08_5_GM', 'GEM_89_24', 'VII_59_433_x', 'VII_59_749_x', 'VII_60_111_x', 'VII_60_286_x', 'GEM_89_11', 'GS_2000_28_GM', 'VII_59_777_x']")
        //}, 200);

        // debug zoom to image
        // setTimeout(function () {
        //   var idx = 102
        //   canvas.zoomToImage(data[idx], 100)
        // }, 100);

        // Create a lookup map to handle multiple entries with same ID

        const idToItemsMap = new Map();
        data.forEach(d => {
          if (d.sprite) { // Ensure sprite exists
            if (!idToItemsMap.has(d.id)) {
              idToItemsMap.set(d.id, []);
            }
            idToItemsMap.get(d.id).push(d);
          }
        });

        LoaderSprites()
          .progress(function (textures) {      
            Object.keys(textures).forEach(id => {
              const items = idToItemsMap.get(id);
              if (items) {
                items.forEach(item => {
                  item.sprite.texture = textures[id];
                });
              }
            });
            canvas.wakeup();
          })
          .finished(function () {
            canvas.onhashchange();
          })
          .load(makeUrl(baseUrl.path, config.loader.textures.medium.url));
      });
    });
  });

  d3.select(window)
    .on("resize", function () {
      if (canvas !== undefined && tags !== undefined) {
        clearTimeout(window.resizedFinished);
        window.resizedFinished = setTimeout(function () {
          canvas.resize();
          tags.resize();
        }, 250);
      }
    })
    .on("keydown", function (e) {
      if (d3.event.keyCode != 27) return;
      search.reset();
      tags.reset();
      canvas.split();
      window.location.hash = "";
    });

  d3.select(".filterReset").on("click", function () {
    canvas.resetZoom(function () {
      tags.reset();
      //canvas.split();
    })
  });
  d3.select(".filterReset").on("dblclick", function () {
    console.log("dblclick");
    //location.reload();
  });

  d3.select(".slidebutton").on("click", function () {
    var s = !d3.select(".sidebar").classed("sneak");
    d3.select(".sidebar").classed("sneak", s);
  });

  d3.select(".infobutton").on("click", function () {
    var s = !d3.select(".infobar").classed("sneak");
    d3.select(".infobar").classed("sneak", s);
  });

  // Model switch button is now created via createPersistentModelSwitch() before init()
  console.log("[init] Persistent model switch button should already exist");

  // d3.selectAll(".navi .button").on("click", function () {
  //   var that = this;
  //   var mode = d3.select(this).attr("data");
  //   canvas.setMode(mode);
  //   timeline.setDisabled(mode != "time");

  //   d3.selectAll(".navi .button").classed("active", function () {
  //     return that === this;
  //   });
  // });

  function deactivateUI() {
    d3.selectAll(".navi").style("display", "none");
    d3.selectAll(".searchbar").style("display", "none");
    d3.selectAll(".infobar").style("display", "none");
  }
}

utils.setMode = function(title, interaction = false) {
  console.log("setMode", title);
  if(utils.config.loader.layouts === undefined) return;
  var currentMode = canvas.getMode().title;
  if(title === undefined){
    title = utils.config.loader.layouts[0].title;
  }
  if(currentMode === title) return;
  var layout = utils.config.loader.layouts.find((d) => d.title == title);
  canvas.setMode(layout);
  d3.selectAll(".navi .button").classed(
    "active",
    (d) => d.title == title
  );
  updateNavDots();
  updateHash("mode", layout.title, interaction ? ["ids"] : undefined);
}

function updateHash(name, value, clear = undefined) {
  console.log("updateHashtags", name, value);
  var hash = window.location.hash.slice(1);
  if(clear && clear.length === 0) hash = "";
  var params = new URLSearchParams(hash);
  if(clear && clear.length > 0) {
    clear.forEach((d) => params.delete(d));
  }

  params.set(name, value);
  // if value is am array and is empty remove the filter
  if(typeof value === "object" && value.length === 0) params.delete(name);
  if(typeof value === "string" && value === "") params.delete(name);
  
  var newHash = params.toString().replaceAll("%2C", ",")

  if(newHash !== hash){
    window.location.hash = params.toString().replaceAll("%2C", ",")
    // window.history.pushState({}, "", `#${params.toString().replaceAll("%2C", ",")}`);
  }
}

utils.updateHash = updateHash;
