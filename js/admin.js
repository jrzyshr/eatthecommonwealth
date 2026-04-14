// admin.js — Admin panel (static JSON workflow)
// Loads municipalities.json, allows editing visit status, details, and links,
// and exports the updated JSON for committing to the repo.

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────────────────────────
  const exportBtn              = document.getElementById('export-btn');
  const modalOverlay           = document.getElementById('edit-modal-overlay');
  const modalTitle             = document.getElementById('modal-title');
  const modalCounty            = document.getElementById('modal-county');
  const statusSelect           = document.getElementById('status-select');
  const visitNumberIn          = document.getElementById('visit-number-input');
  const restaurantNameIn       = document.getElementById('restaurant-name-input');
  const mealNameIn             = document.getElementById('meal-name-input');
  const dateVisitedIn          = document.getElementById('date-visited-input');
  const linksList              = document.getElementById('links-list');
  const addLinkBtn             = document.getElementById('add-link-btn');
  const linkCategoryIn         = document.getElementById('link-category-input');
  const linkCategoryCustomWrap = document.getElementById('link-category-custom-wrap');
  const linkCategoryCustomIn   = document.getElementById('link-category-custom-input');
  const linkPlatformWrap       = document.getElementById('link-platform-wrap');
  const linkPlatformIn         = document.getElementById('link-platform-input');
  const linkLabelIn            = document.getElementById('link-label-input');
  const linkUrlIn              = document.getElementById('link-url-input');
  const addLinkErr             = document.getElementById('add-link-error');
  const addLinkFormHeading     = document.getElementById('add-link-form-heading');
  const cancelEditLinkBtn      = document.getElementById('cancel-edit-link-btn');
  const saveBtn                = document.getElementById('save-btn');
  const cancelBtn              = document.getElementById('cancel-btn');
  const saveError              = document.getElementById('save-error');
  const modalCloseBtn          = document.getElementById('modal-close-btn');
  const muniList               = document.getElementById('municipality-list');
  const sidebarSearch          = document.getElementById('sidebar-search');
  const adminVisited           = document.getElementById('admin-visited-count');

  // ── State ──────────────────────────────────────────────────────────────────
  let municipalityData = {}; // GEOID → municipality data
  let geoidToLayer     = {}; // GEOID → Leaflet layer
  let geojsonLayer     = null;
  let map              = null;
  let editGeoid        = null;
  let editLinks        = [];
  let editLinkIdx      = null;

  // ── Style helpers ──────────────────────────────────────────────────────────
  const STYLE_VISITED   = { fillColor: '#FFD700', fillOpacity: 0.75, color: '#b8860b', weight: 1 };
  const STYLE_UNVISITED = { fillColor: '#aaaaaa', fillOpacity: 0.4,  color: '#666666', weight: 1 };
  const STYLE_HOVER     = { fillOpacity: 0.85, weight: 3 };
  const STYLE_SELECTED  = { fillOpacity: 0.9, weight: 3, color: '#1565c0' };

  function isVisited(data) {
    return data && data.status && data.status !== 'unvisited';
  }

  function getStyle(geoid) {
    return isVisited(municipalityData[geoid]) ? STYLE_VISITED : STYLE_UNVISITED;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Map init ───────────────────────────────────────────────────────────────
  map = L.map('map', { center: [42.15, -71.5], zoom: 8, minZoom: 7, maxZoom: 16 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

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

    updateCounter();

    geojsonLayer = L.geoJson(geojsonData, {
      style: function (feature) { return getStyle(feature.properties.GEOID); },
      onEachFeature: function (feature, layer) {
        const geoid = feature.properties.GEOID;
        geoidToLayer[geoid] = layer;
        layer.on({
          mouseover: function (e) { e.target.setStyle(STYLE_HOVER); e.target.bringToFront(); },
          mouseout:  function (e) {
            if (editGeoid !== geoid) geojsonLayer.resetStyle(e.target);
          },
          click: function () { openModal(geoid); }
        });
      }
    }).addTo(map);

    map.fitBounds(geojsonLayer.getBounds(), { padding: [20, 20] });
    renderSidebar();
  }).catch(function (err) { console.error('Error loading map data:', err); });

  // ── Counter ────────────────────────────────────────────────────────────────
  function updateCounter() {
    const count = Object.values(municipalityData).filter(function (d) { return isVisited(d); }).length;
    if (adminVisited) adminVisited.textContent = count;
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const STATUS_BADGE_HTML = {
    visited:       ' <span class="sb-badge sb-visited">&#10003;</span>',
    queued:        ' <span class="sb-badge sb-queued">&#8987;</span>',
    'pre-challenge': ' <span class="sb-badge sb-pre">&#9733;</span>'
  };

  function renderSidebar() {
    const query = (sidebarSearch.value || '').toLowerCase();
    const items = Object.entries(municipalityData)
      .filter(function (e) {
        const d = e[1];
        if (!query) return true;
        return (d.name || '').toLowerCase().includes(query) ||
               (d.county || '').toLowerCase().includes(query);
      })
      .sort(function (a, b) {
        return (a[1].name || '').localeCompare(b[1].name || '');
      });

    muniList.innerHTML = items.map(function (e) {
      const geoid  = e[0];
      const d      = e[1];
      const badge  = STATUS_BADGE_HTML[d.status] || '';
      const linksBadge = d.links && d.links.length > 0
        ? ' <span class="sb-links">(' + d.links.length + ')</span>'
        : '';
      return '<li class="sb-item" data-geoid="' + escapeHtml(geoid) + '">' +
        escapeHtml(d.namelsad || d.name) + badge + linksBadge + '</li>';
    }).join('');

    muniList.querySelectorAll('.sb-item').forEach(function (li) {
      li.addEventListener('click', function () { openModal(li.dataset.geoid); });
    });
  }

  sidebarSearch.addEventListener('input', renderSidebar);

  // ── Category select show/hide ──────────────────────────────────────────────
  linkCategoryIn.addEventListener('change', function () {
    const isCustom  = linkCategoryIn.value === 'custom';
    const isSocial  = linkCategoryIn.value === 'social';
    linkCategoryCustomWrap.hidden = !isCustom;
    linkPlatformWrap.hidden       = !isSocial;
    if (!isCustom) linkCategoryCustomIn.value = '';
    if (!isSocial) linkPlatformIn.value = '';
  });

  // ── Modal open/close ───────────────────────────────────────────────────────
  function openModal(geoid) {
    const data = municipalityData[geoid];
    if (!data) return;

    editGeoid = geoid;
    editLinks = (data.links || []).map(function (l) { return Object.assign({}, l); });

    modalTitle.textContent  = data.namelsad || data.name || geoid;
    modalCounty.textContent = (data.county || '') + ' County';

    statusSelect.value       = data.status || 'unvisited';
    visitNumberIn.value      = data.visitNumber != null ? data.visitNumber : '';
    restaurantNameIn.value   = data.restaurantName || '';
    mealNameIn.value         = data.mealName || '';
    dateVisitedIn.value      = data.dateVisited || '';

    // Reset add-link form
    resetAddLinkForm();
    saveError.hidden              = true;

    renderModalLinks();

    if (geoidToLayer[geoid]) {
      geoidToLayer[geoid].setStyle(STYLE_SELECTED);
      geoidToLayer[geoid].bringToFront();
    }

    modalOverlay.hidden = false;
  }

  function closeModal() {
    if (editGeoid && geoidToLayer[editGeoid]) {
      geoidToLayer[editGeoid].setStyle(getStyle(editGeoid));
    }
    editGeoid = null;
    editLinks = [];
    modalOverlay.hidden = true;
  }

  modalCloseBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
  });

  // ── Modal links rendering ─────────────────────────────────────────────────
  const CATEGORY_DISPLAY = {
    restaurant: 'Restaurant',
    wikipedia:  'Wikipedia',
    social:     'Social Media',
    more:       'Additional Restaurants & Businesses'
  };

  function categoryDisplay(cat) {
    return CATEGORY_DISPLAY[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'Other');
  }

  function renderModalLinks() {
    if (editLinks.length === 0) {
      linksList.innerHTML = '<li class="no-links-msg">No links added yet.</li>';
      return;
    }
    linksList.innerHTML = editLinks.map(function (link, idx) {
      const catLabel = categoryDisplay(link.category);
      const platformTag = link.platform
        ? ' <span class="link-platform-tag">' + escapeHtml(link.platform) + '</span>'
        : '';
      return '<li class="link-item" data-idx="' + idx + '">' +
        '<div class="link-reorder-btns">' +
          '<button class="link-move-btn" data-idx="' + idx + '" data-dir="up" aria-label="Move up"' + (idx === 0 ? ' disabled' : '') + '>&#8593;</button>' +
          '<button class="link-move-btn" data-idx="' + idx + '" data-dir="down" aria-label="Move down"' + (idx === editLinks.length - 1 ? ' disabled' : '') + '>&#8595;</button>' +
        '</div>' +
        '<div class="link-item-info">' +
          '<span class="link-label">' +
            '<span class="link-cat-tag">' + escapeHtml(catLabel) + '</span>' +
            platformTag + ' ' + escapeHtml(link.label) +
          '</span>' +
          '<a class="link-url-preview" href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(link.url) +
          '</a>' +
        '</div>' +
        '<div class="link-item-actions">' +
          '<button class="edit-link-btn" data-idx="' + idx + '" aria-label="Edit link">&#9998;</button>' +
          '<button class="delete-link-btn" data-idx="' + idx + '" aria-label="Remove link">&times;</button>' +
        '</div>' +
        '</li>';
    }).join('');

    linksList.querySelectorAll('.link-move-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.dataset.idx, 10);
        const dir = btn.dataset.dir;
        if (dir === 'up' && idx > 0) {
          var tmp = editLinks[idx - 1];
          editLinks[idx - 1] = editLinks[idx];
          editLinks[idx] = tmp;
        } else if (dir === 'down' && idx < editLinks.length - 1) {
          var tmp = editLinks[idx + 1];
          editLinks[idx + 1] = editLinks[idx];
          editLinks[idx] = tmp;
        }
        renderModalLinks();
      });
    });

    linksList.querySelectorAll('.edit-link-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.dataset.idx, 10);
        populateFormForEdit(idx);
      });
    });

    linksList.querySelectorAll('.delete-link-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.dataset.idx, 10);
        if (editLinkIdx === idx) resetAddLinkForm();
        editLinks.splice(idx, 1);
        renderModalLinks();
      });
    });
  }

  function populateFormForEdit(idx) {
    const link = editLinks[idx];
    editLinkIdx = idx;
    const cat = link.category || 'other';
    const isKnown = ['restaurant', 'wikipedia', 'social', 'more'].includes(cat);
    linkCategoryIn.value          = isKnown ? cat : 'custom';
    linkCategoryCustomWrap.hidden = isKnown;
    linkCategoryCustomIn.value    = isKnown ? '' : cat;
    linkPlatformWrap.hidden       = (cat !== 'social');
    linkPlatformIn.value          = link.platform || '';
    linkLabelIn.value             = link.label || '';
    linkUrlIn.value               = link.url || '';
    addLinkErr.hidden             = true;
    addLinkFormHeading.textContent = 'Edit Link';
    addLinkBtn.textContent        = 'Update Link';
    cancelEditLinkBtn.hidden      = false;
  }

  function resetAddLinkForm() {
    editLinkIdx                   = null;
    linkCategoryIn.value          = 'restaurant';
    linkCategoryCustomWrap.hidden = true;
    linkPlatformWrap.hidden       = true;
    linkCategoryCustomIn.value    = '';
    linkPlatformIn.value          = '';
    linkLabelIn.value             = '';
    linkUrlIn.value               = '';
    addLinkErr.hidden             = true;
    addLinkFormHeading.textContent = 'Add a Link';
    addLinkBtn.textContent        = '+ Add Link';
    cancelEditLinkBtn.hidden      = true;
  }

  cancelEditLinkBtn.addEventListener('click', resetAddLinkForm);

  // ── Add link ───────────────────────────────────────────────────────────────
  addLinkBtn.addEventListener('click', function () {
    addLinkErr.hidden = true;

    const catValue = linkCategoryIn.value;
    const category = catValue === 'custom'
      ? linkCategoryCustomIn.value.trim()
      : catValue;
    const platform = linkPlatformIn.value.trim();
    const label    = linkLabelIn.value.trim();
    const url      = linkUrlIn.value.trim();

    if (!category) {
      addLinkErr.textContent = 'Please enter a custom category name.';
      addLinkErr.hidden = false;
      return;
    }
    if (!label) {
      addLinkErr.textContent = 'Please enter a description.';
      addLinkErr.hidden = false;
      return;
    }
    if (!url || !isValidUrl(url)) {
      addLinkErr.textContent = 'Please enter a valid URL (starting with https://).';
      addLinkErr.hidden = false;
      return;
    }
    if (catValue === 'social' && !platform) {
      addLinkErr.textContent = 'Please enter the social media platform name.';
      addLinkErr.hidden = false;
      return;
    }

    const newLink = { category: category, label: label, url: url };
    if (catValue === 'social' && platform) newLink.platform = platform;

    if (editLinkIdx !== null) {
      editLinks[editLinkIdx] = newLink;
      resetAddLinkForm();
    } else {
      editLinks.push(newLink);
      linkLabelIn.value = '';
      linkUrlIn.value   = '';
    }
    renderModalLinks();
  });

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  // ── Save (in-memory) ───────────────────────────────────────────────────────
  saveBtn.addEventListener('click', function () {
    if (!editGeoid) return;

    const d = municipalityData[editGeoid];
    d.status         = statusSelect.value;
    d.visitNumber    = visitNumberIn.value !== '' ? parseInt(visitNumberIn.value, 10) : null;
    d.restaurantName = restaurantNameIn.value.trim() || null;
    d.mealName       = mealNameIn.value.trim() || null;
    d.dateVisited    = dateVisitedIn.value || null;
    d.links          = editLinks.slice();

    const layer = geoidToLayer[editGeoid];
    if (layer) layer.setStyle(getStyle(editGeoid));

    updateCounter();
    renderSidebar();
    closeModal();
  });

  // ── Export JSON ────────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', function () {
    const json = JSON.stringify(municipalityData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'municipalities.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

})();
