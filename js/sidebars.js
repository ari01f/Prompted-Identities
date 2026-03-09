var detailVue = new Vue({
      el: '#detail',
      data: {
        item: null,
        structure: null,
        page: 0,
        id: null,
        dataset: window.currentDataset || 'sdxl_base_1'
      },
      computed: {
        filteredStructure: function() {
          if (!this.structure) return [];
          return this.structure.filter(function(entry) {
            return entry.type !== 'keywords';
          });
        },
        imageFilename: function() {
          var currentId = this.id;
          if (!currentId) return '';
          var ds = this.dataset;
          var ext = ds === 'V15' ? '.jpg' : '.png';
          return currentId + ext;
        },
        detectedObjects: function() {
          // depend on reactive props so Vue recomputes on change
          var currentId = this.id;
          var currentPage = this.page;
          var currentItem = this.item;
          if (!currentId) return [];
          var fullItem = typeof canvas !== 'undefined' && canvas.selectedImage ? canvas.selectedImage() : null;
          if (!fullItem) return [];
          var detectionColumns = [
            '_glasses', '_tie', '_book', '_laptop', '_phone',
            '_chair', '_table', '_bag', '_watch', '_uniform',
            '_pen', '_desk', '_gloves', '_apron', '_monitor',
            '_clipboard'
          ];
          var results = [];
          detectionColumns.forEach(function(col) {
            var val = parseFloat(fullItem[col]);
            if (!isNaN(val) && val > 0) {
              var label = col.replace(/^_/, '').replace(/_/g, ' ');
              label = label.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
              results.push({ label: label, count: val });
            }
          });
          return results;
        },
        detectionImageUrl: function() {
          var currentId = this.id;
          var currentPage = this.page;
          var ds = this.dataset;
          if (!currentId) return '';
          return 'data/' + ds + '/object_detection/' + currentId + '.png';
        }
      },
      methods: {
        displayPage: function(page){
          canvas.changePage(this.id, page)
        },
        hasData: function(entry){
          return this.getContent(entry) !== ''
        },
        formatDisplayValue: function(value) {
          if (!value || typeof value !== 'string') return value || '';
          // Look up in uiLabels.values first
          if (typeof uiLabel === 'function') {
            var mapped = uiLabel('values', value);
            if (mapped !== value) return mapped;
          }
          // CamelCase -> spaced words
          var result = value.replace(/([a-z])([A-Z])/g, '$1 $2');
          // underscores -> spaces, then title-case each word
          result = result.replace(/_/g, ' ');
          result = result.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
          return result;
        },
        formatLabel: function(title) {
          if (!title) return '';
          return title;
        },
        getContent: function(entry) {
          if(entry.type === 'text') {
            return this.item[entry.source]
          }
          if(entry.type === 'array') {
            return this.item[entry.source].join(', ')
          }
          if(entry.type === 'keywords') {
            return this.item[entry.source].join(', ')
          }
          if(entry.type === 'markdown') {
            return marked(this.item[entry.source], { breaks: true})
          }
          if(entry.type === 'function') {
            const column = this.item
            const func = entry.source
            try {
              return eval(func)
            } catch (e) {
              return 'Error'
            }
          }
        },
        getDetectedObjects: function() {
          return this.detectedObjects;
        },
        getDetectionImageUrl: function() {
          return this.detectionImageUrl;
        }
      }
    })
  window.detailVue = detailVue;

  var infoVue = new Vue({
      el: '#infobar',
      data: {
        info: ""
      },
      methods: {
        marked: function(input) {
          return marked(input);
        }
      }
    })
  window.infoVue = infoVue;