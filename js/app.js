/* eslint-env browser */
const DATA_URL = "data/geoguessr-metas.json";
const WORLD_URL = "data/world.geo.json";
const DEFAULT_LANG = "en";

// Which facets we expose (and how they are typed)
const FACETS = [
  { key: "cameras", type: "array" },
  { key: "driving", type: "array" },
  { key: "roadLine", type: "array" },
  { key: "flagColor", type: "array" },
  { key: "flagPattern", type: "array" },
  { key: "alphabet", type: "array" },
  { key: "scenery", type: "array" },
  { key: "uniqueLetter", type: "array" }, // this can be huge; still supported
  { key: "years", type: "array" }, // added years facet
];

let metas = {};
let worldGeo = null;
let lang = DEFAULT_LANG;
let t = (s) => s; // translation function stub
let trMap = {}; // the loaded translation file
const state = {}; // selected filters per facet => Set
const layersByCode = new Map(); // isoCode(lower) -> Leaflet layer

// ------- BOOT -------

(async function boot() {
  [metas, trMap, worldGeo] = await Promise.all([
    fetch(DATA_URL).then((r) => r.json()),
    loadLang(DEFAULT_LANG),
    fetch(WORLD_URL).then((r) => r.json()),
  ]);

  t = buildT(); // now we have translation maps

  // init state
  FACETS.forEach((f) => {
    state[f.key] = new Set();
  });

  buildUI();
  setupLangSwitcher();
  setupThemeToggle();
  initMap();
  // Restore state from hashbang on boot
  parseHashToState();
  render();
})().catch(console.error);

// ------- TRANSLATION -------

async function loadLang(code) {
  lang = code;
  return fetch(`i18n/${code}.json`).then((r) => r.json());
}

function buildT() {
  return function translate(key) {
    // 1) try UI string map
    if (trMap.ui && trMap.ui[key]) return trMap.ui[key];

    // 2) try facet name mapping
    if (trMap.facets && trMap.facets[key]) return trMap.facets[key];

    // 3) try value map for data values
    if (trMap.values && trMap.values[key]) return trMap.values[key];

    // 4) fallback: key itself
    return key;
  };
}

// ------- UI -------

function buildUI() {
  // Where to inject (desktop vs mobile)
  const filtersDesktop = document.getElementById("filters-desktop");
  const filtersMobile = document.getElementById("filters-mobile");

  // Build separately for desktop and mobile to ensure event listeners are attached
  const filtersFragmentDesktop = buildFiltersFragment();
  const filtersFragmentMobile = buildFiltersFragment();
  filtersDesktop.append(filtersFragmentDesktop);
  filtersMobile.append(filtersFragmentMobile);

  // Buttons
  const btnClearDesktop = document.getElementById("btn-clear");
  const btnClearMobile = document.getElementById("btn-clear-mob");
  btnClearDesktop.addEventListener("click", clearAll);
  btnClearMobile.addEventListener("click", clearAll);
  // Set translated text for Clear all buttons
  btnClearDesktop.textContent = t("Clear all");
  btnClearMobile.textContent = t("Clear all");
}

function buildFiltersFragment() {
  const frag = document.createDocumentFragment();

  FACETS.forEach((facet) => {
    const box = document.createElement("div");
    box.className = "facet-group";

    const title = document.createElement("div");
    title.className = "facet-title";
    title.textContent = t(facet.key);
    title.setAttribute("data-key", facet.key);
    box.appendChild(title);

    const values = getAllFacetValues(facet.key);
    values.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    const container = document.createElement("div");

    values.forEach((val, idx) => {
      const id = `${facet.key}__${slug(val)}__${idx}`;

      const input = document.createElement("input");
      input.className = "btn-check";
      input.type = "checkbox";
      input.autocomplete = "off";
      input.id = id;
      input.dataset.facetKey = facet.key;
      input.dataset.value = val;

      input.addEventListener("change", onFacetToggle);

      const label = document.createElement("label");
      label.className = "btn btn-outline-white btn-sm chip fw-bold";
      label.setAttribute("for", id);
      label.textContent = t(val);
      label.setAttribute("data-key", val);

      container.appendChild(input);
      container.appendChild(label);
    });

    box.appendChild(container);
    frag.appendChild(box);
  });

  return frag;
}

