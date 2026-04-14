// map.js — Public map view
// Loads MA municipality polygons and visited/links data from the static
// municipalities.json file, then renders an interactive Leaflet map.

(function () {
  'use strict';

  // ── Leaflet map init ───────────────────────────────────────────────────────
  const map = L.map('map', {
    center: [42.15, -71.5],
    zoom: 8,
    minZoom: 7,
    maxZoom: 16
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // ── State ──────────────────────────────────────────────────────────────────
  let municipalityData = {}; // GEOID → { name, county, status, visitNumber, restaurantName, dateVisited, links }
  let geoidToLayer     = {}; // GEOID → Leaflet layer
  let ambiguousNames   = new Set(); // town names that appear in more than one county
  let geojsonLayer     = null;
  let detailMode       = false; // true when the "Show visit status" toggle is ON

  // ── Style helpers ──────────────────────────────────────────────────────────
  const STYLE_VISITED = {
    fillColor: '#FFD700',
    fillOpacity: 0.75,
    color: '#b8860b',
    weight: 1
  };
  const STYLE_UNVISITED = {
    fillColor: '#aaaaaa',
    fillOpacity: 0.4,
    color: '#666666',
    weight: 1
  };
  const STYLE_HOVER = {
    fillOpacity: 0.85,
    weight: 3
  };
  // LEGEND COLORS — to change queued/pre-challenge map colors, edit fillColor below.
  // LEGEND LABELS  — to change legend text, edit the .legend-detail items in index.html.
  const STYLE_QUEUED = {
    fillColor: '#FF8C00',
    fillOpacity: 0.75,
    color: '#cc5500',
    weight: 1
  };
  const STYLE_PRE_CHALLENGE = {
    fillColor: '#9C59B6',
    fillOpacity: 0.75,
    color: '#6c3483',
    weight: 1
  };

  function isVisited(data) {
    return data && data.status && data.status !== 'unvisited';
  }

  function getStyle(geoid) {
    const data = municipalityData[geoid];
    if (detailMode && data) {
      if (data.status === 'queued')        return STYLE_QUEUED;
      if (data.status === 'pre-challenge') return STYLE_PRE_CHALLENGE;
    }
    return isVisited(data) ? STYLE_VISITED : STYLE_UNVISITED;
  }

  // ── Link category display config ───────────────────────────────────────────
  const CATEGORY_LABELS = {
    restaurant: 'Restaurant',
    wikipedia:  'Wikipedia',
    social:     'Additional posts',
    more:       'Additional Restaurants & Businesses'
  };
  const CATEGORY_ORDER = ['social', 'restaurant', 'wikipedia', 'more'];

  // ── Social platform → Font Awesome icon class ──────────────────────────────
  const PLATFORM_ICONS = {
    instagram: 'fa-brands fa-instagram',
    tiktok:    'fa-brands fa-tiktok',
    youtube:   'fa-brands fa-youtube',
    threads:   'fa-brands fa-threads',
    bluesky:   'fa-brands fa-bluesky',
    facebook:  'fa-brands fa-facebook'
  };

  function platformIcon(platform) {
    return PLATFORM_ICONS[(platform || '').toLowerCase()] || 'fa-solid fa-link';
  }

  function categoryLabel(cat) {
    return CATEGORY_LABELS[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
  }

  // ── Date formatting ────────────────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return dateStr;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ── Popup builder ──────────────────────────────────────────────────────────
  function buildPopupContent(geoid, geoProps) {
    const data   = municipalityData[geoid] || {};
    const name   = data.name || geoProps.namelsad || geoProps.name;
    const type   = data.townType || '';
    const capType = type ? (type.charAt(0).toUpperCase() + type.slice(1)) : '';
    const displayName = (name && capType && !name.toLowerCase().endsWith(' ' + type.toLowerCase()))
      ? name + ' ' + capType
      : (name || '');
    const county = data.county || geoProps.county || '';
    const links  = data.links || [];
    const status = data.status || 'unvisited';

    // Status badge
    var statusBadge = '';
    if (status === 'visited') {
      statusBadge = '<span class="popup-badge visited-badge">&#10003; Visited</span>';
    } else if (status === 'queued') {
      statusBadge = '<span class="popup-badge queued-badge">&#8987; Coming Soon</span>';
    } else if (status === 'pre-challenge') {
      statusBadge = '<span class="popup-badge pre-challenge-badge">&#9733; Pre-Challenge Visit</span>';
    }

    // Visit info block
    var visitInfoHtml = '';
    if (status !== 'unvisited') {
      var lines = '';
      if (data.visitNumber) {
        lines += '<div class="popup-visit-number">Town #' + escapeHtml(String(data.visitNumber)) + ' visited</div>';
      }
      if (data.restaurantName) {
        lines += '<div class="popup-restaurant">' + escapeHtml(data.restaurantName) + '</div>';
      }
      if (data.mealName) {
        lines += '<div class="popup-meal">' + escapeHtml(data.mealName) + '</div>';
      }
      if (data.dateVisited) {
        lines += '<div class="popup-date">' + escapeHtml(formatDate(data.dateVisited)) + '</div>';
      }
      if (lines) {
        visitInfoHtml = '<div class="popup-visit-info">' + lines + '</div>';
      }
    }

    // platformOrder — used both for overlay pre-computation and social icon sort below
    var platformOrder = (typeof EJC_CONFIG !== 'undefined' && EJC_CONFIG.platformOrder) ? EJC_CONFIG.platformOrder : [];

    // Overlay: icons for the first social post, displayed on the thumbnail image
    var overlayHtml = '';
    var useOverlay = false;
    if (data.thumbnailShortcode) {
      var socialLinks = links.filter(function (l) { return (l.category || 'other') === 'social'; });
      if (socialLinks.length > 0) {
        var firstLabel = socialLinks[0].label || 'Untitled';
        var firstGroupLinks = socialLinks.filter(function (l) { return (l.label || 'Untitled') === firstLabel; });
        var sortedFirstLinks = firstGroupLinks.slice().sort(function (a, b) {
          var ai = platformOrder.indexOf((a.platform || '').toLowerCase());
          var bi = platformOrder.indexOf((b.platform || '').toLowerCase());
          if (ai === -1 && bi === -1) return (a.platform || '').localeCompare(b.platform || '');
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
        useOverlay = true;
        overlayHtml = '<div class="popup-thumbnail-overlay">' +
          sortedFirstLinks.map(function (l) {
            var pName = l.platform || 'Link';
            var pKey  = pName.toLowerCase();
            return '<a href="' + escapeHtml(l.url) + '" title="' + escapeHtml(pName) + '" data-platform="' + escapeHtml(pKey) + '" target="_blank" rel="noopener noreferrer"><i class="' + platformIcon(pName) + '"></i></a>';
          }).join('') + '</div>';
      }
    }

    // Links — group by category, then by platform within social
    var linksHtml = '';
    if (links.length > 0) {
      var groups = {};
      var groupOrder = [];
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var cat = link.category || 'other';
        if (!groups[cat]) { groups[cat] = []; groupOrder.push(cat); }
        groups[cat].push(link);
      }

      groupOrder.sort(function (a, b) {
        var ai = CATEGORY_ORDER.indexOf(a);
        var bi = CATEGORY_ORDER.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      var sectionsHtml = '';
      for (var g = 0; g < groupOrder.length; g++) {
        var cat = groupOrder[g];
        var catLinks = groups[cat];
        var sectionContent = '';

        if (cat === 'social') {
          // Sub-group by content title (label), then list platforms as links
          var contentGroups = {};
          var contentOrder = [];
          for (var p = 0; p < catLinks.length; p++) {
            var lbl = catLinks[p].label || 'Untitled';
            if (!contentGroups[lbl]) { contentGroups[lbl] = []; contentOrder.push(lbl); }
            contentGroups[lbl].push(catLinks[p]);
          }
          for (var k = (useOverlay ? 1 : 0); k < contentOrder.length; k++) {
            var contentLabel = contentOrder[k];
            var sortedLinks = contentGroups[contentLabel].slice().sort(function (a, b) {
              var ai = platformOrder.indexOf((a.platform || '').toLowerCase());
              var bi = platformOrder.indexOf((b.platform || '').toLowerCase());
              if (ai === -1 && bi === -1) return (a.platform || '').localeCompare(b.platform || '');
              if (ai === -1) return 1;
              if (bi === -1) return -1;
              return ai - bi;
            });
            sectionContent += '<div class="popup-content-heading">' + escapeHtml(contentLabel) + '</div>';
            sectionContent += '<div class="popup-platform-icons">' +
              sortedLinks.map(function (l) {
                var pName = l.platform || 'Link';
                var pKey  = pName.toLowerCase();
                return '<a href="' + escapeHtml(l.url) + '" title="' + escapeHtml(pName) + '" data-platform="' + escapeHtml(pKey) + '" target="_blank" rel="noopener noreferrer"><i class="' + platformIcon(pName) + '"></i></a>';
              }).join('') + '</div>';
          }
        } else {
          sectionContent = '<ul class="popup-links">' +
            catLinks.map(function (l) {
              var linkLabel = l.label;
              if (cat === 'wikipedia') {
                linkLabel = ambiguousNames.has(data.name)
                  ? displayName + ' (' + county + ' County)'
                  : displayName;
              }
              return '<li><a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(linkLabel) + '</a></li>';
            }).join('') + '</ul>';
        }

        if (sectionContent !== '') {
          sectionsHtml += '<div class="popup-link-section">' +
            '<div class="popup-section-heading">' + escapeHtml(categoryLabel(cat)) + '</div>' +
            sectionContent + '</div>';
        }
      }

      linksHtml = '<div class="popup-links-container">' + sectionsHtml + '</div>';
    }

    // Thumbnail image — only rendered when a matched shortcode is present
    var thumbnailHtml = '';
    if (data.thumbnailShortcode) {
      var thumbSrc = 'images/thumbnails/' + escapeHtml(data.thumbnailShortcode) + '.webp';
      thumbnailHtml = '<div class="popup-thumbnail-wrapper" style="min-height:160px">' +
        '<img class="popup-thumbnail" src="' + thumbSrc + '" alt="' + escapeHtml(displayName) + '" loading="lazy" onerror="this.parentNode.style.minHeight=\'\';this.style.display=\'none\'">' +
        overlayHtml +
        '</div>';
    }

    return '<div class="popup-content">' +
      '<h3 class="popup-title">' + escapeHtml(displayName) + '</h3>' +
      '<p class="popup-county">' + escapeHtml(county) + ' County</p>' +
      statusBadge +
      thumbnailHtml +
      visitInfoHtml +
      linksHtml +
      '</div>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Per-feature event handlers ─────────────────────────────────────────────
  function onEachFeature(feature, layer) {
    const geoid = feature.properties.GEOID;
    geoidToLayer[geoid] = layer;

    layer.on({
      mouseover: function (e) {
        e.target.setStyle(STYLE_HOVER);
        e.target.bringToFront();
      },
      mouseout: function (e) {
        geojsonLayer.resetStyle(e.target);
      },
      click: function (e) {
        const content = buildPopupContent(geoid, feature.properties);
        L.popup({ maxWidth: 340, className: 'ejc-popup' })
          .setLatLng(e.latlng)
          .setContent(content)
          .openOn(map);
      }
    });
  }

  // ── Update counter ─────────────────────────────────────────────────────────
  function updateCounter() {
    const count = Object.values(municipalityData).filter(function (d) { return isVisited(d); }).length;
    const el = document.getElementById('visited-count');
    if (el) el.textContent = count;
  }

  // ── Load data ──────────────────────────────────────────────────────────────
  Promise.all([
    fetch('data/municipalities.json').then(function (r) {
      if (!r.ok) throw new Error('municipalities.json failed to load');
      return r.json();
    }),
    fetch('data/ma_municipalities.geojson').then(function (r) {
      if (!r.ok) throw new Error('ma_municipalities.geojson failed to load');
      return r.json();
    })
  ]).then(function (results) {
    municipalityData = results[0];
    var geojsonData  = results[1];

    // Build set of town names that appear in more than one county
    var nameCountyMap = {};
    Object.values(municipalityData).forEach(function (d) {
      if (!d.name) return;
      if (!nameCountyMap[d.name]) nameCountyMap[d.name] = new Set();
      nameCountyMap[d.name].add(d.county || '');
    });
    Object.keys(nameCountyMap).forEach(function (n) {
      if (nameCountyMap[n].size > 1) ambiguousNames.add(n);
    });

    updateCounter();

    geojsonLayer = L.geoJson(geojsonData, {
      style:         function (feature) { return getStyle(feature.properties.GEOID); },
      onEachFeature: onEachFeature
    }).addTo(map);

    map.fitBounds(geojsonLayer.getBounds(), { padding: [20, 20] });

    // ── Status-detail toggle ────────────────────────────────────────────────
    var toggle = document.getElementById('status-detail-toggle');
    if (toggle) {
      toggle.addEventListener('change', function () {
        detailMode = toggle.checked;
        geojsonLayer.setStyle(function (feature) { return getStyle(feature.properties.GEOID); });
        document.querySelectorAll('.legend-detail').forEach(function (el) {
          el.style.display = detailMode ? 'flex' : 'none';
        });
      });
    }
  }).catch(function (err) {
    console.error('Error loading map data:', err);
  });

})();
