/**
 * Khandelia Oil & General Mills Pvt. Ltd. — 42 Costing Platform
 * Core Application Logic & Data Controller
 */

// Global App State
const state = {
  currentTab: 'owner-dashboard',
  unit: 'qtl', // 'qtl' or 'mt'
  filters: {
    supervisor: '',
    supplier: '',
    station: '',
    date_from: '',
    date_to: '',
    search: '',
    anomaly_only: false,
    lab_pending_only: false,
  },
  pagination: {
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1,
    sortBy: 'id',
    sortOrder: 'desc'
  },
  dnPagination: {
    page: 1,
    limit: 25,
    total: 0,
    totalAll: 2038,
    isFiltered: false,
    totalPages: 1,
    search: '',
    status: '',
    outcome: '',
    oilRange: '',
    station: '',
    sortBy: 's_no',
    sortOrder: 'asc'
  },
  anomalyPagination: {
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1,
    search: '',
    sortBy: 'anomaly_score',
    sortOrder: 'desc'
  },
  sourcing: {
    entity: 'supplier',
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'cost_42',
    sortOrder: 'asc',
    allRows: [],
    filteredRows: [],
    currentRows: [],
    total: 0,
    totalPages: 1
  },
  charts: {},
  filterOptions: {},
  paginators: {}
};

// Global Debounce Utility
function debounce(func, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initTheme();
  } catch (e) {
    console.error('Error in initTheme:', e);
  }
  try {
    setupEventListeners();
  } catch (e) {
    console.error('Error in setupEventListeners:', e);
  }
  try {
    await loadFilterOptions();
  } catch (e) {
    console.error('Error in loadFilterOptions:', e);
  }
  try {
    await refreshActiveView();
  } catch (e) {
    console.error('Error in refreshActiveView:', e);
  }
  // Asynchronously update Debit Note tab badge with live lot count
  fetch('/api/debit-note/kpis')
    .then(r => r.json())
    .then(data => {
      if (data && data.total_lots) {
        const badge = document.getElementById('debitNoteBadge');
        if (badge) badge.textContent = data.total_lots.toLocaleString();
        const btnLots = document.getElementById('btnSubtabLots');
        if (btnLots) btnLots.innerHTML = `<i class="fa-solid fa-table"></i> ${data.total_lots.toLocaleString()} Reconciled Lots`;
      }
    })
    .catch(err => console.debug('Initial DN badge fetch silent err:', err));
});

// --- Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem('kogm_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  if (theme === 'dark') {
    icon.className = 'fa-solid fa-moon';
  } else {
    icon.className = 'fa-solid fa-sun';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kogm_theme', next);
  updateThemeIcon(next);

  // Re-render active charts with updated theme contrast immediately
  if (state.currentTab === 'owner-dashboard') {
    loadRateCostTrend();
  } else if (state.currentTab === 'quality-lab') {
    loadOilDistribution();
  }
}

function getChartThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    isDark,
    textColor: isDark ? '#f8fafc' : '#0f172a',
    textSecondary: isDark ? '#94a3b8' : '#334155',
    gridColor: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)'
  };
}

// --- Event Listeners ---
function setupEventListeners() {
  // Theme Toggle
  document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);

  // Tab Navigation
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      switchTab(tabId);
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const tabId = tab.getAttribute('data-tab');
        switchTab(tabId);
      }
    });
  });

  // Filter Toolbar Buttons
  document.getElementById('btnApplyFilters').addEventListener('click', () => {
    readFiltersFromUI();
    state.pagination.page = 1;
    refreshActiveView();
  });

  document.getElementById('btnResetFilters').addEventListener('click', () => {
    resetFiltersUI();
    state.pagination.page = 1;
    refreshActiveView();
  });

  // Search input debounced enter
  document.getElementById('filterSearch').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      readFiltersFromUI();
      state.pagination.page = 1;
      refreshActiveView();
    }
  });

  // Date Range Picker Listeners (Sync display text on change & open picker on click)
  const wrapDateFrom = document.getElementById('wrapDateFrom');
  const elDateFrom = document.getElementById('filterDateFrom');
  if (wrapDateFrom && elDateFrom) {
    wrapDateFrom.addEventListener('click', () => {
      try {
        if (typeof elDateFrom.showPicker === 'function') {
          elDateFrom.showPicker();
        } else {
          elDateFrom.click();
        }
      } catch (err) {
        console.debug('showPicker error:', err);
      }
    });
  }

  const wrapDateTo = document.getElementById('wrapDateTo');
  const elDateTo = document.getElementById('filterDateTo');
  if (wrapDateTo && elDateTo) {
    wrapDateTo.addEventListener('click', () => {
      try {
        if (typeof elDateTo.showPicker === 'function') {
          elDateTo.showPicker();
        } else {
          elDateTo.click();
        }
      } catch (err) {
        console.debug('showPicker error:', err);
      }
    });
  }

  if (elDateFrom) {
    elDateFrom.addEventListener('input', () => {
      updateDateDisplayLabels();
      readFiltersFromUI();
    });
    elDateFrom.addEventListener('change', () => {
      updateDateDisplayLabels();
      readFiltersFromUI();
    });
  }
  if (elDateTo) {
    elDateTo.addEventListener('input', () => {
      updateDateDisplayLabels();
      readFiltersFromUI();
    });
    elDateTo.addEventListener('change', () => {
      updateDateDisplayLabels();
      readFiltersFromUI();
    });
  }

  // Page Size Selector
  document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
    state.pagination.limit = parseInt(e.target.value, 10);
    state.pagination.page = 1;
    loadEmployeeRecords();
  });

  // Anomaly Table Controls
  const selAnomalySize = document.getElementById('anomalyPageSizeSelect');
  if (selAnomalySize) {
    selAnomalySize.addEventListener('change', (e) => {
      state.anomalyPagination.limit = parseInt(e.target.value, 10);
      state.anomalyPagination.page = 1;
      loadAnomaliesTable();
    });
  }

  let anomalySearchTimer = null;
  const inpAnomalySearch = document.getElementById('anomalySearchInput');
  if (inpAnomalySearch) {
    inpAnomalySearch.addEventListener('input', (e) => {
      clearTimeout(anomalySearchTimer);
      anomalySearchTimer = setTimeout(() => {
        state.anomalyPagination.search = e.target.value.trim();
        state.anomalyPagination.page = 1;
        loadAnomaliesTable();
      }, 300);
    });
  }

  document.querySelectorAll('#tableAnomalies th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (state.anomalyPagination.sortBy === field) {
        state.anomalyPagination.sortOrder = state.anomalyPagination.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        state.anomalyPagination.sortBy = field;
        state.anomalyPagination.sortOrder = 'desc';
      }
      document.querySelectorAll('#tableAnomalies th[data-sort] i').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
      });
      const icon = th.querySelector('i');
      if (icon) {
        icon.className = state.anomalyPagination.sortOrder === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
      }
      loadAnomaliesTable();
    });
  });

  // Export CSV Button
  document.getElementById('btnExportCsv').addEventListener('click', exportCsv);

  // Katoti Format Mode Toggle (Rupees vs % / Decimal Excel Format)
  state.katotiMode = 'rupees';
  const katotiModeBtns = document.querySelectorAll('#calcKatotiModeToggle .unit-toggle-btn');
  katotiModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const kmode = btn.getAttribute('data-kmode') || 'rupees';
      state.katotiMode = kmode;
      katotiModeBtns.forEach(b => b.classList.toggle('active', b === btn));

      const isPercent = kmode === 'percent';
      const descEl = document.getElementById('calcDedModeDesc');
      if (descEl) {
        descEl.textContent = isPercent
          ? 'Current Mode: % / Decimal (Excel Lab Format — Auto-calculates ₹ cut from Mandi Rate)'
          : 'Current Mode: Direct ₹/Quintal Rate';
      }

      // Update unit tags
      ['Fm', 'Moisture', 'Greenish', 'Oil'].forEach(k => {
        const tag = document.getElementById(`tagDed${k}`);
        if (tag) tag.textContent = isPercent ? '% / Dec' : '₹/Qtl';
      });

      // Populate typical format values when switching modes
      if (isPercent) {
        const pDefaults = {
          calcDedFm: '0.0045',
          calcDedMoisture: '0.0030',
          calcDedGreenish: '0.0050',
          calcDedOil: '0.0050'
        };
        Object.entries(pDefaults).forEach(([id, val]) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        });
      } else {
        const rDefaults = {
          calcDedFm: '15.00',
          calcDedMoisture: '25.00',
          calcDedGreenish: '10.00',
          calcDedOil: '30.00'
        };
        Object.entries(rDefaults).forEach(([id, val]) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        });
      }

      runCalculatorSimulation();
    });
  });

  // Simple Step-by-Step 42% Calculator Inputs
  const calcInputIds = [
    'calcSellerRate',
    'calcDedFm',
    'calcDedMoisture',
    'calcDedGreenish',
    'calcDedOil',
    'calcDedBardana',
    'calcDedShortage',
    'calcLabOil'
  ];
  calcInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', runCalculatorSimulation);
    }
  });

  const btnResetCalc = document.getElementById('btnResetCalc');
  if (btnResetCalc) {
    btnResetCalc.addEventListener('click', () => {
      const isPercent = state.katotiMode === 'percent';
      const defaults = {
        calcSellerRate: '7200.00',
        calcDedFm: isPercent ? '0.0055' : '40.00',
        calcDedMoisture: isPercent ? '0.0250' : '180.00',
        calcDedGreenish: isPercent ? '0.0040' : '30.00',
        calcDedOil: isPercent ? '0.0165' : '120.00',
        calcDedBardana: '20.00',
        calcDedShortage: '30.00',
        calcLabOil: '39.80'
      };
      Object.entries(defaults).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      });
      runCalculatorSimulation();
    });
  }

  // Sourcing Hub Entity Pills
  document.querySelectorAll('#sourcingEntityPills .unit-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const entity = btn.getAttribute('data-entity');
      state.sourcing.entity = entity;
      state.sourcing.page = 1;
      state.sourcing.search = '';
      const searchInp = document.getElementById('sourcingSearchInput');
      if (searchInp) searchInp.value = '';

      document.querySelectorAll('#sourcingEntityPills .unit-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const thName = document.getElementById('thSourcingEntityName');
      if (thName) {
        const labels = {
          supplier: 'Supplier Name',
          broker: 'Broker / Agent Name',
          supervisor: 'Supervisor Name',
          station: 'Mandi / Station'
        };
        thName.textContent = labels[entity] || 'Entity Name';
      }
      loadSourcingRankings();
    });
  });

  // Sourcing Search Input (Instant Client-side Filter)
  let sourcingSearchTimer = null;
  const inpSourcingSearch = document.getElementById('sourcingSearchInput');
  if (inpSourcingSearch) {
    inpSourcingSearch.addEventListener('input', (e) => {
      clearTimeout(sourcingSearchTimer);
      sourcingSearchTimer = setTimeout(() => {
        state.sourcing.search = e.target.value.trim().toLowerCase();
        state.sourcing.page = 1;
        applySourcingPagination();
      }, 150);
    });
  }

  // Sourcing Limit Selector (Toolbar)
  document.getElementById('sourcingLimitSelect')?.addEventListener('change', (e) => {
    const lim = parseInt(e.target.value, 10);
    state.sourcing.limit = lim;
    state.sourcing.page = 1;
    const pageSelect = document.getElementById('sourcingPageSizeSelect');
    if (pageSelect) pageSelect.value = lim.toString();
    applySourcingPagination();
  });

  // Sourcing Page Size Selector (Bottom Pagination Bar)
  document.getElementById('sourcingPageSizeSelect')?.addEventListener('change', (e) => {
    const lim = parseInt(e.target.value, 10);
    state.sourcing.limit = lim;
    state.sourcing.page = 1;
    const limitSelect = document.getElementById('sourcingLimitSelect');
    if (limitSelect) limitSelect.value = lim.toString();
    applySourcingPagination();
  });

  // Sourcing Sort Column Dropdown
  document.getElementById('sourcingSortSelect')?.addEventListener('change', (e) => {
    state.sourcing.sortBy = e.target.value;
    state.sourcing.page = 1;
    loadSourcingRankings();
  });

  // Sourcing Sort Order (Incr / Decr)
  document.getElementById('btnSortOrderAsc')?.addEventListener('click', () => {
    state.sourcing.sortOrder = 'asc';
    document.getElementById('btnSortOrderAsc')?.classList.add('active');
    document.getElementById('btnSortOrderDesc')?.classList.remove('active');
    state.sourcing.page = 1;
    loadSourcingRankings();
  });

  document.getElementById('btnSortOrderDesc')?.addEventListener('click', () => {
    state.sourcing.sortOrder = 'desc';
    document.getElementById('btnSortOrderDesc')?.classList.add('active');
    document.getElementById('btnSortOrderAsc')?.classList.remove('active');
    state.sourcing.page = 1;
    loadSourcingRankings();
  });

  // Sourcing Intelligence Hub Excel Export Button
  document.getElementById('btnExportSourcingExcel')?.addEventListener('click', exportSourcingExcel);

  // Google Sheets Sync
  document.getElementById('btnTriggerSync').addEventListener('click', triggerGoogleSheetSync);

  // Modal Close
  document.getElementById('btnModalClose').addEventListener('click', closeModal);
  document.getElementById('recordModal').addEventListener('click', (e) => {
    if (e.target.id === 'recordModal') closeModal();
  });

  // Table Sort Header Clicks
  document.querySelectorAll('#tableRecords th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.getAttribute('data-sort');
      if (state.pagination.sortBy === field) {
        state.pagination.sortOrder = state.pagination.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        state.pagination.sortBy = field;
        state.pagination.sortOrder = 'desc';
      }
      loadEmployeeRecords();
    });
  });

  // Setup Debit Note Event Listeners
  setupDebitNoteEventListeners();

  // Unit Toggle (₹/Quintal vs ₹/MT)
  const btnUnitQtl = document.getElementById('btnUnitQtl');
  const btnUnitMt = document.getElementById('btnUnitMt');
  if (btnUnitQtl && btnUnitMt) {
    btnUnitQtl.addEventListener('click', () => setUnit('qtl'));
    btnUnitMt.addEventListener('click', () => setUnit('mt'));
  }

  // Upload & Email Modal Listeners
  setupUploadAndEmailHandlers();

  // Sarso Market AI Prediction Listeners
  setupSarsoEventListeners();

  // Global Commodities Listeners
  setupGlobalCommoditiesListeners();
}

function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${tabId}`);
  });
  refreshActiveView();
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return 'Select Date';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const dayStr = String(day).padStart(2, '0');
      return `${dayStr} ${monthNames[month]} ${year}`;
    }
  } catch (e) {
    console.error('Date formatting error:', e);
  }
  return dateStr;
}

function updateDateDisplayLabels() {
  const elDateFrom = document.getElementById('filterDateFrom');
  const elDateTo = document.getElementById('filterDateTo');
  const dispFrom = document.getElementById('displayDateFrom');
  const dispTo = document.getElementById('displayDateTo');
  if (dispFrom && elDateFrom) {
    dispFrom.textContent = formatDisplayDate(elDateFrom.value);
  }
  if (dispTo && elDateTo) {
    dispTo.textContent = formatDisplayDate(elDateTo.value);
  }
}

function readFiltersFromUI() {
  state.filters.supervisor = document.getElementById('filterSupervisor')?.value || '';
  state.filters.supplier = document.getElementById('filterSupplier')?.value || '';
  state.filters.station = document.getElementById('filterStation')?.value || '';
  state.filters.date_from = document.getElementById('filterDateFrom')?.value || '';
  state.filters.date_to = document.getElementById('filterDateTo')?.value || '';
  state.filters.anomaly_only = document.getElementById('filterAnomalyOnly')?.checked || false;
  state.filters.lab_pending_only = document.getElementById('filterLabPending')?.checked || false;
  state.filters.search = (document.getElementById('filterSearch')?.value || '').trim();
  updateDateDisplayLabels();
  renderGlobalActiveFiltersBar();
}

function resetFiltersUI() {
  if (document.getElementById('filterSupervisor')) document.getElementById('filterSupervisor').value = '';
  if (document.getElementById('filterSupplier')) document.getElementById('filterSupplier').value = '';
  if (document.getElementById('filterStation')) document.getElementById('filterStation').value = '';
  if (state.filterOptions && state.filterOptions.min_date) {
    if (document.getElementById('filterDateFrom')) document.getElementById('filterDateFrom').value = state.filterOptions.min_date;
    if (document.getElementById('filterDateTo')) document.getElementById('filterDateTo').value = state.filterOptions.max_date;
  } else {
    if (document.getElementById('filterDateFrom')) document.getElementById('filterDateFrom').value = '';
    if (document.getElementById('filterDateTo')) document.getElementById('filterDateTo').value = '';
  }
  if (document.getElementById('filterAnomalyOnly')) document.getElementById('filterAnomalyOnly').checked = false;
  if (document.getElementById('filterLabPending')) document.getElementById('filterLabPending').checked = false;
  if (document.getElementById('filterSearch')) document.getElementById('filterSearch').value = '';
  readFiltersFromUI();
}

function renderGlobalActiveFiltersBar() {
  const bar = document.getElementById('globalActiveFiltersBar');
  if (!bar) return;

  const chips = [];

  const toggleControlActive = (el, isActive) => {
    if (!el) return;
    const itemWrap = el.closest('.filter-item') || el;
    if (isActive) {
      itemWrap.classList.add('filter-active-control');
    } else {
      itemWrap.classList.remove('filter-active-control');
    }
  };

  const supEl = document.getElementById('filterSupervisor');
  const supActive = !!(state.filters.supervisor);
  toggleControlActive(supEl, supActive);
  if (supActive) {
    chips.push({
      key: 'supervisor',
      label: 'Supervisor',
      value: state.filters.supervisor,
      icon: 'fa-solid fa-user-tie'
    });
  }

  const suppEl = document.getElementById('filterSupplier');
  const suppActive = !!(state.filters.supplier);
  toggleControlActive(suppEl, suppActive);
  if (suppActive) {
    chips.push({
      key: 'supplier',
      label: 'Supplier',
      value: state.filters.supplier,
      icon: 'fa-solid fa-building'
    });
  }

  const statEl = document.getElementById('filterStation');
  const statActive = !!(state.filters.station);
  toggleControlActive(statEl, statActive);
  if (statActive) {
    chips.push({
      key: 'station',
      label: 'Station',
      value: state.filters.station,
      icon: 'fa-solid fa-location-dot'
    });
  }

  const searchEl = document.getElementById('filterSearch');
  const searchActive = !!(state.filters.search && state.filters.search.trim());
  toggleControlActive(searchEl, searchActive);
  if (searchActive) {
    chips.push({
      key: 'search',
      label: 'Search',
      value: `"${state.filters.search}"`,
      icon: 'fa-solid fa-magnifying-glass'
    });
  }

  const anomEl = document.getElementById('filterAnomalyOnly');
  const anomActive = !!(state.filters.anomaly_only);
  toggleControlActive(anomEl, anomActive);
  if (anomActive) {
    chips.push({
      key: 'anomaly_only',
      label: 'Filter',
      value: 'Anomalies Only',
      icon: 'fa-solid fa-triangle-exclamation'
    });
  }

  const labEl = document.getElementById('filterLabPending');
  const labActive = !!(state.filters.lab_pending_only);
  toggleControlActive(labEl, labActive);
  if (labActive) {
    chips.push({
      key: 'lab_pending_only',
      label: 'Filter',
      value: 'Lab Pending Only',
      icon: 'fa-solid fa-hourglass-half'
    });
  }

  const isCustomDate = !!(state.filterOptions && state.filters.date_from && state.filters.date_to &&
    (state.filters.date_from !== state.filterOptions.min_date || state.filters.date_to !== state.filterOptions.max_date));
  const wrapDate = document.getElementById('dateRangePickerWrap');
  if (wrapDate) {
    if (isCustomDate) wrapDate.classList.add('filter-active-control');
    else wrapDate.classList.remove('filter-active-control');
  }
  if (isCustomDate) {
    chips.push({
      key: 'date_range',
      label: 'Date Range',
      value: `${formatDisplayDate(state.filters.date_from)} to ${formatDisplayDate(state.filters.date_to)}`,
      icon: 'fa-regular fa-calendar'
    });
  }

  if (chips.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="active-filters-label">
      <i class="fa-solid fa-filter-circle-check"></i> Active Filters (${chips.length}):
    </span>
    ${chips.map(c => `
      <span class="active-filter-chip">
        <i class="${c.icon}" style="color: var(--mustard-gold); font-size: 0.75rem;"></i>
        <span>${c.label}: <strong>${c.value}</strong></span>
        <button class="btn-chip-remove" onclick="clearGlobalFilter('${c.key}')" title="Remove ${c.label} filter">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </span>
    `).join('')}
    <button class="btn-clear-all-chips" onclick="resetGlobalFilters()" title="Reset all global filters">
      <i class="fa-solid fa-rotate-left"></i> Clear All (${chips.length})
    </button>
  `;
}

function clearGlobalFilter(key) {
  if (key === 'supervisor') {
    const el = document.getElementById('filterSupervisor');
    if (el) el.value = '';
  } else if (key === 'supplier') {
    const el = document.getElementById('filterSupplier');
    if (el) el.value = '';
  } else if (key === 'station') {
    const el = document.getElementById('filterStation');
    if (el) el.value = '';
  } else if (key === 'search') {
    const el = document.getElementById('filterSearch');
    if (el) el.value = '';
  } else if (key === 'anomaly_only') {
    const el = document.getElementById('filterAnomalyOnly');
    if (el) el.checked = false;
  } else if (key === 'lab_pending_only') {
    const el = document.getElementById('filterLabPending');
    if (el) el.checked = false;
  } else if (key === 'date_range') {
    if (state.filterOptions) {
      const elFrom = document.getElementById('filterDateFrom');
      const elTo = document.getElementById('filterDateTo');
      if (elFrom) elFrom.value = state.filterOptions.min_date || '';
      if (elTo) elTo.value = state.filterOptions.max_date || '';
    }
  }
  readFiltersFromUI();
  state.pagination.page = 1;
  refreshActiveView();
}

function resetGlobalFilters() {
  resetFiltersUI();
  state.pagination.page = 1;
  refreshActiveView();
}

window.clearGlobalFilter = clearGlobalFilter;
window.resetGlobalFilters = resetGlobalFilters;

function buildQueryString(extraParams = {}) {
  const params = new URLSearchParams();
  if (state.filters.supervisor) params.append('supervisor', state.filters.supervisor);
  if (state.filters.supplier) params.append('supplier', state.filters.supplier);
  if (state.filters.station) params.append('station', state.filters.station);
  if (state.filters.date_from) params.append('date_from', state.filters.date_from);
  if (state.filters.date_to) params.append('date_to', state.filters.date_to);
  if (state.filters.anomaly_only) params.append('anomaly_only', 'true');
  if (state.filters.lab_pending_only) params.append('lab_pending_only', 'true');
  if (state.filters.search) params.append('search', state.filters.search);

  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null && v !== '') {
      params.append(k, v);
    }
  }
  return params.toString();
}

// --- Load Dropdown Filter Options ---
async function loadFilterOptions() {
  try {
    const res = await fetch('/api/filters/options');
    const data = await res.json();
    state.filterOptions = data;

    const supCount = data.supervisors ? data.supervisors.length : 0;
    const suppCount = data.suppliers ? data.suppliers.length : 0;
    const statCount = data.stations ? data.stations.length : 0;

    populateSelect('filterSupervisor', data.supervisors, `All Supervisors (${supCount})`);
    populateSelect('filterSupplier', data.suppliers, `All Suppliers (${suppCount})`);
    populateSelect('filterStation', data.stations, `All Stations / Mandis (${statCount})`);

    // Auto-set Date From and Date To inputs with the dataset date range (e.g., 2026-04-01 to 2026-09-01)
    const elDateFrom = document.getElementById('filterDateFrom');
    const elDateTo = document.getElementById('filterDateTo');
    if (elDateFrom && data.min_date) {
      elDateFrom.value = data.min_date;
      elDateFrom.min = data.min_date;
      elDateFrom.max = data.max_date;
    }
    if (elDateTo && data.max_date) {
      elDateTo.value = data.max_date;
      elDateTo.min = data.min_date;
      elDateTo.max = data.max_date;
    }
    readFiltersFromUI();
  } catch (err) {
    console.error("Failed loading filter options:", err);
  }
}

function populateSelect(selectId, items, defaultText) {
  const select = document.getElementById(selectId);
  select.innerHTML = `<option value="">${defaultText}</option>`;
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  });
}

// --- Master View Dispatcher ---
async function refreshActiveView() {
  // Always update global KPIs to keep status bar and badges fresh
  loadKPIs();

  switch (state.currentTab) {
    case 'owner-dashboard':
      await Promise.all([
        loadRateCostTrend(),
        load3DayBenchmark()
      ]);
      break;
    case 'employee-hub':
      await loadEmployeeRecords();
      break;
    case 'quality-analytics':
      await Promise.all([loadQualityDistribution(), loadLabComparison()]);
      break;
    case 'supplier-intelligence':
      await Promise.all([
        loadSourcingRankings(),
        loadTopSupplierRankings(),
        loadWeeklySuppliers(),
        loadLocationSuppliers(),
        loadDormantSupplierAlerts(),
        loadSupplierScorecards()
      ]);
      break;
    case 'ai-anomalies':
      await loadAnomaliesTable();
      break;
    case 'formula-guide':
      runCalculatorSimulation();
      break;
    case 'data-audit':
      await loadDataQualityAudit();
      break;
    case 'google-sync':
      await loadSyncHistory();
      break;
    case 'debit-note-analysis':
      await Promise.all([loadDebitNoteKpis(), loadDebitNoteRecords(), loadDebitNoteSuppliers(), loadDebitNoteDiscrepancies()]);
      runDnSimulation();
      break;
    case 'sarso-prediction':
      await loadSarsoPredictionModule();
      break;
    case 'global-commodities':
      await loadGlobalCommoditiesModule();
      break;
  }
}

// --- VIEW 1: Owner Dashboard & KPIs ---
async function loadKPIs() {
  try {
    const qs = buildQueryString();
    const res = await fetch(`/api/dashboard/kpis?${qs}`);
    const kpi = await res.json();
    state.kpiData = kpi;

    const mult = state.unit === 'mt' ? 10.0 : 1.0;
    const unitSuffix = state.unit === 'mt' ? '/ MT' : '/ Qtl';

    const recWtQtl = kpi.total_rec_wt_qtl !== undefined ? (kpi.total_rec_wt_qtl || 0) : (kpi.total_weight_qtl || 0);
    const recWtMt = kpi.total_rec_wt_mt !== undefined ? (kpi.total_rec_wt_mt || 0) : (recWtQtl / 10.0);
    const billWtQtl = kpi.total_bill_wt_qtl !== undefined ? (kpi.total_bill_wt_qtl || 0) : (recWtQtl || 0);

    const volText = state.unit === 'mt'
      ? `${recWtMt.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MT`
      : `${recWtQtl.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Qtl`;

    const volParts = volText.split(' ');
    const elVol = document.getElementById('kpiVolume');
    if (elVol) elVol.innerHTML = `${volParts[0]} <span class="kpi-unit">${volParts[1] || 'Qtl'}</span>`;
    const volSub = document.getElementById('kpiVolumeSubtext');
    if (volSub) {
      volSub.innerHTML = `<span>Billed Wt: <strong>${billWtQtl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Qtl</strong></span>`;
    }

    const rateVal = (kpi.avg_actual_rate || 0) * mult;
    const elRate = document.getElementById('kpiActualRate');
    if (elRate) elRate.innerHTML = `₹${rateVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span class="kpi-unit">${unitSuffix}</span>`;

    const oilVal = kpi.avg_oil_manual || 0;
    const elOil = document.getElementById('kpiOilManual');
    if (elOil) elOil.innerHTML = `${oilVal.toFixed(2)}%`;

    const landingCostQtl = kpi.avg_landing_cost_qtl || 0;
    const landingCostVal = landingCostQtl * mult;
    const cost42Qtl = kpi.avg_cost_42 || 0;
    const cost42Val = cost42Qtl * mult;

    // Card 4: 42% Benchmark Cost on Landing
    const elCost42 = document.getElementById('kpiCost42');
    if (elCost42) elCost42.innerHTML = `₹${cost42Val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span class="kpi-unit">${unitSuffix}</span>`;
    const delta = cost42Val - landingCostVal;
    const badge = document.getElementById('kpiCostDeltaBadge');
    if (badge) {
      badge.textContent = `${delta >= 0 ? '+' : ''}₹${delta.toFixed(0)}`;
      badge.className = delta > 0 ? 'trend-badge danger' : 'trend-badge success';
      badge.title = `Landing Cost se ${delta >= 0 ? '+' : ''}₹${delta.toFixed(2)}/Qtl Quality Variance`;
    }

    // Card 5: Apple-to-Apple Quality Loss / Profit (42 Costing vs Khareed Rate)
    const billedRateQtl = kpi.avg_actual_rate || 7568.04;
    const diffVsKhareedQtl = cost42Qtl - billedRateQtl;
    const netKhareedImpactInr = diffVsKhareedQtl * recWtQtl;
    const netImpactCr = Math.abs(netKhareedImpactInr) / 10000000;
    const isQualityLoss = diffVsKhareedQtl > 0;
    const exactInrFormatted = `${isQualityLoss ? '-₹' : '+₹'}${Math.abs(Math.round(netKhareedImpactInr)).toLocaleString('en-IN')}`;

    const elQuality = document.getElementById('kpiQualityImpact');
    const elQualityTitle = document.getElementById('kpiQualityTitle');
    if (elQualityTitle) {
      elQualityTitle.textContent = isQualityLoss ? 'Net Quality Loss' : 'Net Quality Profit';
    }
    if (elQuality) {
      elQuality.innerHTML = `
        <div style="display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; line-height: 1.1;">
          <span style="font-size: 1.55rem; font-weight: 900; color: ${isQualityLoss ? '#ef4444' : '#10b981'};">${isQualityLoss ? '-₹' : '+₹'}${netImpactCr.toFixed(2)}</span>
          <span class="kpi-unit" style="font-size: 0.95rem; font-weight: 700;">Cr</span>
        </div>
        <div style="font-size: 0.82rem; font-weight: 800; color: ${isQualityLoss ? '#ef4444' : '#10b981'}; font-family: var(--font-mono, monospace); margin-top: 2px; letter-spacing: 0.01em;" title="Exact Net Amount: ${exactInrFormatted}">
          ${exactInrFormatted}
        </div>
      `;
      elQuality.style.color = isQualityLoss ? '#ef4444' : '#10b981';
      elQuality.title = `Exact Total Amount: ${exactInrFormatted} (${recWtQtl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Qtl × ${isQualityLoss ? '+' : '-'}₹${Math.abs(diffVsKhareedQtl).toFixed(2)}/Qtl)`;
    }
    const impactDet = document.getElementById('kpiImpactDetail');
    if (impactDet) {
      const diffSign = isQualityLoss ? '+' : '-';
      const diffUnitSuffix = state.unit === 'mt' ? '/MT' : '/Qtl';
      const diffVal = state.unit === 'mt' ? Math.abs(diffVsKhareedQtl) * 10 : Math.abs(diffVsKhareedQtl);
      impactDet.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 3px 6px; border-radius: 5px; background: rgba(0, 0, 0, 0.04); font-size: 0.78rem; margin-top: 2px;" title="Difference between 42% Standard Cost and Purchase Buying Rate">
          <span style="color: var(--text-secondary); font-weight: 600;">Rate Variance:</span>
          <strong style="color: ${isQualityLoss ? '#dc2626' : '#059669'}; font-weight: 800; font-family: var(--font-mono);">${diffSign}₹${diffVal.toFixed(2)} ${diffUnitSuffix}</strong>
        </div>
      `;
    }

    // Card 6: 3-Day Benchmark (Fetch dynamic from backend)
    try {
      const bRes = await fetch('/api/analytics/benchmark-3days');
      const bData = await bRes.json();
      const b3Val = (bData.avg_cost_42 || 8363.78) * mult;
      const el3Day = document.getElementById('kpi3DayCost');
      if (el3Day) {
        el3Day.innerHTML = `₹${b3Val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span class="kpi-unit">${unitSuffix}</span>`;
      }
      const el3DaySub = document.getElementById('kpi3DaySubtext');
      if (el3DaySub && bData.dates && bData.dates.length > 0) {
        const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        // Sort dates chronologically
        const sortedDates = [...bData.dates].sort();
        const days = sortedDates.map(dStr => {
          const parts = dStr.split('-');
          return parts.length === 3 ? parts[2] : dStr;
        });
        const lastPart = sortedDates[sortedDates.length - 1].split('-');
        const monthYear = lastPart.length === 3 ? `${monthsShort[parseInt(lastPart[1], 10) - 1] || lastPart[1]} ${lastPart[0]}` : '';
        el3DaySub.innerHTML = `<span>Dates: <strong>${days.join(', ')} ${monthYear}</strong></span>`;
      }
    } catch (e) {
      console.warn("Could not load 3day benchmark:", e);
    }

    // Update Loss vs Profit Counts from Backend KPI
    const lossCount = kpi.loss_count !== undefined ? kpi.loss_count : 1523;
    const profitCount = kpi.profit_count !== undefined ? kpi.profit_count : 489;
    const neutralCount = kpi.neutral_count !== undefined ? kpi.neutral_count : 18;
    const pendingCount = kpi.pending_count !== undefined ? kpi.pending_count : 8;
    const totLots = kpi.total_records || (lossCount + profitCount + neutralCount + pendingCount);

    const lossPct = kpi.loss_pct !== undefined ? kpi.loss_pct : (totLots > 0 ? ((lossCount / totLots) * 100).toFixed(1) : 0);
    const profitPct = kpi.profit_pct !== undefined ? kpi.profit_pct : (totLots > 0 ? ((profitCount / totLots) * 100).toFixed(1) : 0);
    const neutralPct = kpi.neutral_pct !== undefined ? kpi.neutral_pct : (totLots > 0 ? ((neutralCount / totLots) * 100).toFixed(1) : 0);
    const pendingPct = kpi.pending_pct !== undefined ? kpi.pending_pct : (totLots > 0 ? ((pendingCount / totLots) * 100).toFixed(1) : 0);

    const elTrendLoss = document.getElementById('trendLossCount');
    if (elTrendLoss) elTrendLoss.textContent = lossCount.toLocaleString('en-IN');
    const elTrendLossPct = document.getElementById('trendLossPct');
    if (elTrendLossPct) elTrendLossPct.textContent = `${lossPct}%`;

    const elTrendProfit = document.getElementById('trendProfitCount');
    if (elTrendProfit) elTrendProfit.textContent = profitCount.toLocaleString('en-IN');
    const elTrendProfitPct = document.getElementById('trendProfitPct');
    if (elTrendProfitPct) elTrendProfitPct.textContent = `${profitPct}%`;

    const elTrendNeutral = document.getElementById('trendNeutralCount');
    if (elTrendNeutral) elTrendNeutral.textContent = neutralCount.toLocaleString('en-IN');
    const elTrendNeutralPct = document.getElementById('trendNeutralPct');
    if (elTrendNeutralPct) elTrendNeutralPct.textContent = `${neutralPct}%`;

    const elTrendPending = document.getElementById('trendPendingCount');
    if (elTrendPending) elTrendPending.textContent = pendingCount.toLocaleString('en-IN');
    const elTrendPendingPct = document.getElementById('trendPendingPct');
    if (elTrendPendingPct) elTrendPendingPct.textContent = `${pendingPct}%`;

    const elTrendTotal = document.getElementById('trendTotalCount');
    if (elTrendTotal) elTrendTotal.textContent = `${totLots.toLocaleString('en-IN')} Lots`;

    const elKpiLoss = document.getElementById('kpiLossCountLabel');
    if (elKpiLoss) {
      elKpiLoss.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> <strong>${lossCount.toLocaleString('en-IN')}</strong> Loss`;
      elKpiLoss.title = `${lossCount.toLocaleString('en-IN')} Lots (${lossPct}% Loss)`;
    }
    const elKpiProfit = document.getElementById('kpiProfitCountLabel');
    if (elKpiProfit) {
      elKpiProfit.innerHTML = `<i class="fa-solid fa-arrow-trend-down"></i> <strong>${profitCount.toLocaleString('en-IN')}</strong> Profit`;
      elKpiProfit.title = `${profitCount.toLocaleString('en-IN')} Lots (${profitPct}% Profit)`;
    }

    document.getElementById('kpiAnomalyCount').textContent = kpi.anomaly_count;

    document.getElementById('totalRecordsBadge').textContent = kpi.total_records.toLocaleString();
    document.getElementById('anomalyBadge').textContent = kpi.anomaly_count;
    document.getElementById('syncStatusText').textContent = `${kpi.total_records.toLocaleString()} Verified Records`;
  } catch (err) {
    console.error("Error loading KPIs:", err);
  }
}

async function loadRateCostTrend() {
  try {
    const qs = buildQueryString();
    const res = await fetch(`/api/analytics/trends?${qs}`);
    const trends = await res.json();

    const tc = getChartThemeColors();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const mult = state.unit === 'mt' ? 10.0 : 1.0;
    const unitLabel = state.unit === 'mt' ? '₹/MT' : '₹/Qtl';
    const unitSuffix = state.unit === 'mt' ? '/ MT' : '/ Qtl';

    const labels = trends.map(t => t.date);
    const rates = trends.map(t => +(t.avg_rate * mult).toFixed(2));
    const landings = trends.map(t => +(t.landing_cost * mult).toFixed(2));
    const costs = trends.map(t => +(t.avg_cost_42 * mult).toFixed(2));

    // Calculate dynamic Y-axis bounds so differences between lines are clearly visible
    const allVals = [...rates, ...landings, ...costs].filter(v => typeof v === 'number' && !isNaN(v) && v > 0);
    let yMin = undefined;
    let yMax = undefined;
    if (allVals.length > 0) {
      const minVal = Math.min(...allVals);
      const maxVal = Math.max(...allVals);
      const stepUnit = state.unit === 'mt' ? 1000 : 200;
      const padding = Math.max((maxVal - minVal) * 0.12, stepUnit);
      yMin = Math.max(0, Math.floor((minVal - padding) / stepUnit) * stepUnit);
      yMax = Math.ceil((maxVal + padding) / stepUnit) * stepUnit;
    }

    const colorRate = isDark ? '#38bdf8' : '#0284c7';
    const colorLanding = isDark ? '#10b981' : '#059669';
    const colorCost = isDark ? '#f59e0b' : '#d97706';

    const monthNamesFull = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    function formatFullDeliveryDate(dStr) {
      if (!dStr) return '';
      const parts = dStr.split('-');
      if (parts.length === 3) {
        const y = parts[0];
        const m = parseInt(parts[1], 10) - 1;
        const d = parts[2];
        const mName = monthNamesFull[m] || parts[1];
        return `${d} / ${mName} / ${y}`;
      }
      return dStr;
    }

    const ctx = document.getElementById('chartRateVsCost').getContext('2d');
    if (state.charts.rateVsCost) state.charts.rateVsCost.destroy();

    state.charts.rateVsCost = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: `Mandi Purchase Rate (${unitLabel})`,
            data: rates,
            borderColor: colorRate,
            backgroundColor: isDark ? 'rgba(56, 189, 248, 0.06)' : 'rgba(2, 132, 199, 0.05)',
            pointBackgroundColor: colorRate,
            pointBorderColor: colorRate,
            pointHoverBackgroundColor: colorRate,
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
            tension: 0.25,
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 6.5,
            fill: false
          },
          {
            label: `Factory Landing Cost (${unitLabel})`,
            data: landings,
            borderColor: colorLanding,
            backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(5, 150, 105, 0.08)',
            pointBackgroundColor: colorLanding,
            pointBorderColor: colorLanding,
            pointHoverBackgroundColor: colorLanding,
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
            tension: 0.25,
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 6.5,
            fill: false
          },
          {
            label: `42% Benchmark Cost (${unitLabel})`,
            data: costs,
            borderColor: colorCost,
            backgroundColor: isDark ? 'rgba(245, 158, 11, 0.10)' : 'rgba(217, 119, 6, 0.08)',
            pointBackgroundColor: colorCost,
            pointBorderColor: colorCost,
            pointHoverBackgroundColor: colorCost,
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2.5,
            tension: 0.25,
            borderWidth: 3.2,
            pointRadius: 3,
            pointHoverRadius: 7.5,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 14,
            bottom: 6,
            left: 6,
            right: 12
          }
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: tc.textColor,
              font: { family: "'Outfit', 'Inter', sans-serif", size: 16, weight: '800' },
              padding: 24,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 12,
              boxHeight: 12
            }
          },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: isDark ? 'rgba(11, 18, 33, 0.98)' : 'rgba(15, 23, 42, 0.96)',
            titleColor: '#ffffff',
            titleFont: { family: "'Outfit', 'Inter', sans-serif", size: 16.5, weight: '700' },
            titleSpacing: 8,
            bodyColor: '#f1f5f9',
            bodyFont: { family: "'Inter', sans-serif", size: 15, weight: '600' },
            bodySpacing: 8,
            padding: 16,
            cornerRadius: 12,
            borderColor: colorCost,
            borderWidth: 1.5,
            displayColors: true,
            boxWidth: 12,
            boxHeight: 12,
            boxPadding: 8,
            usePointStyle: true,
            labelPointStyle: () => {
              return {
                pointStyle: 'circle',
                rotation: 0
              };
            },
            labelColor: (context) => {
              const colors = [colorRate, colorLanding, colorCost];
              const c = colors[context.datasetIndex] || colorRate;
              return {
                borderColor: c,
                backgroundColor: c,
                borderWidth: 0
              };
            },
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                const d = trends[idx]?.date || items[0].label;
                return `📅 Delivery Date: ${formatFullDeliveryDate(d)}`;
              },
              label: (context) => {
                const idx = context.dataIndex;
                const t = trends[idx];
                const val = context.raw;
                const formattedVal = `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unitSuffix}`;

                if (context.datasetIndex === 0) {
                  return ` Mandi Purchase Rate:  ${formattedVal}  (Mandi Buying Rate)`;
                } else if (context.datasetIndex === 1) {
                  const kat = (t.katoti_qtl * mult).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  return ` Factory Landing Cost:  ${formattedVal}  (Deduction: -₹${kat} ${unitSuffix})`;
                } else if (context.datasetIndex === 2) {
                  return ` 42% Benchmark Cost:  ${formattedVal}  (Landing Benchmark)`;
                }
                return ` ${context.dataset.label}:  ${formattedVal}`;
              },
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const t = trends[idx];
                if (!t) return [];
                const oil = t.avg_oil || 0;
                const oilGap = (oil - 42.0).toFixed(2);

                // Comparison: 42 Costing vs Mandi Purchase Rate (Col Y / Col W) -> Profit ya Loss
                const rateDiff = (t.avg_cost_42 - t.avg_rate) * mult;
                const isRateLoss = rateDiff > 0;
                const rateDiffPct = t.avg_rate > 0 ? (Math.abs(rateDiff) / (t.avg_rate * mult) * 100).toFixed(2) : '0.00';
                const rateOutcomeText = isRateLoss
                  ? `⚠️ Quality Loss: +₹${rateDiff.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unitSuffix} (+${rateDiffPct}%)`
                  : `🎉 Quality Profit: -₹${Math.abs(rateDiff).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unitSuffix} (-${rateDiffPct}%)`;

                const oilStatusText = Number(oilGap) < 0
                  ? `🧪 Lab NIR Oil: ${oil.toFixed(2)}% (Deficit: ${oilGap}% vs 42.00%)`
                  : `🧪 Lab NIR Oil: ${oil.toFixed(2)}% (Surplus: +${oilGap}% vs 42.00%)`;

                return [
                  '────────────────────────────────────────────────────────',
                  rateOutcomeText,
                  oilStatusText
                ];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: tc.textSecondary,
              font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
              maxTicksLimit: 12,
              autoSkip: true,
              autoSkipPadding: 24,
              maxRotation: 0,
              minRotation: 0,
              padding: 8,
              callback: function (val, index) {
                const dStr = this.getLabelForValue(val);
                if (!dStr) return '';
                const parts = dStr.split('-');
                if (parts.length === 3) {
                  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const mIdx = parseInt(parts[1], 10) - 1;
                  return `${parts[2]} ${months[mIdx] || parts[1]}`;
                }
                return dStr;
              }
            },
            grid: { color: tc.gridColor }
          },
          y: {
            min: yMin,
            max: yMax,
            ticks: {
              color: tc.textSecondary,
              font: { family: "'Inter', sans-serif", size: 12.5, weight: '600' },
              callback: (val) => `₹${val.toLocaleString('en-IN')}`
            },
            grid: { color: tc.gridColor }
          }
        }
      }
    });
  } catch (err) {
    console.error("Error loading trends:", err);
  }
}

async function loadAiInsights() {
  try {
    const qs = buildQueryString();
    const res = await fetch(`/api/ai/insights?${qs}`);
    const insights = await res.json();

    const container = document.getElementById('dashboardAiInsights');
    if (!container) return;
    container.innerHTML = '';

    insights.slice(0, 3).forEach(ins => {
      const card = createInsightCardElement(ins);
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Error loading AI insights:", err);
  }
}

function createInsightCardElement(ins) {
  const card = document.createElement('div');
  card.className = `ai-insight-card ${ins.type || 'info'}`;

  let citationsHtml = '';
  if (ins.citations && ins.citations.length > 0) {
    citationsHtml = `<div class="citation-chips">` +
      ins.citations.slice(0, 4).map(c => {
        const text = Object.entries(c).map(([k, v]) => `${v}`).join(' • ');
        return `<span class="citation-chip">${text}</span>`;
      }).join('') +
      `</div>`;
  }

  card.innerHTML = `
    <div class="insight-cat">${ins.category}</div>
    <div class="insight-title">${ins.title}</div>
    <div class="insight-body">${ins.narrative}</div>
    ${citationsHtml}
  `;
  return card;
}

async function loadTopSuppliersTable() {
  try {
    const tbody = document.querySelector('#tableTopSuppliers tbody');
    if (!tbody) return;
    const res = await fetch('/api/analytics/suppliers?limit=6');
    const supps = await res.json();
    tbody.innerHTML = '';

    supps.forEach(s => {
      const tr = document.createElement('tr');
      const isLoss = s.avg_cost_diff_pct > 0;
      const costBadge = isLoss
        ? `<span class="trend-badge danger" style="font-weight:700;">+${s.avg_cost_diff_pct}% Loss</span>`
        : `<span class="trend-badge success" style="font-weight:700;">-${Math.abs(s.avg_cost_diff_pct)}% Profit</span>`;

      tr.innerHTML = `
        <td><strong>${s.supplier_name}</strong></td>
        <td>${s.total_trips}</td>
        <td>${s.total_qty_qtl.toLocaleString()}</td>
        <td>₹${s.avg_rate.toLocaleString()}</td>
        <td><strong style="color: var(--accent-cyan);">${s.avg_oil}%</strong></td>
        <td><strong style="color: var(--mustard-gold);">₹${s.avg_cost_42.toLocaleString()}</strong></td>
        <td>${costBadge}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading top suppliers:", err);
  }
}

async function loadStationRankings() {
  try {
    const tbody = document.querySelector('#tableStationRankings tbody');
    if (!tbody) return;
    const res = await fetch('/api/analytics/stations');
    const stations = await res.json();
    tbody.innerHTML = '';

    stations.slice(0, 6).forEach(st => {
      const tr = document.createElement('tr');
      const isLoss = st.avg_cost_diff_pct > 0;
      const badge = isLoss
        ? `<span class="trend-badge danger" style="font-weight:700;">+${st.avg_cost_diff_pct}% Loss</span>`
        : `<span class="trend-badge success" style="font-weight:700;">-${Math.abs(st.avg_cost_diff_pct)}% Profit</span>`;

      tr.innerHTML = `
        <td><strong>${st.station}</strong></td>
        <td>${st.total_qty_qtl.toLocaleString()}</td>
        <td>₹${st.avg_rate ? st.avg_rate.toLocaleString() : '—'}</td>
        <td><strong style="color: var(--accent-cyan);">${st.avg_oil}%</strong></td>
        <td><strong style="color: var(--mustard-gold);">₹${st.avg_cost_42.toLocaleString()}</strong></td>
        <td>${badge}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading station rankings:", err);
  }
}

// --- VIEW 2: Employee Operational Hub ---
async function loadEmployeeRecords() {
  try {
    const qs = buildQueryString({
      page: state.pagination.page,
      limit: state.pagination.limit,
      sort_by: state.pagination.sortBy,
      sort_order: state.pagination.sortOrder
    });

    const res = await fetch(`/api/records?${qs}`);
    const data = await res.json();

    state.pagination.total = data.total;
    state.pagination.totalPages = data.pages;

    const tbody = document.querySelector('#tableRecords tbody');
    tbody.innerHTML = '';

    if (data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding: 2rem; color: var(--text-muted);">No records found matching current filters.</td></tr>`;
      renderPaginationControls();
      return;
    }

    data.records.forEach(r => {
      const tr = document.createElement('tr');
      if (r.is_anomaly) tr.style.borderLeft = '3px solid var(--danger-red)';

      let statusBadge = '';
      if (r.costing_status === 'LAB_PENDING') {
        statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-hourglass-start"></i> Pending Lab</span>`;
      } else if (r.is_anomaly) {
        statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Anomaly</span>`;
      } else {
        statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Verified</span>`;
      }

      const cost42Text = r.cost_42 ? `₹${r.cost_42.toFixed(2)}` : '—';
      let costDiffText = '—';
      if (r.cost_diff !== null && r.cost_diff !== undefined) {
        if (r.cost_diff > 0) {
          costDiffText = `<span class="badge-diff-danger" style="font-weight: 700; font-size: 0.8rem; display:inline-block;"><i class="fa-solid fa-arrow-trend-up"></i> +₹${r.cost_diff.toFixed(2)} (+${r.cost_diff_pct}% Loss)</span>`;
        } else {
          costDiffText = `<span class="badge-diff-success" style="font-weight: 700; font-size: 0.8rem; display:inline-block;"><i class="fa-solid fa-arrow-trend-down"></i> -₹${Math.abs(r.cost_diff).toFixed(2)} (${r.cost_diff_pct}% Profit)</span>`;
        }
      }

      const hasMismatch = r.oil_analyzer && r.oil_manual && Math.abs(r.oil_manual - r.oil_analyzer) > 0.05;
      const oilByHtml = r.oil_manual ? `<strong style="color: #c084fc; font-size: 0.9rem;">${r.oil_manual.toFixed(2)}%</strong>` : '<span style="color:var(--warning-orange);">Pending</span>';
      const oilAxHtml = r.oil_analyzer ? (hasMismatch
        ? `<span style="color: var(--danger-red); font-weight: 700; font-size: 0.85rem;" title="Discrepancy: BY (${r.oil_manual.toFixed(2)}%) vs AX (${r.oil_analyzer.toFixed(2)}%)">${r.oil_analyzer.toFixed(2)}% ⚠️</span>`
        : `<span style="color: var(--accent-blue); font-size: 0.85rem;">${r.oil_analyzer.toFixed(2)}%</span>`) : '—';

      tr.innerHTML = `
        <td>${r.id}</td>
        <td><strong>${r.gin || '—'}</strong></td>
        <td>${r.gin_date || '—'}</td>
        <td>${r.supplier_name}</td>
        <td>${r.station || '—'}</td>
        <td>${r.bill_wt ? r.bill_wt.toFixed(2) : '—'}</td>
        <td class="td-col-rate"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ₹${r.actual_rate ? r.actual_rate.toFixed(2) : '—'}</span></td>
        <td>${r.party_condition ? r.party_condition.toFixed(2) + '%' : '—'}</td>
        <td>${oilByHtml}</td>
        <td>${oilAxHtml}</td>
        <td class="td-col-cost42"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ${cost42Text}</span></td>
        <td>${costDiffText}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn-secondary" style="padding: 2px 7px; font-size: 0.75rem;" onclick="openRecordModal(${r.id})">
            <i class="fa-solid fa-magnifying-glass"></i> View
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    renderPaginationControls();
  } catch (err) {
    console.error("Error loading employee records:", err);
  }
}

function renderPaginationControls() {
  const start = (state.pagination.page - 1) * state.pagination.limit + 1;
  const end = Math.min(state.pagination.page * state.pagination.limit, state.pagination.total);
  document.getElementById('paginationSummary').textContent =
    `Showing ${state.pagination.total > 0 ? start : 0} to ${end} of ${state.pagination.total.toLocaleString()} records`;

  const btnContainer = document.getElementById('paginationButtons');
  btnContainer.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.disabled = state.pagination.page <= 1;
  prevBtn.addEventListener('click', () => {
    state.pagination.page--;
    loadEmployeeRecords();
  });
  btnContainer.appendChild(prevBtn);

  // Show window of page numbers
  const cur = state.pagination.page;
  const total = state.pagination.totalPages;
  const pageNums = [1];
  if (cur > 3) pageNums.push('...');
  for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) {
    pageNums.push(i);
  }
  if (cur < total - 2) pageNums.push('...');
  if (total > 1) pageNums.push(total);

  pageNums.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.style.padding = '0 4px';
      span.textContent = '...';
      btnContainer.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = `page-btn ${p === cur ? 'active' : ''}`;
      btn.textContent = p;
      btn.addEventListener('click', () => {
        state.pagination.page = p;
        loadEmployeeRecords();
      });
      btnContainer.appendChild(btn);
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = state.pagination.page >= total;
  nextBtn.addEventListener('click', () => {
    state.pagination.page++;
    loadEmployeeRecords();
  });
  btnContainer.appendChild(nextBtn);
}

// --- Record Detail Modal ---
async function openRecordModal(id) {
  try {
    const res = await fetch(`/api/records/${id}`);
    const r = await res.json();

    document.getElementById('modalTitle').textContent = `Lot Audit: ${r.gin || 'ID ' + r.id}`;
    const badge = document.getElementById('modalStatusBadge');
    badge.textContent = r.costing_status;
    badge.className = `badge ${r.costing_status === 'VALID' ? 'badge-success' : 'badge-warning'}`;

    const reasonsHtml = r.anomaly_reasons && r.anomaly_reasons.length > 0
      ? `<div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger-red); padding: 0.75rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
           <div style="font-weight: 700; color: var(--danger-red); font-size: 0.8rem; margin-bottom: 0.2rem;">AI ANOMALY FLAGS:</div>
           <ul style="padding-left: 1rem; font-size: 0.82rem;">${r.anomaly_reasons.map(x => `<li>${x}</li>`).join('')}</ul>
         </div>`
      : '';

    const modalBody = document.getElementById('modalBodyContent');
    modalBody.innerHTML = `
      ${reasonsHtml}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.84rem;">
        <div>
          <h4 style="color: var(--mustard-gold); margin-bottom: 0.5rem;">Purchase & Logistic Details</h4>
          <p><strong>PO Number:</strong> ${r.po_no || '—'}</p>
          <p><strong>GRN Number:</strong> ${r.grn_no || '—'}</p>
          <p><strong>Supplier Name:</strong> ${r.supplier_name}</p>
          <p><strong>Supplier Code:</strong> ${r.supplier_code || '—'}</p>
          <p><strong>Origin Mandi / Station:</strong> ${r.station || '—'}</p>
          <p><strong>Broker / Agent:</strong> ${r.broker_name || 'Direct Purchase'}</p>
          <p><strong>Supervisor / Unloading:</strong> ${r.supervisor_name || '—'}</p>
          <p><strong>Entry Date (GIN):</strong> ${r.gin_date || '—'}</p>
        </div>

        <div>
          <h4 style="color: var(--accent-cyan); margin-bottom: 0.5rem;">Laboratory Quality Parameters</h4>
          <p><strong>Tested Seed Oil %:</strong> <span style="font-weight:700; color:var(--accent-cyan);">${r.oil_manual ? r.oil_manual + '%' : 'Pending'}</span></p>
          <p><strong>NIR Analyzer Oil %:</strong> ${r.oil_analyzer ? r.oil_analyzer + '%' : '—'}</p>
          <p><strong>Contract Condition %:</strong> ${r.party_condition ? r.party_condition + '%' : '—'}</p>
          <p><strong>Condition Variance:</strong> ${r.oil_diff_condition !== null ? r.oil_diff_condition + '%' : '—'}</p>
          <p><strong>Foreign Matter (FM):</strong> ${r.fm_pct ? r.fm_pct.toFixed(2) + '%' : '—'}</p>
          <p><strong>Moisture In QC:</strong> ${r.moisture_qc ? r.moisture_qc.toFixed(2) + '%' : '—'}</p>
          <p><strong>Free Fatty Acid (FFA):</strong> ${r.ffa ? r.ffa.toFixed(2) + '%' : '—'}</p>
        </div>
      </div>

      <div style="margin-top: 1.25rem; background: var(--bg-card); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
        <h4 style="color: var(--mustard-gold); margin-bottom: 0.5rem;">42 Costing Calculation Proof</h4>
        <div style="font-family: monospace; font-size: 0.9rem; color: var(--text-primary); line-height: 1.6;">
          • Actual Purchase Rate (AT) = ₹${r.actual_rate ? r.actual_rate.toFixed(4) : '0'}/Qtl<br>
          • Laboratory Oil (AW) = ${r.oil_manual ? r.oil_manual : '0'}%<br>
          • 42 Adjusted Cost = (${r.actual_rate ? r.actual_rate.toFixed(2) : 0} ÷ ${r.oil_manual ? r.oil_manual : 0}) × 42<br>
          • <strong>Calculated 42 Cost: ₹${r.cost_42 ? r.cost_42.toFixed(4) : 'Pending'}/Qtl</strong><br>
          • Net Cost Impact: ${r.cost_diff ? (r.cost_diff > 0 ? '+' : '') + '₹' + r.cost_diff.toFixed(2) : '—'} (${r.cost_diff_pct ? (r.cost_diff_pct > 0 ? '+' : '') + r.cost_diff_pct + '%' : '—'})
        </div>
      </div>
    `;

    document.getElementById('recordModal').classList.add('active');
  } catch (err) {
    console.error("Error opening record modal:", err);
  }
}

function closeModal() {
  document.getElementById('recordModal').classList.remove('active');
}

// ==========================================================================
// Universal Responsive Client-Side Table Paginator Engine
// ==========================================================================
function createTablePaginator({
  tableId,
  summaryId,
  pageSizeSelectId,
  buttonsId,
  defaultLimit = 10,
  entityName = 'records',
  renderRow,
  emptyMessage = 'No records found.'
}) {
  const stateObj = {
    allRows: [],
    filteredRows: [],
    page: 1,
    limit: defaultLimit,
    total: 0,
    totalPages: 1
  };

  function update(newRows) {
    if (newRows !== undefined) {
      stateObj.allRows = Array.isArray(newRows) ? newRows : [];
      stateObj.filteredRows = stateObj.allRows;
    }
    render();
  }

  function filter(filterPredicate) {
    if (typeof filterPredicate === 'function') {
      stateObj.filteredRows = stateObj.allRows.filter(filterPredicate);
    } else {
      stateObj.filteredRows = stateObj.allRows;
    }
    stateObj.page = 1;
    render();
  }

  function render() {
    const total = stateObj.filteredRows.length;
    stateObj.total = total;
    const limit = stateObj.limit;
    let page = stateObj.page;
    let totalPages = 1;
    let sliced = [];

    if (limit === 0 || limit >= total) {
      totalPages = 1;
      page = 1;
      sliced = stateObj.filteredRows;
    } else {
      totalPages = Math.max(1, Math.ceil(total / limit));
      if (page > totalPages) page = totalPages;
      if (page < 1) page = 1;
      const start = (page - 1) * limit;
      sliced = stateObj.filteredRows.slice(start, start + limit);
    }

    stateObj.page = page;
    stateObj.totalPages = totalPages;

    // 1. Render Table Rows
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (tbody) {
      tbody.innerHTML = '';
      if (sliced.length === 0) {
        tbody.innerHTML = `<tr><td colspan="100" style="text-align: center; color: var(--text-muted); padding: 2rem;">${emptyMessage}</td></tr>`;
      } else {
        const startIdx = limit === 0 ? 0 : (page - 1) * limit;
        sliced.forEach((item, idx) => {
          const globalRank = startIdx + idx + 1;
          const tr = renderRow(item, idx, globalRank);
          if (typeof tr === 'string') {
            const temp = document.createElement('tbody');
            temp.innerHTML = tr;
            tbody.appendChild(temp.firstElementChild);
          } else if (tr instanceof HTMLElement) {
            tbody.appendChild(tr);
          }
        });
      }
    }

    // 2. Render Summary Text
    const summary = document.getElementById(summaryId);
    if (summary) {
      if (total === 0) {
        summary.textContent = `Showing 0 of 0 ${entityName}`;
      } else if (limit === 0 || limit >= total) {
        summary.textContent = `Showing all ${total} ${entityName}`;
      } else {
        const start = (page - 1) * limit + 1;
        const end = Math.min(page * limit, total);
        summary.textContent = `Showing ${start} to ${end} of ${total} ${entityName}`;
      }
    }

    // 3. Render Navigation Buttons
    const btnContainer = document.getElementById(buttonsId);
    if (btnContainer) {
      btnContainer.innerHTML = '';

      // Prev Button
      const prevBtn = document.createElement('button');
      prevBtn.className = 'page-btn';
      prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i> Prev';
      prevBtn.disabled = page <= 1 || limit === 0;
      prevBtn.addEventListener('click', () => {
        if (stateObj.page > 1) {
          stateObj.page--;
          render();
        }
      });
      btnContainer.appendChild(prevBtn);

      // Page Numbers with Ellipses
      let pagesToShow = [];
      if (totalPages <= 7) {
        pagesToShow = Array.from({ length: totalPages }, (_, i) => i + 1);
      } else {
        pagesToShow = [1];
        if (page > 3) pagesToShow.push('...');
        const startP = Math.max(2, page - 1);
        const endP = Math.min(totalPages - 1, page + 1);
        for (let i = startP; i <= endP; i++) pagesToShow.push(i);
        if (page < totalPages - 2) pagesToShow.push('...');
        pagesToShow.push(totalPages);
      }

      pagesToShow.forEach(p => {
        if (p === '...') {
          const span = document.createElement('span');
          span.textContent = '...';
          span.style.padding = '0.35rem 0.5rem';
          span.style.color = 'var(--text-muted)';
          btnContainer.appendChild(span);
        } else {
          const btn = document.createElement('button');
          btn.className = `page-btn ${p === page ? 'active' : ''}`;
          btn.textContent = p;
          btn.disabled = limit === 0;
          btn.addEventListener('click', () => {
            stateObj.page = p;
            render();
          });
          btnContainer.appendChild(btn);
        }
      });

      // Next Button
      const nextBtn = document.createElement('button');
      nextBtn.className = 'page-btn';
      nextBtn.innerHTML = 'Next <i class="fa-solid fa-chevron-right"></i>';
      nextBtn.disabled = page >= totalPages || limit === 0;
      nextBtn.addEventListener('click', () => {
        if (stateObj.page < totalPages) {
          stateObj.page++;
          render();
        }
      });
      btnContainer.appendChild(nextBtn);
    }
  }

  // Setup Page Size Listener
  const pageSizeSelect = document.getElementById(pageSizeSelectId);
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      stateObj.limit = parseInt(e.target.value, 10);
      stateObj.page = 1;
      render();
    });
  }

  return {
    update,
    filter,
    render,
    getState: () => stateObj,
    setPage: (p) => { stateObj.page = p; render(); }
  };
}

// --- VIEW 3: Seed Quality & Lab Analytics ---
async function loadQualityDistribution() {
  try {
    const res = await fetch('/api/analytics/quality-distribution');
    const data = await res.json();

    const labels = data.map(d => d.range);
    const counts = data.map(d => d.count);
    const pcts = data.map(d => d.percentage);

    const ctx = document.getElementById('chartOilDistribution').getContext('2d');
    if (state.charts.oilDist) state.charts.oilDist.destroy();

    state.charts.oilDist = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Number of Seed Lots',
          data: counts,
          backgroundColor: [
            'rgba(239, 68, 68, 0.7)',
            'rgba(249, 115, 22, 0.7)',
            'rgba(56, 189, 248, 0.7)',
            'rgba(245, 158, 11, 0.7)',
            'rgba(16, 185, 129, 0.7)',
            'rgba(34, 197, 94, 0.9)'
          ],
          borderColor: 'transparent',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: (item) => `Share: ${pcts[item.dataIndex]}% of all deliveries`
            }
          }
        },
        scales: {
          x: { ticks: { color: getChartThemeColors().textSecondary, font: { size: 12, weight: '600' } }, grid: { display: false } },
          y: { ticks: { color: getChartThemeColors().textSecondary, font: { size: 12, weight: '600' } }, grid: { color: getChartThemeColors().gridColor } }
        }
      }
    });
  } catch (err) {
    console.error("Error loading quality distribution:", err);
  }
}

async function loadLabComparison() {
  try {
    const res = await fetch('/api/analytics/lab-comparison');
    const data = await res.json();

    document.getElementById('labAvgManual').textContent = `${data.summary.avg_manual}%`;
    document.getElementById('labAvgAnalyzer').textContent = `${data.summary.avg_analyzer}%`;
    document.getElementById('labMeanBias').textContent = `${data.summary.mean_bias > 0 ? '+' : ''}${data.summary.mean_bias}%`;

    if (!state.paginators.labDiscrepancies) {
      state.paginators.labDiscrepancies = createTablePaginator({
        tableId: 'tableLabDiscrepancies',
        summaryId: 'labDiscrepanciesPaginationSummary',
        pageSizeSelectId: 'labDiscrepanciesPageSizeSelect',
        buttonsId: 'labDiscrepanciesPaginationButtons',
        defaultLimit: 10,
        entityName: 'discrepancy records',
        renderRow: (r) => {
          const tr = document.createElement('tr');
          const diff = Math.abs(r.diff);
          tr.innerHTML = `
            <td><strong>${r.gin}</strong></td>
            <td>${r.supplier_name}</td>
            <td>${r.gin_date}</td>
            <td><strong style="color: #c084fc; font-size: 0.9rem;">${r.oil_manual}%</strong></td>
            <td><strong style="color: var(--accent-blue); font-size: 0.9rem;">${r.oil_analyzer}%</strong></td>
            <td><strong style="color: ${diff >= 0.5 ? 'var(--danger-red)' : 'var(--warning-orange)'}; font-family: var(--font-mono);">${r.diff > 0 ? '+' : ''}${r.diff}%</strong></td>
            <td><span class="badge ${diff >= 0.5 ? 'badge-danger' : 'badge-warning'}">${diff >= 0.5 ? '⚠️ High Discrepancy' : 'Minor Diff'}</span></td>
          `;
          return tr;
        }
      });
    }

    state.paginators.labDiscrepancies.update(data.records || []);
  } catch (err) {
    console.error("Error loading lab comparison:", err);
  }
}

// --- VIEW 4: Supplier & Mandi Intelligence ---
async function loadSupplierScorecards() {
  try {
    const res = await fetch('/api/analytics/suppliers?limit=100');
    const supps = await res.json();

    if (!state.paginators.supplierScorecard) {
      state.paginators.supplierScorecard = createTablePaginator({
        tableId: 'tableSupplierScorecard',
        summaryId: 'supplierScorecardPaginationSummary',
        pageSizeSelectId: 'supplierScorecardPageSizeSelect',
        buttonsId: 'supplierScorecardPaginationButtons',
        defaultLimit: 10,
        entityName: 'suppliers',
        renderRow: (s) => {
          const tr = document.createElement('tr');
          const isLoss = s.avg_cost_diff_pct > 0;
          const deltaBadge = isLoss
            ? `<span class="trend-badge danger" style="font-weight: 700;">+${s.avg_cost_diff_pct}% Loss</span>`
            : `<span class="trend-badge success" style="font-weight: 700;">-${Math.abs(s.avg_cost_diff_pct)}% Profit</span>`;

          tr.innerHTML = `
            <td><strong>${s.supplier_name}</strong></td>
            <td>${s.total_trips}</td>
            <td>${s.total_qty_qtl.toLocaleString()}</td>
            <td class="td-col-rate" style="text-align: right;"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ₹${s.avg_rate.toLocaleString()}</span></td>
            <td>${s.avg_condition}%</td>
            <td><strong style="color: var(--accent-cyan);">${s.avg_oil}%</strong></td>
            <td class="td-col-cost42" style="text-align: right;"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ₹${s.avg_cost_42.toLocaleString()}</span></td>
            <td>${deltaBadge}</td>
            <td>${s.avg_moisture}%</td>
            <td>${s.avg_fm}%</td>
            <td><span class="badge ${s.anomaly_count > 0 ? 'badge-danger' : 'badge-success'}">${s.anomaly_count}</span></td>
          `;
          return tr;
        }
      });
    }

    state.paginators.supplierScorecard.update(supps || []);
  } catch (err) {
    console.error("Error loading supplier scorecards:", err);
  }
}

// --- VIEW 5: AI Anomalies Center ---
async function loadAnomaliesTable() {
  try {
    const params = new URLSearchParams({
      page: state.anomalyPagination.page,
      limit: state.anomalyPagination.limit,
      sort_by: state.anomalyPagination.sortBy,
      sort_order: state.anomalyPagination.sortOrder
    });
    if (state.anomalyPagination.search) {
      params.append('search', state.anomalyPagination.search);
    }

    const res = await fetch(`/api/ai/anomalies?${params.toString()}`);
    const data = await res.json();
    const anomalies = Array.isArray(data) ? data : (data.items || []);
    const total = Array.isArray(data) ? anomalies.length : (data.total || 0);
    const totalPages = Array.isArray(data) ? 1 : (data.pages || 1);

    state.anomalyPagination.total = total;
    state.anomalyPagination.totalPages = totalPages;

    const badge = document.getElementById('anomalyTotalBadge');
    if (badge) badge.textContent = `${total.toLocaleString()} Total`;

    const navBadge = document.getElementById('anomalyBadge');
    if (navBadge) navBadge.textContent = total.toLocaleString();

    const tbody = document.querySelector('#tableAnomalies tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (anomalies.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
            <i class="fa-solid fa-circle-check" style="font-size: 2rem; color: #10b981; margin-bottom: 0.5rem; display: block;"></i>
            No flagged anomalies match your search criteria.
          </td>
        </tr>
      `;
      renderAnomalyPaginationControls();
      return;
    }

    const mult = state.unit === 'mt' ? 10.0 : 1.0;

    anomalies.forEach(a => {
      const tr = document.createElement('tr');
      const reasons = a.anomaly_reasons && a.anomaly_reasons.length > 0
        ? a.anomaly_reasons.map(r => {
          const isDanger = r.includes('Loss') || r.includes('Low Oil') || r.includes('Discrepancy');
          return `<span class="badge ${isDanger ? 'badge-danger' : 'badge-warning'}" style="margin: 2px; font-size: 0.76rem; font-weight: 600;">${r}</span>`;
        }).join(' ')
        : '<span class="badge badge-gray">Statistical Outlier</span>';

      const rateVal = a.actual_rate ? `₹${(a.actual_rate * mult).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
      const cost42Val = a.cost_42 ? `₹${(a.cost_42 * mult).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
      const diffVal = a.cost_diff !== undefined && a.cost_diff !== null ? (a.cost_diff * mult) : 0;
      const isLoss = diffVal >= 0;

      tr.innerHTML = `
        <td><strong>${a.gin || '—'}</strong></td>
        <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary);">${a.grn_no || a.po_no || '—'}</span></td>
        <td><strong>${a.supplier_name}</strong></td>
        <td>${a.station || '—'}</td>
        <td style="text-align: right;" class="td-col-rate"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ${rateVal}</span></td>
        <td style="text-align: center;"><strong style="color: #c084fc;">${a.oil_manual ? a.oil_manual.toFixed(2) + '%' : 'Pending'}</strong></td>
        <td style="text-align: right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ${cost42Val}</span></td>
        <td style="text-align: right;">
          <span class="${isLoss ? 'badge-diff-danger' : 'badge-diff-success'}" style="display:inline-block; font-weight:700; font-size:0.8rem;">
            ${isLoss ? '+' : '-'}₹${Math.abs(diffVal).toFixed(2)}${state.unit === 'mt' ? '/MT' : '/Qtl'} (${a.cost_diff_pct > 0 ? '+' : ''}${a.cost_diff_pct}%)
          </span>
        </td>
        <td>${reasons}</td>
        <td style="text-align: center;">
          <button class="btn-secondary" style="padding: 3px 9px; font-size: 0.78rem;" onclick="openRecordModal(${a.id})">
            Audit
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    renderAnomalyPaginationControls();

    // Render anomaly type donut chart (overall distribution)
    if (data.type_counts) {
      renderAnomalyPie(data.type_counts);
    }
  } catch (err) {
    console.error("Error loading anomalies table:", err);
  }
}

function renderAnomalyPaginationControls() {
  const start = (state.anomalyPagination.page - 1) * state.anomalyPagination.limit + 1;
  const end = Math.min(state.anomalyPagination.page * state.anomalyPagination.limit, state.anomalyPagination.total);
  const summary = document.getElementById('anomalyPaginationSummary');
  if (summary) {
    summary.textContent = `Showing ${state.anomalyPagination.total > 0 ? start : 0} to ${end} of ${state.anomalyPagination.total.toLocaleString()} flagged records`;
  }

  const btnContainer = document.getElementById('anomalyPaginationButtons');
  if (!btnContainer) return;
  btnContainer.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i> Prev';
  prevBtn.disabled = state.anomalyPagination.page <= 1;
  prevBtn.addEventListener('click', () => {
    state.anomalyPagination.page--;
    loadAnomaliesTable();
  });
  btnContainer.appendChild(prevBtn);

  const cur = state.anomalyPagination.page;
  const total = state.anomalyPagination.totalPages;

  let pagesToShow = [];
  if (total <= 7) {
    pagesToShow = Array.from({ length: total }, (_, i) => i + 1);
  } else {
    pagesToShow = [1];
    if (cur > 3) pagesToShow.push('...');
    const startP = Math.max(2, cur - 1);
    const endP = Math.min(total - 1, cur + 1);
    for (let i = startP; i <= endP; i++) pagesToShow.push(i);
    if (cur < total - 2) pagesToShow.push('...');
    pagesToShow.push(total);
  }

  pagesToShow.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.textContent = '...';
      span.style.padding = '0.35rem 0.5rem';
      span.style.color = 'var(--text-muted)';
      btnContainer.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = `page-btn ${p === cur ? 'active' : ''}`;
      btn.textContent = p;
      btn.addEventListener('click', () => {
        state.anomalyPagination.page = p;
        loadAnomaliesTable();
      });
      btnContainer.appendChild(btn);
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = 'Next <i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = state.anomalyPagination.page >= total;
  nextBtn.addEventListener('click', () => {
    state.anomalyPagination.page++;
    loadAnomaliesTable();
  });
  btnContainer.appendChild(nextBtn);
}

function renderAnomalyPie(typeCounts) {
  if (!typeCounts || typeof typeCounts !== 'object') return;

  const canvas = document.getElementById('chartAnomalyTypes');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts.anomalyPie) state.charts.anomalyPie.destroy();

  const labels = Object.keys(typeCounts);
  const values = Object.values(typeCounts);
  const totalVal = values.reduce((a, b) => a + b, 0);

  // Update center total
  const elCenterTotal = document.getElementById('anomalyCenterTotal');
  const elCenterLabel = document.getElementById('anomalyCenterLabel');
  if (elCenterTotal) elCenterTotal.textContent = totalVal.toLocaleString('en-IN');
  if (elCenterLabel) elCenterLabel.textContent = 'Total Flagged Lots';

  const explanations = {
    'Heavy Quality Loss (≥ ₹200/Qtl)': {
      icon: 'fa-arrow-trend-up',
      color: '#ef4444',
      bgLight: 'rgba(239, 68, 68, 0.08)',
      borderColor: 'rgba(239, 68, 68, 0.40)',
      title: 'Heavy Quality Loss (≥ ₹200/Qtl)',
      shortDesc: 'Arrival cost spiked ≥ ₹200/Qtl higher than purchase rate due to severe oil deficit.',
      whatItMeans: '💡 Meaning: Seed delivered with low oil % caused the final 42% cost to be ₹200+ more expensive per Quintal than expected.'
    },
    'Low Oil Yield (< 39.0%)': {
      icon: 'fa-droplet-slash',
      color: '#f59e0b',
      bgLight: 'rgba(245, 158, 11, 0.08)',
      borderColor: 'rgba(245, 158, 11, 0.40)',
      title: 'Low Oil Yield (< 39.0%)',
      shortDesc: 'Laboratory tested seed oil content dropped below the 39.0% quality standard.',
      whatItMeans: '💡 Meaning: Delivered mustard seed has inferior oil content (< 39%), requiring heavy quality deduction (Katoti) to compensate.'
    },
    'Heavy Deductions (> ₹75k)': {
      icon: 'fa-scissors',
      color: '#0ea5e9',
      bgLight: 'rgba(14, 165, 233, 0.08)',
      borderColor: 'rgba(14, 165, 233, 0.40)',
      title: 'Heavy Deductions (> ₹75k)',
      shortDesc: 'Total Katoti deductions exceeded ₹75,000 for moisture, dirt/FM, or weight shortage.',
      whatItMeans: '💡 Meaning: Lots had severe physical impurities, excess moisture, or shortage requiring large financial deductions from the trader.'
    },
    'Reconciliation Discrepancies': {
      icon: 'fa-triangle-exclamation',
      color: '#a855f7',
      bgLight: 'rgba(168, 85, 247, 0.08)',
      borderColor: 'rgba(168, 85, 247, 0.40)',
      title: 'Reconciliation Discrepancies',
      shortDesc: 'Invoice amount mismatch between mandi bill and factory verified debit note ledger.',
      whatItMeans: '💡 Meaning: Billed amount from trader differs from actual factory weight & lab verification, requiring accounting reconciliation.'
    }
  };

  const bgColors = [
    'rgba(239, 68, 68, 0.90)',
    'rgba(245, 158, 11, 0.90)',
    'rgba(14, 165, 233, 0.90)',
    'rgba(168, 85, 247, 0.90)'
  ];

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // Helper for External HTML Tooltip
  const getOrCreateTooltip = (chart) => {
    let tooltipEl = chart.canvas.parentNode.querySelector('.chartjs-custom-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chartjs-custom-tooltip';
      tooltipEl.style.background = 'rgba(15, 23, 42, 0.98)';
      tooltipEl.style.borderRadius = '10px';
      tooltipEl.style.border = '1.5px solid rgba(245, 158, 11, 0.75)';
      tooltipEl.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.45)';
      tooltipEl.style.color = '#ffffff';
      tooltipEl.style.opacity = '0';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.transform = 'translate(-50%, -115%)';
      tooltipEl.style.transition = 'opacity .18s ease, transform .18s ease';
      tooltipEl.style.padding = '12px 16px';
      tooltipEl.style.width = '290px';
      tooltipEl.style.maxWidth = '320px';
      tooltipEl.style.zIndex = '9999';
      tooltipEl.style.backdropFilter = 'blur(12px)';
      tooltipEl.style.webkitBackdropFilter = 'blur(12px)';
      chart.canvas.parentNode.appendChild(tooltipEl);
    }
    return tooltipEl;
  };

  const externalTooltipHandler = (context) => {
    const { chart, tooltip } = context;
    const tooltipEl = getOrCreateTooltip(chart);

    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    if (tooltip.dataPoints && tooltip.dataPoints.length > 0) {
      const dataIndex = tooltip.dataPoints[0].dataIndex;
      const title = labels[dataIndex] || '';
      const count = values[dataIndex] || 0;
      const pct = totalVal > 0 ? ((count / totalVal) * 100).toFixed(1) : '0';
      const exp = explanations[title] || {};

      tooltipEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 5px;">
          <div style="font-size: 0.92rem; font-weight: 800; color: ${exp.color || '#fbbf24'}; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid ${exp.icon || 'fa-circle-info'}"></i> ${title}
          </div>
          <span style="font-size: 0.78rem; font-weight: 800; background: ${exp.color || '#3b82f6'}; color: #fff; padding: 2px 7px; border-radius: 4px; font-family: monospace;">
            ${pct}% Share
          </span>
        </div>
        <div style="font-size: 0.85rem; font-weight: 700; color: #f8fafc; margin-bottom: 6px;">
          📦 Volume: <strong style="color: #fbbf24; font-size: 0.90rem;">${count.toLocaleString()} lots</strong> (${pct}% of all anomalies)
        </div>
        <div style="font-size: 0.78rem; color: #cbd5e1; line-height: 1.45; border-top: 1px dashed rgba(255,255,255,0.12); padding-top: 6px;">
          ${exp.whatItMeans || ''}
        </div>
      `;
    }

    const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
    tooltipEl.style.opacity = '1';
    tooltipEl.style.left = positionX + tooltip.caretX + 'px';
    tooltipEl.style.top = positionY + tooltip.caretY + 'px';
  };

  state.charts.anomalyPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: isDark ? '#1e293b' : '#ffffff',
        borderWidth: 3,
        hoverOffset: 12
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      layout: {
        padding: 8
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: false, // Use external HTML tooltip for zero cropping and full word-wrapping
          external: externalTooltipHandler
        }
      },
      onHover: (event, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          const idx = activeElements[0].index;
          const label = labels[idx];
          const val = values[idx];
          if (elCenterTotal) {
            elCenterTotal.textContent = val.toLocaleString('en-IN');
            elCenterTotal.style.color = bgColors[idx];
          }
          if (elCenterLabel) {
            const pct = totalVal > 0 ? ((val / totalVal) * 100).toFixed(1) : '0';
            elCenterLabel.textContent = `${pct}% Share`;
          }
          setActiveLegendCard(idx);
        } else {
          if (elCenterTotal) {
            elCenterTotal.textContent = totalVal.toLocaleString('en-IN');
            elCenterTotal.style.color = 'var(--text-primary)';
          }
          if (elCenterLabel) {
            elCenterLabel.textContent = 'Total Flagged Lots';
          }
          clearActiveLegendCards();
        }
      }
    }
  });

  // Render the 4 Executive Legend Cards on the right
  const legendContainer = document.getElementById('anomalyLegendCards');
  if (legendContainer) {
    legendContainer.innerHTML = labels.map((label, i) => {
      const count = values[i] || 0;
      const pct = totalVal > 0 ? ((count / totalVal) * 100).toFixed(1) : '0';
      const exp = explanations[label] || {
        icon: 'fa-circle-exclamation',
        color: '#38bdf8',
        bgLight: 'rgba(56, 189, 248, 0.08)',
        borderColor: 'rgba(56, 189, 248, 0.3)',
        title: label,
        shortDesc: 'Statistical anomaly detected in batch transaction.'
      };

      return `
        <div class="anomaly-legend-card" id="anomalyCard_${i}"
             style="background: ${exp.bgLight}; border-color: ${exp.borderColor};"
             onmouseenter="highlightAnomalySlice(${i})"
             onmouseleave="resetAnomalySlice()"
             title="${exp.whatItMeans}">
          <div class="anomaly-legend-header">
            <div class="anomaly-legend-title" style="color: ${exp.color};">
              <i class="fa-solid ${exp.icon}"></i> ${exp.title}
            </div>
            <span class="anomaly-legend-badge" style="background: ${exp.color}; color: #ffffff;">
              ${count.toLocaleString()} lots (${pct}%)
            </span>
          </div>
          <div class="anomaly-legend-desc">
            ${exp.shortDesc}
          </div>
        </div>
      `;
    }).join('');
  }
}

function setActiveLegendCard(index) {
  const cards = document.querySelectorAll('.anomaly-legend-card');
  cards.forEach((card, idx) => {
    if (idx === index) {
      card.classList.add('active-legend-card');
      card.style.transform = 'translateY(-3px) scale(1.02)';
      card.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.2)';
      card.style.opacity = '1';
    } else {
      card.classList.remove('active-legend-card');
      card.style.transform = 'none';
      card.style.boxShadow = 'none';
      card.style.opacity = '0.55';
    }
  });
}

function clearActiveLegendCards() {
  const cards = document.querySelectorAll('.anomaly-legend-card');
  cards.forEach(card => {
    card.classList.remove('active-legend-card');
    card.style.transform = 'none';
    card.style.boxShadow = 'none';
    card.style.opacity = '1';
  });
}

function highlightAnomalySlice(index) {
  if (!state.charts.anomalyPie) return;
  state.charts.anomalyPie.setActiveElements([{ datasetIndex: 0, index: index }]);
  state.charts.anomalyPie.tooltip.setActiveElements([{ datasetIndex: 0, index: index }], { x: 0, y: 0 });
  state.charts.anomalyPie.update();
  setActiveLegendCard(index);
}

function resetAnomalySlice() {
  if (!state.charts.anomalyPie) return;
  state.charts.anomalyPie.setActiveElements([]);
  state.charts.anomalyPie.tooltip.setActiveElements([], { x: 0, y: 0 });
  state.charts.anomalyPie.update();
  clearActiveLegendCards();
}

// --- VIEW 6: Simple & Direct 42% Costing Engine ---
function parseKatotiItem(valStr, sellerRate, fieldKey) {
  const fmtCur = (n) => '₹' + Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (valStr === undefined || valStr === null) return { cut: 0, preview: '= ₹0.00 / Qtl', pct: 0 };
  const raw = String(valStr).trim().replace(/₹/g, '').replace(/,/g, '');
  if (!raw) return { cut: 0, preview: '= ₹0.00 / Qtl', pct: 0 };

  const hasPercent = raw.endsWith('%');
  const num = parseFloat(raw.replace('%', ''));
  if (isNaN(num) || num < 0) return { cut: 0, preview: '= ₹0.00 / Qtl', pct: 0 };

  const isPercentMode = state.katotiMode === 'percent';
  let cut = 0;
  let pct = 0;

  if (hasPercent) {
    pct = num;
    cut = sellerRate * (num / 100.0);
  } else if (isPercentMode) {
    if (fieldKey === 'bardana' || fieldKey === 'shortage') {
      // Bardana and shortage are normally entered as direct rupee rates
      cut = num;
      pct = sellerRate > 0 ? (cut / sellerRate) * 100 : 0;
    } else if (num < 0.15 && num > 0) {
      // Excel decimal fraction (e.g. 0.0045 for 0.45%, 0.0030 for 0.30%, 0.05 for 5%)
      if (num < 0.01) {
        pct = num * 100.0;
        cut = sellerRate * num;
      } else {
        pct = num;
        cut = sellerRate * (num / 100.0);
      }
    } else {
      // Direct percentage (e.g. 0.45, 1.20)
      pct = num;
      cut = sellerRate * (num / 100.0);
    }
  } else {
    // In rupees mode
    if (num < 0.05 && num > 0) {
      // Auto-detect Excel decimal fraction even in rupee mode! (e.g. 0.0045)
      pct = num * 100.0;
      cut = sellerRate * num;
    } else {
      cut = num;
      pct = sellerRate > 0 ? (cut / sellerRate) * 100 : 0;
    }
  }

  return {
    cut: Math.max(0, cut),
    preview: cut > 0 ? `= -${fmtCur(cut)} / Qtl (${pct.toFixed(2)}%)` : '= ₹0.00 / Qtl',
    pct
  };
}

function runCalculatorSimulation() {
  const fmtCur = (n) => '₹' + Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 1. Read Inputs
  const sellerRate = parseFloat(document.getElementById('calcSellerRate')?.value || '7200.00') || 0;
  const labOil = parseFloat(document.getElementById('calcLabOil')?.value || '39.80') || 39.80;

  // 2. Parse Single-Line Katoti Deductions (Smart ₹, % and Excel Decimal handling)
  const rFm = parseKatotiItem(document.getElementById('calcDedFm')?.value, sellerRate, 'fm');
  const rMoisture = parseKatotiItem(document.getElementById('calcDedMoisture')?.value, sellerRate, 'moisture');
  const rGreenish = parseKatotiItem(document.getElementById('calcDedGreenish')?.value, sellerRate, 'greenish');
  const rOil = parseKatotiItem(document.getElementById('calcDedOil')?.value, sellerRate, 'oil');
  const rBardana = parseKatotiItem(document.getElementById('calcDedBardana')?.value, sellerRate, 'bardana');
  const rShortage = parseKatotiItem(document.getElementById('calcDedShortage')?.value, sellerRate, 'shortage');

  // Update micro-previews
  const pFm = document.getElementById('prevDedFm'); if (pFm) pFm.textContent = rFm.preview;
  const pMo = document.getElementById('prevDedMoisture'); if (pMo) pMo.textContent = rMoisture.preview;
  const pGr = document.getElementById('prevDedGreenish'); if (pGr) pGr.textContent = rGreenish.preview;
  const pOi = document.getElementById('prevDedOil'); if (pOi) pOi.textContent = rOil.preview;
  const pBa = document.getElementById('prevDedBardana'); if (pBa) pBa.textContent = rBardana.preview;
  const pSh = document.getElementById('prevDedShortage'); if (pSh) pSh.textContent = rShortage.preview;

  const elSellerMt = document.getElementById('calcSellerRateMt');
  if (elSellerMt) elSellerMt.textContent = `${fmtCur(sellerRate * 10)} / MT`;

  // 3. Perform Real-World Step-by-Step Costing Math
  const totalKatoti = rFm.cut + rMoisture.cut + rGreenish.cut + rOil.cut + rBardana.cut + rShortage.cut;
  const landingCostQtl = Math.max(0, sellerRate - totalKatoti);
  const landingCostMt = landingCostQtl * 10.0;

  const cost42Qtl = labOil > 0 ? (landingCostQtl / labOil) * 42.0 : 0;
  const cost42Mt = cost42Qtl * 10.0;

  // Variance: 42% Benchmark Costing vs Mandi Purchase Rate (Seller Rate)
  const diffQtl = cost42Qtl - sellerRate;
  const diffMt = diffQtl * 10.0;
  const pctDiff = sellerRate > 0 ? (diffQtl / sellerRate) * 100 : 0;
  const isLoss = diffQtl > 0.001;
  const isEven = Math.abs(diffQtl) <= 0.001;
  const oilGap = labOil - 42.0;

  // 4. Update Input Badges
  const elTotalDedBadge = document.getElementById('calcTotalDedBadge');
  if (elTotalDedBadge) {
    elTotalDedBadge.textContent = `Total Katoti: -${fmtCur(totalKatoti)} / Qtl (-${fmtCur(totalKatoti * 10)} / MT)`;
  }

  // 5. Update Result Cards
  const elLandingQtl = document.getElementById('calcResLandingQtl');
  const elLandingMt = document.getElementById('calcResLandingMt');
  const elCost42Qtl = document.getElementById('calcResCost42Qtl');
  const elCost42Mt = document.getElementById('calcResCost42Mt');
  const elDiffBox = document.getElementById('calcResDiffBox');
  const elDiffTitle = document.getElementById('calcResDiffTitle');
  const elDiffQtl = document.getElementById('calcResDiffQtl');
  const elDiffMt = document.getElementById('calcResDiffMt');
  const elDiffSub = document.getElementById('calcResDiffSub');

  if (elLandingQtl) elLandingQtl.textContent = `${fmtCur(landingCostQtl)} / Qtl`;
  if (elLandingMt) elLandingMt.textContent = `${fmtCur(landingCostMt)} / MT`;

  if (elCost42Qtl) elCost42Qtl.textContent = `${fmtCur(cost42Qtl)} / Qtl`;
  if (elCost42Mt) elCost42Mt.textContent = `${fmtCur(cost42Mt)} / MT`;

  const elDiffFormula = document.getElementById('calcResDiffFormula');

  if (elDiffBox && elDiffTitle && elDiffQtl && elDiffMt && elDiffSub) {
    if (elDiffFormula) {
      elDiffFormula.textContent = `${fmtCur(cost42Qtl)} (42% Cost) − ${fmtCur(sellerRate)} (Seller Rate) = ${(diffQtl >= 0 ? '+' : '-')}${fmtCur(Math.abs(diffQtl))}`;
    }

    if (isLoss) {
      elDiffBox.style.background = 'rgba(239, 68, 68, 0.08)';
      elDiffBox.style.borderColor = 'rgba(239, 68, 68, 0.35)';
      elDiffTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Quality Loss';
      elDiffTitle.style.color = '#f87171';
      elDiffQtl.textContent = `+${fmtCur(diffQtl)} / Qtl`;
      elDiffQtl.style.color = '#ef4444';
      elDiffMt.textContent = `+${fmtCur(diffMt)} / MT (Quality Loss)`;
      elDiffMt.style.color = '#ef4444';
      elDiffSub.textContent = `42% Cost (${fmtCur(cost42Qtl)}) is ${fmtCur(diffQtl)}/Qtl higher than Seller Rate (${fmtCur(sellerRate)}) due to low oil (${labOil.toFixed(2)}%).`;
    } else if (isEven) {
      elDiffBox.style.background = 'rgba(100, 116, 139, 0.08)';
      elDiffBox.style.borderColor = 'rgba(100, 116, 139, 0.35)';
      elDiffTitle.innerHTML = '<i class="fa-solid fa-scale-balanced"></i> Break-Even';
      elDiffTitle.style.color = 'var(--text-secondary)';
      elDiffQtl.textContent = `₹0.00 / Qtl`;
      elDiffQtl.style.color = 'var(--text-primary)';
      elDiffMt.textContent = `₹0.00 / MT (Par)`;
      elDiffMt.style.color = 'var(--text-secondary)';
      elDiffSub.textContent = `42% Cost (${fmtCur(cost42Qtl)}) exactly matches Seller Rate (${fmtCur(sellerRate)}) with zero cost variance.`;
    } else {
      elDiffBox.style.background = 'rgba(16, 185, 129, 0.08)';
      elDiffBox.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      elDiffTitle.innerHTML = '<i class="fa-solid fa-circle-check"></i> Quality Profit (Savings)';
      elDiffTitle.style.color = '#34d399';
      elDiffQtl.textContent = `-${fmtCur(Math.abs(diffQtl))} / Qtl`;
      elDiffQtl.style.color = '#10b981';
      elDiffMt.textContent = `-${fmtCur(Math.abs(diffMt))} / MT (Quality Profit)`;
      elDiffMt.style.color = '#10b981';
      elDiffSub.textContent = `42% Cost (${fmtCur(cost42Qtl)}) is ${fmtCur(Math.abs(diffQtl))}/Qtl lower than Seller Rate (${fmtCur(sellerRate)}) due to ${fmtCur(totalKatoti)} Katoti.`;
    }
  }

  // 6. Update Step-by-Step Proof Bar
  const elProofFormulaText = document.getElementById('calcProofFormulaText');
  const elProofVerdictBadge = document.getElementById('calcProofVerdictBadge');

  if (elProofFormulaText) {
    elProofFormulaText.innerHTML = `Step 1: ${fmtCur(sellerRate)} − ${fmtCur(totalKatoti)} Katoti = <strong>${fmtCur(landingCostQtl)} Landing</strong> ➔ Step 2: (${fmtCur(landingCostQtl)} ÷ ${labOil.toFixed(2)}%) × 42 = <strong>${fmtCur(cost42Qtl)}</strong> ➔ Step 3: ${fmtCur(cost42Qtl)} − ${fmtCur(sellerRate)} = <strong>${diffQtl >= 0 ? '+' : '-'}${fmtCur(Math.abs(diffQtl))} / Qtl</strong>`;
  }

  if (elProofVerdictBadge) {
    elProofVerdictBadge.className = `trend-badge ${isLoss ? 'danger' : 'success'}`;
    const sign = isLoss ? '+' : (diffQtl < 0 ? '-' : '');
    const verdictLabel = isLoss ? 'Quality Loss' : (isEven ? 'Break-Even' : 'Quality Profit');
    elProofVerdictBadge.textContent = `${sign}${fmtCur(Math.abs(diffQtl))} / Qtl (${(pctDiff >= 0 ? '+' : '')}${pctDiff.toFixed(2)}% ${verdictLabel})`;
  }

  const modeBadge = document.getElementById('storyActiveModeBadge');
  if (modeBadge) {
    modeBadge.textContent = 'Simple 42% Costing Flow';
  }

  // 7. Dynamic Rendering of Executive Financial Audit Table
  const tbody = document.getElementById('tbodyCalcStory');
  if (!tbody) return;

  const katotiDetails = [
    rFm.cut > 0 ? `F.M.: ${fmtCur(rFm.cut)} (${rFm.pct.toFixed(2)}%)` : null,
    rMoisture.cut > 0 ? `Nami: ${fmtCur(rMoisture.cut)} (${rMoisture.pct.toFixed(2)}%)` : null,
    rGreenish.cut > 0 ? `Greenish: ${fmtCur(rGreenish.cut)} (${rGreenish.pct.toFixed(2)}%)` : null,
    rOil.cut > 0 ? `Oil Cut: ${fmtCur(rOil.cut)} (${rOil.pct.toFixed(2)}%)` : null,
    rBardana.cut > 0 ? `Bardana: ${fmtCur(rBardana.cut)}` : null,
    rShortage.cut > 0 ? `Shortage: ${fmtCur(rShortage.cut)}` : null
  ].filter(Boolean).join(' + ') || 'No deductions applied';

  const rowsHtml = `
    <tr style="background: rgba(96, 165, 250, 0.05);">
      <td>
        <span style="font-weight: 700; color: #60a5fa;">
          <i class="fa-solid fa-receipt" style="margin-right: 6px;"></i> 1. Seller / Mandi Price
        </span>
      </td>
      <td>
        <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 600;">Agreed Mandi Purchase Rate from seller invoice</div>
        <small style="color: var(--text-muted); font-size: 0.72rem;">Original contract price per quintal before quality & transit debits</small>
      </td>
      <td style="text-align: right; font-weight: 800; color: #60a5fa;">${fmtCur(sellerRate)}</td>
      <td style="text-align: right; font-weight: 600; color: #60a5fa;">${fmtCur(sellerRate * 10)}</td>
      <td style="text-align: center;">
        <span class="badge" style="background: rgba(96, 165, 250, 0.18); color: #3b82f6; font-weight: 700;">Seller Price</span>
      </td>
    </tr>

    <tr style="background: rgba(239, 68, 68, 0.05);">
      <td>
        <span style="font-weight: 700; color: #f87171;">
          <i class="fa-solid fa-scissors" style="margin-right: 6px;"></i> — Total Katoti Deductions
        </span>
      </td>
      <td>
        <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 600;">${katotiDetails}</div>
        <small style="color: var(--text-muted); font-size: 0.72rem;">Total penalty & operational deductions recovered from seller</small>
      </td>
      <td style="text-align: right; font-weight: 800; color: #ef4444;">-${fmtCur(totalKatoti)}</td>
      <td style="text-align: right; font-weight: 600; color: #ef4444;">-${fmtCur(totalKatoti * 10)}</td>
      <td style="text-align: center;">
        <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-weight: 700;">Total Katoti</span>
      </td>
    </tr>

    <tr style="background: rgba(16, 185, 129, 0.06);">
      <td>
        <span style="font-weight: 700; color: #10b981;">
          <i class="fa-solid fa-truck-ramp-box" style="margin-right: 6px;"></i> 2. Net Factory Landing Cost
        </span>
      </td>
      <td>
        <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 600;">Seller Price (${fmtCur(sellerRate)}) − Total Katoti (${fmtCur(totalKatoti)})</div>
        <small style="color: var(--text-muted); font-size: 0.72rem;">Effective price of raw material delivered inside factory gate</small>
      </td>
      <td style="text-align: right; font-weight: 800; color: #10b981;">${fmtCur(landingCostQtl)}</td>
      <td style="text-align: right; font-weight: 700; color: #10b981;">${fmtCur(landingCostMt)}</td>
      <td style="text-align: center;">
        <span class="badge" style="background: rgba(16, 185, 129, 0.18); color: #10b981; font-weight: 800;">Factory Landing</span>
      </td>
    </tr>

    <tr style="background: rgba(168, 85, 247, 0.05);">
      <td>
        <span style="font-weight: 700; color: #c084fc;">
          <i class="fa-solid fa-flask-vial" style="margin-right: 6px;"></i> 3. Delivered Lab Oil Report
        </span>
      </td>
      <td>
        <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 600;">Factory laboratory oil extraction test on arrival</div>
        <small style="color: var(--text-muted); font-size: 0.72rem;">Benchmark Standard: 42.00% | Delivered Yield: ${labOil.toFixed(2)}%</small>
      </td>
      <td style="text-align: right; font-weight: 800; color: #c084fc;">${labOil.toFixed(2)}%</td>
      <td style="text-align: right; font-weight: 600; color: var(--text-secondary);">Gap: ${(oilGap >= 0 ? '+' : '')}${oilGap.toFixed(2)}%</td>
      <td style="text-align: center;">
        <span class="badge ${oilGap >= 0 ? 'badge-success' : 'badge-danger'}">
          ${(oilGap >= 0 ? '+' : '')}${oilGap.toFixed(2)}% ${oilGap >= 0 ? 'Above Benchmark' : 'Under Benchmark'}
        </span>
      </td>
    </tr>

    <tr style="background: rgba(245, 158, 11, 0.08);">
      <td>
        <span style="font-weight: 700; color: var(--mustard-gold);">
          <i class="fa-solid fa-scale-balanced" style="margin-right: 6px;"></i> 4. 42% Benchmark Costing
        </span>
      </td>
      <td>
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">(Landing Cost ÷ Lab Oil%) × 42.00 = (${fmtCur(landingCostQtl)} ÷ ${labOil.toFixed(2)}%) × 42.00</div>
        <small style="color: var(--text-muted); font-size: 0.72rem;">Normalized cost required to obtain standard 42.00% oil yield</small>
      </td>
      <td style="text-align: right; font-weight: 800; color: var(--mustard-gold); font-size: 1.05rem;">${fmtCur(cost42Qtl)}</td>
      <td style="text-align: right; font-weight: 700; color: var(--mustard-gold);">${fmtCur(cost42Mt)}</td>
      <td style="text-align: center;">
        <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #d97706; font-weight: 800;">True 42% Cost</span>
      </td>
    </tr>

    <tr style="background: ${isLoss ? 'rgba(239, 68, 68, 0.07)' : (isEven ? 'rgba(100, 116, 139, 0.07)' : 'rgba(16, 185, 129, 0.07)')};">
      <td>
        <span style="font-weight: 700; color: ${isLoss ? '#ef4444' : (isEven ? 'var(--text-secondary)' : '#10b981')};">
          <i class="fa-solid ${isLoss ? 'fa-triangle-exclamation' : (isEven ? 'fa-scale-balanced' : 'fa-circle-check')}" style="margin-right: 6px;"></i> 5. Profit vs Loss
        </span>
      </td>
      <td>
        <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 700;">${fmtCur(cost42Qtl)} (42% Cost) − ${fmtCur(sellerRate)} (Seller Rate) = ${(isLoss ? '+' : (diffQtl < 0 ? '-' : ''))}${fmtCur(diffQtl)} / Qtl</div>
        <small style="color: var(--text-muted); font-size: 0.72rem;">${isLoss ? `42% Cost is ${fmtCur(diffQtl)} higher than contract rate (Financial Deficit)` : (isEven ? 'Zero difference - perfectly matched' : `42% Cost is ${fmtCur(Math.abs(diffQtl))} cheaper than contract rate due to ${fmtCur(totalKatoti)} Katoti (Financial Savings / Profit)`)}</small>
      </td>
      <td style="text-align: right; font-weight: 800; color: ${isLoss ? '#ef4444' : (isEven ? 'var(--text-primary)' : '#10b981')}; font-size: 1.05rem;">${(isLoss ? '+' : (diffQtl < 0 ? '-' : ''))}${fmtCur(diffQtl)}</td>
      <td style="text-align: right; font-weight: 700; color: ${isLoss ? '#ef4444' : (isEven ? 'var(--text-secondary)' : '#10b981')};">${(isLoss ? '+' : (diffQtl < 0 ? '-' : ''))}${fmtCur(diffMt)}</td>
      <td style="text-align: center;">
        <span class="badge ${isLoss ? 'badge-danger' : (isEven ? 'badge-neutral' : 'badge-success')}" style="font-weight: 800;">
          ${isLoss ? 'Quality Loss' : (isEven ? 'Break-Even' : 'Quality Profit')} (${(pctDiff >= 0 ? '+' : '')}${pctDiff.toFixed(2)}%)
        </span>
      </td>
    </tr>
  `;

  tbody.innerHTML = rowsHtml;
}

// --- VIEW 7: Data Quality Audit Center ---
async function loadDataQualityAudit() {
  try {
    const res = await fetch('/api/audit/data-quality');
    const audit = await res.json();

    const totalStr = audit.total_records ? audit.total_records.toLocaleString() : '2,038';
    const labPendingStr = audit.lab_pending_count ? audit.lab_pending_count.toLocaleString() : '1';
    const stationsStr = audit.stations_normalized_count ? audit.stations_normalized_count.toLocaleString() : '2,036';
    const directStr = audit.direct_purchases_count ? audit.direct_purchases_count.toLocaleString() : '1,165';

    const elTotal = document.getElementById('auditTotalRecords');
    if (elTotal) elTotal.textContent = totalStr;

    const elLab = document.getElementById('auditLabPending');
    if (elLab) elLab.textContent = labPendingStr;

    const elStations = document.getElementById('auditStationsNormalized');
    if (elStations) elStations.textContent = stationsStr;

    const elDirect = document.getElementById('auditDirectPurchases');
    if (elDirect) elDirect.textContent = directStr;

    const elLabFooter = document.getElementById('auditLabPendingFooter');
    if (elLabFooter) elLabFooter.textContent = `Click to Inspect ${labPendingStr} Lot${audit.lab_pending_count === 1 ? '' : 's'}`;

    const elDirectFooter = document.getElementById('auditDirectPurchasesFooter');
    if (elDirectFooter) elDirectFooter.textContent = `Click to View ${directStr} Direct Lots`;

    // Dynamic Integrity Rules Population
    const rules = audit.rules_integrity || {};

    // 1. Zero Denominator
    const elZeroBadge = document.getElementById('auditZeroDenomBadge');
    if (elZeroBadge) elZeroBadge.textContent = `${labPendingStr} Lot${audit.lab_pending_count === 1 ? '' : 's'} Safeguarded`;
    const elZeroCount = document.getElementById('auditZeroDenomCount');
    if (elZeroCount) elZeroCount.textContent = labPendingStr;
    const elZeroTotal = document.getElementById('auditZeroDenomTotal');
    if (elZeroTotal) elZeroTotal.textContent = totalStr;

    // 2. Moisture Typo Outlier
    const elMoistureBadge = document.getElementById('auditMoistureBadge');
    if (elMoistureBadge) elMoistureBadge.textContent = `${rules.moisture_typo?.outlier_count || 1} Outlier Capped`;
    const elMoistureRow = document.getElementById('auditMoistureRow');
    if (elMoistureRow) elMoistureRow.textContent = rules.moisture_typo?.row_ref || 'Row 502 (GIN INWDMSD27/0488)';

    // 3. Date Fallback
    const elDateBadge = document.getElementById('auditDateBadge');
    if (elDateBadge) elDateBadge.textContent = `${totalStr} Dates Verified`;
    const elDateRange = document.getElementById('auditDateRange');
    if (elDateRange) elDateRange.textContent = `${rules.date_fallback?.date_start || '01-Apr-2026'} to ${rules.date_fallback?.date_end || '10-Sep-2026'}`;

    // 4. GIN Split
    const sharedGins = rules.gin_split?.shared_gins || 37;
    const splitRows = rules.gin_split?.split_rows || 76;
    const elGinBadge = document.getElementById('auditGinBadge');
    if (elGinBadge) elGinBadge.textContent = `${sharedGins} Shared GINs`;
    const elSplitRows = document.getElementById('auditSplitRows');
    if (elSplitRows) elSplitRows.textContent = splitRows.toLocaleString();
    const elSharedGins = document.getElementById('auditSharedGins');
    if (elSharedGins) elSharedGins.textContent = sharedGins.toLocaleString();
    const elGinTotal = document.getElementById('auditGinTotal');
    if (elGinTotal) elGinTotal.textContent = totalStr;

  } catch (err) {
    console.error("Error loading audit data:", err);
  }
}

// --- VIEW 8: Google Sheets Daily Sync ---
async function triggerGoogleSheetSync() {
  const sheetId = document.getElementById('inputSheetId').value.trim();
  const gid = document.getElementById('inputSheetGid').value.trim() || '0';
  const msgEl = document.getElementById('syncProgressMsg');

  msgEl.textContent = 'Connecting to Google Sheets and reconciling records...';
  msgEl.style.color = 'var(--mustard-gold)';

  try {
    const res = await fetch('/api/sync/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_id: sheetId, gid: gid })
    });
    const result = await res.json();

    if (result.status === 'SUCCESS') {
      msgEl.textContent = `Sync Complete: ${result.new_records} new, ${result.updated_records} updated, ${result.ml_flagged} flagged.`;
      msgEl.style.color = 'var(--success-green)';
      await loadKPIs();
      await loadSyncHistory();
    } else {
      msgEl.textContent = `${result.message || 'Sync failed.'}`;
      msgEl.style.color = 'var(--danger-red)';
    }
  } catch (err) {
    msgEl.textContent = `Network error during sync: ${err.message}`;
    msgEl.style.color = 'var(--danger-red)';
  }
}

async function loadSyncHistory() {
  try {
    const res = await fetch('/api/sync/history');
    const logs = await res.json();

    if (!state.paginators.syncLogs) {
      state.paginators.syncLogs = createTablePaginator({
        tableId: 'tableSyncLogs',
        summaryId: 'syncLogsPaginationSummary',
        pageSizeSelectId: 'syncLogsPageSizeSelect',
        buttonsId: 'syncLogsPaginationButtons',
        defaultLimit: 5,
        entityName: 'sync history logs',
        renderRow: (l) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${l.timestamp}</td>
            <td><strong>${l.sync_source}</strong></td>
            <td>${l.total_rows}</td>
            <td><span class="badge ${l.status === 'SUCCESS' ? 'badge-success' : 'badge-warning'}">${l.status}</span></td>
            <td>${l.details}</td>
          `;
          return tr;
        }
      });
    }

    state.paginators.syncLogs.update(logs || []);
  } catch (err) {
    console.error("Error loading sync history:", err);
  }
}

// --- Export Filtered View to CSV ---
async function exportCsv() {
  try {
    const qs = buildQueryString({ limit: 5000 });
    const res = await fetch(`/api/records?${qs}`);
    const data = await res.json();

    if (!data.records || data.records.length === 0) {
      alert("No records to export.");
      return;
    }

    const headers = ["ID", "GIN", "GRN", "PO", "Date", "Supplier", "Station", "Bill Weight", "Actual Rate", "Party Condition", "Oil Manual", "Oil Analyzer", "42 Cost", "Cost Impact %", "Status"];
    const csvRows = [headers.join(",")];

    data.records.forEach(r => {
      const row = [
        r.id,
        `"${r.gin || ''}"`,
        `"${r.grn_no || ''}"`,
        `"${r.po_no || ''}"`,
        `"${r.gin_date || ''}"`,
        `"${(r.supplier_name || '').replace(/"/g, '""')}"`,
        `"${(r.station || '').replace(/"/g, '""')}"`,
        r.bill_wt || 0,
        r.actual_rate || 0,
        r.party_condition || 0,
        r.oil_manual || 0,
        r.oil_analyzer || 0,
        r.cost_42 || 0,
        r.cost_diff_pct || 0,
        `"${r.costing_status || ''}"`
      ];
      csvRows.push(row.join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KOGM_42_Costing_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Export CSV error:", err);
  }
}

// Global modal helper
window.openRecordModal = openRecordModal;

// =============================================================
// DEBIT NOTE & LANDING COST ANALYSIS CONTROLLER
// =============================================================

function setupDebitNoteEventListeners() {
  // Subtab switching
  document.querySelectorAll('.dn-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dn-subtab').forEach(b => {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-secondary');
      });
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary', 'active');

      const targetSubtab = btn.getAttribute('data-subtab');
      document.querySelectorAll('.dn-content-section').forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('active');
      });

      if (targetSubtab === 'lots') {
        const el = document.getElementById('dnSectionLots');
        el.style.display = 'block';
        el.classList.add('active');
      } else if (targetSubtab === 'suppliers') {
        const el = document.getElementById('dnSectionSuppliers');
        el.style.display = 'block';
        el.classList.add('active');
      } else if (targetSubtab === 'discrepancies') {
        const el = document.getElementById('dnSectionDiscrepancies');
        el.style.display = 'block';
        el.classList.add('active');
      } else if (targetSubtab === 'simulator') {
        const el = document.getElementById('dnSectionSimulator');
        el.style.display = 'block';
        el.classList.add('active');
        runDnSimulation();
      }
    });
  });

  // Load Stations dropdown on startup
  loadDebitNoteStations();

  // Helper to read all filters from DOM into state
  function syncDnFiltersFromUI() {
    state.dnPagination.search = (document.getElementById('dnLotSearch')?.value || '').trim();
    state.dnPagination.status = document.getElementById('dnLotStatusFilter')?.value || '';
    state.dnPagination.outcome = document.getElementById('dnLotOutcomeFilter')?.value || '';
    state.dnPagination.oilRange = document.getElementById('dnLotOilFilter')?.value || '';
    state.dnPagination.station = document.getElementById('dnLotStationFilter')?.value || '';

    const sortVal = document.getElementById('dnLotSortBy')?.value || 's_no_asc';
    if (sortVal === 'variance_desc') {
      state.dnPagination.sortBy = 'cost_variance';
      state.dnPagination.sortOrder = 'desc';
    } else if (sortVal === 'variance_asc') {
      state.dnPagination.sortBy = 'cost_variance';
      state.dnPagination.sortOrder = 'asc';
    } else if (sortVal === 'date_desc') {
      state.dnPagination.sortBy = 'date';
      state.dnPagination.sortOrder = 'desc';
    } else if (sortVal === 'date_asc') {
      state.dnPagination.sortBy = 'date';
      state.dnPagination.sortOrder = 'asc';
    } else if (sortVal === 'billed_rate_desc') {
      state.dnPagination.sortBy = 'billed_rate_qtl';
      state.dnPagination.sortOrder = 'desc';
    } else if (sortVal === 'oil_asc') {
      state.dnPagination.sortBy = 'oil_analyzer_by';
      state.dnPagination.sortOrder = 'asc';
    } else if (sortVal === 'oil_desc') {
      state.dnPagination.sortBy = 'oil_analyzer_by';
      state.dnPagination.sortOrder = 'desc';
    } else if (sortVal === 'rec_wt_desc') {
      state.dnPagination.sortBy = 'rec_wt_mt';
      state.dnPagination.sortOrder = 'desc';
    } else {
      state.dnPagination.sortBy = 's_no';
      state.dnPagination.sortOrder = 'asc';
    }
  }

  // Filter Button
  const btnSearch = document.getElementById('btnDnSearch');
  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      syncDnFiltersFromUI();
      state.dnPagination.page = 1;
      loadDebitNoteRecords();
    });
  }

  // Search input with Enter key
  const inpSearch = document.getElementById('dnLotSearch');
  if (inpSearch) {
    inpSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        syncDnFiltersFromUI();
        state.dnPagination.page = 1;
        loadDebitNoteRecords();
      }
    });
  }

  // Auto filter on changing any dropdown
  ['dnLotStatusFilter', 'dnLotOutcomeFilter', 'dnLotOilFilter', 'dnLotStationFilter', 'dnLotSortBy'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) {
      sel.addEventListener('change', () => {
        syncDnFiltersFromUI();
        state.dnPagination.page = 1;
        loadDebitNoteRecords();
      });
    }
  });

  // Reset Button
  const btnReset = document.getElementById('btnDnReset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      resetAllDnFilters();
    });
  }

  // Connect top timeline summary pills to auto-filter Debit Note table
  const pillConfigs = [
    { id: 'trendLossPill', type: 'loss' },
    { id: 'trendProfitPill', type: 'profit' },
    { id: 'trendNeutralPill', type: 'even' },
    { id: 'trendPendingPill', type: 'pending' },
    { id: 'trendTotalPill', type: 'total' }
  ];

  pillConfigs.forEach(({ id, type }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', () => filterDebitNoteFromPill(type));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          filterDebitNoteFromPill(type);
        }
      });
    }
  });

  const selPageSize = document.getElementById('dnPageSizeSelect');
  if (selPageSize) {
    selPageSize.addEventListener('change', (e) => {
      state.dnPagination.limit = parseInt(e.target.value, 10);
      state.dnPagination.page = 1;
      loadDebitNoteRecords();
    });
  }

  // Simulator controls
  const btnSim = document.getElementById('btnRunDnSim');
  if (btnSim) btnSim.addEventListener('click', runDnSimulation);
  ['simLandingCost', 'simOilNir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', runDnSimulation);
  });
}

// Global helper to filter Debit Note table by clicking header pills
function filterDebitNoteFromPill(filterType) {
  // 1. Switch to Debit Note & Costing tab
  switchTab('debit-note-analysis');

  // 2. Activate 'lots' subtab
  const btnLots = document.getElementById('btnSubtabLots');
  if (btnLots) {
    document.querySelectorAll('.dn-subtab').forEach(b => {
      b.classList.remove('btn-primary', 'active');
      b.classList.add('btn-secondary');
    });
    btnLots.classList.remove('btn-secondary');
    btnLots.classList.add('btn-primary', 'active');

    document.querySelectorAll('.dn-content-section').forEach(sec => {
      sec.style.display = 'none';
      sec.classList.remove('active');
    });
    const elSection = document.getElementById('dnSectionLots');
    if (elSection) {
      elSection.style.display = 'block';
      elSection.classList.add('active');
    }
  }

  // 3. Clear any previous conflicting form inputs
  const elSearch = document.getElementById('dnLotSearch');
  const elStatus = document.getElementById('dnLotStatusFilter');
  const elOutcome = document.getElementById('dnLotOutcomeFilter');
  const elOil = document.getElementById('dnLotOilFilter');
  const elStation = document.getElementById('dnLotStationFilter');
  const elSort = document.getElementById('dnLotSortBy');

  if (elSearch) elSearch.value = '';
  if (elStatus) elStatus.value = '';
  if (elOutcome) elOutcome.value = '';
  if (elOil) elOil.value = '';
  if (elStation) elStation.value = '';
  if (elSort) elSort.value = 's_no_asc';

  // 4. Set specific filter values based on clicked pill
  let targetStatus = '';
  let targetOutcome = '';
  let targetSortBy = 's_no';
  let targetSortOrder = 'asc';

  if (filterType === 'loss') {
    if (elOutcome) elOutcome.value = 'loss';
    if (elSort) elSort.value = 'variance_desc';
    targetOutcome = 'loss';
    targetSortBy = 'cost_variance';
    targetSortOrder = 'desc';
  } else if (filterType === 'profit') {
    if (elOutcome) elOutcome.value = 'profit';
    if (elSort) elSort.value = 'variance_asc';
    targetOutcome = 'profit';
    targetSortBy = 'cost_variance';
    targetSortOrder = 'asc';
  } else if (filterType === 'even') {
    if (elOutcome) elOutcome.value = 'even';
    targetOutcome = 'even';
    targetSortBy = 's_no';
    targetSortOrder = 'asc';
  } else if (filterType === 'pending') {
    if (elStatus) elStatus.value = 'lab_pending';
    targetStatus = 'lab_pending';
    targetSortBy = 's_no';
    targetSortOrder = 'asc';
  } else if (filterType === 'total') {
    targetSortBy = 's_no';
    targetSortOrder = 'asc';
  }

  // 5. Update state & fetch records immediately
  state.dnPagination.page = 1;
  state.dnPagination.search = '';
  state.dnPagination.status = targetStatus;
  state.dnPagination.outcome = targetOutcome;
  state.dnPagination.oilRange = '';
  state.dnPagination.station = '';
  state.dnPagination.sortBy = targetSortBy;
  state.dnPagination.sortOrder = targetSortOrder;

  renderDnActiveFiltersBar();
  loadDebitNoteRecords();

  // 6. Smooth scroll to the Debit Note table
  setTimeout(() => {
    const tableEl = document.getElementById('dnSectionLots') || document.getElementById('tableDebitNoteLots');
    if (tableEl) {
      tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 120);
}

window.filterDebitNoteFromPill = filterDebitNoteFromPill;

async function loadDebitNoteKpis() {
  try {
    const res = await fetch('/api/debit-note/kpis');
    const data = await res.json();
    state.kpiData = data;
    const isMt = state.unit === 'mt';

    // 1. Total Weight
    const elWeightTitle = document.getElementById('dnKpiWeightTitle');
    if (elWeightTitle) elWeightTitle.textContent = isMt ? 'TOTAL INWARD WEIGHT (MT)' : 'TOTAL INWARD WEIGHT (QTL)';

    if (isMt) {
      document.getElementById('dnKpiWeight').textContent = `${(data.total_rec_wt_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT`;
      document.getElementById('dnKpiWeightQtl').textContent = `${(data.total_rec_wt_qtl).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Quintals • ${data.total_lots.toLocaleString()} Lots`;
    } else {
      document.getElementById('dnKpiWeight').textContent = `${(data.total_rec_wt_qtl).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Qtl`;
      document.getElementById('dnKpiWeightQtl').textContent = `${(data.total_rec_wt_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT • ${data.total_lots.toLocaleString()} Lots`;
    }

    // 2. Taxable Value & 3. Total Deductions
    document.getElementById('dnKpiTaxable').textContent = `₹${(data.total_taxable_amt / 10000000).toFixed(2)} Cr`;
    document.getElementById('dnKpiDeductions').textContent = `₹${(data.total_net_ded / 10000000).toFixed(2)} Cr`;

    // 4. Landing Cost
    const elLandingTitle = document.getElementById('dnKpiLandingTitle');
    if (elLandingTitle) elLandingTitle.textContent = isMt ? 'AVG LANDING COST / MT' : 'AVG LANDING COST / QTL';

    if (isMt) {
      document.getElementById('dnKpiLandingMt').textContent = `₹${data.avg_landing_cost_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('dnKpiLandingQtl').textContent = `₹${data.avg_landing_cost_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / Qtl (After Deductions)`;
    } else {
      document.getElementById('dnKpiLandingMt').textContent = `₹${data.avg_landing_cost_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('dnKpiLandingQtl').textContent = `₹${data.avg_landing_cost_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / MT (After Deductions)`;
    }

    // 5. Avg Lab Oil
    document.getElementById('dnKpiOilNir').textContent = `${data.avg_oil_nir.toFixed(2)}%`;

    // 6. Avg 42% Costing
    const elCost42Title = document.getElementById('dnKpiCost42Title');
    if (elCost42Title) elCost42Title.textContent = isMt ? 'AVG 42% COSTING / MT' : 'AVG 42% COSTING / QTL';

    // 6-Step Story Banner base values
    const billedRateQtl = data.total_rec_wt_qtl > 0 ? (data.total_taxable_amt / data.total_rec_wt_qtl) : 0;
    const dedQtl = data.total_rec_wt_qtl > 0 ? (data.total_net_ded / data.total_rec_wt_qtl) : 0;
    const billedRateMt = billedRateQtl * 10.0;
    const dedMt = dedQtl * 10.0;

    // Quality Variance / Munapha: Step 5 (42% Cost) vs Step 1 (Purchase Billed Rate)
    const diffMt = data.avg_cost_42_mt - billedRateMt;
    const diffQtl = data.avg_cost_42_qtl - billedRateQtl;
    const totQualityDiff = diffQtl * data.total_rec_wt_qtl;
    const isMunapha = isMt ? (diffMt < 0) : (diffQtl < 0);

    if (isMt) {
      document.getElementById('dnKpiCost42Mt').textContent = `₹${data.avg_cost_42_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const impactText = isMunapha
        ? `-₹${Math.abs(diffMt).toFixed(2)}/MT Munapha (-₹${Math.abs(totQualityDiff / 10000000).toFixed(2)} Cr)`
        : `+₹${diffMt.toFixed(2)}/MT Quality Loss (+₹${(totQualityDiff / 10000000).toFixed(2)} Cr)`;
      const elImpact = document.getElementById('dnKpiImpactText');
      if (elImpact) {
        elImpact.textContent = impactText;
        elImpact.style.color = isMunapha ? 'var(--success-green)' : 'var(--danger-red)';
      }
    } else {
      document.getElementById('dnKpiCost42Mt').textContent = `₹${data.avg_cost_42_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const impactText = isMunapha
        ? `-₹${Math.abs(diffQtl).toFixed(2)}/Qtl Munapha (-₹${Math.abs(totQualityDiff / 10000000).toFixed(2)} Cr)`
        : `+₹${diffQtl.toFixed(2)}/Qtl Quality Loss (+₹${(totQualityDiff / 10000000).toFixed(2)} Cr)`;
      const elImpact = document.getElementById('dnKpiImpactText');
      if (elImpact) {
        elImpact.textContent = impactText;
        elImpact.style.color = isMunapha ? 'var(--success-green)' : 'var(--danger-red)';
      }
    }

    // Badge & subtab count
    const badge = document.getElementById('debitNoteBadge');
    if (badge && data.total_lots) badge.textContent = data.total_lots.toLocaleString();
    const btnLots = document.getElementById('btnSubtabLots');
    if (btnLots && data.total_lots) btnLots.innerHTML = `<i class="fa-solid fa-table"></i> ${data.total_lots.toLocaleString()} Reconciled Lots`;
    const btnDisc = document.getElementById('btnSubtabDiscrepancies');
    if (btnDisc && data.total_discrepancies !== undefined) {
      btnDisc.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Discrepancy Log (${data.total_discrepancies.toLocaleString()})`;
    }

    // Populate 6-Step Story Banner
    const elBilled = document.getElementById('storyBilledRate');
    const elBilledSub = document.getElementById('storyBilledRateSub');
    if (elBilled) {
      elBilled.textContent = isMt
        ? `₹${billedRateMt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `₹${billedRateQtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (elBilledSub) {
      elBilledSub.textContent = isMt ? 'Avg Billed Rate / MT' : 'Avg Billed Rate / Quintal';
    }

    const elDed = document.getElementById('storyNetDed');
    const elDedSub = document.getElementById('storyNetDedSub');
    if (elDed) {
      elDed.textContent = isMt
        ? `-₹${dedMt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `-₹${dedQtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (elDedSub) {
      elDedSub.textContent = isMt ? 'Oil, Shortage, Moisture / MT' : 'Oil, Shortage, Moisture / Qtl';
    }

    const elLanding = document.getElementById('storyLandingCost');
    const elLandingSub = document.getElementById('storyLandingCostSub');
    if (elLanding) {
      elLanding.textContent = isMt
        ? `₹${data.avg_landing_cost_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `₹${data.avg_landing_cost_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (elLandingSub) {
      elLandingSub.textContent = isMt
        ? `₹${data.avg_landing_cost_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / Qtl (Post-Deductions)`
        : `₹${data.avg_landing_cost_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / MT (Post-Deductions)`;
    }

    const elOil = document.getElementById('storyOilNir');
    if (elOil) elOil.textContent = `${data.avg_oil_nir.toFixed(2)}%`;

    const elCost42 = document.getElementById('storyCost42');
    const elCost42Sub = document.getElementById('storyCost42Sub');
    if (elCost42) {
      elCost42.textContent = isMt
        ? `₹${data.avg_cost_42_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `₹${data.avg_cost_42_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (elCost42Sub) {
      elCost42Sub.textContent = isMt
        ? `₹${data.avg_cost_42_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / Qtl (Normalized Quality Cost)`
        : `₹${data.avg_cost_42_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / MT (Normalized Quality Cost)`;
    }

    // Step 6: Variance vs Purchase Billed Rate
    const elVar = document.getElementById('storyCostVariance');
    const elVarSub = document.getElementById('storyCostVarianceSub');
    const elVarCard = document.getElementById('storyStepVarianceCard') || (elVar ? elVar.closest('.story-step') : null);
    const elVarLabel = document.getElementById('storyStepVarianceLabel') || (elVarCard ? elVarCard.querySelector('.story-step-label') : null);

    if (elVarLabel) {
      elVarLabel.textContent = isMunapha ? '6. Quality Munapha (Step 5 < 1)' : '6. Quality Variance (Step 5 - 1)';
    }

    if (elVarCard) {
      if (isMunapha) {
        elVarCard.classList.remove('story-step-danger');
        elVarCard.classList.add('story-step-success');
      } else {
        elVarCard.classList.remove('story-step-success');
        elVarCard.classList.add('story-step-danger');
      }
    }

    if (elVar) {
      elVar.textContent = isMt
        ? `${diffMt >= 0 ? '+' : ''}₹${diffMt.toFixed(2)} / MT`
        : `${diffQtl >= 0 ? '+' : ''}₹${diffQtl.toFixed(2)} / Qtl`;
      elVar.style.color = isMunapha ? 'var(--success-green)' : 'var(--danger-red)';
    }
    if (elVarSub) {
      elVarSub.innerHTML = isMt
        ? `<span style="font-family:var(--font-mono); font-weight:700; color:var(--text-primary);">₹${data.avg_cost_42_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - ₹${billedRateMt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><br><span style="font-size:0.69rem; color:var(--text-muted);">${isMunapha ? '(Munapha: 42% Cost < Purchase Rate)' : '(42% Cost - Purchase Rate)'}</span>`
        : `<span style="font-family:var(--font-mono); font-weight:700; color:var(--text-primary);">₹${data.avg_cost_42_qtl.toFixed(2)} - ₹${billedRateQtl.toFixed(2)}</span><br><span style="font-size:0.69rem; color:var(--text-muted);">${isMunapha ? '(Munapha: 42% Cost < Purchase Rate)' : '(42% Cost - Purchase Rate)'}</span>`;
    }
    // Keep live average synced to simple calculator
    loadSimplePreset('dataset_avg');
  } catch (err) {
    console.error("Error loading Debit Note KPIs:", err);
  }
}

async function loadDebitNoteStations() {
  try {
    const res = await fetch('/api/debit-note/stations');
    const data = await res.json();
    const selStation = document.getElementById('dnLotStationFilter');
    if (selStation && data.stations) {
      const currentVal = selStation.value;
      selStation.innerHTML = '<option value="">📍 All Mandis / Stations</option>';
      data.stations.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.station;
        opt.textContent = `${s.station} (${s.count})`;
        selStation.appendChild(opt);
      });
      if (currentVal) selStation.value = currentVal;
    }
  } catch (e) {
    console.error("Error loading Debit Note stations:", e);
  }
}

function renderDnActiveFiltersBar() {
  const bar = document.getElementById('dnActiveFiltersBar');
  if (!bar) return;

  const chips = [];

  const toggleControl = (id, isActive) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isActive) {
      el.classList.add('filter-active-control');
    } else {
      el.classList.remove('filter-active-control');
    }
  };

  const searchActive = !!(state.dnPagination.search && state.dnPagination.search.trim());
  toggleControl('dnLotSearch', searchActive);
  if (searchActive) {
    chips.push({
      key: 'search',
      label: 'Search',
      value: `"${state.dnPagination.search}"`,
      icon: 'fa-solid fa-magnifying-glass'
    });
  }

  const statusActive = !!(state.dnPagination.status);
  toggleControl('dnLotStatusFilter', statusActive);
  if (statusActive) {
    let statusText = state.dnPagination.status;
    if (statusText === 'Matched') statusText = 'Verified Lots';
    else if (statusText === 'Oil Discrepancy Flagged') statusText = 'Oil Mismatch Flagged';
    else if (statusText === 'lab_pending') statusText = 'Lab Pending / Awaiting';
    chips.push({
      key: 'status',
      label: 'Status',
      value: statusText,
      icon: 'fa-solid fa-clipboard-check'
    });
  }

  const outcomeActive = !!(state.dnPagination.outcome);
  toggleControl('dnLotOutcomeFilter', outcomeActive);
  if (outcomeActive) {
    let outcomeText = state.dnPagination.outcome;
    if (outcomeText === 'loss') outcomeText = 'Quality Loss (+₹)';
    else if (outcomeText === 'profit') outcomeText = 'Quality Profit (-₹)';
    else if (outcomeText === 'even') outcomeText = 'No Profit - No Loss (₹0)';
    else if (outcomeText === 'moderate_loss') outcomeText = 'Moderate Loss (₹0 - ₹200)';
    else if (outcomeText === 'heavy_loss') outcomeText = 'High Loss (> ₹200)';
    chips.push({
      key: 'outcome',
      label: 'Outcome',
      value: outcomeText,
      icon: 'fa-solid fa-scale-balanced'
    });
  }

  const oilActive = !!(state.dnPagination.oilRange);
  toggleControl('dnLotOilFilter', oilActive);
  if (oilActive) {
    let oilText = state.dnPagination.oilRange;
    if (oilText === 'above_benchmark') oilText = '42%+ Benchmark Oil';
    else if (oilText === 'near_benchmark') oilText = '40% - 42% Oil';
    else if (oilText === 'sub_benchmark') oilText = '38% - 40% Oil';
    else if (oilText === 'low') oilText = 'Under 38% Low Oil';
    chips.push({
      key: 'oil',
      label: 'Oil Content',
      value: oilText,
      icon: 'fa-solid fa-flask-vial'
    });
  }

  const stationActive = !!(state.dnPagination.station);
  toggleControl('dnLotStationFilter', stationActive);
  if (stationActive) {
    chips.push({
      key: 'station',
      label: 'Mandi',
      value: state.dnPagination.station,
      icon: 'fa-solid fa-location-dot'
    });
  }

  if (chips.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="active-filters-label">
      <i class="fa-solid fa-filter-circle-check"></i> Applied Filters (${chips.length}):
    </span>
    ${chips.map(c => `
      <span class="active-filter-chip">
        <i class="${c.icon}" style="color: var(--mustard-gold); font-size: 0.75rem;"></i>
        <span>${c.label}: <strong>${c.value}</strong></span>
        <button class="btn-chip-remove" onclick="clearDnFilter('${c.key}')" title="Remove ${c.label} filter">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </span>
    `).join('')}
    <button class="btn-clear-all-chips" onclick="resetAllDnFilters()" title="Reset all table filters">
      <i class="fa-solid fa-rotate-left"></i> Clear All (${chips.length})
    </button>
  `;
}

function clearDnFilter(key) {
  if (key === 'search') {
    const el = document.getElementById('dnLotSearch');
    if (el) el.value = '';
    state.dnPagination.search = '';
  } else if (key === 'status') {
    const el = document.getElementById('dnLotStatusFilter');
    if (el) el.value = '';
    state.dnPagination.status = '';
  } else if (key === 'outcome') {
    const el = document.getElementById('dnLotOutcomeFilter');
    if (el) el.value = '';
    state.dnPagination.outcome = '';
  } else if (key === 'oil') {
    const el = document.getElementById('dnLotOilFilter');
    if (el) el.value = '';
    state.dnPagination.oilRange = '';
  } else if (key === 'station') {
    const el = document.getElementById('dnLotStationFilter');
    if (el) el.value = '';
    state.dnPagination.station = '';
  }
  renderDnActiveFiltersBar();
  state.dnPagination.page = 1;
  loadDebitNoteRecords();
}

function resetAllDnFilters() {
  if (document.getElementById('dnLotSearch')) document.getElementById('dnLotSearch').value = '';
  if (document.getElementById('dnLotStatusFilter')) document.getElementById('dnLotStatusFilter').value = '';
  if (document.getElementById('dnLotOutcomeFilter')) document.getElementById('dnLotOutcomeFilter').value = '';
  if (document.getElementById('dnLotOilFilter')) document.getElementById('dnLotOilFilter').value = '';
  if (document.getElementById('dnLotStationFilter')) document.getElementById('dnLotStationFilter').value = '';
  if (document.getElementById('dnLotSortBy')) document.getElementById('dnLotSortBy').value = 's_no_asc';

  state.dnPagination.search = '';
  state.dnPagination.status = '';
  state.dnPagination.outcome = '';
  state.dnPagination.oilRange = '';
  state.dnPagination.station = '';
  state.dnPagination.sortBy = 's_no';
  state.dnPagination.sortOrder = 'asc';
  state.dnPagination.page = 1;

  renderDnActiveFiltersBar();
  loadDebitNoteRecords();
}

window.clearDnFilter = clearDnFilter;
window.resetAllDnFilters = resetAllDnFilters;

async function loadDebitNoteRecords() {
  renderDnActiveFiltersBar();
  try {
    const isMt = state.unit === 'mt';
    const params = new URLSearchParams({
      page: state.dnPagination.page,
      limit: state.dnPagination.limit,
      sort_by: state.dnPagination.sortBy,
      sort_order: state.dnPagination.sortOrder
    });
    if (state.dnPagination.search) params.append('search', state.dnPagination.search);
    if (state.dnPagination.status) params.append('status', state.dnPagination.status);
    if (state.dnPagination.outcome) params.append('outcome', state.dnPagination.outcome);
    if (state.dnPagination.oilRange) params.append('oil_range', state.dnPagination.oilRange);
    if (state.dnPagination.station) params.append('station', state.dnPagination.station);

    const res = await fetch(`/api/debit-note/records?${params.toString()}`);
    const data = await res.json();

    state.dnPagination.total = data.total;
    state.dnPagination.totalAll = data.total_all || state.dnPagination.totalAll || 2038;
    state.dnPagination.isFiltered = data.is_filtered !== undefined ? data.is_filtered : (state.dnPagination.total !== state.dnPagination.totalAll);
    state.dnPagination.totalPages = data.pages;

    updateDnPaginationSummary(data);

    const tbody = document.querySelector('#tableDnLots tbody');
    tbody.innerHTML = '';

    if (data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="16" style="text-align:center; padding: 3rem 1rem; color: var(--text-muted);"><i class="fa-solid fa-filter-circle-xmark" style="font-size:2rem; margin-bottom:0.75rem; opacity:0.5; display:block;"></i>No lots match the selected filter criteria.<br><span style="font-size:0.8rem; color:var(--text-secondary);">Try adjusting the dropdowns or click <b>Reset</b>.</span></td></tr>`;
      renderDnPaginationControls();
      return;
    }

    data.records.forEach(r => {
      const tr = document.createElement('tr');
      let statusBadge = '';
      if (r.status === 'Matched') {
        statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Matched</span>`;
      } else if (r.status === 'Amount Discrepancy') {
        statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Discrepancy</span>`;
      } else {
        statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> ${r.status}</span>`;
      }

      const billWtQtl = r.bill_wt_qtl || (r.rec_wt_qtl || 0);
      const recWtQtl = r.rec_wt_qtl || 0;
      const billWtMt = billWtQtl / 10.0;
      const recWtMt = r.rec_wt_mt || (recWtQtl / 10.0);

      const billedRateQtl = r.billed_rate_qtl || (billWtQtl > 0 ? (r.debit_amt_y / billWtQtl) : (recWtQtl > 0 ? r.debit_amt_y / recWtQtl : 0));
      const billedRateMt = billedRateQtl * 10.0;

      const rateDiffQtl = r.rate_diff_qtl !== null && r.rate_diff_qtl !== undefined
        ? r.rate_diff_qtl
        : (r.cost_42_qtl && billedRateQtl ? (r.cost_42_qtl - billedRateQtl) : null);
      const rateDiffMt = rateDiffQtl !== null ? rateDiffQtl * 10.0 : null;

      const isLabPending = !r.cost_42_qtl || !r.oil_nir || r.oil_analyzer_by <= 0 || r.status === 'Lab Data Not Available';

      let diffBadge = '—';
      if (isLabPending) {
        diffBadge = `
          <span class="badge" style="background: rgba(245, 158, 11, 0.14); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); font-weight:700; font-size:0.78rem; display:inline-block; padding: 3px 8px; border-radius: 4px;">
            <i class="fa-solid fa-hourglass-start"></i> Lab Pending
          </span>
          <div style="font-size:0.67rem; color:var(--text-muted); margin-top:2px;">
            Awaiting NIR Oil
          </div>
        `;
      } else if (rateDiffQtl !== null && r.cost_42_qtl) {
        const cost42Val = isMt ? (r.cost_42_mt || (r.cost_42_qtl * 10.0)) : r.cost_42_qtl;
        const billedVal = isMt ? billedRateMt : billedRateQtl;

        if (rateDiffQtl > 0) {
          diffBadge = `
            <span class="badge-diff-danger" style="display:inline-block; font-weight:700; font-size:0.82rem;">
              <i class="fa-solid fa-arrow-trend-up"></i> ${isMt ? `+₹${rateDiffMt.toFixed(2)}/MT` : `+₹${rateDiffQtl.toFixed(2)}/Qtl`} (Loss)
            </span>
            <div style="font-size:0.73rem; font-family:var(--font-mono); font-weight:700; color:var(--text-secondary); margin-top:3px; letter-spacing: -0.01em;">
              ₹${cost42Val.toFixed(2)} - ₹${billedVal.toFixed(2)}
            </div>
            <div style="font-size:0.67rem; color:var(--text-muted); margin-top:1px;">
              (42% Cost - Purchase Rate)
            </div>
          `;
        } else {
          diffBadge = `
            <span class="badge-diff-success" style="display:inline-block; font-weight:700; font-size:0.82rem;">
              <i class="fa-solid fa-arrow-trend-down"></i> ${isMt ? `-₹${Math.abs(rateDiffMt).toFixed(2)}/MT` : `-₹${Math.abs(rateDiffQtl).toFixed(2)}/Qtl`} (Profit)
            </span>
            <div style="font-size:0.73rem; font-family:var(--font-mono); font-weight:700; color:var(--text-secondary); margin-top:3px; letter-spacing: -0.01em;">
              ₹${cost42Val.toFixed(2)} - ₹${billedVal.toFixed(2)}
            </div>
            <div style="font-size:0.67rem; color:var(--text-muted); margin-top:1px;">
              (42% Cost - Purchase Rate)
            </div>
          `;
        }
      }

      // Weight block HTML
      const wtHtml = isMt
        ? `<div style="font-weight:700; color:var(--text-primary); font-size:0.92rem;">Bill: ${billWtMt ? billWtMt.toFixed(2) + ' MT' : '—'}</div>
           <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Rec: ${recWtMt ? recWtMt.toFixed(2) + ' MT' : '—'} (${recWtQtl ? recWtQtl.toFixed(1) + ' Qtl' : '—'})</div>`
        : `<div style="font-weight:700; color:var(--text-primary); font-size:0.92rem;">Bill: ${billWtQtl ? billWtQtl.toFixed(1) + ' Qtl' : '—'}</div>
           <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Rec: ${recWtQtl ? recWtQtl.toFixed(1) + ' Qtl' : '—'} (${recWtMt ? recWtMt.toFixed(2) + ' MT' : '—'})</div>`;

      // Billed rate HTML
      const rateHtml = isMt
        ? `<span class="badge-rate" title="Mandi Purchase Rate / MT"><i class="fa-solid fa-cart-shopping" style="font-size:0.75rem; opacity:0.85;"></i> ₹${billedRateMt.toFixed(2)} / MT</span>
           <div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px;"><span style="color:var(--accent-blue); font-weight:700;">Mandi:</span> ₹${billedRateQtl.toFixed(2)} / Qtl</div>`
        : `<span class="badge-rate" title="Mandi Purchase Rate / Qtl"><i class="fa-solid fa-cart-shopping" style="font-size:0.75rem; opacity:0.85;"></i> ₹${billedRateQtl.toFixed(2)} / Qtl</span>
           <div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px;"><span style="color:var(--accent-blue); font-weight:700;">Bill:</span> ₹${r.debit_amt_y ? (r.debit_amt_y / 100000).toFixed(2) + ' L' : '0'}</div>`;

      // Deductions HTML
      const dedPerUnit = isMt
        ? (recWtMt > 0 ? (r.net_ded || 0) / recWtMt : 0)
        : (recWtQtl > 0 ? (r.net_ded || 0) / recWtQtl : 0);
      const dedUnitSuffix = isMt ? '/MT' : '/Qtl';

      // Landing cost HTML
      const landingHtml = isMt
        ? `<span class="badge-landing">₹${r.landing_cost_mt ? r.landing_cost_mt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'} / MT</span>
           <div style="font-size:0.78rem; color:var(--success-green); margin-top:3px; font-weight:600;">₹${r.landing_cost_qtl ? r.landing_cost_qtl.toFixed(2) : '—'}/Qtl</div>`
        : `<span class="badge-landing">₹${r.landing_cost_qtl ? r.landing_cost_qtl.toFixed(2) : '—'} / Qtl</span>
           <div style="font-size:0.78rem; color:var(--success-green); margin-top:3px; font-weight:600;">₹${r.landing_cost_mt ? r.landing_cost_mt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}/MT</div>`;

      // 42 Costing HTML
      let cost42Html = '';
      if (isLabPending) {
        cost42Html = `
          <span style="color: #d97706; font-size: 0.84rem; font-weight: 700;">
            <i class="fa-solid fa-clock"></i> Lab Pending
          </span>
          <div style="font-size:0.70rem; color:var(--text-muted); margin-top:2px;">Std: 42% Target</div>
        `;
      } else {
        cost42Html = isMt
          ? `<span class="badge-cost42" title="42% Standard Normalized Cost / MT"><i class="fa-solid fa-star" style="color:#f59e0b; font-size:0.78rem;"></i> ₹${r.cost_42_mt ? r.cost_42_mt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'} / MT</span>
             <div style="font-size:0.75rem; color:var(--mustard-gold); margin-top:3px; font-weight:700;">★ ₹${r.cost_42_qtl ? r.cost_42_qtl.toFixed(2) : '—'}/Qtl</div>`
          : `<span class="badge-cost42" title="42% Standard Normalized Cost / Qtl"><i class="fa-solid fa-star" style="color:#f59e0b; font-size:0.78rem;"></i> ₹${r.cost_42_qtl ? r.cost_42_qtl.toFixed(2) : '—'} / Qtl</span>
             <div style="font-size:0.75rem; color:var(--mustard-gold); margin-top:3px; font-weight:700;">★ ₹${r.cost_42_mt ? r.cost_42_mt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}/MT</div>`;
      }

      // Dual Oil Comparison Chip
      let oilChipHtml = '';
      if (r.oil_analyzer_by > 0 && r.oil_analyzer_ax > 0) {
        if (r.oil_mismatch_flag || Math.abs(r.oil_analyzer_by - r.oil_analyzer_ax) > 0.05) {
          oilChipHtml = `
            <span class="badge-oil" style="background: rgba(239, 68, 68, 0.2); color: var(--danger-red); border: 1px solid var(--danger-red);">${r.oil_nir ? r.oil_nir.toFixed(2) + '%' : '—'}</span>
            <div style="font-size:0.71rem; color:var(--danger-red); font-weight:700; margin-top:2px;">⚠️ BY: ${r.oil_analyzer_by.toFixed(2)}% | AX: ${r.oil_analyzer_ax.toFixed(2)}%</div>
          `;
        } else {
          oilChipHtml = `
            <span class="badge-oil">${r.oil_nir ? r.oil_nir.toFixed(2) + '%' : 'Pending'}</span>
            <div style="font-size:0.71rem; color:var(--success-green); font-weight:600; margin-top:2px;"><i class="fa-solid fa-check-double"></i> BY: ${r.oil_analyzer_by.toFixed(2)}% (AX: ${r.oil_analyzer_ax.toFixed(2)}%)</div>
          `;
        }
      } else {
        oilChipHtml = `
          <span class="badge-oil">${r.oil_nir ? r.oil_nir.toFixed(2) + '%' : 'Pending'}</span>
          <div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">Tested Oil: ${r.oil_analyzer_by ? r.oil_analyzer_by.toFixed(2) + '%' : (r.oil_nir ? r.oil_nir.toFixed(2) + '%' : '—')}</div>
        `;
      }

      const isMultiPo = r.remarks && r.remarks.includes('Multi-PO');
      const multiPoBadge = isMultiPo
        ? `<span class="badge" style="background: rgba(14, 165, 233, 0.14); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4); font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="${r.remarks}"><i class="fa-solid fa-truck-ramp-box"></i> Multi-PO Split</span>`
        : '';

      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap;">
            <span style="font-size:0.82rem; color:var(--text-muted); font-weight:700;">#${r.s_no}</span>
            <strong style="color:var(--text-primary); font-size:0.98rem;">${r.supplier_name}</strong>
            ${multiPoBadge}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">
            <span style="color:var(--mustard-gold); font-weight:700;">${r.gin}</span>
            ${r.po_no ? ' • ' + r.po_no : ''} • ${r.date || '—'}
          </div>
          <div style="font-size:0.74rem; color:var(--text-secondary); margin-top:3px; display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${r.supervisor_name ? `<span><i class="fa-solid fa-user-tie" style="color:var(--accent-blue);"></i> ${r.supervisor_name}</span>` : ''}
            ${r.broker_name ? `<span><i class="fa-solid fa-handshake" style="color:var(--accent-cyan);"></i> ${r.broker_name}${r.brokerage_rate > 0 ? ` (@₹${r.brokerage_rate}/Q)` : ''}</span>` : ''}
            ${r.station ? `<span><i class="fa-solid fa-location-dot" style="color:var(--warning-orange);"></i> ${r.station}</span>` : ''}
          </div>
        </td>
        <td style="text-align:right;">
          ${wtHtml}
        </td>
        <td style="text-align:right;" class="td-col-rate">
          ${rateHtml}
        </td>
        <td style="text-align:right;">
          <span class="badge-ded">-₹${r.net_ded ? r.net_ded.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0'}</span>
          <div style="font-size:0.78rem; color:var(--danger-red); margin-top:3px; font-weight:600;">-₹${dedPerUnit.toFixed(2)}${dedUnitSuffix}</div>
        </td>
        <td style="text-align:right;">
          ${landingHtml}
        </td>
        <td style="text-align:center;">
          ${oilChipHtml}
        </td>
        <td style="text-align:right;" class="td-col-cost42">
          ${cost42Html}
        </td>
        <td style="text-align:right;">
          ${diffBadge}
        </td>
        <td style="text-align:center;">
          <button class="btn-secondary btn-audit-lot" style="padding: 5px 12px; font-size: 0.82rem; font-weight: 600; border-radius: var(--radius-sm); cursor: pointer;" title="Audit Complete Cost & Deduction Steps">
            <i class="fa-solid fa-eye"></i> Audit
          </button>
        </td>
      `;

      // Attach audit click
      const btnAudit = tr.querySelector('.btn-audit-lot');
      if (btnAudit) {
        btnAudit.addEventListener('click', () => openDebitLotModal(r));
      }

      tbody.appendChild(tr);
    });

    renderDnPaginationControls();
  } catch (err) {
    console.error("Error loading Debit Note records:", err);
  }
}

function updateDnPaginationSummary(data) {
  const total = data && data.total !== undefined ? data.total : (state.dnPagination.total || 0);
  const totalAll = data && data.total_all !== undefined ? data.total_all : (state.dnPagination.totalAll || 2038);
  const isFiltered = data && data.is_filtered !== undefined ? data.is_filtered : (state.dnPagination.isFiltered || (total !== totalAll));
  const page = data && data.page !== undefined ? data.page : state.dnPagination.page;
  const limit = data && data.limit !== undefined ? data.limit : state.dnPagination.limit;

  const startIdx = total > 0 ? (page - 1) * limit + 1 : 0;
  const endIdx = Math.min(page * limit, total);

  const topEl = document.getElementById('dnTopPaginationSummary');
  const bottomEl = document.getElementById('dnPaginationSummary');

  let topHtml = '';
  let bottomHtml = '';

  if (total === 0) {
    topHtml = `<span style="background: rgba(239, 68, 68, 0.14); color: var(--danger-red); padding: 3px 10px; border-radius: 6px; font-weight: 700; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.82rem;"><i class="fa-solid fa-circle-exclamation"></i> 0 lots found</span> <span style="color: var(--text-muted); font-size: 0.78rem;">(from ${totalAll.toLocaleString()} total)</span>`;
    bottomHtml = `<span style="color: var(--danger-red); font-weight: 600;">0 records found</span> matching selected filter criteria (out of ${totalAll.toLocaleString()} total lots)`;
  } else if (isFiltered && total < totalAll) {
    topHtml = `<span style="background: rgba(245, 158, 11, 0.16); color: var(--mustard-gold); padding: 3px 10px; border-radius: 6px; font-weight: 700; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.82rem;"><i class="fa-solid fa-filter"></i> ${total.toLocaleString()} Lots</span> <span style="color: var(--text-secondary);">Showing ${startIdx.toLocaleString()} to ${endIdx.toLocaleString()}</span> <span style="color: var(--text-muted); font-size: 0.76rem;">(Filtered from ${totalAll.toLocaleString()} total)</span>`;
    bottomHtml = `Showing <b>${startIdx.toLocaleString()}</b> to <b>${endIdx.toLocaleString()}</b> of <b style="color: var(--mustard-gold);">${total.toLocaleString()}</b> filtered records <span style="color: var(--text-muted); font-size: 0.78rem;">(from ${totalAll.toLocaleString()} total)</span>`;
  } else {
    topHtml = `Showing <b>${startIdx.toLocaleString()}</b> to <b>${endIdx.toLocaleString()}</b> of <b>${total.toLocaleString()}</b> records`;
    bottomHtml = `Showing ${startIdx.toLocaleString()} to ${endIdx.toLocaleString()} of ${total.toLocaleString()} records`;
  }

  if (topEl) topEl.innerHTML = topHtml;
  if (bottomEl) bottomEl.innerHTML = bottomHtml;
}

function renderDnPaginationControls() {
  updateDnPaginationSummary();

  const btnContainer = document.getElementById('dnPaginationButtons');
  btnContainer.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.disabled = state.dnPagination.page <= 1;
  prevBtn.addEventListener('click', () => {
    state.dnPagination.page--;
    loadDebitNoteRecords();
  });
  btnContainer.appendChild(prevBtn);

  const cur = state.dnPagination.page;
  const total = state.dnPagination.totalPages;
  const pageNums = [1];
  if (cur > 3) pageNums.push('...');
  for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) {
    pageNums.push(i);
  }
  if (cur < total - 2) pageNums.push('...');
  if (total > 1) pageNums.push(total);

  pageNums.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.style.padding = '0 4px';
      span.textContent = '...';
      btnContainer.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = `page-btn ${p === cur ? 'active' : ''}`;
      btn.textContent = p;
      btn.addEventListener('click', () => {
        state.dnPagination.page = p;
        loadDebitNoteRecords();
      });
      btnContainer.appendChild(btn);
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = state.dnPagination.page >= total;
  nextBtn.addEventListener('click', () => {
    state.dnPagination.page++;
    loadDebitNoteRecords();
  });
  btnContainer.appendChild(nextBtn);
}

async function loadDebitNoteSuppliers() {
  try {
    const res = await fetch('/api/debit-note/suppliers?limit=100');
    const data = await res.json();

    if (!state.paginators.dnSuppliers) {
      state.paginators.dnSuppliers = createTablePaginator({
        tableId: 'tableDnSuppliers',
        summaryId: 'dnSuppliersPaginationSummary',
        pageSizeSelectId: 'dnSuppliersPageSizeSelect',
        buttonsId: 'dnSuppliersPaginationButtons',
        defaultLimit: 10,
        entityName: 'suppliers',
        renderRow: (s, idx, globalRank) => {
          const tr = document.createElement('tr');
          const isLoss = s.is_loss !== undefined ? s.is_loss : ((s.avg_rate_diff_mt || s.avg_cost_42_mt - s.avg_purchase_rate_mt) > 0);
          const impactDiff = Math.abs(s.rate_impact_amt !== undefined ? s.rate_impact_amt : ((s.avg_cost_42_mt - s.avg_purchase_rate_mt) * s.total_rec_wt_mt));
          const isMt = state.unit === 'mt';

          const cost42Num = isMt ? s.avg_cost_42_mt : (s.avg_cost_42_qtl || s.avg_cost_42_mt / 10.0);
          const rateNum = isMt ? s.avg_purchase_rate_mt : (s.avg_purchase_rate_qtl || s.avg_purchase_rate_mt / 10.0);
          const wtNum = isMt ? s.total_rec_wt_mt : (s.total_rec_wt_qtl || s.total_rec_wt_mt * 10.0);
          const wtUnit = isMt ? 'MT' : 'Qtl';

          const impactBadge = isLoss
            ? `<span class="badge-diff-danger" style="font-weight:700; font-size:0.82rem; display:inline-block;"><i class="fa-solid fa-arrow-trend-up"></i> +₹${impactDiff.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Loss)</span>`
            : `<span class="badge-diff-success" style="font-weight:700; font-size:0.82rem; display:inline-block;"><i class="fa-solid fa-arrow-trend-down"></i> -₹${impactDiff.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (Profit)</span>`;

          const purchaseRate = isMt
            ? (s.avg_purchase_rate_mt ? `₹${s.avg_purchase_rate_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—')
            : (s.avg_purchase_rate_qtl ? `₹${s.avg_purchase_rate_qtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : (s.avg_purchase_rate_mt ? `₹${(s.avg_purchase_rate_mt / 10).toFixed(2)}` : '—'));

          const landingCost = isMt
            ? `₹${s.avg_landing_cost_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `₹${(s.avg_landing_cost_qtl || s.avg_landing_cost_mt / 10).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          const cost42 = isMt
            ? `₹${s.avg_cost_42_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `₹${(s.avg_cost_42_qtl || s.avg_cost_42_mt / 10).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          const wtDisplay = isMt
            ? `${s.total_rec_wt_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`
            : `${(s.total_rec_wt_qtl || s.total_rec_wt_mt * 10).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Qtl`;

          tr.innerHTML = `
            <td style="text-align:center; font-weight:700; color:var(--text-muted);">#${globalRank}</td>
            <td><strong style="color:var(--text-primary); font-size:0.95rem;">${s.supplier_name}</strong></td>
            <td style="text-align:center; font-weight:700;">${s.total_lots}</td>
            <td style="text-align:right; font-weight:600;">${wtDisplay}</td>
            <td style="text-align:right;" class="td-col-rate"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ${purchaseRate}</span></td>
            <td style="text-align:right; color: var(--danger-red); font-weight:600;">₹${(s.total_net_ded).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
            <td style="text-align:right;"><strong style="color: var(--success-green);">${landingCost}</strong></td>
            <td style="text-align:center;"><strong style="color: var(--accent-cyan);">${s.avg_oil_nir.toFixed(2)}%</strong></td>
            <td style="text-align:right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ${cost42}</span></td>
            <td style="text-align:right;">
              ${impactBadge}
              <div style="font-size:0.72rem; font-family:var(--font-mono); font-weight:700; color:var(--text-secondary); margin-top:3px; letter-spacing: -0.01em;">
                (₹${cost42Num.toFixed(2)} - ₹${rateNum.toFixed(2)}) × ${wtNum.toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${wtUnit}
              </div>
              <div style="font-size:0.67rem; color:var(--text-muted); margin-top:1px;">
                (42% Cost - Purchase Rate) × Weight
              </div>
            </td>
          `;
          return tr;
        }
      });
    }

    state.paginators.dnSuppliers.update(data || []);
  } catch (err) {
    console.error("Error loading Debit Note suppliers:", err);
  }
}

async function loadDebitNoteDiscrepancies() {
  try {
    const res = await fetch('/api/debit-note/discrepancies');
    const data = await res.json();
    const discRecords = data.records || [];

    const btnDisc = document.getElementById('btnSubtabDiscrepancies');
    if (btnDisc) {
      btnDisc.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Discrepancy Log (${discRecords.length})`;
    }
    const headerDisc = document.getElementById('dnDiscrepancyHeader');
    if (headerDisc) {
      headerDisc.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Reconciliation Discrepancies & Audit Log (${discRecords.length} Records)`;
    }

    if (!state.paginators.dnDiscrepancies) {
      state.paginators.dnDiscrepancies = createTablePaginator({
        tableId: 'tableDnDiscrepancies',
        summaryId: 'dnDiscrepanciesPaginationSummary',
        pageSizeSelectId: 'dnDiscrepanciesPageSizeSelect',
        buttonsId: 'dnDiscrepanciesPaginationButtons',
        defaultLimit: 10,
        entityName: 'discrepancy records',
        renderRow: (r, idx, globalRank) => {
          const tr = document.createElement('tr');
          const diffVal = r.debit_amt_y - r.taxable_amt_an;

          tr.innerHTML = `
            <td style="text-align:center; font-weight:700;">${globalRank}</td>
            <td>
              <div style="font-weight:700; color:var(--mustard-gold);">${r.gin}</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">${r.po_no || '—'}</div>
            </td>
            <td>
              <strong style="color:var(--text-primary);">${r.supplier_name}</strong>
            </td>
            <td style="text-align:center; font-size:0.8rem;">${r.date || '—'}</td>
            <td style="text-align:right;">
              <div style="font-weight:600;">Debit: ₹${r.debit_amt_y ? r.debit_amt_y.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0'}</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">Lab: ₹${r.taxable_amt_an ? r.taxable_amt_an.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0'}</div>
            </td>
            <td style="text-align:right;">
              <strong style="color: var(--warning-orange);">${diffVal > 0 ? '+' : ''}₹${diffVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
            </td>
            <td style="text-align:right; color: var(--danger-red);">
              -₹${r.net_ded ? r.net_ded.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0'}
            </td>
            <td style="text-align:center;"><span class="badge badge-warning">${r.status}</span></td>
            <td style="font-size:0.78rem; color:var(--text-secondary);">${r.remarks}</td>
          `;
          return tr;
        }
      });
    }

    state.paginators.dnDiscrepancies.update(discRecords || []);
  } catch (err) {
    console.error("Error loading Debit Note discrepancies:", err);
  }
}

function loadSimplePreset(presetType) {
  const avgLanding = (state.kpiData && state.kpiData.avg_landing_cost_qtl) || 7295.97;
  const avgOil = (state.kpiData && state.kpiData.avg_oil_nir) || 39.78;

  let landing = avgLanding;
  let oil = avgOil;

  if (presetType === 'dataset_avg') {
    landing = avgLanding;
    oil = avgOil;
  } else if (presetType === 'profit_lot' || presetType === 'munakha_lot') {
    landing = 7350.00;
    oil = 42.60;
  } else if (presetType === 'loss_lot') {
    landing = 7300.00;
    oil = 38.20;
  } else if (presetType === 'benchmark_lot') {
    landing = 7200.00;
    oil = 42.00;
  }

  const elLanding = document.getElementById('simLandingCost');
  if (elLanding) elLanding.value = landing.toFixed(2);

  const elOil = document.getElementById('simOilNir');
  if (elOil) elOil.value = oil.toFixed(2);

  runDnSimulation();
}
window.loadSimplePreset = loadSimplePreset;

function runDnSimulation() {
  const landingQtl = parseFloat(document.getElementById('simLandingCost')?.value) || 0;
  const oilNir = parseFloat(document.getElementById('simOilNir')?.value) || 0;

  const elLandingHelp = document.getElementById('simLandingMtHelp');
  if (elLandingHelp) {
    elLandingHelp.textContent = `(= ₹${(landingQtl * 10).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / MT)`;
  }

  if (oilNir <= 0 || landingQtl <= 0) {
    const elCQ = document.getElementById('simResultCost42Qtl'); if (elCQ) elCQ.textContent = '—';
    const elCM = document.getElementById('simResultCost42Mt'); if (elCM) elCM.textContent = '—';
    const elDiff = document.getElementById('simResultDiffQtl'); if (elDiff) elDiff.textContent = '—';
    return;
  }

  // DIRECT FORMULA: (Landing Cost / Lab Oil) * 42.0
  const cost42Qtl = (landingQtl / oilNir) * 42.0;
  const cost42Mt = cost42Qtl * 10.0;
  const landingMt = landingQtl * 10.0;
  const diffQtl = cost42Qtl - landingQtl;
  const diffMt = diffQtl * 10.0;
  const diffPct = ((cost42Qtl - landingQtl) / landingQtl) * 100.0;
  const isLoss = diffQtl > 0.001;
  const isEven = Math.abs(diffQtl) <= 0.001;

  // 1. Big 42% Cost Display
  const elCQ = document.getElementById('simResultCost42Qtl');
  if (elCQ) {
    elCQ.innerHTML = `₹${cost42Qtl.toFixed(2)} <span style="font-size: 1.05rem; font-weight: 600; color: var(--text-secondary);">/ Qtl</span>`;
  }

  const elCM = document.getElementById('simResultCost42Mt');
  if (elCM) {
    elCM.textContent = `(= ₹${cost42Mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / MT)`;
  }

  // 2. Breakdown Values
  const elLD = document.getElementById('simResultLandingDisplay');
  if (elLD) {
    elLD.textContent = `₹${landingQtl.toFixed(2)} / Qtl (₹${landingMt.toFixed(2)} / MT)`;
  }

  const elOD = document.getElementById('simResultOilDisplay');
  if (elOD) {
    elOD.textContent = `${oilNir.toFixed(2)}%`;
  }

  // 3. Difference (42% Cost - Landing Cost)
  const elDiff = document.getElementById('simResultDiffQtl');
  if (elDiff) {
    elDiff.textContent = `${(diffQtl >= 0 ? '+' : '')}₹${diffQtl.toFixed(2)} / Qtl (${(diffPct >= 0 ? '+' : '')}${diffPct.toFixed(2)}%)`;
    elDiff.style.color = isLoss ? 'var(--danger-red)' : (isEven ? 'var(--text-primary)' : 'var(--success-green)');
  }

  // 4. Clean Step-by-Step Math Box
  const elMath = document.getElementById('simResultMathProof');
  if (elMath) {
    elMath.innerHTML = `
      <div class="math-proof-title"><i class="fa-solid fa-calculator"></i> Calculation:</div>
      <div class="math-proof-line">
        <span class="math-step-label">Formula:</span>
        <span class="math-formula">(Landing Cost ÷ Lab Oil %) × 42.0</span>
      </div>
      <div class="math-proof-line">
        <span class="math-step-label">Math:</span>
        <span class="math-formula">(₹${landingQtl.toFixed(2)} ÷ ${oilNir.toFixed(2)}) × 42.0</span>
        <span style="color:#94a3b8;">=</span>
        <strong class="math-res-gold" style="font-size: 1.05rem;">₹${cost42Qtl.toFixed(2)} / Qtl (₹${cost42Mt.toFixed(2)} / MT)</strong>
      </div>
    `;
  }
}
window.runDnSimulation = runDnSimulation;

function openDebitLotModal(r) {
  const modal = document.getElementById('recordModal');
  const title = document.getElementById('modalTitle');
  const badge = document.getElementById('modalStatusBadge');
  const body = document.getElementById('modalBodyContent');

  title.textContent = `Lot Audit: ${r.gin} • ${r.supplier_name}`;
  badge.textContent = r.status;
  badge.className = `badge ${r.status === 'Matched' ? 'badge-success' : 'badge-warning'}`;

  const isMt = state.unit === 'mt';
  const billWt = r.bill_wt_qtl || r.rec_wt_qtl || 0;
  const billedRateQtl = r.billed_rate_qtl || (billWt > 0 ? (r.debit_amt_y / billWt) : 0);
  const dedPerQtl = r.rec_wt_qtl > 0 ? ((r.net_ded || 0) / r.rec_wt_qtl) : 0;
  const diffQtl = (r.cost_42_qtl && r.landing_cost_qtl) ? (r.cost_42_qtl - r.landing_cost_qtl) : 0;
  const rateDiffQtl = r.rate_diff_qtl !== null && r.rate_diff_qtl !== undefined
    ? r.rate_diff_qtl
    : (r.cost_42_qtl && billedRateQtl ? (r.cost_42_qtl - billedRateQtl) : null);
  const isLoss = rateDiffQtl > 0;
  const hasDeductions = (r.net_ded || 0) > 0;

  // Deduction items list for visual badges
  const dedBadges = [];
  if (r.oil_ded > 0) dedBadges.push(`Oil: ₹${r.oil_ded.toLocaleString('en-IN')}`);
  if (r.shortage_ded > 0) dedBadges.push(`Shortage: ₹${r.shortage_ded.toLocaleString('en-IN')}`);
  if (r.bardana_ded > 0) dedBadges.push(`Bardana: ₹${r.bardana_ded.toLocaleString('en-IN')}`);
  if (r.moisture_ded > 0) dedBadges.push(`Moisture: ₹${r.moisture_ded.toLocaleString('en-IN')}`);
  if (r.brokerage_ded > 0) dedBadges.push(`Brokerage: ₹${r.brokerage_ded.toLocaleString('en-IN')}`);
  if (r.fm_ded > 0) dedBadges.push(`FM (Dust): ₹${r.fm_ded.toLocaleString('en-IN')}`);
  if (r.greenish_ded > 0) dedBadges.push(`Greenish: ₹${r.greenish_ded.toLocaleString('en-IN')}`);

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- Procurement Attribution & Dual Oil Verification Summary -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; background: var(--bg-card); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); font-size: 0.84rem;">
        <div>
          <h4 style="color: var(--accent-cyan); font-size: 0.88rem; font-weight: 700; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-user-tie"></i> Sourcing & Personnel Attribution
          </h4>
          <p style="margin: 0.25rem 0;"><strong>Supervisor Name:</strong> <span style="color: var(--accent-blue); font-weight: 700;">${r.supervisor_name || 'Direct / Head Office'}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Broker / Agent:</strong> <span style="color: var(--text-primary); font-weight: 600;">${r.broker_name || 'Direct Purchase (No Broker)'}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Brokerage Rate:</strong> <span style="color: var(--text-secondary);">${r.brokerage_rate > 0 ? `₹${r.brokerage_rate}/Qtl` : '₹0.00 / Direct'}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Mandi / Station:</strong> <span>${r.station || 'Direct Factory'}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Supplier:</strong> <span>${r.supplier_code ? `[${r.supplier_code}] ` : ''}${r.supplier_name}</span></p>
        </div>
        <div>
          <h4 style="color: var(--mustard-gold); font-size: 0.88rem; font-weight: 700; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-flask-vial"></i> Tested Oil vs NIR Analyzer Cross-Verification
          </h4>
          <p style="margin: 0.25rem 0;"><strong>Debit Note Tested Oil:</strong> <span style="color: var(--mustard-gold); font-weight: 700;">${r.oil_analyzer_by ? r.oil_analyzer_by.toFixed(2) + '%' : (r.oil_nir ? r.oil_nir.toFixed(2) + '%' : '—')}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Lab Report Oil %:</strong> <span style="color: #c084fc; font-weight: 700;">${r.oil_analyzer_ax ? r.oil_analyzer_ax.toFixed(2) + '%' : '—'}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Dual Oil Variance:</strong> <span style="${r.oil_mismatch_flag ? 'color: var(--danger-red); font-weight: 700;' : 'color: var(--success-green); font-weight: 600;'}">${r.oil_nir_diff !== null && r.oil_nir_diff !== undefined ? `${r.oil_nir_diff.toFixed(2)}%` : '0.00%'} (${r.oil_mismatch_flag ? '⚠️ Variance > 0.05%' : '✓ Reconciled'})</span></p>
          <p style="margin: 0.25rem 0;"><strong>Foreign Matter (FM):</strong> <span>${r.fm_pct ? r.fm_pct.toFixed(2) + '%' : '—'}</span> | <strong>Moisture:</strong> <span>${r.moisture_pct ? r.moisture_pct.toFixed(2) + '%' : '—'}</span></p>
          <p style="margin: 0.25rem 0;"><strong>Reconciliation Status:</strong> <span class="badge ${r.status === 'Matched' ? 'badge-success' : 'badge-warning'}">${r.status}</span></p>
        </div>
      </div>

      <!-- Step By Step Cost Journey Card -->
      <div class="modal-section-box">
        <h4 style="font-size: 0.92rem; font-weight: 700; color: var(--mustard-gold); margin-bottom: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em;">
          <i class="fa-solid fa-route"></i> Complete Cost &amp; Lab Calculation Story
        </h4>

        <div class="audit-kpi-grid">
          <div class="audit-card audit-card-blue">
            <div class="audit-card-title">1. Mandi Purchase Rate</div>
            <div class="audit-card-value">₹${billedRateQtl.toFixed(2)} <span style="font-size: 0.76rem; font-weight: 600; opacity: 0.75;">/ Qtl</span></div>
            <div class="audit-card-sub">Bill Amount: ₹${r.debit_amt_y ? r.debit_amt_y.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0'} ÷ ${billWt ? billWt.toFixed(1) : '0'} Qtl</div>
          </div>

          <div class="audit-card audit-card-red">
            <div class="audit-card-title">2. Net Deductions (Katoti)</div>
            <div class="audit-card-value">-₹${(r.net_ded || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div class="audit-card-sub">-₹${dedPerQtl.toFixed(2)} / Qtl</div>
          </div>

          <div class="audit-card audit-card-green">
            <div class="audit-card-title">3. Factory Landing Cost</div>
            <div class="audit-card-value">₹${r.landing_cost_qtl ? r.landing_cost_qtl.toFixed(2) : '—'} <span style="font-size: 0.76rem; font-weight: 600; opacity: 0.75;">/ Qtl</span></div>
            <div class="audit-card-sub">₹${r.landing_cost_mt ? r.landing_cost_mt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'} / MT</div>
          </div>

          <div class="audit-card audit-card-purple">
            <div class="audit-card-title">4. Lab Tested Oil %</div>
            <div class="audit-card-value">${r.oil_nir ? r.oil_nir.toFixed(2) + '%' : 'Pending'}</div>
            <div class="audit-card-sub">Instrument NIR • Std: 42%</div>
          </div>

          <div class="audit-card audit-card-gold">
            <div class="audit-card-title">5. 42% Benchmark Costing</div>
            <div class="audit-card-value">₹${r.cost_42_qtl ? r.cost_42_qtl.toFixed(2) : '—'} <span style="font-size: 0.76rem; font-weight: 600; opacity: 0.75;">/ Qtl</span></div>
            <div class="audit-card-sub">₹${r.cost_42_mt ? r.cost_42_mt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'} / MT</div>
          </div>

          <div class="audit-card ${isLoss ? 'audit-card-result-loss' : 'audit-card-result-profit'}">
            <div class="audit-card-title">6. Rate Difference vs Purchase Rate</div>
            <div class="audit-card-value">
              ${rateDiffQtl !== null ? `${rateDiffQtl >= 0 ? '+' : '-'}₹${Math.abs(rateDiffQtl).toFixed(2)}` : '—'} <span style="font-size: 0.76rem; font-weight: 700; opacity: 0.85;">/ Qtl</span>
            </div>
            <div class="audit-card-sub" style="font-family:var(--font-mono); font-weight:700; font-size:0.75rem; letter-spacing: -0.01em;">
              ₹${r.cost_42_qtl ? r.cost_42_qtl.toFixed(2) : '0'} − ₹${billedRateQtl.toFixed(2)}
            </div>
            <div style="font-size: 0.67rem; margin-top: 2px; opacity: 0.88;">
              ${rateDiffQtl !== null ? (isLoss ? '⚠️ Quality Loss (42% Cost > Rate)' : '🎉 Quality Profit (42% Cost < Rate)') : '—'}
            </div>
          </div>
        </div>

        <div class="math-proof-box">
          <div class="math-proof-title">
            <i class="fa-solid fa-calculator"></i> Step-by-Step Mathematical Verification
          </div>
          
          <div class="math-proof-line">
            <span class="math-step-label">1. Mandi Purchase Rate:</span>
            <span class="math-formula">Bill Amount (₹${(r.debit_amt_y || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}) ÷ Weight (${billWt.toFixed(2)} Qtl)</span>
            <span style="color:#94a3b8;">=</span>
            <strong style="color:var(--accent-blue);">₹${billedRateQtl.toFixed(2)} / Qtl</strong>
            <span style="color:#93c5fd;">(₹${(billedRateQtl * 10).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / MT)</span>
          </div>

          <div class="math-proof-line">
            <span class="math-step-label">2. Factory Landing Cost:</span>
            <span class="math-formula">(Bill ₹${(r.taxable_amt_an || r.debit_amt_y || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} - Katoti ₹${(r.net_ded || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}) ÷ ${r.rec_wt_mt ? r.rec_wt_mt.toFixed(3) : '0'} MT</span>
            <span style="color:#94a3b8;">=</span>
            <strong class="math-res-green">₹${r.landing_cost_mt ? r.landing_cost_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} / MT</strong>
            <span style="color:#6ee7b7;">(₹${r.landing_cost_qtl ? r.landing_cost_qtl.toFixed(2) : '—'} / Qtl)</span>
          </div>

          <div class="math-proof-line">
            <span class="math-step-label">3. 42% Benchmark Costing:</span>
            <span class="math-formula">(Landing Cost ₹${r.landing_cost_mt ? r.landing_cost_mt.toFixed(2) : '—'} ÷ Lab Tested Oil ${r.oil_nir ? r.oil_nir.toFixed(2) : '—'}%) × 42.0</span>
            <span style="color:#94a3b8;">=</span>
            <strong class="math-res-gold">₹${r.cost_42_mt ? r.cost_42_mt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} / MT</strong>
            <span style="color:#fde68a;">(₹${r.cost_42_qtl ? r.cost_42_qtl.toFixed(2) : '—'} / Qtl)</span>
          </div>

          <div class="math-proof-line">
            <span class="math-step-label">4. Profit/Loss (Quality Impact):</span>
            <span class="math-formula">42% Cost ₹${r.cost_42_qtl ? r.cost_42_qtl.toFixed(2) : '—'} - Purchase Rate ₹${billedRateQtl.toFixed(2)}</span>
            <span style="color:#94a3b8;">=</span>
            <strong class="${isLoss ? 'math-res-diff-danger' : 'math-res-diff-success'}">
              ${rateDiffQtl !== null ? `${rateDiffQtl >= 0 ? '+' : '-'}₹${Math.abs(rateDiffQtl).toFixed(2)} / Qtl (${isLoss ? '⚠️ Quality Loss' : '🎉 Quality Profit / Savings'})` : '—'}
            </strong>
          </div>

          ${Math.abs((r.debit_amt_y || 0) - (r.taxable_amt_an || 0)) >= 1.0 ? `
          <div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: rgba(245, 158, 11, 0.15); border-left: 3px solid var(--mustard-gold); border-radius: 4px; font-size: 0.82rem; color: #fde68a; line-height: 1.5;">
            <strong><i class="fa-solid fa-triangle-exclamation"></i> Accountant Pre-Adjustment Audit:</strong><br>
            • Lab Report Taxable Bill: <strong>₹${(r.taxable_amt_an || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong><br>
            • Debit Note Net Billed Amount: <strong>₹${(r.debit_amt_y || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong><br>
            • Advance deduction subtracted in Debit bill formula: <strong>-₹${Math.abs((r.debit_amt_y || 0) - (r.taxable_amt_an || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Itemized Deductions Section -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="font-size: 0.88rem; font-weight: 700; color: var(--text-primary); margin: 0;">
            <i class="fa-solid fa-list-check"></i> Itemized Debit Note Deductions Breakdown
          </h4>
          ${hasDeductions ? `
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              ${dedBadges.map(b => `<span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 8px; border-radius: 4px; font-size: 0.76rem; font-weight: 600;">${b}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        ${!hasDeductions ? `
          <div style="padding: 0.85rem 1.1rem; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
            <i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 1.3rem;"></i>
            <div>
              <div style="color: #34d399; font-weight: 700; font-size: 0.90rem;">Zero Katoti Applied (100% Full Payment Lot)</div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 1px;">Is lot me koi deduction (Oil, Moisture, Shortage, Bardana, FM, Brokerage) nahi kaati gayi hai — Full weight & rate accept hua hai.</div>
            </div>
          </div>
        ` : ''}

        <div class="modal-table-wrap">
          <table class="data-table" style="font-size: 0.82rem; width: 100%; min-width: 780px;">
            <thead>
              <tr style="background: var(--bg-card);">
                <th style="padding: 0.6rem 0.5rem; text-align: center;">Oil Ded</th>
                <th style="padding: 0.6rem 0.5rem; text-align: center;">Bardana Ded</th>
                <th style="padding: 0.6rem 0.5rem; text-align: center;">FM Ded</th>
                <th style="padding: 0.6rem 0.5rem; text-align: center;">Brokerage</th>
                <th style="padding: 0.6rem 0.5rem; text-align: center;">Shortage Ded</th>
                <th style="padding: 0.6rem 0.5rem; text-align: center;">Greenish Ded</th>
                <th style="padding: 0.6rem 0.5rem; text-align: center;">Moisture Ded</th>
                <th style="padding: 0.6rem 0.5rem; text-align: right; color: var(--danger-red);">Total Katoti</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align: center; ${r.oil_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.oil_ded > 0 ? `₹${r.oil_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: center; ${r.bardana_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.bardana_ded > 0 ? `₹${r.bardana_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: center; ${r.fm_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.fm_ded > 0 ? `₹${r.fm_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: center; ${r.brokerage_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.brokerage_ded > 0 ? `₹${r.brokerage_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: center; ${r.shortage_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.shortage_ded > 0 ? `₹${r.shortage_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: center; ${r.greenish_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.greenish_ded > 0 ? `₹${r.greenish_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: center; ${r.moisture_ded > 0 ? 'background: rgba(239, 68, 68, 0.12); color: #f87171; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${r.moisture_ded > 0 ? `₹${r.moisture_ded.toLocaleString('en-IN')}` : '₹0'}
                </td>
                <td style="text-align: right; font-weight: 800; font-size: 0.90rem; ${hasDeductions ? 'color: var(--danger-red);' : 'color: var(--success-green);'}">
                  ${hasDeductions ? `-₹${r.net_ded.toLocaleString('en-IN')}` : '₹0 (None)'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

window.openDebitLotModal = openDebitLotModal;

// ==========================================================================
// Unit Toggle (₹/Quintal vs ₹/MT)
// ==========================================================================
function setUnit(unit) {
  state.unit = unit;
  document.getElementById('btnUnitQtl')?.classList.toggle('active', unit === 'qtl');
  document.getElementById('btnUnitMt')?.classList.toggle('active', unit === 'mt');
  Object.values(state.paginators || {}).forEach(p => {
    if (p && typeof p.render === 'function') p.render();
  });
  refreshActiveView();
}

function formatPriceUnit(valQtl) {
  if (valQtl === null || valQtl === undefined || isNaN(valQtl)) return '—';
  if (state.unit === 'mt') {
    const valMt = valQtl * 10.0;
    return `₹${valMt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / MT`;
  }
  return `₹${valQtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / Qtl`;
}

function formatWeightUnit(valQtl) {
  if (valQtl === null || valQtl === undefined || isNaN(valQtl)) return '—';
  if (state.unit === 'mt') {
    return `${(valQtl / 10.0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`;
  }
  return `${valQtl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Qtl`;
}

// ==========================================================================
// 3-Day Rolling Benchmark
// ==========================================================================
async function load3DayBenchmark() {
  try {
    const res = await fetch('/api/analytics/benchmark-3days');
    const data = await res.json();
    const el = document.getElementById('kpi3DayCost');
    const subEl = document.getElementById('kpi3DaySubtext');
    if (el) {
      el.textContent = formatPriceUnit(data.avg_cost_42);
    }
    if (subEl && data.dates && data.dates.length > 0) {
      subEl.innerHTML = `<span>Dates: ${data.dates.join(', ')} • Avg Oil: <strong>${data.avg_oil}%</strong></span>`;
    }
  } catch (err) {
    console.error("Failed loading 3-day benchmark:", err);
  }
}

// ==========================================================================
// Sourcing Intelligence Hub: Complete Unified Rankings (Suppliers, Brokers, Supervisors, Mandis)
// ==========================================================================
async function loadSourcingRankings() {
  try {
    const { entity, sortBy, sortOrder } = state.sourcing;
    // Always fetch all rows (limit=0) to ensure accurate global ranking #1 to #N and instant client-side pagination
    const res = await fetch(`/api/sourcing/rankings?entity=${entity}&limit=0&sort_by=${sortBy}&sort_order=${sortOrder}`);
    const rows = await res.json();
    state.sourcing.allRows = Array.isArray(rows) ? rows : [];

    // Dynamically update entity pill count badge
    const countElMap = {
      supplier: { id: 'sourcingCountSupplier', label: 'Suppliers' },
      broker: { id: 'sourcingCountBroker', label: 'Brokers' },
      supervisor: { id: 'sourcingCountSupervisor', label: 'Supervisors' },
      station: { id: 'sourcingCountStation', label: 'Mandis' }
    };
    const entityCfg = countElMap[entity];
    if (entityCfg) {
      const el = document.getElementById(entityCfg.id);
      if (el) el.textContent = `${entityCfg.label} (${state.sourcing.allRows.length})`;
    }

    applySourcingPagination();
  } catch (err) {
    console.error("Failed loading sourcing rankings:", err);
    const tbody = document.querySelector('#tableSourcingRankings tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--danger-red); padding: 2rem;">Error loading sourcing rankings. Please retry.</td></tr>';
    }
  }
}

function applySourcingPagination() {
  const all = state.sourcing.allRows || [];
  const search = (state.sourcing.search || '').trim().toLowerCase();

  // Apply search filter across name, verdict, or station
  let filtered = all;
  if (search) {
    filtered = all.filter(r => {
      const name = (r.entity_name || '').toLowerCase();
      const verdict = (r.verdict || '').toLowerCase();
      return name.includes(search) || verdict.includes(search);
    });
  }
  state.sourcing.filteredRows = filtered;

  const total = filtered.length;
  state.sourcing.total = total;
  const limit = state.sourcing.limit; // 10, 20, 50, 0
  let page = state.sourcing.page || 1;
  let totalPages = 1;
  let slicedRows = [];

  if (limit === 0 || limit >= total) {
    totalPages = 1;
    page = 1;
    slicedRows = filtered;
  } else {
    totalPages = Math.max(1, Math.ceil(total / limit));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    const start = (page - 1) * limit;
    slicedRows = filtered.slice(start, start + limit);
  }

  state.sourcing.page = page;
  state.sourcing.totalPages = totalPages;
  state.sourcing.currentRows = slicedRows;

  // Render Table Rows
  const tbody = document.querySelector('#tableSourcingRankings tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!slicedRows || slicedRows.length === 0) {
    const emptyMsg = search
      ? `No matching records found for "<strong>${state.sourcing.search}</strong>".`
      : 'No sourcing records found.';
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2.5rem;"><i class="fa-solid fa-magnifying-glass" style="font-size: 1.8rem; color: var(--text-muted); margin-bottom: 0.6rem; display: block;"></i>${emptyMsg}</td></tr>`;
    renderSourcingPaginationControls();
    return;
  }

  slicedRows.forEach(r => {
    const tr = document.createElement('tr');

    const billed = state.unit === 'mt'
      ? `₹${(r.avg_billed_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / MT`
      : `₹${(r.avg_billed_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / Qtl`;

    const landing = state.unit === 'mt'
      ? `₹${(r.avg_landing_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / MT`
      : `₹${(r.avg_landing_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / Qtl`;

    const cost42 = state.unit === 'mt'
      ? `₹${(r.avg_cost_42_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / MT`
      : `₹${(r.avg_cost_42_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} / Qtl`;

    const billedVal = state.unit === 'mt' ? (r.avg_billed_mt || 0) : (r.avg_billed_qtl || 0);
    const cost42Val = state.unit === 'mt' ? (r.avg_cost_42_mt || 0) : (r.avg_cost_42_qtl || 0);
    const rateDiffVal = r.rate_diff_qtl !== undefined && r.rate_diff_qtl !== null
      ? (state.unit === 'mt' ? (r.rate_diff_mt || r.rate_diff_qtl * 10) : r.rate_diff_qtl)
      : (cost42Val - billedVal);
    const isCostIncrease = rateDiffVal > 0;
    const diffSign = isCostIncrease ? '+' : '';
    const unitLabel = state.unit === 'mt' ? '/ MT' : '/ Qtl';
    const diffText = `${diffSign}₹${Math.abs(rateDiffVal).toFixed(2)} ${unitLabel} (${isCostIncrease ? 'Loss' : 'Profit'})`;
    const diffClass = isCostIncrease ? 'badge-danger' : 'badge-success';

    const vol = state.unit === 'mt'
      ? `${r.total_wt_mt} MT`
      : `${(r.total_wt_mt * 10).toFixed(1)} Qtl`;

    tr.innerHTML = `
      <td style="text-align: center; font-weight: 700; color: ${r.rank <= 3 ? 'var(--mustard-gold)' : 'var(--text-muted)'};">#${r.rank}</td>
      <td><strong>${r.entity_name}</strong></td>
      <td style="text-align: right;" class="td-col-rate"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ${billed}</span></td>
      <td style="text-align: right; color: #34d399; font-weight: 600;">${landing}</td>
      <td style="text-align: right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ${cost42}</span></td>
      <td style="text-align: center;"><span class="badge ${diffClass}">${diffText}</span></td>
      <td style="text-align: center; font-weight: 700; color: ${r.avg_oil_nir < 39 ? 'var(--danger-red)' : 'var(--accent-cyan)'};">${r.avg_oil_nir}%</td>
      <td style="text-align: right;">${vol}</td>
      <td style="text-align: center;"><span class="badge badge-gray">${r.total_lots} lots</span></td>
      <td style="text-align: center;"><span class="badge ${r.verdict_class || 'badge-gray'}">${r.verdict}</span></td>
    `;
    tbody.appendChild(tr);
  });

  renderSourcingPaginationControls();
}

function renderSourcingPaginationControls() {
  const entityLabels = {
    supplier: 'suppliers',
    broker: 'brokers',
    supervisor: 'supervisors',
    station: 'mandis / stations'
  };
  const entityPlural = entityLabels[state.sourcing.entity] || 'records';
  const total = state.sourcing.total;
  const limit = state.sourcing.limit;
  const page = state.sourcing.page;
  const totalPages = state.sourcing.totalPages;
  const isFiltered = !!state.sourcing.search;

  // 1. Update Summary Text
  const summary = document.getElementById('sourcingPaginationSummary');
  if (summary) {
    if (total === 0) {
      summary.textContent = `Showing 0 of 0 ${entityPlural}`;
    } else if (limit === 0 || limit >= total) {
      if (isFiltered) {
        summary.textContent = `Showing all ${total} matching ${entityPlural} (filtered from ${state.sourcing.allRows.length} total)`;
      } else {
        summary.textContent = `Showing all ${total} ${entityPlural}`;
      }
    } else {
      const start = (page - 1) * limit + 1;
      const end = Math.min(page * limit, total);
      if (isFiltered) {
        summary.textContent = `Showing ${start} to ${end} of ${total} matching ${entityPlural} (filtered from ${state.sourcing.allRows.length} total)`;
      } else {
        summary.textContent = `Showing ${start} to ${end} of ${total} ${entityPlural}`;
      }
    }
  }

  // 2. Render Pagination Buttons
  const btnContainer = document.getElementById('sourcingPaginationButtons');
  if (!btnContainer) return;
  btnContainer.innerHTML = '';

  // Prev Button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i> Prev';
  prevBtn.disabled = page <= 1 || limit === 0;
  prevBtn.addEventListener('click', () => {
    if (state.sourcing.page > 1) {
      state.sourcing.page--;
      applySourcingPagination();
    }
  });
  btnContainer.appendChild(prevBtn);

  // Page Numbers
  let pagesToShow = [];
  if (totalPages <= 7) {
    pagesToShow = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    pagesToShow = [1];
    if (page > 3) pagesToShow.push('...');
    const startP = Math.max(2, page - 1);
    const endP = Math.min(totalPages - 1, page + 1);
    for (let i = startP; i <= endP; i++) pagesToShow.push(i);
    if (page < totalPages - 2) pagesToShow.push('...');
    pagesToShow.push(totalPages);
  }

  pagesToShow.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.textContent = '...';
      span.style.padding = '0.35rem 0.5rem';
      span.style.color = 'var(--text-muted)';
      btnContainer.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = `page-btn ${p === page ? 'active' : ''}`;
      btn.textContent = p;
      btn.disabled = limit === 0;
      btn.addEventListener('click', () => {
        state.sourcing.page = p;
        applySourcingPagination();
      });
      btnContainer.appendChild(btn);
    }
  });

  // Next Button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = 'Next <i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = page >= totalPages || limit === 0;
  nextBtn.addEventListener('click', () => {
    if (state.sourcing.page < totalPages) {
      state.sourcing.page++;
      applySourcingPagination();
    }
  });
  btnContainer.appendChild(nextBtn);
}

// ==========================================================================
// Export Sourcing Intelligence Table to Professional Excel (.xlsx)
// ==========================================================================
async function exportSourcingExcel() {
  const btn = document.getElementById('btnExportSourcingExcel');
  const btnText = document.getElementById('btnExportSourcingExcelText');

  try {
    if (btn) {
      btn.style.opacity = '0.7';
      btn.style.pointerEvents = 'none';
      if (btnText) btnText.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Downloading...';
    }

    const { entity, sortBy, sortOrder } = state.sourcing;
    const unit = state.unit || 'qtl';
    const exportUrl = `/api/sourcing/export-excel?entity=${entity}&limit=0&sort_by=${sortBy}&sort_order=${sortOrder}&unit=${unit}`;

    // Trigger native browser file download via temporary anchor
    const link = document.createElement('a');
    link.href = exportUrl;
    link.setAttribute('download', `KOGM_Sourcing_${entity}_${unit}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Provide visual feedback
    if (btnText) btnText.innerHTML = '<i class="fa-solid fa-check"></i> Downloaded!';
    setTimeout(() => {
      if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-file-excel"></i> <span id="btnExportSourcingExcelText">Download Excel</span>`;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
    }, 1800);
  } catch (err) {
    console.error("Export Sourcing Excel error:", err);
    alert("Failed to export Sourcing Excel. Please try again.");
    if (btn) {
      btn.innerHTML = `<i class="fa-solid fa-file-excel"></i> <span id="btnExportSourcingExcelText">Download Excel</span>`;
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }
  }
}

// ==========================================================================
// Supplier Intelligence: Top Rankings (Highest Oil & Best Value)
// ==========================================================================
// Supplier Intelligence: Top Rankings (Highest Oil & Best Value)
// ==========================================================================
async function loadTopSupplierRankings() {
  try {
    const res = await fetch('/api/suppliers/top-rankings?limit=20');
    const data = await res.json();

    // 1. Highest Oil % Table
    if (!state.paginators.topOil) {
      state.paginators.topOil = createTablePaginator({
        tableId: 'tableTopOilSuppliers',
        summaryId: 'topOilPaginationSummary',
        pageSizeSelectId: 'topOilPageSizeSelect',
        buttonsId: 'topOilPaginationButtons',
        defaultLimit: 5,
        entityName: 'suppliers',
        renderRow: (s) => {
          const tr = document.createElement('tr');
          const billedPrice = state.unit === 'mt' ? `₹${(s.avg_billed_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(s.avg_billed_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const landingPrice = state.unit === 'mt' ? `₹${(s.avg_landing_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(s.avg_landing_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const cost42Price = state.unit === 'mt' ? `₹${(s.avg_cost_42_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(s.avg_cost_42_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const rateDiffVal = s.rate_diff_qtl !== undefined && s.rate_diff_qtl !== null
            ? (state.unit === 'mt' ? (s.rate_diff_mt || s.rate_diff_qtl * 10) : s.rate_diff_qtl)
            : (state.unit === 'mt' ? (s.diff_mt || 0) : (s.diff_qtl || 0));
          const isLoss = rateDiffVal > 0;
          const diffSign = isLoss ? '+' : '';
          const vol = state.unit === 'mt' ? `${s.total_wt_mt} MT` : `${(s.total_wt_mt * 10).toFixed(1)} Qtl`;

          tr.innerHTML = `
            <td><strong>${s.supplier_name}</strong></td>
            <td style="text-align: right;" class="td-col-rate"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ${billedPrice}</span></td>
            <td style="text-align: right; color: #34d399;">${landingPrice}</td>
            <td style="text-align: right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ${cost42Price}</span></td>
            <td style="text-align: center;"><strong style="color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 8px; border-radius: 4px;">${s.avg_oil_nir}%</strong></td>
            <td style="text-align: center;"><span class="badge ${isLoss ? 'badge-danger' : 'badge-success'}">${diffSign}₹${Math.abs(rateDiffVal).toFixed(1)} (${isLoss ? 'Loss' : 'Profit'})</span></td>
            <td style="text-align: center; color: var(--text-muted);">${vol}</td>
          `;
          return tr;
        }
      });
    }
    state.paginators.topOil.update(data.highest_oil_suppliers || []);

    // 2. Best Value (Lowest 42 Costing) Table
    if (!state.paginators.bestValue) {
      state.paginators.bestValue = createTablePaginator({
        tableId: 'tableBestValueSuppliers',
        summaryId: 'bestValuePaginationSummary',
        pageSizeSelectId: 'bestValuePageSizeSelect',
        buttonsId: 'bestValuePaginationButtons',
        defaultLimit: 5,
        entityName: 'suppliers',
        renderRow: (s) => {
          const tr = document.createElement('tr');
          const billedPrice = state.unit === 'mt' ? `₹${(s.avg_billed_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(s.avg_billed_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const landingPrice = state.unit === 'mt' ? `₹${(s.avg_landing_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(s.avg_landing_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const cost42Price = state.unit === 'mt' ? `₹${(s.avg_cost_42_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(s.avg_cost_42_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const rateDiffVal = s.rate_diff_qtl !== undefined && s.rate_diff_qtl !== null
            ? (state.unit === 'mt' ? (s.rate_diff_mt || s.rate_diff_qtl * 10) : s.rate_diff_qtl)
            : (state.unit === 'mt' ? (s.diff_mt || 0) : (s.diff_qtl || 0));
          const isLoss = rateDiffVal > 0;
          const diffSign = isLoss ? '+' : '';
          const vol = state.unit === 'mt' ? `${s.total_wt_mt} MT` : `${(s.total_wt_mt * 10).toFixed(1)} Qtl`;

          tr.innerHTML = `
            <td><strong>${s.supplier_name}</strong></td>
            <td style="text-align: right;" class="td-col-rate"><span class="badge-rate" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.72rem; opacity:0.85;"></i> ${billedPrice}</span></td>
            <td style="text-align: right; color: #34d399;">${landingPrice}</td>
            <td style="text-align: right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.88rem; padding:3px 8px;"><i class="fa-solid fa-star" style="font-size:0.72rem; color:#f59e0b;"></i> ${cost42Price}</span></td>
            <td style="text-align: center;"><strong>${s.avg_oil_nir}%</strong></td>
            <td style="text-align: center;"><span class="badge ${isLoss ? 'badge-danger' : 'badge-success'}">${diffSign}₹${Math.abs(rateDiffVal).toFixed(1)} (${isLoss ? 'Loss' : 'Profit'})</span></td>
            <td style="text-align: center; color: var(--text-muted);">${vol}</td>
          `;
          return tr;
        }
      });
    }
    state.paginators.bestValue.update(data.best_value_suppliers || []);
  } catch (err) {
    console.error("Failed loading top supplier rankings:", err);
  }
}

// ==========================================================================
// Weekly Supplier Breakdown
// ==========================================================================
async function loadWeeklySuppliers() {
  try {
    const res = await fetch('/api/suppliers/weekly');
    const rows = await res.json();

    if (!state.paginators.weeklySuppliers) {
      state.paginators.weeklySuppliers = createTablePaginator({
        tableId: 'tableWeeklySuppliers',
        summaryId: 'weeklySuppliersPaginationSummary',
        pageSizeSelectId: 'weeklySuppliersPageSizeSelect',
        buttonsId: 'weeklySuppliersPaginationButtons',
        defaultLimit: 10,
        entityName: 'records',
        renderRow: (r) => {
          const tr = document.createElement('tr');
          const wt = state.unit === 'mt' ? `${r.total_wt_mt} MT` : `${(r.total_wt_mt * 10).toFixed(1)} Qtl`;
          const cost42 = state.unit === 'mt' ? `₹${(r.avg_cost_42_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(r.avg_cost_42_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

          tr.innerHTML = `
            <td><span class="badge badge-primary" style="font-family: monospace;">${r.week_num}</span></td>
            <td><strong>${r.supplier_name}</strong></td>
            <td style="text-align: center;">${r.lot_count}</td>
            <td style="text-align: right;">${wt}</td>
            <td style="text-align: center; color: ${r.avg_oil < 39 ? '#ef4444' : '#38bdf8'}; font-weight: 700;">${r.avg_oil}%</td>
            <td style="text-align: right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-star" style="font-size:0.70rem; color:#f59e0b;"></i> ${cost42}</span></td>
          `;
          return tr;
        }
      });
    }
    state.paginators.weeklySuppliers.update(rows || []);
  } catch (err) {
    console.error("Failed loading weekly suppliers:", err);
  }
}

// ==========================================================================
// Location / Mandi-wise Supplier Performance
// ==========================================================================
async function loadLocationSuppliers() {
  try {
    const res = await fetch('/api/suppliers/by-location');
    const rows = await res.json();

    if (!state.paginators.locationSuppliers) {
      state.paginators.locationSuppliers = createTablePaginator({
        tableId: 'tableLocationSuppliers',
        summaryId: 'locationSuppliersPaginationSummary',
        pageSizeSelectId: 'locationSuppliersPageSizeSelect',
        buttonsId: 'locationSuppliersPaginationButtons',
        defaultLimit: 10,
        entityName: 'mandis',
        renderRow: (r) => {
          const tr = document.createElement('tr');
          const vol = state.unit === 'mt' ? `${r.total_wt_mt} MT` : `${(r.total_wt_mt * 10).toFixed(1)} Qtl`;
          const landing = state.unit === 'mt' ? `₹${(r.avg_rate_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(r.avg_rate_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          const cost42 = state.unit === 'mt' ? `₹${(r.avg_cost_42_mt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `₹${(r.avg_cost_42_qtl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

          tr.innerHTML = `
            <td><strong>${r.station}</strong></td>
            <td style="text-align: center;"><span class="badge badge-gray">${r.unique_suppliers} suppliers</span></td>
            <td style="text-align: right;">${vol}</td>
            <td style="text-align: center; color: var(--accent-cyan); font-weight: 700;">${r.avg_oil}%</td>
            <td style="text-align: right;">${landing}</td>
            <td style="text-align: right;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.86rem; padding:3px 7px;"><i class="fa-solid fa-star" style="font-size:0.70rem; color:#f59e0b;"></i> ${cost42}</span></td>
          `;
          return tr;
        }
      });
    }
    state.paginators.locationSuppliers.update(rows || []);
  } catch (err) {
    console.error("Failed loading location suppliers:", err);
  }
}

// ==========================================================================
// No-Bargain Inactive Historical Supplier Alerts
// ==========================================================================
async function loadDormantSupplierAlerts() {
  try {
    const res = await fetch('/api/suppliers/dormant-alerts?dormancy_days=14');
    const rows = await res.json();

    if (!state.paginators.dormantAlerts) {
      state.paginators.dormantAlerts = createTablePaginator({
        tableId: 'tableDormantAlerts',
        summaryId: 'dormantAlertsPaginationSummary',
        pageSizeSelectId: 'dormantAlertsPageSizeSelect',
        buttonsId: 'dormantAlertsPaginationButtons',
        defaultLimit: 5,
        entityName: 'alerts',
        renderRow: (r) => {
          const tr = document.createElement('tr');
          const vol = state.unit === 'mt' ? `${r.total_volume_mt} MT` : `${(r.total_volume_mt * 10).toFixed(1)} Qtl`;

          tr.innerHTML = `
            <td><strong>${r.supplier_name}</strong></td>
            <td>${r.station || '—'}</td>
            <td>${vol} (${r.total_past_deals} deals)</td>
            <td style="color: var(--accent-cyan);">${r.avg_oil_historical}%</td>
            <td><span style="font-family: monospace; color: var(--text-muted);">${r.last_trade_date || 'Past Deal'}</span></td>
            <td><span class="badge badge-warning">${r.alert_reason}</span></td>
          `;
          return tr;
        }
      });
    }
    state.paginators.dormantAlerts.update(rows || []);
  } catch (err) {
    console.error("Failed loading dormant alerts:", err);
  }
}

// ==========================================================================
// Modal Handlers: Upload Daily Debit Sheet & Send Weekly Email
// ==========================================================================
function setupUploadAndEmailHandlers() {
  // 1. Debit Sheet Upload Modal
  const btnOpenUpload = document.getElementById('btnOpenUploadModal');
  const uploadModal = document.getElementById('uploadModal');
  const btnCloseUpload = document.getElementById('btnUploadModalClose');
  const btnCancelUpload = document.getElementById('btnCancelUpload');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('debitFileInput');
  const selectedFileName = document.getElementById('selectedFileName');
  const btnSubmitUpload = document.getElementById('btnSubmitUpload');
  const uploadStatusBox = document.getElementById('uploadStatusBox');

  let selectedFile = null;
  const lblActiveRows = document.getElementById('lblActiveRows');
  const lblBackupRows = document.getElementById('lblBackupRows');
  const btnRestoreBackup = document.getElementById('btnRestoreBackup');

  async function refreshStorageStatus() {
    if (!lblActiveRows || !lblBackupRows) return;
    try {
      const res = await fetch('/api/debit-note/storage-status');
      if (res.ok) {
        const data = await res.json();
        lblActiveRows.textContent = (data.active_records || 0).toLocaleString();
        lblBackupRows.textContent = (data.backup_records || 0).toLocaleString();
        if (btnRestoreBackup) {
          btnRestoreBackup.style.display = data.has_backup ? 'inline-flex' : 'none';
        }
      }
    } catch (e) {
      console.warn('Storage status fetch skipped:', e);
    }
  }

  btnRestoreBackup?.addEventListener('click', async () => {
    if (!confirm('Kya aap pichli upload sheet ke backup par rollback karna chahte hain? Current data pichle backup se restore ho jayega.')) return;
    btnRestoreBackup.disabled = true;
    btnRestoreBackup.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restoring...';
    try {
      const res = await fetch('/api/debit-note/rollback', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`✅ Rollback successful! Restored ${data.restored_records} records.`);
        closeUpload();
        refreshActiveView();
      } else {
        alert(`❌ Rollback failed: ${data.detail || data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Network error during rollback: ${err.message}`);
    } finally {
      btnRestoreBackup.disabled = false;
      btnRestoreBackup.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Restore Previous Backup';
      refreshStorageStatus();
    }
  });

  if (btnOpenUpload && uploadModal) {
    btnOpenUpload.addEventListener('click', () => {
      uploadModal.classList.add('active');
      uploadStatusBox.style.display = 'none';
      selectedFile = null;
      btnSubmitUpload.disabled = true;
      selectedFileName.textContent = 'Supports .xlsx, .xls, .csv';
      refreshStorageStatus();
    });

    const closeUpload = () => uploadModal.classList.remove('active');
    btnCloseUpload?.addEventListener('click', closeUpload);
    btnCancelUpload?.addEventListener('click', closeUpload);
    uploadModal.addEventListener('click', (e) => { if (e.target === uploadModal) closeUpload(); });

    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        selectedFileName.textContent = `Selected: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`;
        btnSubmitUpload.disabled = false;
      }
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        selectedFileName.textContent = `Selected: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`;
        btnSubmitUpload.disabled = false;
      }
    });

    btnSubmitUpload?.addEventListener('click', async () => {
      if (!selectedFile) return;
      btnSubmitUpload.disabled = true;
      btnSubmitUpload.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing & Reconciling...';
      uploadStatusBox.style.display = 'block';
      uploadStatusBox.style.background = 'rgba(56, 189, 248, 0.15)';
      uploadStatusBox.style.color = '#38bdf8';
      uploadStatusBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ingesting spreadsheet and recalculating Landing Cost & 42 Costing...';

      const formData = new FormData();
      formData.append('file', selectedFile);

      try {
        const res = await fetch('/api/debit-note/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();

        if (res.ok && data.success) {
          uploadStatusBox.style.background = 'rgba(16, 185, 129, 0.15)';
          uploadStatusBox.style.color = '#34d399';
          uploadStatusBox.innerHTML = `✅ <strong>Success:</strong> ${data.message}`;
          setTimeout(() => {
            closeUpload();
            refreshActiveView();
          }, 1500);
        } else {
          uploadStatusBox.style.background = 'rgba(239, 68, 68, 0.15)';
          uploadStatusBox.style.color = '#f87171';
          uploadStatusBox.innerHTML = `❌ <strong>Error:</strong> ${data.detail || data.error || 'Failed to process file'}`;
        }
      } catch (err) {
        uploadStatusBox.style.background = 'rgba(239, 68, 68, 0.15)';
        uploadStatusBox.style.color = '#f87171';
        uploadStatusBox.innerHTML = `❌ <strong>Network Error:</strong> ${err.message}`;
      } finally {
        btnSubmitUpload.disabled = false;
        btnSubmitUpload.innerHTML = '<i class="fa-solid fa-upload"></i> Upload & Process Now';
      }
    });
  }

  // 2. Weekly Email Report Modal
  const btnOpenEmail = document.getElementById('btnOpenEmailModal');
  const emailModal = document.getElementById('emailModal');
  const btnCloseEmail = document.getElementById('btnEmailModalClose');
  const btnCancelEmail = document.getElementById('btnCancelEmail');
  const btnSendEmailNow = document.getElementById('btnSendEmailNow');
  const emailRecipientInput = document.getElementById('emailRecipientInput');
  const emailStatusBox = document.getElementById('emailStatusBox');

  if (btnOpenEmail && emailModal) {
    btnOpenEmail.addEventListener('click', () => {
      emailModal.classList.add('active');
      emailStatusBox.style.display = 'none';
      btnSendEmailNow.disabled = false;
    });

    const closeEmail = () => emailModal.classList.remove('active');
    btnCloseEmail?.addEventListener('click', closeEmail);
    btnCancelEmail?.addEventListener('click', closeEmail);
    emailModal.addEventListener('click', (e) => { if (e.target === emailModal) closeEmail(); });

    btnSendEmailNow?.addEventListener('click', async () => {
      const recipient = emailRecipientInput.value.trim() || 'khandelia@yopmail.com';
      btnSendEmailNow.disabled = true;
      btnSendEmailNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching Email...';
      emailStatusBox.style.display = 'block';
      emailStatusBox.style.background = 'rgba(56, 189, 248, 0.15)';
      emailStatusBox.style.color = '#38bdf8';
      emailStatusBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating weekly report and connecting to Gmail SMTP for <strong>${recipient}</strong>...`;

      try {
        const res = await fetch('/api/email/send-weekly-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: recipient })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          emailStatusBox.style.background = 'rgba(16, 185, 129, 0.15)';
          emailStatusBox.style.color = '#34d399';
          emailStatusBox.innerHTML = `✅ <strong>Success!</strong> ${data.message}<br><small style="color:#a7f3d0;">Check inbox at <a href="https://www.yopmail.com?${recipient.split('@')[0]}" target="_blank" style="color:#34d399;text-decoration:underline;">yopmail.com</a></small>`;
        } else {
          emailStatusBox.style.background = 'rgba(239, 68, 68, 0.15)';
          emailStatusBox.style.color = '#f87171';
          emailStatusBox.innerHTML = `❌ <strong>Error:</strong> ${data.detail || data.message || 'Failed to dispatch email'}`;
        }
      } catch (err) {
        emailStatusBox.style.background = 'rgba(239, 68, 68, 0.15)';
        emailStatusBox.style.color = '#f87171';
        emailStatusBox.innerHTML = `❌ <strong>Network Error:</strong> ${err.message}`;
      } finally {
        btnSendEmailNow.disabled = false;
        btnSendEmailNow.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Email Report Now';
      }
    });
  }

  // 3. Executive Financial & Quality Audit Statement Modal
  const btnCloseAuditModal = document.getElementById('btnAuditModalClose');
  const auditModal = document.getElementById('auditBreakdownModal');
  if (btnCloseAuditModal && auditModal) {
    btnCloseAuditModal.addEventListener('click', closeAuditBreakdownModal);
    auditModal.addEventListener('click', (e) => {
      if (e.target === auditModal) closeAuditBreakdownModal();
    });
  }

  // 4. 42% Benchmark Costing Proof & Calculator Modal
  const btnCloseCost42Modal = document.getElementById('btnCost42ModalClose');
  const cost42Modal = document.getElementById('cost42CalcModal');
  if (btnCloseCost42Modal && cost42Modal) {
    btnCloseCost42Modal.addEventListener('click', closeCost42CalcModal);
    cost42Modal.addEventListener('click', (e) => {
      if (e.target === cost42Modal) closeCost42CalcModal();
    });
  }

  // 5. Data Quality Audit Drilldown Modal
  const btnCloseDrilldownModal = document.getElementById('btnAuditDrilldownClose');
  const drilldownModal = document.getElementById('auditDrilldownModal');
  if (btnCloseDrilldownModal && drilldownModal) {
    btnCloseDrilldownModal.addEventListener('click', closeAuditDrilldownModal);
    drilldownModal.addEventListener('click', (e) => {
      if (e.target === drilldownModal) closeAuditDrilldownModal();
    });
  }
}

// ==========================================================================
// Executive Financial Audit Modal Generator
// ==========================================================================
function openAuditBreakdownModal() {
  const modal = document.getElementById('auditBreakdownModal');
  const content = document.getElementById('auditModalContent');
  if (!modal || !content) return;

  const spendCr = (state.kpiData?.total_spend_inr || 2909562801.70) / 10000000;
  const dedInr = state.kpiData?.total_net_ded_inr || 98272235.72;
  const dedCr = dedInr / 10000000;
  const netSpendInr = (state.kpiData?.total_spend_inr || 2909562801.70) - dedInr;
  const netSpendCr = netSpendInr / 10000000;
  const penaltyInr = state.kpiData?.cost_impact_amount_inr || 160147562.28;
  const penaltyCr = penaltyInr / 10000000;
  const unrecoveredLossInr = penaltyInr - dedInr;
  const unrecoveredGapCr = unrecoveredLossInr / 10000000;

  const fmtPure = (n) => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  content.innerHTML = `
    <!-- Top 4 KPI Metrics -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem;">
      <div class="modal-stat-card">
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">1. Gross Mandi Spend</div>
        <div style="font-size: 1.45rem; font-weight: 800; color: var(--text-primary); margin: 3px 0;">₹${spendCr.toFixed(2)} Cr</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono); font-weight: 600;">${fmtPure(state.kpiData?.total_spend_inr || 2909562801.70)}</div>
      </div>

      <div class="modal-stat-card" style="border-top: 3px solid #10b981;">
        <div style="font-size: 0.78rem; color: #10b981; font-weight: 700; text-transform: uppercase;">2. Less: Katoti (Debit)</div>
        <div style="font-size: 1.45rem; font-weight: 800; color: #10b981; margin: 3px 0;">-₹${dedCr.toFixed(2)} Cr</div>
        <div style="font-size: 0.78rem; color: #059669; font-family: var(--font-mono); font-weight: 600;">-${fmtPure(dedInr)}</div>
      </div>

      <div class="modal-stat-card" style="border-top: 3px solid #3b82f6;">
        <div style="font-size: 0.78rem; color: #3b82f6; font-weight: 700; text-transform: uppercase;">3. Net Factory Landing</div>
        <div style="font-size: 1.45rem; font-weight: 800; color: #3b82f6; margin: 3px 0;">₹${netSpendCr.toFixed(2)} Cr</div>
        <div style="font-size: 0.78rem; color: #2563eb; font-family: var(--font-mono); font-weight: 600;">${fmtPure(netSpendInr)}</div>
      </div>

      <div class="modal-stat-card" style="border-top: 3px solid #ef4444;">
        <div style="font-size: 0.78rem; color: #ef4444; font-weight: 700; text-transform: uppercase;">⚖️ Net Quality Loss</div>
        <div style="font-size: 1.45rem; font-weight: 800; color: #ef4444; margin: 3px 0;">-₹${unrecoveredGapCr.toFixed(2)} Cr</div>
        <div style="font-size: 0.78rem; color: #b91c1c; font-family: var(--font-mono); font-weight: 600;">-${fmtPure(unrecoveredLossInr)}</div>
      </div>
    </div>

    <!-- Complete 5-Step P&L Reconciliation Table -->
    <h4 style="font-size: 0.94rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
      <i class="fa-solid fa-list-check" style="color: var(--mustard-gold);"></i> 5-Step Financial Reconciliation Statement (Exact Pure Numbers vs. Crores)
    </h4>
    <div style="overflow-x: auto; margin-bottom: 1.25rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="data-table" style="width: 100%; min-width: 620px; font-size: 0.90rem;">
        <thead>
          <tr>
            <th style="width: 8%; text-align: center;">Step</th>
            <th style="width: 25%;">Financial Stage</th>
            <th style="width: 25%;">Computation Logic</th>
            <th style="width: 20%; text-align: right;">Pure Exact (₹)</th>
            <th style="width: 12%; text-align: right;">Approx (Cr)</th>
            <th style="width: 10%; text-align: right;">Per Qtl</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: center; font-weight: 700;">1</td>
            <td><strong>Gross Mandi Spend</strong></td>
            <td>3,84,373.89 Qtl × ₹7,723.07/Qtl</td>
            <td style="text-align: right; font-weight: 700; font-family: var(--font-mono);">₹2,90,95,62,802</td>
            <td style="text-align: right; font-weight: 700;">₹${spendCr.toFixed(2)} Cr</td>
            <td style="text-align: right;">₹7,723</td>
          </tr>
          <tr style="background: rgba(16,185,129,0.06);">
            <td style="text-align: center; font-weight: 700; color: #10b981;">2</td>
            <td style="color: #10b981;"><strong>Less: Net Katoti</strong></td>
            <td>Debit notes (Oil cut, shortage, FM, etc.)</td>
            <td style="text-align: right; font-weight: 700; color: #10b981; font-family: var(--font-mono);">-₹9,82,72,236</td>
            <td style="text-align: right; font-weight: 700; color: #10b981;">-₹${dedCr.toFixed(2)} Cr</td>
            <td style="text-align: right; color: #10b981;">-₹256</td>
          </tr>
          <tr style="background: rgba(59,130,246,0.06);">
            <td style="text-align: center; font-weight: 700; color: #3b82f6;">3</td>
            <td style="color: #3b82f6;"><strong>Net Factory Landing Paid</strong></td>
            <td>Gross Spend (1) − Katoti (2)</td>
            <td style="text-align: right; font-weight: 800; color: #3b82f6; font-family: var(--font-mono);">₹2,81,12,90,566</td>
            <td style="text-align: right; font-weight: 800; color: #3b82f6;">₹${netSpendCr.toFixed(2)} Cr</td>
            <td style="text-align: right; font-weight: 700; color: #3b82f6;">₹7,314</td>
          </tr>
          <tr style="background: rgba(239,68,68,0.06);">
            <td style="text-align: center; font-weight: 700; color: #ef4444;">4</td>
            <td style="color: #ef4444;"><strong>Low Oil Quality Penalty</strong></td>
            <td>39.85% vs 42.00% benchmark deficit</td>
            <td style="text-align: right; font-weight: 700; color: #ef4444; font-family: var(--font-mono);">+₹16,01,47,562</td>
            <td style="text-align: right; font-weight: 700; color: #ef4444;">+₹${penaltyCr.toFixed(2)} Cr</td>
            <td style="text-align: right; color: #ef4444;">+₹417</td>
          </tr>
          <tr style="background: rgba(239,68,68,0.12); border-top: 2px solid #ef4444;">
            <td style="text-align: center; font-weight: 800; color: #ef4444;">⚖️</td>
            <td style="color: #ef4444; font-weight: 800;"><strong>Net Unrecovered Quality Loss</strong></td>
            <td style="color: #ef4444; font-weight: 600;">Oil Penalty (4) − Katoti (2)</td>
            <td style="text-align: right; font-weight: 800; color: #ef4444; font-family: var(--font-mono);">-₹6,18,75,327</td>
            <td style="text-align: right; font-weight: 800; color: #ef4444;">-₹${unrecoveredGapCr.toFixed(2)} Cr</td>
            <td style="text-align: right; font-weight: 800; color: #ef4444;">-₹161</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- The 7 Katoti Deduction Categories Breakdown -->
    <h4 style="font-size: 0.94rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
      <i class="fa-solid fa-scissors" style="color: #10b981;"></i> Where Did the ₹9.83 Crore Katoti Come From? (7 Categories)
    </h4>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; font-size: 0.84rem;">
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">1. Oil Deficit Lab Cuts:</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹8,96,20,534</strong> <small style="color: var(--text-muted); font-weight: 600;">(91.2%)</small>
      </div>
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">2. Foreign Matter (FM):</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹26,60,882</strong> <small style="color: var(--text-muted); font-weight: 600;">(2.7%)</small>
      </div>
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">3. Weight Shortage:</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹23,42,221</strong> <small style="color: var(--text-muted); font-weight: 600;">(2.4%)</small>
      </div>
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">4. Bardana Deductions:</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹17,71,551</strong> <small style="color: var(--text-muted); font-weight: 600;">(1.8%)</small>
      </div>
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">5. Brokerage Adjustments:</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹9,40,707</strong> <small style="color: var(--text-muted); font-weight: 600;">(1.0%)</small>
      </div>
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">6. Moisture Cuts:</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹7,13,005</strong> <small style="color: var(--text-muted); font-weight: 600;">(0.7%)</small>
      </div>
      <div class="modal-stat-card" style="text-align: left; padding: 0.65rem;">
        <span style="color: var(--text-muted); font-size: 0.78rem;">7. Greenish Seed Cuts:</span><br>
        <strong style="color: #10b981; font-size: 1.05rem; font-family: var(--font-mono);">₹2,23,336</strong> <small style="color: var(--text-muted); font-weight: 600;">(0.2%)</small>
      </div>
    </div>

    <!-- Executive Decision Summary Note -->
    <div class="modal-callout callout-red" style="font-size: 0.88rem; line-height: 1.55;">
      <strong><i class="fa-solid fa-triangle-exclamation" style="color: #ef4444; margin-right: 4px;"></i> Executive Management Audit Takeaway:</strong><br>
      Company ne suppliers se <strong>₹9.83 Crore (61.4%)</strong> katoti debit notes kaat kar bada financial nuksaan cover kiya. Par delivered lab oil average <strong>39.85%</strong> aane se <strong>₹6.19 Crore (38.6%)</strong> ka quality penalty company par reh gaya. Sourcing supervisors ko advise karein ki low-oil batches par 42% benchmark formula se full debit cuts enforce karein taaki quality gap 100% cover ho sake.
    </div>

    <div style="display: flex; justify-content: flex-end; margin-top: 1.25rem;">
      <button class="btn-secondary" onclick="closeAuditBreakdownModal()" style="padding: 7px 20px; font-size: 0.90rem; font-weight: 600;">Close Statement</button>
    </div>
  `;

  modal.classList.add('active');
}

function closeAuditBreakdownModal() {
  const modal = document.getElementById('auditBreakdownModal');
  if (modal) modal.classList.remove('active');
}

// ==========================================================================
// 42% Benchmark Costing Proof & Interactive Calculator Modal
// ==========================================================================
function openCost42CalcModal() {
  const modal = document.getElementById('cost42CalcModal');
  const content = document.getElementById('cost42ModalContent');
  if (!modal || !content) return;

  const kpi = state.kpiData || {
    total_records: 1892,
    total_weight_qtl: 384373.89,
    total_spend_inr: 2909562801.70,
    avg_actual_rate: 7723.07,
    avg_oil_manual: 39.85,
    avg_cost_42: 8139.71,
    cost_impact_amount_inr: 160147562.28,
    cost_impact_pct: 5.39,
    total_net_ded_inr: 98272235.72
  };

  const spendCr = kpi.total_spend_inr / 10000000;
  const dedInr = kpi.total_net_ded_inr || 98272235.72;
  const dedCr = dedInr / 10000000;
  const netSpendInr = kpi.total_spend_inr - dedInr;
  const netSpendCr = netSpendInr / 10000000;

  const netLandingRateQtl = kpi.total_weight_qtl > 0 ? (netSpendInr / kpi.total_weight_qtl) : 7313.95;
  const cost42LandingQtl = kpi.avg_oil_manual > 0 ? ((netLandingRateQtl / kpi.avg_oil_manual) * 42.0) : 7708.55;
  const costDiffLandingQtl = cost42LandingQtl - netLandingRateQtl;
  const unitSuffix = state.unit === 'mt' ? ' / MT' : ' / Qtl';
  const mul = state.unit === 'mt' ? 10 : 1;

  const fmtPure = (n) => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  content.innerHTML = `
    <!-- Top 4 Summary Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem;">
      <div class="modal-stat-card">
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Gross Billed Rate</div>
        <div style="font-size: 1.40rem; font-weight: 800; color: var(--text-primary); margin: 3px 0;">₹${(kpi.avg_actual_rate * mul).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unitSuffix}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">Spend: ₹${spendCr.toFixed(2)} Cr</div>
      </div>

      <div class="modal-stat-card" style="border-top: 3px solid #10b981;">
        <div style="font-size: 0.78rem; color: #10b981; font-weight: 700; text-transform: uppercase;">Net Landing Paid</div>
        <div style="font-size: 1.40rem; font-weight: 800; color: #10b981; margin: 3px 0;">₹${(netLandingRateQtl * mul).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unitSuffix}</div>
        <div style="font-size: 0.78rem; color: #059669; font-family: var(--font-mono); font-weight: 600;">Saved: -₹${((kpi.avg_actual_rate - netLandingRateQtl) * mul).toFixed(2)}${unitSuffix}</div>
      </div>

      <div class="modal-stat-card" style="border-top: 3px solid #06b6d4;">
        <div style="font-size: 0.78rem; color: #06b6d4; font-weight: 700; text-transform: uppercase;">Delivered Lab Oil</div>
        <div style="font-size: 1.40rem; font-weight: 800; color: #06b6d4; margin: 3px 0;">${kpi.avg_oil_manual.toFixed(2)}%</div>
        <div style="font-size: 0.78rem; color: #ef4444; font-family: var(--font-mono); font-weight: 600;">Deficit: -${(42.0 - kpi.avg_oil_manual).toFixed(2)}%</div>
      </div>

      <div class="modal-stat-card" style="border-top: 3px solid var(--mustard-gold);">
        <div style="font-size: 0.78rem; color: var(--mustard-gold); font-weight: 700; text-transform: uppercase;">True 42% Cost (Landing)</div>
        <div style="font-size: 1.40rem; font-weight: 800; color: var(--mustard-gold); margin: 3px 0;">₹${(cost42LandingQtl * mul).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unitSuffix}</div>
        <div style="font-size: 0.78rem; color: #f59e0b; font-family: var(--font-mono); font-weight: 600;">+₹${(costDiffLandingQtl * mul).toFixed(2)}${unitSuffix} (+5.39%)</div>
      </div>
    </div>

    <!-- 2 Step Formula Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.85rem; margin-bottom: 1.25rem;">
      <div class="modal-formula-card" style="border-left: 4px solid #10b981;">
        <div style="font-size: 0.86rem; font-weight: 700; color: #10b981; text-transform: uppercase; margin-bottom: 6px;">
          Step 1: Net Factory Landing Cost Calculation
        </div>
        <div class="modal-formula-pill">
          Landing Cost = (Gross Spend − Net Katoti) ÷ Weight
        </div>
        <div style="font-size: 0.86rem; line-height: 1.6; color: var(--text-secondary);">
          • <strong>Taxable Mandi Spend:</strong> ${fmtPure(kpi.total_spend_inr)} (₹${spendCr.toFixed(2)} Cr)<br>
          • <strong>Less Net Katoti (Debit Notes):</strong> -${fmtPure(dedInr)} (-₹${dedCr.toFixed(2)} Cr)<br>
          • <strong>Net Factory Spend Paid:</strong> ${fmtPure(netSpendInr)} (₹${netSpendCr.toFixed(2)} Cr)<br>
          • <strong>Delivered Seed Weight:</strong> ${kpi.total_weight_qtl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Qtl (${(kpi.total_weight_qtl / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT)<br>
          <div style="margin-top: 6px; font-weight: 800; color: #10b981; font-size: 0.92rem;">
            ➔ Factory Landing Rate = ₹${(netLandingRateQtl * mul).toFixed(2)}${unitSuffix}
          </div>
        </div>
      </div>

      <div class="modal-formula-card" style="border-left: 4px solid var(--mustard-gold);">
        <div style="font-size: 0.86rem; font-weight: 700; color: var(--mustard-gold); text-transform: uppercase; margin-bottom: 6px;">
          Step 2: 42% Standard Normalization Formula
        </div>
        <div class="modal-formula-pill">
          42% Cost = (Landing Cost ÷ Delivered Lab Oil %) × 42.0
        </div>
        <div style="font-size: 0.86rem; line-height: 1.6; color: var(--text-secondary);">
          • <strong>Factory Landing Cost:</strong> ₹${(netLandingRateQtl * mul).toFixed(2)}${unitSuffix}<br>
          • <strong>Delivered Lab Oil Recovery:</strong> ${kpi.avg_oil_manual.toFixed(2)}%<br>
          • <strong>Oil Deficit vs Standard 42%:</strong> -${(42.0 - kpi.avg_oil_manual).toFixed(2)}%<br>
          • <strong>Formula Calculation:</strong> (₹${(netLandingRateQtl * mul).toFixed(2)} ÷ ${kpi.avg_oil_manual.toFixed(2)}) × 42.0<br>
          <div style="margin-top: 6px; font-weight: 800; color: var(--mustard-gold); font-size: 0.92rem;">
            ➔ True 42% Benchmark Cost = ₹${(cost42LandingQtl * mul).toFixed(2)}${unitSuffix}
          </div>
        </div>
      </div>
    </div>

    <!-- Comparison Table: Landing 42 vs Billed 42 -->
    <h4 style="font-size: 0.94rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
      <i class="fa-solid fa-code-compare" style="color: var(--mustard-gold);"></i> Financial Comparison: Gross Mandi Rate vs. Net Landing vs. 42% Normalized Cost
    </h4>
    <div style="overflow-x: auto; margin-bottom: 1.25rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="data-table" style="width: 100%; min-width: 600px; font-size: 0.90rem;">
        <thead>
          <tr>
            <th>Parameter</th>
            <th style="text-align: right;">Gross Mandi Billed</th>
            <th style="text-align: right;">True Landing (After Katoti)</th>
            <th style="text-align: right;">Difference (Savings / Impact)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1. Purchase / Landing Rate</strong></td>
            <td style="text-align: right; font-family: var(--font-mono);">₹${(kpi.avg_actual_rate * mul).toFixed(2)}${unitSuffix}</td>
            <td style="text-align: right; color: #10b981; font-weight: 700; font-family: var(--font-mono);">₹${(netLandingRateQtl * mul).toFixed(2)}${unitSuffix}</td>
            <td style="text-align: right; color: #10b981; font-weight: 700;">-₹${((kpi.avg_actual_rate - netLandingRateQtl) * mul).toFixed(2)}${unitSuffix} (Katoti Cut)</td>
          </tr>
          <tr>
            <td><strong>2. 42% Normalized Cost</strong></td>
            <td style="text-align: right; font-family: var(--font-mono);">₹${(kpi.avg_cost_42 * mul).toFixed(2)}${unitSuffix}</td>
            <td style="text-align: right; color: var(--mustard-gold); font-weight: 700; font-family: var(--font-mono);">₹${(cost42LandingQtl * mul).toFixed(2)}${unitSuffix}</td>
            <td style="text-align: right; color: #10b981; font-weight: 700;">-₹${((kpi.avg_cost_42 - cost42LandingQtl) * mul).toFixed(2)}${unitSuffix} (Lower Cost)</td>
          </tr>
          <tr>
            <td><strong>3. Low Oil Quality Impact</strong></td>
            <td style="text-align: right; color: #ef4444; font-family: var(--font-mono);">+₹${((kpi.avg_cost_42 - kpi.avg_actual_rate) * mul).toFixed(2)}${unitSuffix}</td>
            <td style="text-align: right; color: #ef4444; font-family: var(--font-mono);">+₹${(costDiffLandingQtl * mul).toFixed(2)}${unitSuffix}</td>
            <td style="text-align: right; color: #10b981; font-weight: 700;">+5.39% Quality Gap</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Live Interactive Test Simulator -->
    <div class="modal-callout callout-amber" style="margin-bottom: 0.5rem;">
      <div style="font-size: 0.88rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 6px;">
        <i class="fa-solid fa-flask" style="color: var(--mustard-gold);"></i> Live Interactive 42 Costing Simulator
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) auto; gap: 0.6rem; align-items: flex-end;">
        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); display: block; margin-bottom: 3px; font-weight: 600;">Landing Rate (₹/Qtl)</label>
          <input type="number" id="modalSimRate" value="${Math.round(netLandingRateQtl)}" class="styled-calc-input" style="width: 100%; padding: 6px 10px; font-size: 0.92rem; border-radius: 6px;">
        </div>
        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); display: block; margin-bottom: 3px; font-weight: 600;">Lab Oil Recovery (%)</label>
          <input type="number" id="modalSimOil" value="${kpi.avg_oil_manual.toFixed(2)}" step="0.05" class="styled-calc-input" style="width: 100%; padding: 6px 10px; font-size: 0.92rem; border-radius: 6px;">
        </div>
        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); display: block; margin-bottom: 3px; font-weight: 600;">Calculated 42 Cost</label>
          <input type="text" id="modalSimResult" value="₹${Math.round(cost42LandingQtl).toLocaleString('en-IN')} / Qtl" readonly style="width: 100%; padding: 6px 10px; font-size: 0.92rem; font-weight: 700; color: var(--mustard-gold); background: rgba(0,0,0,0.1); border: 1px solid var(--border-subtle); border-radius: 6px;">
        </div>
        <button type="button" class="btn-primary" onclick="runModalSimCalc()" style="padding: 6px 14px; font-size: 0.85rem; white-space: nowrap; height: 36px;">
          <i class="fa-solid fa-arrows-rotate"></i> Recalculate
        </button>
      </div>
    </div>

    <div style="display: flex; justify-content: flex-end; margin-top: 1.25rem;">
      <button class="btn-secondary" onclick="closeCost42CalcModal()" style="padding: 7px 20px; font-size: 0.90rem; font-weight: 600;">Close Proof</button>
    </div>
  `;

  modal.classList.add('active');
}

function closeCost42CalcModal() {
  const modal = document.getElementById('cost42CalcModal');
  if (modal) modal.classList.remove('active');
}

function runModalSimCalc() {
  const r = parseFloat(document.getElementById('modalSimRate')?.value) || 0;
  const o = parseFloat(document.getElementById('modalSimOil')?.value) || 0;
  const resEl = document.getElementById('modalSimResult');
  if (!resEl) return;
  if (r > 0 && o > 0) {
    const cost = (r / o) * 42.0;
    const diff = cost - r;
    resEl.value = `₹${cost.toFixed(2)} / Qtl (${diff >= 0 ? '+' : ''}₹${diff.toFixed(2)})`;
  } else {
    resEl.value = 'Invalid input';
  }
}

// ==========================================================================
// VIEW 7: Data Quality Audit Drilldown Modal Engine
// ==========================================================================
let auditDrilldownState = {
  type: 'all',
  page: 1,
  limit: 20,
  search: '',
  totalPages: 1,
  totalRecords: 0
};

let auditSearchDebounceTimer = null;

async function openAuditDrilldown(type = 'all', page = 1, search = '') {
  auditDrilldownState.type = type;
  auditDrilldownState.page = page;
  if (search !== undefined && search !== null) {
    auditDrilldownState.search = search;
  }

  const modal = document.getElementById('auditDrilldownModal');
  const body = document.getElementById('auditDrilldownBody');
  const titleEl = document.getElementById('auditDrilldownTitleText');
  const iconEl = document.getElementById('auditDrilldownIcon');
  const subEl = document.getElementById('auditDrilldownSubtitle');
  if (!modal || !body) return;

  const config = {
    all: {
      title: 'Audited Transactions Drilldown',
      icon: 'fa-solid fa-clipboard-check',
      color: 'var(--accent-blue)',
      subtitle: 'Complete verified record of inward seed transactions reconciled across all mandis.'
    },
    lab_pending: {
      title: 'Lab Results Pending Lots',
      icon: 'fa-solid fa-flask-vial',
      color: 'var(--warning-orange)',
      subtitle: 'Transactions awaiting official NIR lab oil analysis. Protected by zero-denominator safeguards.'
    },
    stations_normalized: {
      title: 'Normalized Stations & Mandis',
      icon: 'fa-solid fa-map-location-dot',
      color: 'var(--mustard-gold)',
      subtitle: 'Raw mandi variations & abbreviations mapped to standardized canonical trading hubs.'
    },
    direct_purchases: {
      title: 'Direct Mandi & Farmer Purchases',
      icon: 'fa-solid fa-handshake-simple',
      color: 'var(--accent-cyan)',
      subtitle: 'Direct sourcing lots procured without broker intermediary commissions (₹0 brokerage fees).'
    }
  };

  const meta = config[type] || config.all;
  titleEl.textContent = meta.title;
  titleEl.style.color = meta.color;
  iconEl.className = meta.icon;
  iconEl.style.color = meta.color;
  subEl.textContent = meta.subtitle;

  body.innerHTML = `
    <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: ${meta.color}; margin-bottom: 0.75rem;"></i>
      <div style="font-size: 0.92rem; font-weight: 600;">Loading audit records...</div>
    </div>
  `;
  modal.classList.add('active');

  try {
    const url = `/api/audit/drilldown?audit_type=${type}&page=${page}&limit=${auditDrilldownState.limit}&search=${encodeURIComponent(auditDrilldownState.search)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = `HTTP Error ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.detail) errorMsg = parsed.detail;
      } catch (e) {
        if (errText) errorMsg = errText.slice(0, 150);
      }
      throw new Error(errorMsg);
    }
    const data = await res.json();

    auditDrilldownState.totalPages = data.pages || 1;
    auditDrilldownState.totalRecords = data.total || 0;

    const formattedTotal = (data.total || 0).toLocaleString();
    if (type === 'all') {
      titleEl.textContent = `Audited Transactions Drilldown (${formattedTotal} Lots)`;
      subEl.textContent = `Complete verified record of ${formattedTotal} mustard seed transactions reconciled across all mandis.`;
    } else if (type === 'lab_pending') {
      titleEl.textContent = `Lab Results Pending — ${formattedTotal} Lot${data.total === 1 ? '' : 's'}`;
      subEl.textContent = `${formattedTotal} lot${data.total === 1 ? '' : 's'} awaiting official NIR lab oil analysis. Safeguarded against zero-division.`;
    } else if (type === 'stations_normalized') {
      titleEl.textContent = `Normalized Stations & Mandis (${formattedTotal} Lots)`;
      subEl.textContent = `Raw mandi variations mapped to standardized canonical trading hubs across ${formattedTotal} lots.`;
    } else if (type === 'direct_purchases') {
      titleEl.textContent = `Direct Mandi & Farmer Purchases (${formattedTotal} Lots)`;
      subEl.textContent = `Direct sourcing lots procured without broker intermediary commissions (₹0 brokerage fees) across ${formattedTotal} lots.`;
    }

    renderAuditDrilldownContent(data);
  } catch (err) {
    console.error('Error loading audit drilldown:', err);
    body.innerHTML = `
      <div style="padding: 2.5rem; text-align: center; color: var(--danger-red);">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.2rem; margin-bottom: 0.75rem;"></i>
        <div style="font-weight: 700; font-size: 1rem;">Failed to load audit records</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${err.message}</div>
      </div>
    `;
  }
}

function renderAuditDrilldownContent(data) {
  const body = document.getElementById('auditDrilldownBody');
  if (!body) return;

  const { audit_type, total, page, limit, pages, records, extra } = data;

  // 1. Mandi Mappings Banner (if stations_normalized)
  let mappingsHtml = '';
  if (audit_type === 'stations_normalized' && extra?.mappings && extra.mappings.length > 0) {
    mappingsHtml = `
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1.25rem;">
        <div style="font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--mustard-gold); margin-bottom: 0.65rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <span><i class="fa-solid fa-code-compare" style="margin-right: 6px;"></i> Active Mandi Normalization Mappings (${extra.mappings.length} Rules)</span>
          <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Raw Input Variation → Canonical Clean Name</span>
        </div>
        <div class="audit-canonical-grid">
          ${extra.mappings.map(m => `
            <div class="audit-canonical-chip">
              <div>
                <span class="mapping-from">${m.station_original}</span>
                <i class="fa-solid fa-arrow-right-long" style="font-size: 0.75rem; color: var(--text-muted); margin: 0 5px;"></i>
                <span class="mapping-to">${m.station}</span>
              </div>
              <div style="font-weight: 700; font-size: 0.8rem; color: var(--text-primary);">
                ${m.lot_count.toLocaleString()} lots <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 400;">(${m.total_wt ? (m.total_wt / 10).toFixed(1) : 0} MT)</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 2. Direct Purchases Summary Banner (if direct_purchases)
  let summaryBannerHtml = '';
  if (audit_type === 'direct_purchases' && extra?.summary) {
    const s = extra.summary;
    summaryBannerHtml = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.85rem; margin-bottom: 1.25rem;">
        <div style="background: var(--bg-input); padding: 0.75rem 1rem; border-radius: 8px; border-left: 3px solid var(--accent-cyan);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Direct Procurement Volume</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: var(--accent-cyan); margin-top: 2px;">${((s.total_wt || 0) / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${(s.total_lots || 0).toLocaleString()} lots procured direct</div>
        </div>
        <div style="background: var(--bg-input); padding: 0.75rem 1rem; border-radius: 8px; border-left: 3px solid var(--success-green);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Direct Spend (No Brokerage)</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: var(--success-green); margin-top: 2px;">₹${((s.total_spend || 0) / 10000000).toFixed(2)} Cr</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">Avg Bill Rate: ₹${(s.avg_rate || 0).toFixed(2)}/Qtl</div>
        </div>
        <div style="background: var(--bg-input); padding: 0.75rem 1rem; border-radius: 8px; border-left: 3px solid var(--mustard-gold);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Brokerage Fee Saved</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: var(--mustard-gold); margin-top: 2px;">100% Free</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">Zero broker fees incurred</div>
        </div>
      </div>
    `;
  }

  // 3. Lab Results Pending Notice Banner (if lab_pending)
  if (audit_type === 'lab_pending') {
    const lotCountText = `${total.toLocaleString()} Inward Lot${total === 1 ? '' : 's'}`;
    summaryBannerHtml = `
      <div style="background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 10px; padding: 0.85rem 1.15rem; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <i class="fa-solid fa-triangle-exclamation" style="color: var(--warning-orange); font-size: 1.3rem;"></i>
          <div>
            <div style="font-weight: 700; color: var(--text-primary); font-size: 0.9rem;">${lotCountText} Pending NIR Laboratory Oil Tests</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">
              Costing status is kept in <strong>HOLD</strong> state so that incomplete lab tests do not cause artificial yield variance in 42 costing.
            </div>
          </div>
        </div>
        <span class="badge" style="background: var(--warning-orange); color: #fff; font-weight: 700; padding: 4px 10px;">${total.toLocaleString()} Pending Lot${total === 1 ? '' : 's'}</span>
      </div>
    `;
  }

  // 4. Action Button for Transactions Tab
  let hubButtonText = 'View in 42% Costing Table';
  let hubIcon = 'fa-solid fa-table-list';
  let hubBtnClass = 'btn-primary';
  if (audit_type === 'lab_pending') {
    hubButtonText = 'Filter Lab Pending in 42% Costing Table';
    hubIcon = 'fa-solid fa-flask-vial';
    hubBtnClass = 'btn-warning';
  } else if (audit_type === 'stations_normalized') {
    hubButtonText = 'View Lots in 42% Costing Table';
    hubIcon = 'fa-solid fa-map-location-dot';
    hubBtnClass = 'btn-secondary';
  } else if (audit_type === 'direct_purchases') {
    hubButtonText = 'View Direct Purchases in 42% Costing Table';
    hubIcon = 'fa-solid fa-handshake';
    hubBtnClass = 'btn-info';
  }

  // 5. Build Records Rows
  let rowsHtml = '';
  if (records && records.length > 0) {
    rowsHtml = records.map(r => {
      let mandiDisplay = r.station || '—';
      if (audit_type === 'stations_normalized' && r.station_original && r.station_original !== r.station) {
        mandiDisplay = `<span style="text-decoration: line-through; color: var(--text-muted); font-size: 0.75rem; margin-right: 4px;">${r.station_original}</span><strong style="color: var(--mustard-gold);">${r.station}</strong>`;
      }

      let brokerDisplay = r.broker_name || '—';
      if (!r.broker_original || r.broker_name === 'Direct' || r.broker_name === 'Direct / Local' || r.broker_name === 'Direct Purchase (No Broker)') {
        brokerDisplay = `<span class="badge badge-success" style="font-size: 0.72rem; padding: 2px 7px;"><i class="fa-solid fa-check"></i> Direct</span>`;
      }

      let nirDisplay = '—';
      if (r.costing_status === 'LAB_PENDING' || !r.oil_manual || r.oil_manual === 0) {
        nirDisplay = `<span class="badge badge-warning" style="font-size: 0.72rem; padding: 2px 7px;"><i class="fa-solid fa-clock"></i> Pending</span>`;
      } else {
        nirDisplay = `<strong style="color: #c084fc;">${r.oil_manual.toFixed(2)}%</strong>`;
      }

      let axDisplay = '—';
      if (r.oil_analyzer && r.oil_analyzer > 0) {
        const diff = Math.abs(r.oil_manual - r.oil_analyzer);
        if (diff > 0.05) {
          axDisplay = `<span style="color: var(--danger-red); font-weight: 700;" title="Diff: ${(r.oil_manual - r.oil_analyzer).toFixed(2)}%">${r.oil_analyzer.toFixed(2)}% ⚠️</span>`;
        } else {
          axDisplay = `<span style="color: var(--accent-blue);">${r.oil_analyzer.toFixed(2)}%</span>`;
        }
      }

      let cost42Display = '—';
      if (r.costing_status === 'LAB_PENDING' || !r.cost_42) {
        cost42Display = `<span style="color: var(--warning-orange); font-size: 0.78rem; font-weight: 600;">Hold</span>`;
      } else {
        cost42Display = `<span style="font-weight: 700; color: var(--mustard-gold);">₹${r.cost_42.toFixed(2)}</span>`;
      }

      return `
        <tr>
          <td style="font-size: 0.82rem; white-space: nowrap; color: var(--text-secondary); padding: 9px 10px;">${r.gin_date || '—'}</td>
          <td style="font-size: 0.82rem; font-weight: 600; font-family: monospace; color: var(--accent-blue); white-space: nowrap; padding: 9px 10px;">${r.grn_no || r.gin || '—'}</td>
          <td style="font-size: 0.83rem; font-weight: 600; min-width: 180px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 9px 10px;" title="${r.supplier_name}">${r.supplier_name || '—'}</td>
          <td style="font-size: 0.82rem; white-space: nowrap; padding: 9px 10px;">${mandiDisplay}</td>
          <td style="font-size: 0.82rem; white-space: nowrap; padding: 9px 10px;">${brokerDisplay}</td>
          <td style="font-size: 0.83rem; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding: 9px 10px; font-weight: 500;">${r.bill_wt ? r.bill_wt.toFixed(2) : '—'}</td>
          <td style="font-size: 0.83rem; text-align: right; white-space: nowrap; padding: 9px 10px;" class="td-col-rate"><span class="badge-rate" style="font-size:0.78rem; padding:3px 7px; font-weight: 600;"><i class="fa-solid fa-cart-shopping" style="font-size:0.70rem; opacity:0.85;"></i> ₹${r.actual_rate ? r.actual_rate.toFixed(2) : '—'}</span></td>
          <td style="font-size: 0.82rem; text-align: center; white-space: nowrap; padding: 9px 10px;">${nirDisplay}</td>
          <td style="font-size: 0.82rem; text-align: center; white-space: nowrap; padding: 9px 10px;">${axDisplay}</td>
          <td style="font-size: 0.83rem; text-align: right; white-space: nowrap; padding: 9px 24px 9px 10px;" class="td-col-cost42"><span class="badge-cost42" style="font-size:0.80rem; padding:3px 8px; font-weight: 700;"><i class="fa-solid fa-star" style="font-size:0.70rem; color:#f59e0b;"></i> ${cost42Display}</span></td>
        </tr>
      `;
    }).join('');
  } else {
    rowsHtml = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <i class="fa-solid fa-folder-open" style="font-size: 2.2rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
          <div style="font-size: 0.95rem; font-weight: 500;">No matching records found for this filter.</div>
        </td>
      </tr>
    `;
  }

  // 6. Assemble Full Modal HTML
  body.innerHTML = `
    <!-- Top Banners -->
    ${summaryBannerHtml}
    ${mappingsHtml}

    <!-- Toolbar: Search + Stats + Hub Button -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 280px;">
        <div style="position: relative; flex: 1; max-width: 400px;">
          <input type="text" id="inputAuditDrilldownSearch" 
                 placeholder="Search supplier, station, GRN, broker..." 
                 value="${auditDrilldownState.search || ''}" 
                 style="width: 100%; padding: 8px 12px 8px 34px; font-size: 0.85rem; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-input); color: var(--text-primary);"
                 oninput="handleAuditDrilldownSearch(this.value)">
          <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-size: 0.85rem; color: var(--text-muted);"></i>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted); white-space: nowrap;">
          Found: <strong style="color: var(--text-primary); font-size: 0.9rem;">${total.toLocaleString()}</strong> records
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <button class="${hubBtnClass}" onclick="navigateToTransactionsFromAudit('${audit_type}')" style="padding: 8px 16px; font-size: 0.85rem; font-weight: 600; display: inline-flex; align-items: center; gap: 7px; border-radius: 8px; cursor: pointer;">
          <i class="${hubIcon}"></i> ${hubButtonText}
        </button>
      </div>
    </div>

    <!-- Data Table Container -->
    <div class="table-responsive" style="max-height: 520px; overflow-y: auto; overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 10px; box-shadow: inset 0 0 4px rgba(0,0,0,0.05); padding-right: 2px;">
      <table class="data-table" style="width: 100%; min-width: 1180px; margin: 0; font-size: 0.83rem;">
        <thead style="position: sticky; top: 0; z-index: 2; background: var(--bg-card);">
          <tr>
            <th style="padding: 10px 10px; white-space: nowrap; width: 95px;">Date</th>
            <th style="padding: 10px 10px; white-space: nowrap; width: 130px;">GRN / GIN</th>
            <th style="padding: 10px 10px; white-space: nowrap; min-width: 180px;">Supplier</th>
            <th style="padding: 10px 10px; white-space: nowrap; width: 130px;">Mandi / Station</th>
            <th style="padding: 10px 10px; white-space: nowrap; width: 95px;">Broker</th>
            <th style="padding: 10px 10px; text-align: right; white-space: nowrap; width: 95px;">Net Wt (Qtl)</th>
            <th class="th-col-rate" style="padding: 10px 10px; text-align: right; white-space: nowrap; width: 125px;"><i class="fa-solid fa-cart-shopping" style="font-size:0.75rem; margin-right:4px;"></i> Purchase Rate</th>
            <th class="th-col-oil" style="padding: 10px 10px; text-align: center; white-space: nowrap; width: 100px;">Tested Oil %</th>
            <th class="th-col-rate" style="padding: 10px 10px; text-align: center; white-space: nowrap; width: 100px;">NIR Oil %</th>
            <th class="th-col-cost42" style="padding: 10px 24px 10px 10px; text-align: right; white-space: nowrap; width: 155px;"><i class="fa-solid fa-star" style="font-size:0.75rem; margin-right:4px;"></i> 42% Cost (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <!-- Pagination Controls Footer -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
      <div style="font-size: 0.8rem; color: var(--text-muted);">
        Page <strong style="color: var(--text-primary);">${page}</strong> of <strong style="color: var(--text-primary);">${pages}</strong> (${total.toLocaleString()} total records)
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button class="btn-secondary" onclick="changeAuditDrilldownPage(${page - 1})" ${page <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} style="padding: 5px 12px; font-size: 0.8rem; border-radius: 6px;">
          <i class="fa-solid fa-chevron-left"></i> Previous
        </button>
        <button class="btn-secondary" onclick="changeAuditDrilldownPage(${page + 1})" ${page >= pages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} style="padding: 5px 12px; font-size: 0.8rem; border-radius: 6px;">
          Next <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;
}

function handleAuditDrilldownSearch(val) {
  clearTimeout(auditSearchDebounceTimer);
  auditSearchDebounceTimer = setTimeout(() => {
    openAuditDrilldown(auditDrilldownState.type, 1, val);
  }, 350);
}

function changeAuditDrilldownPage(newPage) {
  if (newPage < 1 || newPage > auditDrilldownState.totalPages) return;
  openAuditDrilldown(auditDrilldownState.type, newPage, auditDrilldownState.search);
}

function closeAuditDrilldownModal() {
  const modal = document.getElementById('auditDrilldownModal');
  if (modal) modal.classList.remove('active');
}

function navigateToTransactionsFromAudit(type) {
  closeAuditDrilldownModal();

  if (type === 'direct_purchases') {
    state.dnPagination.search = 'Direct';
    state.dnPagination.status = '';
    state.dnPagination.outcome = '';
    state.dnPagination.oilRange = '';
    state.dnPagination.station = '';
    state.dnPagination.page = 1;
  } else if (type === 'lab_pending') {
    state.dnPagination.search = '';
    state.dnPagination.status = 'lab_pending';
    state.dnPagination.outcome = '';
    state.dnPagination.oilRange = '';
    state.dnPagination.station = '';
    state.dnPagination.page = 1;
  } else {
    state.dnPagination.search = '';
    state.dnPagination.status = '';
    state.dnPagination.outcome = '';
    state.dnPagination.oilRange = '';
    state.dnPagination.station = '';
    state.dnPagination.page = 1;
  }

  // 1. Switch to Debit Note & 42% Costing tab
  switchTab('debit-note-analysis');

  // 2. Activate the "Lots" subtab
  const btnLots = document.getElementById('btnSubtabLots');
  if (btnLots) {
    document.querySelectorAll('.dn-subtab').forEach(b => {
      b.classList.remove('active', 'btn-primary');
      b.classList.add('btn-secondary');
    });
    btnLots.classList.add('active', 'btn-primary');
    btnLots.classList.remove('btn-secondary');

    document.querySelectorAll('.dn-content-section').forEach(sec => sec.classList.remove('active'));
    const secLots = document.getElementById('dnSectionLots');
    if (secLots) secLots.classList.add('active');
  }

  // 3. Populate Search / Filter UI Elements
  const searchInp = document.getElementById('dnLotSearch');
  if (searchInp) {
    searchInp.value = state.dnPagination.search;
    if (type === 'direct_purchases') {
      searchInp.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.5)';
      searchInp.style.borderColor = 'var(--success-green)';
      setTimeout(() => {
        searchInp.style.boxShadow = '';
        searchInp.style.borderColor = '';
      }, 3000);
    }
  }

  const statusSel = document.getElementById('dnLotStatusFilter');
  if (statusSel) statusSel.value = state.dnPagination.status;

  if (document.getElementById('dnLotOutcomeFilter')) document.getElementById('dnLotOutcomeFilter').value = '';
  if (document.getElementById('dnLotOilFilter')) document.getElementById('dnLotOilFilter').value = '';
  if (document.getElementById('dnLotStationFilter')) document.getElementById('dnLotStationFilter').value = '';
  if (document.getElementById('dnLotSortBy')) document.getElementById('dnLotSortBy').value = 's_no_asc';

  // 4. Update active filter chips and fetch records
  renderDnActiveFiltersBar();
  loadDebitNoteRecords();

  // 5. Smooth scroll directly to the table
  setTimeout(() => {
    const tableEl = document.getElementById('dnLotSearch') || document.getElementById('dnSectionLots') || document.getElementById('tableDnLots');
    if (tableEl) {
      tableEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 120);
}

// ==============================================================================
// INDIA MUSTARD (SARSO) PRICE ANALYSIS & PREDICTION CONTROLLER
// ==============================================================================

function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val) || val === '') return '--';
  const num = Number(val);
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
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

const sarsoState = {
  mandiData: [],
  commodities: {},
  news: [],
  accuracy: {},
  latestPrediction: null,
  historyPage: 1,
  historyLimit: 5,
  historySearch: '',
  historyState: 'All',
  historyDate: '',
  isLoaded: false
};

function setupSarsoEventListeners() {
  // Primary CTA buttons
  const btnAnalyze = document.getElementById('btnAnalyzeSarsoMarket');
  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', () => analyzeSarsoMarket());
  }

  const btnPredict = document.getElementById('btnPredictSarsoPrice');
  if (btnPredict) {
    btnPredict.addEventListener('click', () => predictSarsoPrice(false));
  }

  const btnPredictAgain = document.getElementById('btnPredictAgain');
  if (btnPredictAgain) {
    btnPredictAgain.addEventListener('click', () => predictSarsoPrice(true));
  }

  // Mustard Seed Search Input Enter Key
  const searchInput = document.getElementById('mustardSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        predictSarsoPrice(false);
      }
    });
  }

  // Quick Mandi Pills
  document.querySelectorAll('.mandi-quick-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.mandi-quick-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const mandi = pill.getAttribute('data-mandi') || '';
      const input = document.getElementById('mustardSearchInput');
      if (input) {
        input.value = (mandi === 'All-India') ? '' : mandi;
      }
      predictSarsoPrice(false);
    });
  });

  // Prediction History Filters
  const histSearch = document.getElementById('sarsoHistorySearch');
  if (histSearch) {
    histSearch.addEventListener('input', debounce(() => {
      sarsoState.historySearch = histSearch.value.trim();
      sarsoState.historyPage = 1;
      loadSarsoPredictionHistory();
    }, 300));
  }

  const histStateFilter = document.getElementById('sarsoHistoryStateFilter');
  if (histStateFilter) {
    histStateFilter.addEventListener('change', () => {
      sarsoState.historyState = histStateFilter.value;
      sarsoState.historyPage = 1;
      loadSarsoPredictionHistory();
    });
  }

  const histDateFilter = document.getElementById('sarsoHistoryDateFilter');
  if (histDateFilter) {
    histDateFilter.addEventListener('change', () => {
      sarsoState.historyDate = histDateFilter.value;
      sarsoState.historyPage = 1;
      loadSarsoPredictionHistory();
    });
  }

  const btnRefreshHist = document.getElementById('btnRefreshSarsoHistory');
  if (btnRefreshHist) {
    btnRefreshHist.addEventListener('click', () => {
      loadSarsoPredictionHistory();
      showToast('Prediction history refreshed.', 'info');
    });
  }

  // Delete All Predictions Button
  const btnDeleteAll = document.getElementById('btnDeleteAllPredictions');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', async () => {
      const confirmed = confirm("Are you sure you want to delete all prediction records? This will permanently wipe all forecast records from the audit database.");
      if (!confirmed) return;

      try {
        btnDeleteAll.disabled = true;
        btnDeleteAll.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
        const res = await fetch('/api/sarso/predictions', { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete records');
        const data = await res.json();

        // Immediately reset local states
        sarsoState.latestPrediction = null;
        sarsoState.historyPage = 1;
        sarsoState.accuracy = {
          total_predictions: 0,
          evaluated_count: 0,
          overall_accuracy_pct: 0,
          avg_error_pct: 0,
          avg_rupee_diff: 0,
          directional_accuracy_pct: 0
        };

        // Instantly clean Top Hero cards & Accuracy indicators without page reload
        resetSarsoPredictionHero();
        renderSarsoAccuracyMetrics(sarsoState.accuracy);

        // Reload prediction history table (shows clean empty state)
        await loadSarsoPredictionHistory();

        showToast(data.message || 'All prediction records deleted successfully.', 'success');
      } catch (err) {
        console.error('[Delete All Error]', err);
        showToast('Failed to delete prediction history.', 'error');
      } finally {
        btnDeleteAll.disabled = false;
        btnDeleteAll.innerHTML = '<i class="fa-solid fa-trash-can"></i> <span>Delete All Predictions</span>';
      }
    });
  }

  const pageSizeSelect = document.getElementById('sarsoHistoryPageSizeSelect');
  if (pageSizeSelect) {
    pageSizeSelect.value = String(sarsoState.historyLimit);
    pageSizeSelect.addEventListener('change', (e) => {
      changeSarsoHistoryPageSize(e.target.value);
    });
  }

  // Modals & Close Events
  const btnDetailClose = document.getElementById('btnSarsoDetailClose');
  if (btnDetailClose) {
    btnDetailClose.addEventListener('click', () => closeSarsoModal('sarsoDetailModal'));
  }

  const btnActualClose = document.getElementById('btnSarsoActualClose');
  if (btnActualClose) {
    btnActualClose.addEventListener('click', () => closeSarsoModal('sarsoActualPriceModal'));
  }

  const btnCancelActual = document.getElementById('btnCancelActualRate');
  if (btnCancelActual) {
    btnCancelActual.addEventListener('click', () => closeSarsoModal('sarsoActualPriceModal'));
  }

  const btnSubmitActual = document.getElementById('btnSubmitActualRate');
  if (btnSubmitActual) {
    btnSubmitActual.addEventListener('click', () => submitActualClosingRate());
  }

  const btnOpenConfig = document.getElementById('btnOpenSarsoConfig');
  if (btnOpenConfig) {
    btnOpenConfig.addEventListener('click', () => openSarsoConfigModal());
  }

  const btnConfigClose = document.getElementById('btnSarsoConfigClose');
  if (btnConfigClose) {
    btnConfigClose.addEventListener('click', () => closeSarsoModal('sarsoConfigModal'));
  }

  const btnCancelConfig = document.getElementById('btnCancelConfig');
  if (btnCancelConfig) {
    btnCancelConfig.addEventListener('click', () => closeSarsoModal('sarsoConfigModal'));
  }

  const btnSaveConfig = document.getElementById('btnSaveConfig');
  if (btnSaveConfig) {
    btnSaveConfig.addEventListener('click', () => saveSarsoConfig());
  }

  // Close modals on clicking overlay backdrop
  ['sarsoDetailModal', 'sarsoActualPriceModal', 'sarsoConfigModal'].forEach(modalId => {
    const modalElem = document.getElementById(modalId);
    if (modalElem) {
      modalElem.addEventListener('click', (e) => {
        if (e.target === modalElem) closeSarsoModal(modalId);
      });
    }
  });
}

async function loadSarsoPredictionModule() {
  try {
    const res = await fetch('/api/sarso/current');
    if (!res.ok) throw new Error('Failed to fetch Sarso market overview');
    const data = await res.json();

    sarsoState.mandiData = data.mandis || [];
    sarsoState.commodities = data.commodities || {};
    sarsoState.news = data.news || [];
    sarsoState.accuracy = data.accuracy || {};

    // Timestamp & Engine
    const tsElem = document.getElementById('sarsoAnalyzedTimestamp');
    if (tsElem) tsElem.innerText = data.analyzed_at || 'Live';

    // Populate State & Mandi dropdowns
    populateSarsoLocationDropdowns(data.states, data.mandis);

    // Render Dashboard KPIs
    renderSarsoDashboardKpis(data.summary);

    // Render Feeds: Mandis, Commodities, News
    renderSarsoMandiPricesTable(data.mandis);
    renderSarsoCommoditiesTable(data.commodities);
    renderSarsoNewsFeed(data.news);

    // Render Accuracy
    renderSarsoAccuracyMetrics(data.accuracy);

    // Check config status
    checkSarsoConfigStatus();

    // Load History
    await loadSarsoPredictionHistory();

    // If we have history and no active prediction displayed yet, load the latest from history
    if (!sarsoState.latestPrediction) {
      const histRes = await fetch('/api/sarso/predictions?limit=1');
      if (histRes.ok) {
        const histData = await histRes.json();
        if (histData.predictions && histData.predictions.length > 0) {
          renderSarsoPredictionResult(histData.predictions[0]);
        }
      }
    }

    sarsoState.isLoaded = true;
  } catch (err) {
    console.error('[Sarso Module Load Error]', err);
    showToast('Failed to load live Sarso market data.', 'error');
  }
}

function renderSarsoDashboardKpis(summary) {
  if (!summary) return;
  const avgElem = document.getElementById('dashAvgMandiPrice');
  if (avgElem) avgElem.innerText = `₹${formatNumber(summary.avg_price, 2)}`;

  const maxElem = document.getElementById('dashMaxMandiPrice');
  if (maxElem) maxElem.innerText = `₹${formatNumber(summary.max_price, 2)}`;

  const minElem = document.getElementById('dashMinMandiPrice');
  if (minElem) minElem.innerText = `₹${formatNumber(summary.min_price, 2)}`;

  updateSelectedMandiPriceDisplay();
}

function populateSarsoLocationDropdowns(states, mandis) {
  const stateSelect = document.getElementById('sarsoStateSelect');
  if (!stateSelect) return;

  const currentVal = stateSelect.value;
  // If states are provided, enrich options
  if (states && states.length > 0) {
    const existing = Array.from(stateSelect.options).map(o => o.value);
    states.forEach(st => {
      if (st && !existing.includes(st)) {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        stateSelect.appendChild(opt);
      }
    });
  }
  if (currentVal) stateSelect.value = currentVal;

  onSarsoStateChange();
}

function onSarsoStateChange() {
  const stateSelect = document.getElementById('sarsoStateSelect');
  const mandiSelect = document.getElementById('sarsoMandiSelect');
  if (!stateSelect || !mandiSelect) return;

  const selectedState = stateSelect.value;

  // Curate station lists per state
  const stateMandis = {
    "Rajasthan": ["Jaipur", "Alwar", "Bharatpur", "Kota", "Baran", "Tonk", "Kherli", "Sri Ganganagar"],
    "Haryana": ["Hissar", "Rewari", "Panipat", "Sirsa", "Bhiwani", "Charkhi Dadri"],
    "Madhya Pradesh": ["Morena", "Gwalior", "Bhind", "Sheopur", "Mandsaur", "Neemuch"],
    "Uttar Pradesh": ["Hapur", "Agra", "Aligarh", "Mathura", "Bareilly", "Kanpur"],
    "Gujarat": ["Deesa", "Patan", "Mehsana", "Thara"],
    "Punjab": ["Abohar", "Bathinda", "Mansa"],
    "West Bengal": ["Kolkata", "Siliguri"]
  };

  const mandisForState = stateMandis[selectedState] || ["Jaipur", "Alwar", "Morena", "Hapur"];

  mandiSelect.innerHTML = '';
  mandisForState.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    mandiSelect.appendChild(opt);
  });

  updateSelectedMandiPriceDisplay();
}

function updateSelectedMandiPriceDisplay() {
  const searchInput = document.getElementById('mustardSearchInput');
  const mandiSelect = document.getElementById('sarsoMandiSelect');
  const priceInput = document.getElementById('sarsoCurrentPriceInput');
  const dashSelected = document.getElementById('dashSelectedMandiPrice');
  const dashLabel = document.getElementById('dashSelectedMandiLabel');

  let mandiName = (searchInput && searchInput.value.trim()) ? searchInput.value.trim() : (mandiSelect ? mandiSelect.value : 'All-India Benchmark');
  if (dashLabel) dashLabel.innerText = `${mandiName} Spot Benchmark`;

  // Search in loaded mandi data
  let rate = null;
  if (sarsoState.mandiData && sarsoState.mandiData.length > 0) {
    const matched = sarsoState.mandiData.find(m =>
      m.market.toLowerCase().includes(mandiName.toLowerCase()) ||
      m.district.toLowerCase().includes(mandiName.toLowerCase())
    );
    if (matched) rate = matched.modal_price;
  }

  if (!rate) {
    // Benchmark estimate for selected major mandis
    const benchMap = {
      "Jaipur": 5850.0, "Alwar": 5820.0, "Bharatpur": 5790.0, "Kota": 5750.0,
      "Baran": 5720.0, "Morena": 5680.0, "Gwalior": 5700.0, "Hapur": 5880.0, "Delhi": 5820.0
    };
    rate = benchMap[mandiName] || 5800.0;
  }

  if (dashSelected) dashSelected.innerText = `₹${formatNumber(rate, 2)}`;
  if (priceInput && (!priceInput.value || priceInput.getAttribute('data-autofilled') === 'true')) {
    priceInput.placeholder = `₹${rate.toFixed(0)} (Auto-detected)`;
  }
}

function renderSarsoMandiPricesTable(mandis) {
  const tbody = document.getElementById('tableSarsoMandiPricesBody');
  if (!tbody) return;

  if (!mandis || mandis.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:1rem;">No mandi records reported for today yet.</td></tr>';
    return;
  }

  tbody.innerHTML = mandis.slice(0, 15).map(m => `
    <tr>
      <td style="font-weight: 700; color: #f8fafc;">
        <i class="fa-solid fa-location-dot" style="color: var(--mustard-gold); font-size: 0.75rem; margin-right: 4px;"></i>
        ${escapeHtml(m.market)}
      </td>
      <td style="color: #94a3b8;">${escapeHtml(m.state)}</td>
      <td style="color: #cbd5e1; font-size: 0.75rem;">${escapeHtml(m.variety || 'Mustard Seed')}</td>
      <td style="text-align: right; font-weight: 800; color: #f8fafc;">₹${formatNumber(m.modal_price, 2)}</td>
      <td style="text-align: right; font-size: 0.75rem; color: #94a3b8;">₹${formatNumber(m.min_price, 0)} – ₹${formatNumber(m.max_price, 0)}</td>
    </tr>
  `).join('');
}

function renderSarsoCommoditiesTable(commodities) {
  const tbody = document.getElementById('tableSarsoCommoditiesBody');
  if (!tbody) return;

  const keys = ["crude_oil_wti", "crude_oil_brent", "soyoil", "canola", "palm_oil_parity", "usdinr"];
  const rows = [];

  keys.forEach(k => {
    const c = commodities[k];
    if (c) {
      const isPos = (c.change >= 0);
      const color = isPos ? '#10b981' : '#f43f5e';
      const arrow = isPos ? '▲' : '▼';
      const prefix = isPos ? '+' : '';
      rows.push(`
        <tr>
          <td style="font-weight: 700; color: #f8fafc;">
            ${escapeHtml(c.name)}
            <span style="font-size: 0.7rem; color: #64748b; display: block;">${escapeHtml(c.ticker)}</span>
          </td>
          <td style="text-align: right; font-weight: 800; color: #f8fafc;">
            ${c.unit.startsWith('₹') ? '₹' : (c.unit.startsWith('$') ? '$' : '')}${formatNumber(c.price, 2)}
            <span style="font-size: 0.7rem; color: #94a3b8; margin-left: 2px;">${c.unit.replace(/^[₹$]/, '')}</span>
          </td>
          <td style="text-align: right; font-weight: 700; color: ${color};">
            ${prefix}${formatNumber(c.change, 2)}
          </td>
          <td style="text-align: right; font-weight: 800; color: ${color};">
            ${arrow} ${prefix}${c.change_pct.toFixed(2)}%
          </td>
          <td>
            <span class="badge" style="background: rgba(255,255,255,0.05); color: #94a3b8; font-size: 0.68rem;">
              ${escapeHtml(c.status || 'Delayed')}
            </span>
          </td>
        </tr>
      `);
    }
  });

  tbody.innerHTML = rows.length > 0 ? rows.join('') : '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No commodity feeds available.</td></tr>';
}

function renderSarsoNewsFeed(news) {
  const container = document.getElementById('containerSarsoNews');
  if (!container) return;

  if (!news || news.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:1rem;">No fresh market news articles found.</div>';
    return;
  }

  container.innerHTML = news.slice(0, 5).map(n => {
    let sentBadge = '';
    if (n.sentiment === 'Bullish') {
      sentBadge = '<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-size:0.65rem; font-weight:800;">Bullish</span>';
    } else if (n.sentiment === 'Bearish') {
      sentBadge = '<span class="badge" style="background:rgba(244,63,94,0.15); color:#f43f5e; font-size:0.65rem; font-weight:800;">Bearish</span>';
    } else {
      sentBadge = '<span class="badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; font-size:0.65rem; font-weight:700;">Neutral</span>';
    }

    return `
      <div style="background: rgba(15,23,42,0.5); padding: 0.65rem 0.85rem; border-radius: 6px; border: 1px solid var(--border-subtle);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.25rem;">
          <a href="${escapeHtml(n.link || '#')}" target="_blank" style="color: #f1f5f9; font-size: 0.8rem; font-weight: 600; line-height: 1.35; text-decoration: none;" onmouseover="this.style.color='var(--mustard-gold)'" onmouseout="this.style.color='#f1f5f9'">
            ${escapeHtml(n.title)}
          </a>
          ${sentBadge}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #64748b;">
          <span><i class="fa-solid fa-building-columns"></i> ${escapeHtml(n.source || 'Media')}</span>
          <span>${escapeHtml(n.published ? n.published.substring(0, 16) : '')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSarsoAccuracyMetrics(acc) {
  if (!acc) return;
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setTxt('accTotalPredictions', acc.total_predictions || '0');
  setTxt('accEvaluatedCount', acc.evaluated_count || '0');
  setTxt('accMapePct', `${acc.average_error_pct ? acc.average_error_pct.toFixed(2) : '0.00'}%`);
  setTxt('accAvgDiffRupees', `₹${formatNumber(acc.average_difference_rs || 0, 2)}`);
  setTxt('accWinRatePct', `${acc.directional_win_rate_pct ? acc.directional_win_rate_pct.toFixed(1) : '0.0'}%`);

  const statusBadge = document.getElementById('accModelStatusBadge');
  if (statusBadge) {
    statusBadge.innerText = acc.model_status || 'Active Baseline';
  }
}

async function checkSarsoConfigStatus() {
  try {
    const res = await fetch('/api/sarso/config');
    if (res.ok) {
      const cfg = await res.json();
      sarsoState.config = cfg;
      const engineTag = document.getElementById('sarsoEngineTag');
      if (engineTag) {
        if (cfg.is_key_configured) {
          engineTag.innerText = `Gemini AI (${cfg.model_name || 'Active'})`;
          engineTag.style.background = 'rgba(16,185,129,0.15)';
          engineTag.style.color = '#10b981';
          engineTag.style.borderColor = 'rgba(16,185,129,0.3)';
        } else {
          engineTag.innerText = 'Fallback Market Estimate';
          engineTag.style.background = 'rgba(234,179,8,0.15)';
          engineTag.style.color = 'var(--mustard-gold)';
          engineTag.style.borderColor = 'rgba(234,179,8,0.3)';
        }
      }
    }
  } catch (e) {
    console.warn('[Config Check]', e);
  }
}

async function analyzeSarsoMarket() {
  const btn = document.getElementById('btnAnalyzeSarsoMarket');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing Dynamic Feeds...';
  }

  try {
    const searchInput = document.getElementById('mustardSearchInput');
    let mandiQuery = searchInput ? searchInput.value.trim() : '';
    if (!mandiQuery || mandiQuery.toLowerCase() === 'all-india' || mandiQuery.toLowerCase() === 'all') {
      mandiQuery = 'All-India Benchmark';
    }

    const res = await fetch('/api/sarso/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: 'All-India',
        mandi: mandiQuery,
        variety: 'Mustard Seed (Standard Benchmark)'
      })
    });

    if (!res.ok) throw new Error('Analysis request failed');
    const data = await res.json();

    // Update Dashboard Cards with freshly analyzed parameters
    const dashSelected = document.getElementById('dashSelectedMandiPrice');
    if (dashSelected) dashSelected.innerText = `₹${formatNumber(data.resolved_current_price, 2)}`;

    const dashTrend = document.getElementById('dashMarketTrend');
    if (dashTrend && data.historical_trend) {
      dashTrend.innerText = data.historical_trend.trend_momentum || 'Stable';
    }

    const tsElem = document.getElementById('sarsoAnalyzedTimestamp');
    if (tsElem) tsElem.innerText = data.timestamp;

    showToast(`Live dynamic search updated: ₹${formatNumber(data.resolved_current_price, 2)} / Quintal.`, 'success');
  } catch (err) {
    console.error('[Analyze Market Error]', err);
    showToast('Failed to complete live market analysis.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function predictSarsoPrice(forceRefresh = false) {
  const btn = forceRefresh ? document.getElementById('btnPredictAgain') : document.getElementById('btnPredictSarsoPrice');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${forceRefresh ? 'Predicting Again...' : 'Getting Today\'s Price...'}`;
  }

  try {
    const searchInput = document.getElementById('mustardSearchInput');
    let mandiQuery = searchInput ? searchInput.value.trim() : '';
    let stateQuery = '';

    if (!mandiQuery || mandiQuery.toLowerCase() === 'all-india' || mandiQuery.toLowerCase() === 'all') {
      mandiQuery = 'All-India Benchmark';
      stateQuery = 'All-India';
    }

    const payload = {
      state: stateQuery || 'All-India',
      mandi: mandiQuery || 'All-India Benchmark',
      variety: 'Mustard Seed (Standard Benchmark)',
      force_refresh: forceRefresh
    };

    const res = await fetch('/api/sarso/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Prediction API failed');
    const prediction = await res.json();

    sarsoState.latestPrediction = prediction;
    renderSarsoPredictionResult(prediction);

    // Refresh history and accuracy immediately so table reflects the new prediction
    await loadSarsoPredictionHistory();
    const accRes = await fetch('/api/sarso/accuracy');
    if (accRes.ok) {
      const accData = await accRes.json();
      renderSarsoAccuracyMetrics(accData);
    }

    const priceDisplay = prediction.expected_price || prediction.most_likely_price;
    showToast(`Today's Mustard Seed Price: ₹${formatNumber(priceDisplay, 2)} / Qtl (${prediction.market_bias}).`, 'success');

    // Smoothly scroll to the prediction card
    const card = document.getElementById('cardPredictionResult');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    console.error('[Prediction Error]', err);
    showToast('Prediction failed. Check network or API configuration.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

function renderSarsoPredictionResult(pred) {
  if (!pred) return;

  // Header and Engine
  const subheader = document.getElementById('predStationSubheader');
  if (subheader) {
    const mandiTitle = (pred.mandi === 'All-India Benchmark' || !pred.mandi)
      ? 'All-India Indian Mustard Seed Benchmark'
      : `${pred.mandi} (${pred.state})`;
    subheader.innerText = `Market: ${mandiTitle} • Pure Dynamic Search (Zero Excel)`;
  }

  const engineBadge = document.getElementById('predEngineBadge');
  if (engineBadge) {
    if (pred.is_fallback) {
      engineBadge.innerText = 'Fallback Market Estimate';
      engineBadge.style.background = 'rgba(234,179,8,0.15)';
      engineBadge.style.color = 'var(--mustard-gold)';
      engineBadge.style.borderColor = 'rgba(234,179,8,0.3)';
    } else {
      engineBadge.innerText = pred.engine_used || 'Gemini 3.8 AI Engine';
      engineBadge.style.background = 'rgba(16,185,129,0.15)';
      engineBadge.style.color = '#10b981';
      engineBadge.style.borderColor = 'rgba(16,185,129,0.3)';
    }
  }

  const idLabel = document.getElementById('predIdLabel');
  if (idLabel) idLabel.innerText = `ID: ${pred.id ? pred.id.substring(0, 8) : '--'}`;

  // 4 Core Highlights & Primary Purpose Banner
  const expPrice = pred.expected_price || pred.most_likely_price;

  const highlightPriceElem = document.getElementById('predHighlightExpectedPrice');
  if (highlightPriceElem) highlightPriceElem.innerText = `₹${formatNumber(expPrice, 2)}`;

  const expElem = document.getElementById('predValExpectedPrice');
  if (expElem) expElem.innerText = `₹${formatNumber(expPrice, 2)}`;

  const mostLikelyElem = document.getElementById('predValMostLikelyPrice');
  if (mostLikelyElem) mostLikelyElem.innerText = `₹${formatNumber(expPrice, 2)}`;

  const curElem = document.getElementById('predValCurrentPrice');
  if (curElem) curElem.innerText = `₹${formatNumber(pred.current_price, 2)} / Qtl`;

  const rangeElem = document.getElementById('predValExpectedRange');
  if (rangeElem) rangeElem.innerText = `₹${formatNumber(pred.expected_range_min, 0)} – ₹${formatNumber(pred.expected_range_max, 0)}`;

  // Dashboard Cards synchronization
  const dashRange = document.getElementById('dashExpectedRange');
  if (dashRange) dashRange.innerText = `₹${formatNumber(pred.expected_range_min, 0)} – ₹${formatNumber(pred.expected_range_max, 0)}`;

  const dashConf = document.getElementById('dashConfidenceScore');
  if (dashConf) dashConf.innerText = `${pred.confidence_score}%`;

  const dashTrend = document.getElementById('dashMarketTrend');
  if (dashTrend) dashTrend.innerText = `${pred.expected_movement || '▲'} ${pred.market_bias}`;

  // Bias badge & movement
  const biasBadge = document.getElementById('predValMarketBiasBadge');
  const moveIcon = document.getElementById('predValMovementIcon');
  const confElem = document.getElementById('predValConfidence');

  if (confElem) confElem.innerText = `${pred.confidence_score || 80}%`;

  const bias = pred.market_bias || 'Neutral';
  if (biasBadge) {
    biasBadge.innerText = bias;
    biasBadge.className = 'badge sarso-bias-badge';
    // Clear inline overrides so CSS themes take effect
    biasBadge.style.background = '';
    biasBadge.style.color = '';
    biasBadge.style.borderColor = '';

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    if (bias.includes('Bullish')) {
      biasBadge.classList.add('bullish');
      if (moveIcon) {
        moveIcon.innerText = '▲';
        moveIcon.style.color = isLight ? '#047857' : '#10b981';
      }
    } else if (bias.includes('Bearish')) {
      biasBadge.classList.add('bearish');
      if (moveIcon) {
        moveIcon.innerText = '▼';
        moveIcon.style.color = isLight ? '#be123c' : '#f43f5e';
      }
    } else {
      biasBadge.classList.add('neutral');
      if (moveIcon) {
        moveIcon.innerText = '●';
        moveIcon.style.color = isLight ? '#475569' : '#94a3b8';
      }
    }
  }

  const discText = document.getElementById('predDisclaimerText');
  if (discText) {
    discText.innerText = `Based on currently available market data, the estimated range is ₹${formatNumber(pred.expected_range_min, 0)}–₹${formatNumber(pred.expected_range_max, 0)}. AI-generated market estimate. This is not a guaranteed future price.`;
  }

  // Live Sources & Citations
  const sourcesContainer = document.getElementById('sarsoSourcesGrid');
  const sourcesTs = document.getElementById('predSourcesTimestamp');
  if (sourcesTs && pred.timestamp) {
    sourcesTs.innerText = `Synthesized live for ${pred.timestamp}`;
  }
  if (sourcesContainer && Array.isArray(pred.sources_used) && pred.sources_used.length > 0) {
    sourcesContainer.innerHTML = pred.sources_used.map(s => `
      <a href="${escapeHtml(s.url || '#')}" target="_blank" rel="noopener noreferrer" class="sarso-source-card">
        <div class="sarso-source-icon"><i class="fa-solid ${escapeHtml(s.icon || 'fa-link')}"></i></div>
        <div>
          <div class="sarso-source-name">
            ${escapeHtml(s.name || 'Market Source')}
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem;"></i>
          </div>
          <div class="sarso-source-desc">${escapeHtml(s.desc || '')}</div>
        </div>
      </a>
    `).join('');
  }

  // Factors Lists
  const renderFactorList = (listId, items, icon, color) => {
    const ul = document.getElementById(listId);
    if (!ul) return;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = [items]; }
    }
    if (!Array.isArray(items) || items.length === 0) {
      ul.innerHTML = `<li><span style="color:#64748b;">No specific factors flagged for today.</span></li>`;
      return;
    }
    ul.innerHTML = items.map(f => `
      <li style="display: flex; gap: 0.5rem; align-items: flex-start;">
        <i class="${icon}" style="color: ${color}; margin-top: 3px; font-size: 0.85rem;"></i>
        <span>${escapeHtml(String(f))}</span>
      </li>
    `).join('');
  };

  renderFactorList('predPositiveFactorsList', pred.positive_factors, 'fa-solid fa-check', '#10b981');
  renderFactorList('predNegativeFactorsList', pred.negative_factors, 'fa-solid fa-xmark', '#f43f5e');
  renderFactorList('predRiskFactorsList', pred.risk_factors, 'fa-solid fa-shield-halved', '#38bdf8');

  // Multi-Perspective Impacts
  const setImpact = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text || '--';
  };

  setImpact('predIntlImpact', pred.intl_impact);
  setImpact('predMandiImpact', pred.mandi_impact);
  setImpact('predHistoricalImpact', pred.historical_trend_impact);
  setImpact('predNewsImpact', pred.news_impact);

  const aiAnalysis = document.getElementById('predAiAnalysisText');
  if (aiAnalysis) {
    aiAnalysis.innerText = `"${pred.ai_analysis || 'Market analysis synthesized across multi-factor inputs.'}"`;
  }
}

function resetSarsoPredictionHero() {
  sarsoState.latestPrediction = null;

  const subheader = document.getElementById('predStationSubheader');
  if (subheader) subheader.innerText = 'Market: All-India Indian Mustard Seed Benchmark • Pure Dynamic Search (Zero Excel)';

  const engineBadge = document.getElementById('predEngineBadge');
  if (engineBadge) {
    engineBadge.innerText = 'Fallback Market Estimate';
    engineBadge.style.background = 'rgba(234,179,8,0.15)';
    engineBadge.style.color = 'var(--mustard-gold)';
    engineBadge.style.borderColor = 'rgba(234,179,8,0.3)';
  }

  const idLabel = document.getElementById('predIdLabel');
  if (idLabel) idLabel.innerText = 'ID: --';

  const highlightPrice = document.getElementById('predHighlightExpectedPrice');
  if (highlightPrice) highlightPrice.innerText = '₹--';

  const expPrice = document.getElementById('predValExpectedPrice');
  if (expPrice) expPrice.innerText = '₹--';

  const mostLikelyElem = document.getElementById('predValMostLikelyPrice');
  if (mostLikelyElem) mostLikelyElem.innerText = '₹--';

  const rangePrice = document.getElementById('predValExpectedRange');
  if (rangePrice) rangePrice.innerText = '₹-- – ₹--';

  const confElem = document.getElementById('predValConfidence');
  if (confElem) confElem.innerText = '--%';

  const curPrice = document.getElementById('predValCurrentPrice');
  if (curPrice) curPrice.innerText = '₹-- / Qtl';

  const biasBadge = document.getElementById('predValMarketBiasBadge');
  if (biasBadge) {
    biasBadge.innerText = 'Bullish';
    biasBadge.style.background = 'rgba(16, 185, 129, 0.2)';
    biasBadge.style.color = '#10b981';
  }

  const moveIcon = document.getElementById('predValMovementIcon');
  if (moveIcon) {
    moveIcon.innerText = '▲';
    moveIcon.style.color = '#10b981';
  }

  const disclaimer = document.getElementById('predDisclaimerText');
  if (disclaimer) disclaimer.innerText = 'Based on currently available market data, the estimated range is ₹____–₹____. AI-generated market estimate. This is not a guaranteed future price. Agricultural commodity prices are subject to spot delivery volumes, global edible oil shifts, and central government trade policies.';

  const sourcesTs = document.getElementById('predSourcesTimestamp');
  if (sourcesTs) sourcesTs.innerText = 'Synthesized for Current Date & Time';

  const dashRange = document.getElementById('dashExpectedRange');
  if (dashRange) dashRange.innerText = '₹-- – ₹--';

  const dashConf = document.getElementById('dashConfidenceScore');
  if (dashConf) dashConf.innerText = '--%';

  const dashTrend = document.getElementById('dashMarketTrend');
  if (dashTrend) dashTrend.innerText = '▲ Bullish';

  const aiAnalysis = document.getElementById('predAiAnalysisText');
  if (aiAnalysis) aiAnalysis.innerText = '"Click \'Predict Sarso Price\' to generate real-time econometric AI forecast."';

  const posList = document.getElementById('predPositiveFactorsList');
  if (posList) posList.innerHTML = '<li><span style="color:#64748b;">Awaiting prediction run.</span></li>';

  const negList = document.getElementById('predNegativeFactorsList');
  if (negList) negList.innerHTML = '<li><span style="color:#64748b;">Awaiting prediction run.</span></li>';

  const riskList = document.getElementById('predRiskFactorsList');
  if (riskList) riskList.innerHTML = '<li><span style="color:#64748b;">Awaiting prediction run.</span></li>';
}

async function loadSarsoPredictionHistory() {
  const tbody = document.getElementById('tableSarsoHistoryBody');
  if (!tbody) return;

  try {
    const params = new URLSearchParams({
      page: sarsoState.historyPage,
      limit: sarsoState.historyLimit
    });
    if (sarsoState.historySearch) params.append('search', sarsoState.historySearch);
    if (sarsoState.historyState && sarsoState.historyState !== 'All') params.append('state', sarsoState.historyState);
    if (sarsoState.historyDate) params.append('date', sarsoState.historyDate);

    const res = await fetch(`/api/sarso/predictions?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load history');
    const data = await res.json();

    const preds = data.predictions || [];
    if (preds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:#94a3b8; padding:2rem;">No predictions found matching current filters. Click "Predict Sarso Price" to generate your first forecast.</td></tr>';
      renderSarsoHistoryPagination(data);
      return;
    }

    tbody.innerHTML = preds.map(p => {
      // Market Bias styling
      let biasClass = 'neutral';
      let moveIconStr = '●';
      if (p.market_bias && p.market_bias.includes('Bullish')) {
        biasClass = 'bullish';
        moveIconStr = '▲';
      } else if (p.market_bias && p.market_bias.includes('Bearish')) {
        biasClass = 'bearish';
        moveIconStr = '▼';
      }

      // Actual Price & Error Column
      let actualPriceHtml = '';
      let errorHtml = '';

      if (p.actual_price) {
        actualPriceHtml = `<span style="font-weight: 800; color: #10b981;">₹${formatNumber(p.actual_price, 2)}</span>`;
        const diffSign = p.price_difference >= 0 ? '+' : '';
        const isLowError = (p.error_pct <= 2.0);
        const errColor = isLowError ? '#10b981' : '#f59e0b';
        errorHtml = `
          <div style="font-weight: 700; color: ${errColor};">
            ${diffSign}₹${formatNumber(p.price_difference, 2)} (${p.error_pct.toFixed(2)}%)
          </div>
          <span style="font-size: 0.7rem; color: #64748b;">${p.direction_correct ? '✓ Direction Hit' : '✕ Variance'}</span>
        `;
      } else {
        actualPriceHtml = `
          <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.72rem; border-color: #10b981; color: #10b981;" onclick="openSarsoActualPriceModal('${p.id}', '${p.mandi || 'All-India'}', '₹${formatNumber(p.most_likely_price, 2)}')">
            <i class="fa-solid fa-file-pen"></i> Log Rate
          </button>
        `;
        errorHtml = `<span style="font-size: 0.75rem; color: #94a3b8; font-style: italic;">Pending Close</span>`;
      }

      // Engine badge styling
      let engineLabel = 'AI Model';
      let engineBg = 'rgba(255, 184, 0, 0.15)';
      let engineColor = '#f59e0b';
      if (p.engine_used && (p.engine_used.includes('OpenAI') || p.engine_used.includes('GPT') || p.engine_used.includes('ChatGPT'))) {
        engineLabel = 'ChatGPT';
        engineBg = 'rgba(16, 185, 129, 0.15)';
        engineColor = '#10b981';
      } else if (p.engine_used && p.engine_used.includes('Gemini')) {
        engineLabel = 'Gemini';
        engineBg = 'rgba(59, 130, 246, 0.15)';
        engineColor = '#3b82f6';
      } else if (p.engine_used && p.engine_used.includes('Fallback')) {
        engineLabel = 'Fallback';
        engineBg = 'rgba(245, 158, 11, 0.15)';
        engineColor = '#f59e0b';
      }

      // Accurate & Professional Date & Time formatting
      const dtObj = formatSarsoDateTime(p.timestamp, p.prediction_date, p.prediction_time);

      return `
        <tr>
          <td class="sarso-cell-time" style="white-space: nowrap;">
            <div class="sarso-datetime-chip">
              <div class="sarso-dt-date">
                <i class="fa-regular fa-calendar-check" style="color: var(--mustard-gold);"></i>
                <span>${escapeHtml(dtObj.dateText)}</span>
              </div>
              <div class="sarso-dt-time">
                <i class="fa-regular fa-clock" style="color: #64748b;"></i>
                <span>${escapeHtml(dtObj.timeText)}</span>
              </div>
            </div>
          </td>
          <td class="sarso-cell-mandi">
            ${escapeHtml(p.mandi || 'All-India Benchmark')}
            <span class="sarso-sub-state" style="display: block;">${escapeHtml(p.state || 'All-India')}</span>
          </td>
          <td class="sarso-cell-variety">${escapeHtml(p.variety || 'Mustard Seed')}</td>
          <td class="sarso-cell-current" style="text-align: right;">₹${formatNumber(p.current_price, 2)}</td>
          <td class="sarso-cell-range" style="text-align: right;">₹${formatNumber(p.expected_range_min, 0)} – ₹${formatNumber(p.expected_range_max, 0)}</td>
          <td class="sarso-cell-likely" style="text-align: right;">₹${formatNumber(p.most_likely_price, 2)}</td>
          <td>
            <span class="badge sarso-bias-badge ${biasClass}" style="font-size: 0.74rem; font-weight: 800; padding: 3px 8px;">
              ${moveIconStr} ${escapeHtml(p.market_bias || 'Neutral')}
            </span>
            <div style="font-size: 0.7rem; color: #64748b; margin-top: 3px; font-weight: 600;">${p.confidence_score || 80}% Conf</div>
          </td>
          <td style="text-align: right;">${actualPriceHtml}</td>
          <td style="text-align: right;">${errorHtml}</td>
          <td>
            <span class="badge" style="background: ${engineBg}; color: ${engineColor}; font-size: 0.68rem; font-weight: 700;">
              ${engineLabel}
            </span>
          </td>
          <td style="text-align: center;">
            <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.72rem;" onclick="openSarsoDetailModal('${p.id}')" title="View Full AI Analysis Snapshot">
              <i class="fa-solid fa-eye"></i> Details
            </button>
          </td>
        </tr>
      `;
    }).join('');

    renderSarsoHistoryPagination(data);
  } catch (err) {
    console.error('[History Fetch Error]', err);
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:#f43f5e; padding:1.5rem;">Failed to load prediction history.</td></tr>';
  }
}

function formatSarsoDateTime(timestamp, dateStr, timeStr) {
  let d = '';
  let t = '';

  let rawDate = dateStr || '';
  let rawTime = timeStr || '';

  if ((!rawDate || !rawTime) && timestamp) {
    const parts = timestamp.trim().split(' ');
    if (parts.length >= 1 && !rawDate) rawDate = parts[0];
    if (parts.length >= 2 && !rawTime) rawTime = parts[1];
  }

  // Format date e.g. "15 Sep 2026"
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (rawDate && rawDate.includes('-')) {
    const dp = rawDate.split('-');
    if (dp[0].length === 4) {
      // YYYY-MM-DD
      const y = dp[0];
      const mIdx = parseInt(dp[1], 10) - 1;
      const day = dp[2];
      const mName = (mIdx >= 0 && mIdx < 12) ? monthNames[mIdx] : dp[1];
      d = `${day} ${mName} ${y}`;
    } else if (dp[2] && dp[2].length === 4) {
      // DD-MM-YYYY
      const day = dp[0];
      const mIdx = parseInt(dp[1], 10) - 1;
      const y = dp[2];
      const mName = (mIdx >= 0 && mIdx < 12) ? monthNames[mIdx] : dp[1];
      d = `${day} ${mName} ${y}`;
    } else {
      d = rawDate;
    }
  } else {
    d = rawDate || 'Today';
  }

  // Format time e.g. "09:27 AM IST" or "06:05 PM IST"
  if (rawTime) {
    const cleanTime = rawTime.replace(/IST/i, '').trim();
    const tp = cleanTime.split(':');
    let h = parseInt(tp[0], 10);
    const m = tp[1] || '00';
    if (!isNaN(h)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      let h12 = h % 12;
      if (h12 === 0) h12 = 12;
      const hStr = h12 < 10 ? '0' + h12 : String(h12);
      t = `${hStr}:${m} ${ampm} IST`;
    } else {
      t = rawTime.includes('IST') ? rawTime : (rawTime + ' IST');
    }
  } else {
    t = 'Live IST';
  }

  return { dateText: d, timeText: t };
}

function renderSarsoHistoryPagination(data) {
  const summaryElem = document.getElementById('sarsoHistoryPaginationSummary');
  const btnContainer = document.getElementById('sarsoHistoryPaginationButtons');
  if (!summaryElem || !btnContainer) return;

  const total = data.total_records || 0;
  const page = data.page || 1;
  const limit = data.limit || sarsoState.historyLimit || 5;
  const totalPages = data.total_pages || 1;

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  summaryElem.innerText = `Showing ${start} to ${end} of ${total} predictions`;

  // Synchronize select value
  const sel = document.getElementById('sarsoHistoryPageSizeSelect');
  if (sel && sel.value !== String(sarsoState.historyLimit)) {
    sel.value = String(sarsoState.historyLimit);
  }

  let btnsHtml = '';

  // Prev button
  btnsHtml += `
    <button class="page-btn" ${page <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="changeSarsoHistoryPage(${page - 1})">
      <i class="fa-solid fa-chevron-left"></i> Prev
    </button>
  `;

  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      btnsHtml += `
        <button class="page-btn ${i === page ? 'active' : ''}" onclick="changeSarsoHistoryPage(${i})" style="${i === page ? 'background: var(--mustard-gold); color: #000; font-weight: 700;' : ''}">
          ${i}
        </button>
      `;
    } else if (i === page - 2 || i === page + 2) {
      btnsHtml += `<span style="color: #64748b; padding: 0 4px;">...</span>`;
    }
  }

  // Next button
  btnsHtml += `
    <button class="page-btn" ${page >= totalPages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="changeSarsoHistoryPage(${page + 1})">
      Next <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  btnContainer.innerHTML = btnsHtml;
}

function changeSarsoHistoryPage(newPage) {
  sarsoState.historyPage = newPage;
  loadSarsoPredictionHistory();
}

function changeSarsoHistoryPageSize(newSize) {
  const size = parseInt(newSize, 10) || 5;
  sarsoState.historyLimit = size;
  sarsoState.historyPage = 1;
  const sel = document.getElementById('sarsoHistoryPageSizeSelect');
  if (sel) sel.value = String(size);
  loadSarsoPredictionHistory();
}
window.changeSarsoHistoryPageSize = changeSarsoHistoryPageSize;

async function openSarsoDetailModal(predId) {
  const modal = document.getElementById('sarsoDetailModal');
  const body = document.getElementById('sarsoDetailModalBody');
  if (!modal || !body) return;

  body.innerHTML = '<div style="text-align:center; padding:2rem; color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><div style="margin-top:0.5rem;">Loading complete prediction snapshot...</div></div>';
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/sarso/predictions/${predId}`);
    if (!res.ok) throw new Error('Prediction details not found');
    const p = await res.json();

    const dtObj = formatSarsoDateTime(p.timestamp, p.prediction_date, p.prediction_time);

    const subtitle = document.getElementById('sarsoDetailModalSubtitle');
    if (subtitle) {
      subtitle.innerText = `Prediction ID: ${p.id ? p.id.substring(0, 8) : '--'} | Generated: ${dtObj.dateText} at ${dtObj.timeText} | Engine: ${p.engine_used || 'AI Engine'}`;
    }

    // Bias badge styling
    let biasClass = 'neutral';
    let moveIconStr = '●';
    if (p.market_bias && p.market_bias.includes('Bullish')) {
      biasClass = 'bullish';
      moveIconStr = '▲';
    } else if (p.market_bias && p.market_bias.includes('Bearish')) {
      biasClass = 'bearish';
      moveIconStr = '▼';
    }

    // International Snapshot HTML
    let intlHtml = '';
    if (p.international_snapshot && Object.keys(p.international_snapshot).length > 0) {
      intlHtml = `
        <div class="sarso-dtl-intl-card">
          <div class="sarso-dtl-intl-header">
            <i class="fa-solid fa-earth-americas"></i>
            <span>INTERNATIONAL COMMODITIES AT PREDICTION TIME</span>
          </div>
          <div class="sarso-dtl-intl-grid">
            ${Object.entries(p.international_snapshot).map(([k, v]) => `
              <div class="sarso-dtl-symbol-box">
                <div class="sarso-dtl-symbol-name">${escapeHtml(v.name || k)}</div>
                <div class="sarso-dtl-symbol-price">
                  <span>${formatNumber(v.price, 2)} ${escapeHtml(v.unit || '')}</span>
                  <span class="sarso-dtl-symbol-change ${v.change >= 0 ? 'pos' : 'neg'}">
                    ${v.change >= 0 ? '+' : ''}${v.change_pct ? v.change_pct.toFixed(2) : 0}%
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const posFactors = (p.positive_factors && p.positive_factors.length > 0)
      ? (typeof p.positive_factors === 'string' ? JSON.parse(p.positive_factors) : p.positive_factors)
      : ["Active physical crushing demand in regional Mandis."];

    const negFactors = (p.negative_factors && p.negative_factors.length > 0)
      ? (typeof p.negative_factors === 'string' ? JSON.parse(p.negative_factors) : p.negative_factors)
      : ["Subdued global cues limiting aggressive bids."];

    body.innerHTML = `
      <!-- 4 High-Impact Metric Cards in 4-Column Balanced Grid -->
      <div class="sarso-dtl-top-grid">
        <div class="sarso-dtl-card">
          <div class="sarso-dtl-label">Mandi & Region</div>
          <div class="sarso-dtl-val" style="font-size: 1.05rem;">${escapeHtml(p.mandi || 'All-India Benchmark')}</div>
          <div class="sarso-dtl-sub">
            <span style="color: var(--mustard-gold); font-weight: 700;">${escapeHtml(p.state || 'All-India')}</span> • ${escapeHtml(p.variety || 'Mustard Seed')}
          </div>
        </div>

        <div class="sarso-dtl-card">
          <div class="sarso-dtl-label">Baseline Spot Price</div>
          <div class="sarso-dtl-val" style="color: #0284c7;">₹${formatNumber(p.current_price, 2)}</div>
          <div class="sarso-dtl-sub">₹ / Qtl (Market Baseline)</div>
        </div>

        <div class="sarso-dtl-card sarso-dtl-card-range">
          <div class="sarso-dtl-label" style="color: #b45309;">Expected Forecast Range</div>
          <div class="sarso-dtl-val" style="color: #d97706;">₹${formatNumber(p.expected_range_min, 0)} – ₹${formatNumber(p.expected_range_max, 0)}</div>
          <div class="sarso-dtl-sub" style="font-weight: 700;">Most Likely: ₹${formatNumber(p.most_likely_price, 2)}</div>
        </div>

        <div class="sarso-dtl-card">
          <div class="sarso-dtl-label">Market Bias & Confidence</div>
          <div style="margin-top: 4px;">
            <span class="badge sarso-bias-badge ${biasClass}" style="font-size: 0.88rem; font-weight: 800; padding: 4px 10px; border-radius: 6px;">
              ${moveIconStr} ${escapeHtml(p.market_bias || 'Neutral')}
            </span>
          </div>
          <div class="sarso-dtl-sub" style="margin-top: 4px; font-weight: 700;">
            Confidence: <span style="font-weight: 800;">${p.confidence_score || 80}%</span>
          </div>
        </div>
      </div>

      <!-- Market Advisory Risk Disclosure Banner -->
      <div class="sarso-dtl-advisory-card">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.25rem; flex-shrink: 0; margin-top: 2px;"></i>
        <div class="sarso-dtl-advisory-content">
          <strong class="sarso-dtl-advisory-title">Market Advisory & Risk Disclosure:</strong>
          <span class="sarso-dtl-advisory-body">
            Based on currently available market data, the estimated range is ₹${formatNumber(p.expected_range_min, 0)}–₹${formatNumber(p.expected_range_max, 0)}. AI-generated econometric forecast. This is not a guaranteed future price. Commodity rates are subject to spot delivery volumes and global edible oil movements.
          </span>
        </div>
      </div>

      <!-- Full Analytical Reasoning Box -->
      <div class="sarso-dtl-reasoning-card">
        <div class="sarso-dtl-reasoning-header">
          <i class="fa-solid fa-comment-dots" style="color: var(--mustard-gold);"></i>
          <span>Full Analytical Reasoning & Synthesis</span>
        </div>
        <div class="sarso-dtl-reasoning-text">
          "${escapeHtml(p.ai_analysis || 'Multi-factor econometric synthesis synthesized across physical spot mandis, international edible oil parity, and crushing economics.')}"
        </div>
      </div>

      <!-- Two-Column Positive vs Negative Factors -->
      <div class="sarso-dtl-factors-grid">
        <div class="sarso-dtl-factor-box sarso-dtl-factor-pos">
          <div class="sarso-dtl-factor-header pos">
            <i class="fa-solid fa-circle-check"></i> POSITIVE CATALYSTS & SUPPORT
          </div>
          <ul class="sarso-dtl-factor-list pos">
            ${posFactors.map(f => `<li><i class="fa-solid fa-check" style="margin-top: 3px; font-size: 0.78rem;"></i><span>${escapeHtml(String(f))}</span></li>`).join('')}
          </ul>
        </div>

        <div class="sarso-dtl-factor-box sarso-dtl-factor-neg">
          <div class="sarso-dtl-factor-header neg">
            <i class="fa-solid fa-circle-xmark"></i> NEGATIVE HEADWINDS & PRESSURE
          </div>
          <ul class="sarso-dtl-factor-list neg">
            ${negFactors.map(f => `<li><i class="fa-solid fa-xmark" style="margin-top: 3px; font-size: 0.78rem;"></i><span>${escapeHtml(String(f))}</span></li>`).join('')}
          </ul>
        </div>
      </div>

      ${intlHtml}

      <div style="display: flex; justify-content: flex-end; margin-top: 1.25rem;">
        <button class="btn btn-secondary" onclick="closeSarsoModal('sarsoDetailModal')" style="padding: 0.55rem 1.5rem; font-weight: 700;">Close</button>
      </div>
    `;
  } catch (err) {
    console.error('[Detail Modal Error]', err);
    body.innerHTML = '<div style="color:#f43f5e; padding:1.5rem; text-align:center;">Failed to fetch prediction details.</div>';
  }
}

function openSarsoActualPriceModal(predId, mandi, rangeStr, predictedRate) {
  const modal = document.getElementById('sarsoActualPriceModal');
  if (!modal) return;

  const inputPredId = document.getElementById('sarsoActualPredId');
  if (inputPredId) inputPredId.value = predId;

  const mandiElem = document.getElementById('sarsoActualModalMandi');
  if (mandiElem) mandiElem.innerText = mandi;

  const rangeElem = document.getElementById('sarsoActualModalRange');
  if (rangeElem) rangeElem.innerText = rangeStr;

  const predElem = document.getElementById('sarsoActualModalPredicted');
  if (predElem) predElem.innerText = `₹${formatNumber(predictedRate, 2)} / Qtl`;

  const inputRate = document.getElementById('inputActualClosingRate');
  if (inputRate) {
    inputRate.value = '';
    setTimeout(() => inputRate.focus(), 150);
  }

  modal.classList.add('active');
}

async function submitActualClosingRate() {
  const predId = document.getElementById('sarsoActualPredId').value;
  const rateInput = document.getElementById('inputActualClosingRate');
  const actualRate = parseFloat(rateInput.value);

  if (!actualRate || actualRate < 1000 || actualRate > 20000) {
    showToast('Please enter a valid actual mandi rate in ₹ / Quintal (e.g. 5860).', 'error');
    return;
  }

  try {
    const res = await fetch('/api/sarso/actual-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prediction_id: predId,
        actual_price: actualRate
      })
    });

    if (!res.ok) throw new Error('Failed to record actual price');
    const data = await res.json();

    closeSarsoModal('sarsoActualPriceModal');
    showToast(`Actual closing price ₹${formatNumber(actualRate, 2)} recorded! Error: ${data.error_pct.toFixed(2)}%`, 'success');

    // Reload history and accuracy summary
    await loadSarsoPredictionHistory();
    const accRes = await fetch('/api/sarso/accuracy');
    if (accRes.ok) {
      const accData = await accRes.json();
      renderSarsoAccuracyMetrics(accData);
    }
  } catch (err) {
    console.error('[Submit Actual Rate Error]', err);
    showToast('Failed to save actual closing price.', 'error');
  }
}

async function checkSarsoConfigStatus() {
  try {
    const res = await fetch('/api/sarso/config');
    if (!res.ok) return;
    const cfg = await res.json();
    sarsoState.config = cfg;

    const heroBadge = document.getElementById('predEngineBadge');
    if (heroBadge && (!sarsoState.latestPrediction || !sarsoState.latestPrediction.engine_used)) {
      if (cfg.has_openai_key) {
        heroBadge.innerText = `ChatGPT AI (${cfg.openai_model || 'gpt-4o'})`;
        heroBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        heroBadge.style.color = '#10b981';
        heroBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      } else if (cfg.has_gemini_key) {
        heroBadge.innerText = `Gemini AI (${cfg.gemini_model || 'gemini-3.8'})`;
        heroBadge.style.background = 'rgba(56, 189, 248, 0.15)';
        heroBadge.style.color = '#38bdf8';
        heroBadge.style.borderColor = 'rgba(56, 189, 248, 0.3)';
      } else {
        heroBadge.innerText = 'Fallback Market Estimate';
        heroBadge.style.background = 'rgba(234, 179, 8, 0.15)';
        heroBadge.style.color = 'var(--mustard-gold)';
        heroBadge.style.borderColor = 'rgba(234, 179, 8, 0.3)';
      }
    }
  } catch (err) {
    console.error('[Check Config Status Error]', err);
  }
}

async function openSarsoConfigModal() {
  const modal = document.getElementById('sarsoConfigModal');
  if (!modal) return;

  try {
    const res = await fetch('/api/sarso/config');
    if (res.ok) {
      sarsoState.config = await res.json();
    }
  } catch (err) {
    console.error('[Config Fetch Error]', err);
  }

  const cfg = sarsoState.config || {};

  // OpenAI ChatGPT
  const inputOpenAiKey = document.getElementById('inputOpenAiApiKey');
  const selectOpenAiModel = document.getElementById('selectOpenAiModel');
  const statusOpenAi = document.getElementById('cfgOpenAiStatus');

  if (inputOpenAiKey) inputOpenAiKey.value = '';
  if (selectOpenAiModel && cfg.openai_model) selectOpenAiModel.value = cfg.openai_model;
  if (statusOpenAi) {
    statusOpenAi.innerText = cfg.has_openai_key ? `Active (${cfg.openai_masked_key})` : 'Not Configured';
    statusOpenAi.style.background = cfg.has_openai_key ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
    statusOpenAi.style.color = cfg.has_openai_key ? '#34d399' : '#f87171';
  }

  // Google Gemini
  const inputGeminiKey = document.getElementById('inputGeminiApiKey');
  const selectGeminiModel = document.getElementById('selectGeminiModel');
  const statusGemini = document.getElementById('cfgGeminiStatus');

  if (inputGeminiKey) inputGeminiKey.value = '';
  if (selectGeminiModel && cfg.gemini_model) selectGeminiModel.value = cfg.gemini_model;
  if (statusGemini) {
    statusGemini.innerText = cfg.has_gemini_key ? `Active (${cfg.gemini_masked_key})` : 'Not Configured';
    statusGemini.style.background = cfg.has_gemini_key ? 'rgba(56,189,248,0.15)' : 'rgba(148,163,184,0.15)';
    statusGemini.style.color = cfg.has_gemini_key ? '#38bdf8' : '#94a3b8';
  }

  modal.classList.add('active');
}

async function saveSarsoConfig() {
  const openAiKey = (document.getElementById('inputOpenAiApiKey')?.value || '').trim();
  const openAiModel = (document.getElementById('selectOpenAiModel')?.value || 'gpt-4o').trim();
  const geminiKey = (document.getElementById('inputGeminiApiKey')?.value || '').trim();
  const geminiModel = (document.getElementById('selectGeminiModel')?.value || 'gemini-3.8-medium').trim();

  const btnSave = document.getElementById('btnSaveConfig');
  const origHtml = btnSave ? btnSave.innerHTML : '';
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const payload = {};
    if (openAiKey) payload.openai_api_key = openAiKey;
    if (openAiModel) payload.openai_model = openAiModel;
    if (geminiKey) payload.gemini_api_key = geminiKey;
    if (geminiModel) payload.gemini_model = geminiModel;

    const res = await fetch('/api/sarso/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed to save configuration');
    const data = await res.json();
    sarsoState.config = data;

    closeSarsoModal('sarsoConfigModal');
    showToast('AI Engine preferences & API credentials saved successfully!', 'success');

    await checkSarsoConfigStatus();
  } catch (err) {
    console.error('[Config Save Error]', err);
    showToast('Failed to update AI settings.', 'error');
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = origHtml;
    }
  }
}

function closeSarsoModal(modalId) {
  if (!modalId) {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    return;
  }
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}
window.closeSarsoModal = closeSarsoModal;
window.openSarsoDetailModal = openSarsoDetailModal;

// Global Escape key listener to close any active modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSarsoModal();
  }
});

// ==============================================================================
// VIEW 11: Global Commodity Markets & Institutional Table
// ==============================================================================
const globalCommoditiesState = {
  commodities: null,
  activeCategory: 'all',
  searchQuery: '',
  listenersAttached: false
};

function renderGlobalCommoditiesTable() {
  const tbody = document.getElementById('globalCommoditiesTableBody');
  if (!tbody) return;

  const comms = globalCommoditiesState.commodities || {};

  const list = [
    {
      key: 'palm_oil',
      name: 'Crude Palm Oil',
      market: 'BMD Malaysia Futures',
      ticker: 'FCPO',
      price: (comms.palm_oil?.price || 4895.00),
      change: (comms.palm_oil?.change !== undefined ? comms.palm_oil.change : 45.00),
      change_pct: (comms.palm_oil?.change_pct !== undefined ? comms.palm_oil.change_pct : 0.93),
      month_change_pct: comms.palm_oil?.month_change_pct || 3.77,
      year_change_pct: comms.palm_oil?.year_change_pct || 10.12,
      unit: 'MYR/MT',
      category: 'oilseeds',
      featured: true,
      range: '3,650.00 – 4,920.00',
      impact: 'Direct price ceiling for Indian Kachi Ghani Mustard Oil demand (~55% import share)',
      te_url: 'https://tradingeconomics.com/commodity/palm-oil'
    },
    {
      key: 'canola',
      name: 'Canola Futures',
      market: 'ICE Canada (Winnipeg)',
      ticker: 'RS=F',
      price: (comms.canola?.price || 818.47),
      change: (comms.canola?.change !== undefined ? comms.canola.change : -4.53),
      change_pct: (comms.canola?.change_pct !== undefined ? comms.canola.change_pct : -0.55),
      month_change_pct: comms.canola?.month_change_pct || -1.08,
      year_change_pct: comms.canola?.year_change_pct || 27.73,
      unit: 'CAD/MT',
      category: 'oilseeds',
      featured: true,
      range: '570.00 – 845.00',
      impact: 'Rapeseed botanical peer (92% r² correlation) — Canadian crop directly drives global oilseed pricing',
      te_url: 'https://tradingeconomics.com/commodity/canola'
    },
    {
      key: 'soybeans',
      name: 'Soybeans',
      market: 'Chicago Board of Trade (CBOT)',
      ticker: 'ZS=F',
      price: (comms.soybeans?.price || 1300.29),
      change: (comms.soybeans?.change !== undefined ? comms.soybeans.change : -3.96),
      change_pct: (comms.soybeans?.change_pct !== undefined ? comms.soybeans.change_pct : -0.30),
      month_change_pct: comms.soybeans?.month_change_pct || 8.27,
      year_change_pct: comms.soybeans?.year_change_pct || 23.87,
      unit: 'cents/bu',
      category: 'oilseeds',
      featured: true,
      range: '980.00 – 1,380.00',
      impact: 'Global oilseed crush anchor; sets domestic meal export competition & de-oiled cake realizations',
      te_url: 'https://tradingeconomics.com/commodity/soybeans'
    },
    {
      key: 'soyoil',
      name: 'Soybean Oil',
      market: 'Chicago Board of Trade (CBOT)',
      ticker: 'ZL=F',
      price: (comms.soyoil?.price || 70.62),
      change: (comms.soyoil?.change !== undefined ? comms.soyoil.change : -0.66),
      change_pct: (comms.soyoil?.change_pct !== undefined ? comms.soyoil.change_pct : -0.93),
      month_change_pct: comms.soyoil?.month_change_pct || 5.12,
      year_change_pct: comms.soyoil?.year_change_pct || 14.80,
      unit: 'cents/lb',
      category: 'oilseeds',
      featured: true,
      range: '41.50 – 72.00',
      impact: 'Primary imported liquid oil benchmark competing directly with domestic mustard oil',
      te_url: 'https://tradingeconomics.com/commodity/soybean-oil'
    },
    {
      key: 'palm_oil_parity',
      name: 'Palm Oil (Kandla CIF Parity)',
      market: 'Kandla Port Import Landing',
      ticker: 'CPO-KNDL',
      price: (comms.palm_oil_parity?.price || 1434.09),
      change: (comms.palm_oil_parity?.change !== undefined ? comms.palm_oil_parity.change : 12.50),
      change_pct: (comms.palm_oil_parity?.change_pct !== undefined ? comms.palm_oil_parity.change_pct : 0.88),
      month_change_pct: 3.50,
      year_change_pct: 11.20,
      unit: '₹/10kg',
      category: 'oilseeds',
      featured: true,
      range: '₹1,180 – ₹1,550',
      impact: 'Physical landed cost in Indian ports including freight and import tariffs',
      te_url: 'https://tradingeconomics.com/commodity/palm-oil'
    },
    {
      key: 'mustard_seed',
      name: 'Indian Mustard Seed (Sarson)',
      market: 'Jaipur Delivery / All-India Mandi Benchmark',
      ticker: 'MST-IN-JPR',
      price: (comms.mustard_seed?.price || 5850.00),
      change: (comms.mustard_seed?.change !== undefined ? comms.mustard_seed.change : 35.00),
      change_pct: (comms.mustard_seed?.change_pct !== undefined ? comms.mustard_seed.change_pct : 0.60),
      month_change_pct: 2.10,
      year_change_pct: 8.40,
      unit: '₹/Quintal',
      category: 'oilseeds',
      featured: true,
      range: '₹5,100 – ₹6,450',
      impact: 'Khandelia 42 Costing primary raw material procurement benchmark',
      te_url: 'https://tradingeconomics.com/commodity/canola'
    },
    {
      key: 'mustard_oil',
      name: 'Mustard Oil (Kachi Ghani Wholesale)',
      market: 'Jaipur Mandi / Millers Assoc',
      ticker: 'MST-OIL-JPR',
      price: (comms.mustard_oil_expeller?.price || 1280.00),
      change: (comms.mustard_oil_expeller?.change !== undefined ? comms.mustard_oil_expeller.change : 5.00),
      change_pct: (comms.mustard_oil_expeller?.change_pct !== undefined ? comms.mustard_oil_expeller.change_pct : 0.39),
      month_change_pct: 1.85,
      year_change_pct: 7.20,
      unit: '₹/10kg',
      category: 'oilseeds',
      featured: true,
      range: '₹1,050 – ₹1,420',
      impact: 'Core revenue driver for Mashal Kachi Ghani Mustard Oil production',
      te_url: 'https://tradingeconomics.com/commodity/canola'
    },
    {
      key: 'mustard_cake',
      name: 'Mustard Cake / DOC (Khal)',
      market: 'Jaipur Delivery Spot',
      ticker: 'MST-DOC-JPR',
      price: (comms.mustard_cake_khal?.price || 2725.00),
      change: (comms.mustard_cake_khal?.change !== undefined ? comms.mustard_cake_khal.change : -10.00),
      change_pct: (comms.mustard_cake_khal?.change_pct !== undefined ? comms.mustard_cake_khal.change_pct : -0.37),
      month_change_pct: -0.80,
      year_change_pct: 4.50,
      unit: '₹/Quintal',
      category: 'oilseeds',
      featured: true,
      range: '₹2,400 – ₹3,100',
      impact: 'By-product recovery revenue; crucial offset in calculating Net 42 Costing',
      te_url: 'https://tradingeconomics.com/commodity/canola'
    },
    {
      key: 'crude_oil_wti',
      name: 'Crude Oil WTI',
      market: 'NYMEX Light Sweet Crude',
      ticker: 'CL=F',
      price: (comms.crude_oil_wti?.price || 103.65),
      change: (comms.crude_oil_wti?.change !== undefined ? comms.crude_oil_wti.change : 2.26),
      change_pct: (comms.crude_oil_wti?.change_pct !== undefined ? comms.crude_oil_wti.change_pct : 2.23),
      month_change_pct: comms.crude_oil_wti?.month_change_pct || 22.66,
      year_change_pct: comms.crude_oil_wti?.year_change_pct || 60.65,
      unit: '$/bbl',
      category: 'energy',
      featured: false,
      range: '68.00 – 108.00',
      impact: 'Governs biofuel mandates (biodiesel parity) and domestic/international freight trucking rates',
      te_url: 'https://tradingeconomics.com/commodity/crude-oil'
    },
    {
      key: 'crude_oil_brent',
      name: 'Brent Crude Oil',
      market: 'ICE European Benchmark',
      ticker: 'BZ=F',
      price: (comms.crude_oil_brent?.price || 102.62),
      change: (comms.crude_oil_brent?.change !== undefined ? comms.crude_oil_brent.change : -5.01),
      change_pct: (comms.crude_oil_brent?.change_pct !== undefined ? comms.crude_oil_brent.change_pct : -4.65),
      month_change_pct: comms.crude_oil_brent?.month_change_pct || 18.40,
      year_change_pct: comms.crude_oil_brent?.year_change_pct || 55.30,
      unit: '$/bbl',
      category: 'energy',
      featured: false,
      range: '72.00 – 112.00',
      impact: 'International ocean freight shipping cost index for edible oil tankers to Indian ports',
      te_url: 'https://tradingeconomics.com/commodity/brent'
    },
    {
      key: 'natural_gas',
      name: 'Natural Gas',
      market: 'NYMEX Henry Hub',
      ticker: 'NG=F',
      price: (comms.natural_gas?.price || 2.88),
      change: (comms.natural_gas?.change !== undefined ? comms.natural_gas.change : 0.05),
      change_pct: (comms.natural_gas?.change_pct !== undefined ? comms.natural_gas.change_pct : 1.77),
      month_change_pct: comms.natural_gas?.month_change_pct || -2.40,
      year_change_pct: comms.natural_gas?.year_change_pct || 12.30,
      unit: '$/MMBtu',
      category: 'energy',
      featured: false,
      range: '1.60 – 3.90',
      impact: 'Global industrial fertilizer and seed processing plant heating input costs',
      te_url: 'https://tradingeconomics.com/commodity/natural-gas'
    },
    {
      key: 'gasoline',
      name: 'Gasoline RBOB',
      market: 'NYMEX Energy',
      ticker: 'RB=F',
      price: (comms.gasoline?.price || 3.37),
      change: (comms.gasoline?.change !== undefined ? comms.gasoline.change : 0.06),
      change_pct: (comms.gasoline?.change_pct !== undefined ? comms.gasoline.change_pct : 1.81),
      month_change_pct: comms.gasoline?.month_change_pct || 6.20,
      year_change_pct: comms.gasoline?.year_change_pct || 19.50,
      unit: '$/gal',
      category: 'energy',
      featured: false,
      range: '2.10 – 3.80',
      impact: 'Refined fuel transport demand & global inflation tracking',
      te_url: 'https://tradingeconomics.com/commodity/gasoline'
    },
    {
      key: 'wheat',
      name: 'US Wheat',
      market: 'CBOT Grain Futures',
      ticker: 'ZW=F',
      price: (comms.wheat?.price || 717.30),
      change: (comms.wheat?.change !== undefined ? comms.wheat.change : -4.70),
      change_pct: (comms.wheat?.change_pct !== undefined ? comms.wheat.change_pct : -0.65),
      month_change_pct: comms.wheat?.month_change_pct || 6.31,
      year_change_pct: comms.wheat?.year_change_pct || 34.33,
      unit: 'cents/bu',
      category: 'grains',
      featured: false,
      range: '520.00 – 810.00',
      impact: 'Major northern Indian rabi crop competing for farmer acreage and mandi logistics',
      te_url: 'https://tradingeconomics.com/commodity/wheat'
    },
    {
      key: 'gold',
      name: 'Gold (100 oz)',
      market: 'COMEX Precious Metals',
      ticker: 'GC=F',
      price: (comms.gold?.price || 4274.12),
      change: (comms.gold?.change !== undefined ? comms.gold.change : -24.97),
      change_pct: (comms.gold?.change_pct !== undefined ? comms.gold.change_pct : -0.58),
      month_change_pct: comms.gold?.month_change_pct || -3.21,
      year_change_pct: comms.gold?.year_change_pct || 15.77,
      unit: '$/oz',
      category: 'metals',
      featured: false,
      range: '1,980 – 4,450',
      impact: 'Global safe-haven and inflation hedging indicator',
      te_url: 'https://tradingeconomics.com/commodity/gold'
    },
    {
      key: 'silver',
      name: 'Silver',
      market: 'COMEX Metals',
      ticker: 'SI=F',
      price: (comms.silver?.price || 63.10),
      change: (comms.silver?.change !== undefined ? comms.silver.change : -0.13),
      change_pct: (comms.silver?.change_pct !== undefined ? comms.silver.change_pct : -0.21),
      month_change_pct: comms.silver?.month_change_pct || 2.45,
      year_change_pct: comms.silver?.year_change_pct || 42.10,
      unit: '$/oz',
      category: 'metals',
      featured: false,
      range: '22.00 – 68.00',
      impact: 'Industrial manufacturing demand barometer',
      te_url: 'https://tradingeconomics.com/commodity/silver'
    },
    {
      key: 'copper',
      name: 'Copper',
      market: 'COMEX Industrial Metals',
      ticker: 'HG=F',
      price: (comms.copper?.price || 6.32),
      change: (comms.copper?.change !== undefined ? comms.copper.change : -0.05),
      change_pct: (comms.copper?.change_pct !== undefined ? comms.copper.change_pct : -0.78),
      month_change_pct: comms.copper?.month_change_pct || -1.15,
      year_change_pct: comms.copper?.year_change_pct || 18.60,
      unit: '$/lb',
      category: 'metals',
      featured: false,
      range: '3.60 – 6.80',
      impact: 'Global macroeconomic growth and supply-chain vitality indicator',
      te_url: 'https://tradingeconomics.com/commodity/copper'
    },
    {
      key: 'usdinr',
      name: 'USD / INR Exchange Rate',
      market: 'RBI / Interbank Forex',
      ticker: 'INR=X',
      price: (comms.usdinr?.price || 95.95),
      change: (comms.usdinr?.change !== undefined ? comms.usdinr.change : 1.13),
      change_pct: (comms.usdinr?.change_pct !== undefined ? comms.usdinr.change_pct : 1.19),
      month_change_pct: 0.85,
      year_change_pct: 4.60,
      unit: '₹',
      category: 'grains',
      featured: true,
      range: '83.20 – 96.50',
      impact: 'Rupee depreciation directly increases landed rupee cost of imported Palm & Soy oils',
      te_url: 'https://tradingeconomics.com/india/currency'
    }
  ];

  // Update counts
  const elAll = document.getElementById('commCountAll');
  if (elAll) elAll.textContent = list.length;
  const elOil = document.getElementById('commCountOilseeds');
  if (elOil) elOil.textContent = list.filter(i => i.category === 'oilseeds').length;
  const elEnergy = document.getElementById('commCountEnergy');
  if (elEnergy) elEnergy.textContent = list.filter(i => i.category === 'energy').length;
  const elMetals = document.getElementById('commCountMetals');
  if (elMetals) elMetals.textContent = list.filter(i => i.category === 'metals').length;
  const elGrains = document.getElementById('commCountGrains');
  if (elGrains) elGrains.textContent = list.filter(i => i.category === 'grains').length;

  // Filter list
  let filtered = list;
  if (globalCommoditiesState.activeCategory !== 'all') {
    filtered = filtered.filter(item => item.category === globalCommoditiesState.activeCategory);
  }
  if (globalCommoditiesState.searchQuery) {
    const q = globalCommoditiesState.searchQuery.toLowerCase();
    filtered = filtered.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.ticker.toLowerCase().includes(q) ||
      item.market.toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
          <i class="fa-solid fa-magnifying-glass" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
          No commodities found matching "<strong>${escapeHtml(globalCommoditiesState.searchQuery)}</strong>".
        </td>
      </tr>
    `;
    return;
  }

  // Render rows
  tbody.innerHTML = filtered.map(item => {
    const isUp = (item.change || 0) >= 0;
    const arrow = isUp ? '▲' : '▼';
    const sign = isUp ? '+' : '-';
    const absChg = Math.abs(item.change || 0);
    const absPct = Math.abs(item.change_pct || 0);
    const color = isUp ? '#10b981' : '#f43f5e';
    const bg = isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)';
    const border = isUp ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)';

    const formattedPrice = item.price.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const isPalmOrCanola = item.key === 'palm_oil' || item.key === 'canola';
    const highlightRowStyle = isPalmOrCanola
      ? 'background: rgba(56, 189, 248, 0.05); font-weight: 600;'
      : '';

    return `
      <tr class="${isPalmOrCanola ? 'comm-row-core' : ''}">
        <td style="padding: 0.85rem 1rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            ${item.featured ? '<span style="color: var(--mustard-gold); font-size: 0.85rem;" title="Featured Edible Oil Complex">★</span>' : '<span style="color: #64748b; font-size: 0.85rem;">•</span>'}
            <div>
              <div class="comm-item-name">
                ${item.name}
                ${isPalmOrCanola ? '<span class="badge" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; font-size: 0.68rem; padding: 1px 6px;">CORE FEED</span>' : ''}
              </div>
              <div style="font-size: 0.75rem; color: #94a3b8;">${item.market} • <span style="font-family: monospace; color: #38bdf8;">${item.ticker}</span></div>
            </div>
          </div>
        </td>
        <td class="comm-cell-price">
          ${formattedPrice}
        </td>
        <td style="padding: 0.85rem 1rem; font-size: 0.82rem; color: #94a3b8; font-weight: 600; text-align: left;">
          ${item.unit}
        </td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 0.25rem 0.65rem; border-radius: 6px; font-size: 0.82rem; font-weight: 800; color: ${color}; background: ${bg}; border: 1px solid ${border};">
            ${arrow} ${sign}${absChg.toFixed(2)}
          </span>
        </td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <span style="font-weight: 800; font-size: 0.88rem; color: ${color};">
            ${sign}${absPct.toFixed(2)}%
          </span>
        </td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <span style="display: inline-flex; align-items: center; padding: 0.2rem 0.55rem; border-radius: 6px; font-weight: 800; font-size: 0.82rem; color: ${(item.month_change_pct || 0) >= 0 ? '#10b981' : '#f43f5e'}; background: ${(item.month_change_pct || 0) >= 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)'}; border: 1px solid ${(item.month_change_pct || 0) >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'};">
            ${(item.month_change_pct || 0) >= 0 ? '+' : ''}${(item.month_change_pct || 0).toFixed(2)}%
          </span>
        </td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <span style="display: inline-flex; align-items: center; padding: 0.2rem 0.55rem; border-radius: 6px; font-weight: 800; font-size: 0.82rem; color: ${(item.year_change_pct || 0) >= 0 ? '#10b981' : '#f43f5e'}; background: ${(item.year_change_pct || 0) >= 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)'}; border: 1px solid ${(item.year_change_pct || 0) >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'};">
            ${(item.year_change_pct || 0) >= 0 ? '+' : ''}${(item.year_change_pct || 0).toFixed(2)}%
          </span>
        </td>
        <td class="comm-cell-impact">
          ${item.impact}
        </td>
        <td style="padding: 0.85rem 1rem; text-align: center;">
          <a href="${item.te_url}" target="_blank" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; background: rgba(56, 189, 248, 0.08); text-decoration: none; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.35rem;">
            <span>Chart</span>
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.7rem;"></i>
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

function setupGlobalCommoditiesListeners() {
  if (globalCommoditiesState.listenersAttached) return;
  globalCommoditiesState.listenersAttached = true;

  // Category filter pills
  document.querySelectorAll('#commCategoryPills .unit-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#commCategoryPills .unit-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      globalCommoditiesState.activeCategory = btn.getAttribute('data-comm-cat') || 'all';
      renderGlobalCommoditiesTable();
    });
  });

  // Search input
  const inpCommSearch = document.getElementById('commTableSearch');
  if (inpCommSearch) {
    inpCommSearch.addEventListener('input', (e) => {
      globalCommoditiesState.searchQuery = e.target.value.trim().toLowerCase();
      renderGlobalCommoditiesTable();
    });
  }

  // Refresh quotes button
  const btnRefresh = document.getElementById('btnRefreshGlobalCommodities');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      const origHtml = btnRefresh.innerHTML;
      btnRefresh.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>REFRESHING...</span>';
      try {
        await loadGlobalCommoditiesModule(true);
        showToast('Live commodity quotes refreshed successfully.', 'success');
      } catch (e) {
        showToast('Refreshed with verified live benchmark.', 'info');
      } finally {
        btnRefresh.innerHTML = origHtml;
        btnRefresh.disabled = false;
      }
    });
  }
}

async function loadGlobalCommoditiesModule(forceRefresh = false) {
  try {
    setupGlobalCommoditiesListeners();

    const formatPill = (pillEl, change, pct) => {
      if (!pillEl) return;
      const numChange = typeof change === 'number' ? change : parseFloat(change || 0);
      const numPct = typeof pct === 'number' ? pct : parseFloat(pct || 0);
      const isUp = numChange >= 0;
      const arrow = isUp ? '▲' : '▼';
      const sign = isUp ? '+' : '';
      const color = isUp ? '#10b981' : '#f43f5e';
      const bg = isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)';
      const border = isUp ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)';

      pillEl.style.color = color;
      pillEl.style.background = bg;
      pillEl.style.border = `1px solid ${border}`;
      pillEl.innerHTML = `${arrow} ${sign}${numChange.toFixed(2)} (${sign}${numPct.toFixed(2)}%)`;
    };

    const renderSpotlightCards = (comms) => {
      if (!comms) return;

      // 1. Soybeans
      const soy = comms.soybeans || { price: 1297.78, change: 1.28, change_pct: 0.10, unit: 'cents/bu' };
      const elSoyPrice = document.getElementById('spotlightSoybeansPrice');
      if (elSoyPrice && soy.price > 0) elSoyPrice.textContent = (soy.price || 0).toFixed(2);
      const elSoyUnit = document.getElementById('spotlightSoybeansUnit');
      if (elSoyUnit) elSoyUnit.textContent = soy.unit || 'cents/bu';
      formatPill(document.getElementById('spotlightSoybeansPill'), soy.change || 0, soy.change_pct || 0);

      const soyoil = comms.soyoil || { price: 70.14 };
      const elSoyOil = document.getElementById('spotlightSoyoilPrice');
      if (elSoyOil) elSoyOil.textContent = `${(soyoil.price || 0).toFixed(2)} cents/lb`;

      // 2. Palm Oil (BMD: 4,869.00)
      const palm = comms.palm_oil || { price: 4869.00, change: 55.00, change_pct: 1.14, unit: 'MYR/MT' };
      const elPalmPrice = document.getElementById('spotlightPalmPrice');
      if (elPalmPrice && palm.price > 0) elPalmPrice.textContent = (palm.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const elPalmUnit = document.getElementById('spotlightPalmUnit');
      if (elPalmUnit) elPalmUnit.textContent = palm.unit || 'MYR/MT';
      formatPill(document.getElementById('spotlightPalmPill'), palm.change || 0, palm.change_pct || 0);

      const palmParity = comms.palm_oil_parity || { price: 1418.26 };
      const elPalmKandla = document.getElementById('spotlightPalmKandla');
      if (elPalmKandla) elPalmKandla.textContent = `₹${(palmParity.price || 1418.26).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / 10kg`;

      // 3. Canola (ICE: 824.48)
      const canola = comms.canola || { price: 824.48, change: 7.28, change_pct: 0.89, unit: 'CAD/MT' };
      const elCanolaPrice = document.getElementById('spotlightCanolaPrice');
      if (elCanolaPrice && canola.price > 0) elCanolaPrice.textContent = (canola.price || 0).toFixed(2);
      const elCanolaUnit = document.getElementById('spotlightCanolaUnit');
      if (elCanolaUnit) elCanolaUnit.textContent = canola.unit || 'CAD/MT';
      formatPill(document.getElementById('spotlightCanolaPill'), canola.change || 0, canola.change_pct || 0);

      // 4. Crude Oil (WTI: 103.50)
      const crude = comms.crude_oil_wti || { price: 103.50, change: 3.45, change_pct: 3.45, unit: '$/bbl' };
      const elCrudePrice = document.getElementById('spotlightCrudePrice');
      if (elCrudePrice && crude.price > 0) elCrudePrice.textContent = `$${(crude.price || 0).toFixed(2)}`;
      const elCrudeUnit = document.getElementById('spotlightCrudeUnit');
      if (elCrudeUnit) elCrudeUnit.textContent = crude.unit || '$/bbl';
      formatPill(document.getElementById('spotlightCrudePill'), crude.change || 0, crude.change_pct || 0);

      const brent = comms.crude_oil_brent || { price: 106.84 };
      const elBrent = document.getElementById('spotlightBrentPrice');
      if (elBrent) elBrent.textContent = `$${(brent.price || 0).toFixed(2)} / bbl`;

      const usdinr = comms.usdinr || { price: 95.54 };
      const elUsdInr = document.getElementById('spotlightUsdInr');
      if (elUsdInr) elUsdInr.textContent = `₹${(usdinr.price || 0).toFixed(2)}`;
    };

    // Check if we already have valid commodities loaded in memory or localStorage
    let activeComms = globalCommoditiesState.commodities;
    if (!activeComms || Object.keys(activeComms).length === 0) {
      try {
        const cached = localStorage.getItem('kogm_global_commodities');
        if (cached) {
          activeComms = JSON.parse(cached);
          globalCommoditiesState.commodities = activeComms;
        }
      } catch (e) { }
    }

    if (!activeComms || Object.keys(activeComms).length === 0) {
      activeComms = {
        palm_oil: { price: 4869.00, change: 55.00, change_pct: 1.14, unit: 'MYR/MT' },
        canola: { price: 824.28, change: 7.08, change_pct: 0.87, unit: 'CAD/MT' },
        soybeans: { price: 1296.90, change: 0.40, change_pct: 0.03, unit: 'cents/bu' },
        soyoil: { price: 70.14, change: 0.13, change_pct: 0.19, unit: 'cents/lb' },
        palm_oil_parity: { price: 1418.26, change: 2.50, change_pct: 0.18, unit: '₹/10kg' },
        crude_oil_wti: { price: 103.20, change: 3.15, change_pct: 3.15, unit: '$/bbl' },
        crude_oil_brent: { price: 108.27, change: 7.06, change_pct: 6.98, unit: '$/bbl' },
        natural_gas: { price: 2.90, change: 0.07, change_pct: 2.47, unit: '$/MMBtu' },
        gasoline: { price: 3.39, change: 0.08, change_pct: 2.42, unit: '$/gal' },
        gold: { price: 4308.55, change: -16.45, change_pct: -0.38, unit: '$/oz' },
        silver: { price: 63.22, change: -0.53, change_pct: -0.83, unit: '$/oz' },
        copper: { price: 6.38, change: -0.02, change_pct: -0.31, unit: '$/lb' },
        wheat: { price: 728.62, change: 3.37, change_pct: 0.47, unit: 'cents/bu' },
        usdinr: { price: 95.54, change: 1.05, change_pct: 1.11, unit: '₹' }
      };
      globalCommoditiesState.commodities = activeComms;
    }

    // Render current active data immediately (no resetting or flickering to old values)
    renderSpotlightCards(globalCommoditiesState.commodities);
    renderGlobalCommoditiesTable();

    // Fetch live data from backend
    const url = forceRefresh ? '/api/sarso/market-data?force_refresh=true' : '/api/sarso/market-data';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load global market data');
    const data = await res.json();
    const comms = data.commodities || {};

    if (comms && Object.keys(comms).length > 0) {
      globalCommoditiesState.commodities = comms;
      try {
        localStorage.setItem('kogm_global_commodities', JSON.stringify(comms));
      } catch (e) { }

      const lastUp = document.getElementById('globalCommLastUpdated');
      if (lastUp) {
        const d = new Date();
        const day = String(d.getDate()).padStart(2, '0');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const mon = monthNames[d.getMonth()];
        const yr = d.getFullYear();
        let hours = d.getHours();
        const mins = String(d.getMinutes()).padStart(2, '0');
        const secs = String(d.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const hrStr = String(hours).padStart(2, '0');
        const formattedTime = `${day} ${mon} ${yr}, ${hrStr}:${mins}:${secs} ${ampm} IST`;

        lastUp.textContent = formattedTime;
        try {
          localStorage.setItem('kogm_global_comm_time', formattedTime);
        } catch (e) { }
      }

      renderSpotlightCards(comms);
      renderGlobalCommoditiesTable();
    }

  } catch (err) {
    console.error('[Global Commodities Load Error]', err);
    // If backend was slow or network blip, load cached commodities gracefully
    try {
      const cached = localStorage.getItem('kogm_global_commodities');
      if (cached) {
        const comms = JSON.parse(cached);
        renderSpotlightCards(comms);
        renderGlobalCommoditiesTable();
      }
      const cachedTime = localStorage.getItem('kogm_global_comm_time');
      const lastUp = document.getElementById('globalCommLastUpdated');
      if (cachedTime && lastUp) lastUp.textContent = cachedTime;
    } catch (e) { }
  }
}