function onFacetToggle(ev) {
  const el = ev.target;
  const key = el.dataset.facetKey;
  const val = el.dataset.value;
  if (el.checked) {
    state[key].add(val);
  } else {
    state[key].delete(val);
  }
  serializeStateToHash();
  render();
}

function clearAll() {
  FACETS.forEach((f) => state[f.key].clear());
  document.querySelectorAll(".btn-check").forEach((i) => {
    i.checked = false;
  });
  serializeStateToHash();
  render();
}

function setupLangSwitcher() {
  const sel = document.getElementById("lang-select");
  sel.addEventListener("change", async (e) => {
    trMap = await loadLang(e.target.value);
    t = buildT();

    // Re-label UI
    relabelUI();

    // Re-render list/map (country names could change)
    render();
  });
}

function relabelUI() {
  // facet titles
  document.querySelectorAll(".facet-title").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (key) {
      el.textContent = t(key);
    }
  });

  // chips
  document.querySelectorAll("label.btn").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (key) {
      el.textContent = t(key);
    }
  });

  // offcanvas title
  const offLbl = document.getElementById("filtersCanvasLabel");
  if (offLbl) offLbl.textContent = t("Filters") || "Filters";

  // Translate 'Clear all' buttons
  const btnClearDesktop = document.getElementById("btn-clear");
  const btnClearMobile = document.getElementById("btn-clear-mob");
  if (btnClearDesktop) btnClearDesktop.textContent = t("Clear all");
  if (btnClearMobile) btnClearMobile.textContent = t("Clear all");

  // navbar brand etc. if you want
}

function setupThemeToggle() {
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  // Persist theme in localStorage
  let currentTheme =
    localStorage.getItem("theme") ||
    document.documentElement.getAttribute("data-bs-theme") ||
    "light";
  document.documentElement.setAttribute("data-bs-theme", currentTheme);
  updateThemeIcon(currentTheme);

  themeToggle.addEventListener("click", () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-bs-theme", currentTheme);
    localStorage.setItem("theme", currentTheme);
    updateThemeIcon(currentTheme);
    switchMapTheme(currentTheme);
    render();
  });

  function updateThemeIcon(theme) {
    if (themeIcon) {
      // Invert icons: show sun in dark mode, moon in light mode (user selects desired theme)
      themeIcon.textContent = theme === "light" ? "🌙" : "☀️";
      themeToggle.className =
        theme === "light" ? "btn btn-dark me-2" : "btn btn-warning me-2";
    }
  }
}

// ------- DATA HELPERS -------

function getAllFacetValues(key) {
  const set = new Set();

  Object.values(metas).forEach((country) => {
    const v = country[key];
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach((x) => set.add(x));
    } else {
      set.add(v);
    }
  });

  return Array.from(set);
}

function matchesAllFilters(country) {
  for (const facet of FACETS) {
    const sel = state[facet.key];
    if (sel.size === 0) continue;

    const val = country[facet.key];
    if (!val) return false;

    if (Array.isArray(val)) {
      // every selected value must be included
      for (const chosen of sel) {
        if (!val.includes(chosen)) return false;
      }
    } else {
      if (!sel.has(val)) return false;
    }
  }
  return true;
}

// ------- MAP -------

let map, geoLayer, tileLayer;

const TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
};

function getCurrentTheme() {
  return (
    localStorage.getItem("theme") ||
    document.documentElement.getAttribute("data-bs-theme") ||
    "light"
  );
}

