// christopher pietsch
// cpietsch@gmail.com
// 2015-2018


function Tags() {
  var margin = {top: 10, right: 20, bottom: 20, left: 10},
      width = window.innerWidth - margin.left - margin.right,
      height = 400 - margin.top - margin.bottom;

  var container;
  var keywordsScale = d3.scale.linear();
  var keywordsOpacityScale = d3.scale.linear();
  var keywords = [];
  var wordBackground;
  var keywordsNestGlobal;
  var sortKeywords = "alphabetical";

  // var filterWords = ["Potsdam"];
  var filterWords = [];
  var data, filteredData;
  var activeWord;

  var x = d3.scale.ordinal()
    .rangeBands([0, width]);

  var sliceScale = d3.scale.linear().domain([1200,5000]).range([50, 200])

  var lock = false;
  var state = { init: false, search: '' };

  function tags(){ }

  tags.state = state

  tags.init = function(_data, config) {
    data = _data;

    // Create topbar structure if it doesn't exist
    if (!document.querySelector('.topbar')) {
      var topbar = document.createElement('div');
      topbar.className = 'topbar';
      var center = document.createElement('div');
      center.className = 'topbar-center';
      center.id = 'topbarCenter';
      var right = document.createElement('div');
      right.className = 'topbar-right';
      right.id = 'topbarRight';
      topbar.appendChild(center);
      topbar.appendChild(right);
      document.body.appendChild(topbar);

      // Move model switch into topbar-right if it exists
      var modelHost = document.getElementById('model-switch-host');
      if (modelHost) {
        // Reset its inline positioning since topbar handles layout
        modelHost.style.cssText = 'display: flex; gap: 4px;';
        right.appendChild(modelHost);
      }
    }

    container = d3.select("#topbarCenter").append("div")
      .classed("tagcloud", true)
      .classed("accordion", true)
      .style("color", config.style.fontColor)
      .append("div")
      //.attr("transform", "translate("+ margin.left +","+ margin.top +")")
      
    if (config.sortKeywords != undefined) {
      sortKeywords = config.sortKeywords;
    }

    tags.update();
  }

  tags.resize = function(){
    //if(!state.init) return;
    
    width = window.innerWidth - margin.left - margin.right,
    height = 400 - margin.top - margin.bottom;

    x.rangeBands([0, width]);

    tags.update();
  }

  tags.filter = function(filterWords,highlight){
    data.forEach(function(d) {
      var search = state.search !== "" ? d.search.indexOf(state.search) > -1 : true
      var matches = filterWords.filter(function(word){
        return d.keywords.indexOf(word) > -1;
      });
      if(highlight) d.highlight = (matches.length == filterWords.length && search);
      else d.active = (matches.length == filterWords.length && search);
    });

    // var anzahl = data.filter(function(d){ return d.active; }).length;
    // c("anzahl", anzahl)

    if(!highlight){
      console.log("filter", filterWords)
    }
    
  }

  tags.update = function() {

    tags.filter(filterWords);

    var keywords = [];
    // var topographisch = [];
    data.forEach(function(d) {
      if(d.active){
        d.keywords.forEach(function(keyword) {
          keywords.push({ keyword: keyword, data: d });
        })
      }
    });

  keywordsNestGlobal =  d3.nest()
      .key(function(d) { return d.keyword; })
      .rollup(function(d){
        return d.map(function(d){ return d.data; });
      })
      .entries(keywords)
      .sort(function(a,b){
        return b.values.length - a.values.length;
      })

  var sliceNum = parseInt(sliceScale(width));

  // c("num",sliceNum)

   var keywordsNest = keywordsNestGlobal
      .slice(0,sliceNum);

    if (sortKeywords == "alphabetical") {
      keywordsNest = keywordsNest.sort(function(a,b){
        return d3.ascending(a.key[0], b.key[0]);
      });
    } else if (sortKeywords == "alfabetical-reverse") {
      keywordsNest = keywordsNest.sort(function(a,b){
        return d3.descending(a.key[0], b.key[0]);
      });
    } else if (sortKeywords == "count") {
      keywordsNest = keywordsNest.sort(function(a,b){
        return d3.descending(a.values.length, b.values.length);
      });
    } else if (sortKeywords == "count-reverse") {
      keywordsNest = keywordsNest.sort(function(a,b){
        return d3.ascending(a.values.length, b.values.length);
      });
    } else if (Array.isArray(sortKeywords)) {
      // compare keywords as lower case in case of mismatch
      sortKeywords = sortKeywords.map(function (d) {
			  return d.toLowerCase();
      });
      keywordsNest = keywordsNest.sort(function(a,b){
        var indexA = sortKeywords.indexOf(a.key.toLowerCase());
        var indexB = sortKeywords.indexOf(b.key.toLowerCase());
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });
    }

    // c("keywordsNest", keywordsNest);

    var keywordsExtent = d3.extent(keywordsNest, function (d) {
      return d.values.length;
    });


    keywordsScale
      .domain(keywordsExtent)
      .range([10,20]);

    if(keywordsExtent[0]==keywordsExtent[1]) keywordsScale.range([15,15])


    keywordsOpacityScale
      .domain(keywordsExtent)
      .range([0.2,1]);

    layout(keywordsNest);
    tags.draw(keywordsNest);
   
  }

  function layout(data){
    var p = 1.8;
    var p2 = 1;
    var x0 = 0;

    data.forEach(function(d){
      d.x = x0 + keywordsScale(d.values.length)*p +p2;
      x0 += keywordsScale(d.values.length)*p;
    })
  };

  function getTranslateForList(data){
    var w = _.last(data).x + 100;
    return width/2 - w/2;
  }

  tags.draw = function(words) {
    // Clear container for grouped accordion rebuild
    container.selectAll("*").remove();

    // Always show global image count (even if no filter keywords)
    var visibleCount = data.filter(function(d) { return d.active; }).length;
    container.append("div")
      .attr("id", "imageCount")
      .classed("image-count", true)
      .text("Image count: " + visibleCount);

    if(words.length === 0) return;

    // Group words by prefix before ":"
    var groups = {};
    var categoryOrder = [];
    words.forEach(function(d) {
      var colonIndex = d.key.indexOf(":");
      var category, label;
      if (colonIndex > -1) {
        category = d.key.substring(0, colonIndex);
        label = d.key.substring(colonIndex + 1);
      } else {
        category = "Other";
        label = d.key;
      }
      // Map the raw value to a UI-friendly label (falls back to raw value)
      d._displayLabel = typeof uiLabel === "function" ? uiLabel("values", label) : label;
      if (!groups[category]) {
        groups[category] = [];
        categoryOrder.push(category);
      }
      groups[category].push(d);
    });

    // Render each category as a collapsible <details> dropdown
    categoryOrder.forEach(function(category) {
      var details = container.append("details")
        .classed("filter-category", true);

      var displayName = typeof uiLabel === "function"
        ? uiLabel("filters", category)
        : category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");

      // Determine selected tags in this category
      var selected = groups[category].filter(function(d) {
        return filterWords.indexOf(d.key) > -1;
      });

      // Choose label: show selected value when exactly 1 is selected
      var headerLabel = displayName;
      if (selected.length === 1) {
        headerLabel = selected[0]._displayLabel;
      }

      var headerText = headerLabel;

      details.append("summary")
        .classed("filter-category-header", true)
        .text(headerText);

      var itemsContainer = details.append("div")
        .classed("filter-category-items", true);

      groups[category].forEach(function(d) {
        var tag = itemsContainer.append("div")
          .datum(d)
          .classed("tag", true)
          .classed("active", filterWords.indexOf(d.key) > -1)
          .on("mouseenter", tags.mouseenter)
          .on("mouseleave", tags.mouseleave)
          .on("click", function(d) {
            // Prevent the details from toggling on tag click
            d3.event.stopPropagation();
            tags.mouseclick.call(this, d);
          });

        tag.append("span")
          .text(d._displayLabel);

        tag.append("div")
          .classed("close", true);
      });
    });

    // Close other dropdowns when one opens (mutual exclusion)
    container.selectAll("details").on("toggle", function() {
      if (this.open) {
        var self = this;
        container.selectAll("details").each(function() {
          if (this !== self) this.removeAttribute("open");
        });
      }
    });

    // Mark categories that have an active selection
    container.selectAll(".filter-category").each(function() {
      var el = d3.select(this);
      var hasActive = !el.selectAll(".tag.active").empty();
      el.classed("has-active", hasActive);
    });

    // Close dropdown when clicking outside
    d3.select("body").on("click.tagdropdown", function() {
      var target = d3.event.target;
      var insideTagcloud = false;
      var node = target;
      while (node) {
        if (node.classList && node.classList.contains("tagcloud")) {
          insideTagcloud = true;
          break;
        }
        node = node.parentNode;
      }
      if (!insideTagcloud) {
        container.selectAll("details").each(function() {
          this.removeAttribute("open");
        });
      }
    });

  }

  tags.updateAll = function(clear){
    tags.update();
    tags.highlightWords(filterWords);

    setTimeout(function(){
      canvas.project();
      tags.updateHash(clear);
    },50);

  }

  tags.reset = function(){
    filterWords = []
    state.search = "";  // Clear search term
    tags.update();
    tags.highlightWords(filterWords);
    tags.updateHash();  // Update hash when resetting
    // canvas.highlight();
    // canvas.project()
  }

  tags.setFilterWords = function(words){
    // compare words with filterWords and olny update if different
    if(_.isEqual(words, filterWords)) return;

    filterWords = words;
    tags.updateAll();
  }

  tags.getFilterWords = function(){
    return filterWords;
  }

  tags.getSearchTerm = function(){
    return state.search;
  }

  tags.mouseclick = function (d) {
    lock = true;

    if(filterWords.indexOf(d.key)>-1){
      _.remove(filterWords,function(d2){ return d2 == d.key; });
    } else {
      filterWords.push(d.key);
    }
    // c(filterWords);
    tags.updateAll(true);

    lock = false
  }



  tags.updateHash = function(clear){
    var hash = window.location.hash.slice(1);
    var params = new URLSearchParams(hash);
    params.set("filter", filterWords);
    if(filterWords.length === 0) params.delete("filter");
    
    // Add search term to hash
    if(state.search && state.search !== ""){
      params.set("search", state.search);
    } else {
      params.delete("search");
    }
    
    if(clear){
      params.delete("ids");
    }
    
    var newHash = params.toString().replaceAll("%2C", ",")

    console.log("updateHashtags tags", clear, newHash, hash)

    if(newHash !== hash){
      window.location.hash = params.toString().replaceAll("%2C", ",")
    }
  }

  tags.mouseleave = function (d) {
    if(lock) return;

    container
      .selectAll(".tag")
      .style("opacity", 1)

    data.forEach(function(d){ d.highlight = d.active; })

    canvas.highlight();
  }

  tags.mouseenter = function (d1) {
    if(lock) return;


    var tempFilterWords = _.clone(filterWords);
    tempFilterWords.push(d1.key)

    tags.highlightWords(tempFilterWords);
  }

  tags.filterWords = function(words){
    
    tags.filter(words,1);

    container
      .selectAll(".tag")
      .style("opacity", function(d){
        return d.values.some(function(d){ return d.active; }) ? 1 : 0.2;
      })

    canvas.highlight();
  }

  tags.highlightWords = function(words){
    
    tags.filter(words,1);

    container
      .selectAll(".tag")
      .style("opacity", function(d){
        return d.values.some(function(d){ return d.highlight; }) ? 1 : 0.2;
      })

      canvas.highlight();
  }

  tags.search = function(query){

    state.search = query
    
    tags.filter(filterWords, true);
    tags.update();
    canvas.highlight();
    canvas.project();
    
    // Update hash with search term
    tags.updateHash();
  }

  return tags;

}