function initMap() {
  // Always use the single 'map' container
  const mapContainerId = "map";
  const mapContainer = document.getElementById(mapContainerId);

  if (mapContainer) {
    map = L.map(mapContainerId, {
      worldCopyJump: false,
      attributionControl: false,
    });

    // Select tile URL based on theme
    const theme = getCurrentTheme();
    tileLayer = L.tileLayer(TILE_URLS[theme], {
      maxZoom: 10,
      minZoom: 1,
      noWrap: true,
    });
    tileLayer.addTo(map);

    geoLayer = L.geoJSON(worldGeo, {
      style: baseStyle,
      onEachFeature: onEachCountry,
    }).addTo(map);

    // Fit to world, then zoom in a bit for a single world view
    map.fitBounds(geoLayer.getBounds());
    map.setView([20, 0], 2.2); // latitude, longitude, zoom
  } else {
    console.warn("Map container not found:", mapContainerId);
  }
}

// Helper to switch tile layer on theme change
function switchMapTheme(theme) {
  if (map && tileLayer) {
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILE_URLS[theme], {
      maxZoom: 2,
      minZoom: 2,
      noWrap: true,
    });
    tileLayer.addTo(map);
  }
}

// No need for resize logic with a single map container

function baseStyle(feature) {
  return {
    color: "#fff",
    weight: 1,
    fillColor: "#e9ecef",
    fillOpacity: 1,
  };
}

function matchedStyle() {
  // Detect theme
  const theme =
    localStorage.getItem("theme") ||
    document.documentElement.getAttribute("data-bs-theme") ||
    "light";
  const color = theme === "dark" ? "#306c01" : "#1d3b8b";
  console.log("matchedStyle theme:", theme, "fillColor:", color);
  return {
    fillColor: color,
    fillOpacity: 0.9,
    color: "#fff",
    weight: 1,
  };
}

function onEachCountry(feature, layer) {
  const code = (
    feature.properties.ISO_A2 ||
    feature.properties.iso_a2 ||
    feature.properties.ADM0_A3 ||
    feature.properties.iso_a3 ||
    ""
  )
    .toString()
    .toLowerCase();

  layersByCode.set(code, layer);

  layer.bindTooltip(
    feature.properties.ADMIN || feature.properties.name || code.toUpperCase(),
  );

  // Add click handler to show modal with country info
  layer.on("click", function () {
    showCountryModal(code, true);
  });
}

// ------- RENDER -------

function render() {
  // Compute matches
  const matches = [];
  for (const [code, country] of Object.entries(metas)) {
    if (matchesAllFilters(country)) {
      matches.push({ code, ...country });
    }
  }

  // Update counter
  updateCounters(matches.length);

  // Update map coloring
  recolorMap(matches);

  // Update list
  renderCountryList(matches);
}

function updateCounters(n) {
  const text = `${n} ${n === 1 ? t("match") : t("matches")}`;
  const c1 = document.getElementById("results-counter");
  const c2 = document.getElementById("results-counter-mob");
  if (c1) c1.textContent = text;
  if (c2) c2.textContent = text;
}

function recolorMap(matches) {
  // reset all
  layersByCode.forEach((layer) => layer.setStyle(baseStyle(layer.feature)));

  const matchCodes = new Set(matches.map((m) => m.code.toLowerCase()));

  layersByCode.forEach((layer, code) => {
    if (matchCodes.has(code)) {
      layer.setStyle(matchedStyle(layer.feature));
      layer.bringToFront();
    }
  });
}

function renderCountryList(matches) {
  const html = matches
    .sort((a, b) => t(a.name).localeCompare(t(b.name)))
    .map((c) => {
      return `
        <div class="card mb-2">
          <div class="card-body py-2">
            <strong>${t(c.name)}</strong>
            <small class="text-muted ms-1">${c.code.toUpperCase()}</small>
            <div class="mt-2">
              ${renderFacetLine("cameras", c.cameras)}
              ${renderFacetLine("flagColor", c.flagColor)}
              ${renderFacetLine("flagPattern", c.flagPattern)}
              ${renderFacetLine("roadLine", c.roadLine)}
              ${renderFacetLine("driving", c.driving)}
              ${renderFacetLine("alphabet", c.alphabet)}
              ${renderFacetLine("scenery", c.scenery)}
              ${renderFacetLine("uniqueLetter", c.uniqueLetter)}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  const desktop = document.getElementById("matched-list");
  const mobile = document.getElementById("matched-list-mob");
  if (desktop) desktop.innerHTML = html;
  if (mobile) mobile.innerHTML = html;
}

function renderFacetLine(labelKey, arr) {
  if (!arr || arr.length === 0) return "";
  const items = arr
    .map(
      (v) =>
        `<span class="badge bg-secondary-subtle text-secondary-emphasis me-1">${t(v)}</span>`,
    )
    .join("");
  return `<div class="mb-1"><span class="text-body-secondary">${t(labelKey)}:</span> ${items}</div>`;
}

// ------- utils -------

function slug(s) {
  return s
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/gi, "")
    .toLowerCase();
}

// ------- HASHBANG DEEP LINKING -------

// Serialize filter state and country to hashbang
function serializeStateToHash(countryCode = null) {
  const params = [];
  FACETS.forEach((facet) => {
    if (state[facet.key] && state[facet.key].size > 0) {
      params.push(
        encodeURIComponent(facet.key) +
          "=" +
          Array.from(state[facet.key]).map(encodeURIComponent).join(","),
      );
    }
  });
  if (countryCode) {
    params.push("country=" + encodeURIComponent(countryCode));
  }
  const hash = "#!" + params.join("&");
  window.location.hash = hash;
}

// Parse hashbang and restore filter state and country modal
function parseHashToState() {
  if (!window.location.hash.startsWith("#!")) return;
  const hash = window.location.hash.slice(2);
  const params = new URLSearchParams(hash.replace(/&/g, "&"));
  FACETS.forEach((facet) => {
    state[facet.key].clear();
    const val = params.get(facet.key);
    if (val) {
      val
        .split(",")
        .forEach((v) => state[facet.key].add(decodeURIComponent(v)));
    }
  });
  // Restore checked state in UI
  document.querySelectorAll(".btn-check").forEach((input) => {
    const key = input.dataset.facetKey;
    const val = input.dataset.value;
    input.checked = state[key] && state[key].has(val);
  });
  // If country is specified, show modal
  const countryCode = params.get("country");
  if (countryCode) {
    showCountryModal(countryCode, false);
  }
}

// Show modal with country info
function showCountryModal(code, updateHash = false) {
  const country = metas[code.toUpperCase()] || metas[code] || null;
  if (!country) return;

  // Modal elements
  const modalLabel = document.getElementById("countryModalLabel");
  const modalBody = document.getElementById("countryModalBody");

  // Title
  modalLabel.textContent = t(country.name) + " (" + code.toUpperCase() + ")";

  // Body (same info as card)
  modalBody.innerHTML = `
    <div>
      <strong>${t(country.name)}</strong>
      <small class="text-muted ms-1">${code.toUpperCase()}</small>
      <div class="mt-2">
        ${renderFacetLine("cameras", country.cameras)}
        ${renderFacetLine("flagColor", country.flagColor)}
        ${renderFacetLine("flagPattern", country.flagPattern)}
        ${renderFacetLine("roadLine", country.roadLine)}
        ${renderFacetLine("driving", country.driving)}
        ${renderFacetLine("alphabet", country.alphabet)}
        ${renderFacetLine("scenery", country.scenery)}
        ${renderFacetLine("uniqueLetter", country.uniqueLetter)}
        ${renderFacetLine("years", country.years)}
      </div>
    </div>
  `;

  // Show modal using Bootstrap 5 API
  let modal =
    window.bootstrap && window.bootstrap.Modal
      ? window.bootstrap.Modal.getOrCreateInstance(
          document.getElementById("countryModal"),
        )
      : null;
  if (modal) {
    modal.show();
  } else {
    // fallback for older bootstrap
    document.getElementById("countryModal").style.display = "block";
  }

  // Update hash with country if requested
  if (updateHash) {
    serializeStateToHash(code);
  }

  // Add event to remove country from hash on modal close
  document
    .getElementById("countryModal")
    .addEventListener("hidden.bs.modal", function handler() {
      serializeStateToHash();
      document
        .getElementById("countryModal")
        .removeEventListener("hidden.bs.modal", handler);
    });
}
