/* ============================================================
   app.js — Budologist Stock Management PWA
   ============================================================ */

/* ─── State ──────────────────────────────────────────────── */
let allStock         = [];
let allPurchases     = [];
let stockIcons       = [];   /* loaded from icons/icons.json */
let inventoryFilter  = 'all';
let inventorySearch  = '';   /* live name search */
let filterStatus     = 'all'; /* 'all' | 'in-stock' | 'low-stock' | 'out-of-stock' */
let filterStrain     = 'all';
let filterTag        = 'all';
let sellFilter       = 'all';
let sellSearch       = '';     /* sell tab search query */
let cart             = [];     /* items queued for sale */
let selectedIcon     = null;   /* add-item form */
let editSelectedIcon = null;   /* edit modal */
let selectedSellItem = null;   /* sell step 2 */
let selectedMember   = null;   /* linked member for a sale */
let memberSearchTimer = null;  /* debounce timer */
let deferredInstall  = null;

/* ─── PWA Install ────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  });
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById('installBtn').hidden = false;
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn').hidden = true;
  deferredInstall = null;
});

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') document.getElementById('installBtn').hidden = true;
  deferredInstall = null;
});

/* ─── Helpers ────────────────────────────────────────────── */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmt(num) {
  return 'R\u202f' + Number(num || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function fmtQty(qty, unit) {
  const n = Number(qty || 0);
  const q = n % 1 === 0 ? String(n) : n.toFixed(2);
  return unit ? `${q} ${unit}` : q;
}

function iconSrc(icon) {
  return (icon && icon !== 'none') ? `icons/${icon}.png` : null;
}

function catLabel(cat) {
  return { weed: 'Weed', edibles: 'Edibles', vapes: 'Vapes', joints: 'Joints', dabs: 'Dabs' }[cat] || cat;
}

const TAG_LABELS = {
  'tunnel':            'Tunnel',
  'indoor':            'Indoor',
  'exotic-greenhouse': 'Exotic GH',
  'greenhouse':        'Greenhouse',
  'outdoor':           'Outdoor'
};

const STRAIN_LABELS = {
  'sativa':        'Sativa',
  'indica':        'Indica',
  'hybrid':        'Hybrid',
  'sativa-hybrid': 'Sativa/Hybrid',
  'indica-hybrid': 'Indica/Hybrid'
};

function strainLabel(strain) {
  return STRAIN_LABELS[strain] || (strain ? strain.charAt(0).toUpperCase() + strain.slice(1) : '');
}

function renderTagBadges(tags) {
  if (!tags || typeof tags !== 'object') return '';
  return Object.keys(tags)
    .filter(k => tags[k])
    .map(k => `<span class="tag-badge tag-${esc(k)}">${esc(TAG_LABELS[k] || k)}</span>`)
    .join('');
}

/* ─── Toast ──────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ─── Icon Registry ──────────────────────────────────────── */

/**
 * Fetch icons/icons.json and cache the list in stockIcons.
 * To add a new icon: drop the PNG into stock/icons/ and add
 * a line to icons.json — no code changes needed.
 */
async function loadIcons() {
  try {
    const res  = await fetch('icons/icons.json');
    stockIcons = await res.json();
  } catch (err) {
    console.warn('Could not load icons.json, falling back to empty list', err);
    stockIcons = [];
  }
}

/**
 * Build (or rebuild) an icon picker inside `containerId`.
 * @param {string}      containerId  — 'iconPicker' or 'editIconPicker'
 * @param {boolean}     isEdit       — true = use data-edit-icon attr
 * @param {string|null} currentValue — icon id that should start selected
 */
function buildIconPicker(containerId, isEdit, currentValue) {
  const container = document.getElementById(containerId);
  const attr      = isEdit ? 'edit-icon' : 'icon';

  container.innerHTML = `
    <button type="button" class="icon-opt${!currentValue ? ' selected' : ''}"
            data-${attr}="none" aria-label="No icon">
      <span class="icon-none-label">None</span>
    </button>
    ${stockIcons.map(icon => `
    <button type="button" class="icon-opt${currentValue === icon.id ? ' selected' : ''}"
            data-${attr}="${esc(icon.id)}" aria-label="${esc(icon.label)} icon">
      <img src="icons/${esc(icon.file)}" alt="${esc(icon.label)}">
    </button>`).join('')}`;

  /* Single delegated listener — overwrite any previous one */
  container.onclick = e => {
    const btn = e.target.closest('.icon-opt');
    if (!btn) return;
    container.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const val = isEdit ? btn.dataset.editIcon : btn.dataset.icon;
    if (isEdit) {
      editSelectedIcon = (val === 'none') ? null : val;
    } else {
      selectedIcon = (val === 'none') ? null : val;
    }
  };
}

/* ─── Sale Animation ─────────────────────────────────────── */
let saleAnimTimers = [];

function spawnParticles(overlay, count, spread) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'sale-particle';
    const angle = (i / count) * 360 + Math.random() * (360 / count);
    const dist  = (spread || 110) + Math.random() * 80;
    const rad   = (angle * Math.PI) / 180;
    const tx    = Math.cos(rad) * dist;
    const ty    = Math.sin(rad) * dist;
    const size  = 5 + Math.random() * 8;
    const delay = Math.random() * 0.12;
    const dur   = 0.7 + Math.random() * 0.5;
    const hues  = ['#3ecf6e', '#22d3ee', '#facc15', '#f97316', '#a78bfa'];
    const hue   = hues[Math.floor(Math.random() * hues.length)];
    p.style.cssText =
      `width:${size}px;height:${size}px;background:${hue};` +
      `--p-to:translate(${tx}px,${ty}px);` +
      `animation-duration:${dur}s;animation-delay:${delay}s;`;
    overlay.appendChild(p);
  }
}

function dismissSaleAnim() {
  saleAnimTimers.forEach(t => clearTimeout(t));
  saleAnimTimers = [];
  const overlay = document.getElementById('saleAnim');
  overlay.classList.add('sale-anim-out');
  const t = setTimeout(() => {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlay.classList.remove('sale-anim-out');
    overlay.onclick = null;
  }, 350);
  saleAnimTimers.push(t);
}

/**
 * Play a game-like sequential animation for each item in the cart.
 * @param {Array<{item, qty}>} cartItems
 */
function playSaleAnimation(cartItems) {
  saleAnimTimers.forEach(t => clearTimeout(t));
  saleAnimTimers = [];

  const overlay = document.getElementById('saleAnim');
  overlay.hidden  = false;
  overlay.onclick = dismissSaleAnim;

  const grandTotal = cartItems.reduce((s, e) => s + e.qty * (e.item.price || 0), 0);
  const totalItems = cartItems.length;

  overlay.innerHTML = `
    <div class="sale-stage">
      <div class="sale-seq-header">
        <span class="sale-seq-sold-label">SOLD</span>
        <span class="sale-seq-counter" id="saleSeqCounter">1 / ${totalItems}</span>
      </div>
      <div class="sale-seq-slot" id="saleSeqSlot"></div>
      <div class="sale-seq-total-wrap" id="saleSeqTotalWrap" hidden>
        <div class="sale-seq-total-label">Grand Total</div>
        <div class="sale-seq-total-amount">${esc(fmt(grandTotal))}</div>
        ${totalItems > 1 ? `<div class="sale-seq-item-count">${totalItems} items</div>` : ''}
      </div>
      <div class="sale-seq-tap">Tap to dismiss</div>
    </div>`;

  function showItem(idx) {
    if (idx >= totalItems) {
      /* ── Grand total reveal ── */
      const counter = document.getElementById('saleSeqCounter');
      const slot    = document.getElementById('saleSeqSlot');
      const wrap    = document.getElementById('saleSeqTotalWrap');
      if (counter) counter.hidden = true;
      if (slot)    slot.hidden    = true;
      if (wrap)    wrap.hidden    = false;
      spawnParticles(overlay, 28, 160);
      const t = setTimeout(dismissSaleAnim, 2400);
      saleAnimTimers.push(t);
      return;
    }

    const counter = document.getElementById('saleSeqCounter');
    if (counter) counter.textContent = `${idx + 1} / ${totalItems}`;

    const entry     = cartItems[idx];
    const src       = iconSrc(entry.item.icon);
    const lineTotal = entry.qty * (entry.item.price || 0);
    const slot      = document.getElementById('saleSeqSlot');

    slot.innerHTML = `
      <div class="sale-seq-card sale-seq-card--in">
        <div class="sale-seq-icon-box">
          ${src
            ? `<img src="${esc(src)}" alt="${esc(entry.item.name)}">`
            : `<div class="sale-seq-icon-ph">📦</div>`}
        </div>
        <div class="sale-seq-info">
          <div class="sale-seq-name">${esc(entry.item.name)}</div>
          <div class="sale-seq-qty">${esc(fmtQty(entry.qty, entry.item.unit))} sold</div>
          ${lineTotal ? `<div class="sale-seq-price">${esc(fmt(lineTotal))}</div>` : ''}
        </div>
      </div>`;

    spawnParticles(overlay, 12, 100);

    const t1 = setTimeout(() => {
      const card = slot.querySelector('.sale-seq-card');
      if (card) {
        card.classList.remove('sale-seq-card--in');
        card.classList.add('sale-seq-card--out');
      }
      const t2 = setTimeout(() => showItem(idx + 1), 340);
      saleAnimTimers.push(t2);
    }, 1400);
    saleAnimTimers.push(t1);
  }

  showItem(0);
}

/* ─── Tab Navigation ─────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === name);
  });
  if (name === 'inventory') loadAndRenderStock();
  if (name === 'sell')      renderSellGrid();
  if (name === 'history')   loadAndRenderPurchases();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ─── Inventory: Load & Render ───────────────────────────── */
async function loadAndRenderStock() {
  const loader = document.getElementById('inventoryLoader');
  loader.hidden = false;
  try {
    allStock = await getAllStock();
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast('Failed to load stock', 'error');
  } finally {
    loader.hidden = true;
  }
}

function renderInventory() {
  const grid    = document.getElementById('stockGrid');
  const empty   = document.getElementById('inventoryEmpty');
  const summary = document.getElementById('summaryBar');

  let filtered = inventoryFilter === 'all'
    ? [...allStock]
    : allStock.filter(i => i.category === inventoryFilter);

  /* Name search */
  if (inventorySearch) {
    const q = inventorySearch;
    filtered = filtered.filter(i => i.name.toLowerCase().includes(q));
  }

  /* Status filter */
  if (filterStatus !== 'all') {
    filtered = filtered.filter(i => i.stockStatus === filterStatus);
  }

  /* Strain filter */
  if (filterStrain !== 'all') {
    filtered = filtered.filter(i => i.strain === filterStrain);
  }

  /* Tag filter */
  if (filterTag !== 'all') {
    filtered = filtered.filter(i => i.tags && i.tags[filterTag]);
  }

  /* Default sort: category -> strain -> name */
  const CAT_ORDER    = ['weed','joints','edibles','dabs','vapes'];
  const STRAIN_ORDER = ['sativa','sativa-hybrid','hybrid','indica-hybrid','indica'];
  filtered.sort((a, b) => {
    const ca = CAT_ORDER.indexOf(a.category);
    const cb = CAT_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
    const sa = STRAIN_ORDER.indexOf(a.strain);
    const sb = STRAIN_ORDER.indexOf(b.strain);
    if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    return (a.name || '').localeCompare(b.name || '');
  });

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.hidden   = false;
    summary.hidden = true;
    return;
  }

  empty.hidden   = true;
  summary.hidden = false;

  /* Summary counts by status */
  const inCount  = filtered.filter(i => i.stockStatus === 'in-stock').length;
  const lowCount = filtered.filter(i => i.stockStatus === 'low-stock').length;
  const outCount = filtered.filter(i => i.stockStatus === 'out-of-stock').length;
  document.getElementById('summaryCount').textContent = filtered.length;
  document.getElementById('summaryValue').textContent =
    `${inCount} in \u00b7 ${lowCount} low \u00b7 ${outCount} out`;

  const STATUS_LABEL = { 'in-stock': 'In Stock', 'low-stock': 'Low Stock', 'out-of-stock': 'Out of Stock' };

  grid.innerHTML = filtered.map(item => {
    const src    = iconSrc(item.icon);
    const status = item.stockStatus || 'in-stock';
    return `
      <div class="stock-card cat-${esc(item.category)}${item.hiddenFromMenu ? ' item-hidden-card' : ''}">
        <div class="card-icon-area">
          ${src
            ? `<img src="${esc(src)}" alt="${esc(item.name)}" class="card-icon-img">`
            : `<div class="card-icon-placeholder"></div>`}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="card-name">${esc(item.name)}</span>
            <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          </div>
          ${item.productCode ? `<div class="card-meta"><span class="product-code-badge">Code: ${esc(item.productCode)}</span></div>` : ''}
          ${item.strain ? `<div class="card-meta"><span class="strain-badge strain-${esc(item.strain)}">${esc(strainLabel(item.strain))}</span></div>` : ''}
          ${renderTagBadges(item.tags) ? `<div class="card-tags">${renderTagBadges(item.tags)}</div>` : ''}
          ${item.gramsInfo ? `<div class="card-meta"><span class="grams-label">${esc(item.gramsInfo)}g</span></div>` : ''}
          <div class="card-status-row">
            <span class="card-status-badge status-badge-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
            <div class="status-quick-btns">
              <button class="sqb sqb-in${status === 'in-stock' ? ' sqb-active' : ''}"
                data-status-id="${esc(item.id)}" data-status-val="in-stock"
                aria-label="Mark In Stock" title="In Stock">\u2705</button>
              <button class="sqb sqb-low${status === 'low-stock' ? ' sqb-active' : ''}"
                data-status-id="${esc(item.id)}" data-status-val="low-stock"
                aria-label="Mark Low Stock" title="Low Stock">\u26a0</button>
              <button class="sqb sqb-out${status === 'out-of-stock' ? ' sqb-active' : ''}"
                data-status-id="${esc(item.id)}" data-status-val="out-of-stock"
                aria-label="Mark Out of Stock" title="Out of Stock">\ud83d\udeab</button>
            </div>
          </div>
          ${item.price ? `<div class="card-price">${esc(fmt(item.price))}${item.unit ? ` / ${esc(item.unit)}` : ''}</div>` : ''}
          ${item.infoMessage ? `<div class="card-info-msg">${esc(item.infoMessage)}</div>` : ''}
          ${item.barcodeGenerated ? `<div class="card-meta"><span class="barcode-ready-badge">📊 Barcode Ready</span></div>` : ''}
          <div class="card-actions">
            <button class="stock-card-barcode-btn" data-barcode-id="${esc(item.id)}" title="Generate barcode">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              Barcode
            </button>
            <button class="card-btn btn-hide-toggle${item.hiddenFromMenu ? ' hidden' : ''}"
              data-id="${esc(item.id)}" title="${item.hiddenFromMenu ? 'Show on menu' : 'Hide from menu'}">
              ${item.hiddenFromMenu
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
            </button>
            <button class="card-btn btn-edit" data-id="${esc(item.id)}" aria-label="Edit item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="card-btn btn-del" data-id="${esc(item.id)}" data-name="${esc(item.name)}" aria-label="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  /* Bind buttons */
  grid.querySelectorAll('[data-status-id]').forEach(btn => {
    btn.addEventListener('click', () =>
      handleChangeStockStatus(btn.dataset.statusId, btn.dataset.statusVal)
    );
  });
  grid.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allStock.find(i => i.id === btn.dataset.id);
      if (item) openEditModal(item);
    });
  });
  grid.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteItem(btn.dataset.id, btn.dataset.name));
  });
  grid.querySelectorAll('.btn-hide-toggle').forEach(btn => {
    btn.addEventListener('click', () => handleToggleHidden(btn.dataset.id));
  });
  grid.querySelectorAll('.stock-card-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allStock.find(i => i.id === btn.dataset.barcodeId);
      if (item) openBarcodeModal(item);
    });
  });
}

/* ─── Inventory: Category Filter ────────────────────────── */
document.querySelectorAll('[data-cat]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    inventoryFilter = btn.dataset.cat;
    renderInventory();
  });
});
/* Search */
document.getElementById('stockSearch').addEventListener('input', e => {
  inventorySearch = e.target.value.trim().toLowerCase();
  renderInventory();
});

/* Low / Gram toggles removed — status is now used instead */

/* Status filter buttons */
document.querySelectorAll('[data-status]').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.status;
    filterStatus = filterStatus === val ? 'all' : val;
    document.querySelectorAll('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === filterStatus));
    renderInventory();
  });
});

/* Strain filter */
document.querySelectorAll('.strain-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.strain-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterStrain = btn.dataset.strain;
    renderInventory();
  });
});

/* Tag filter */
document.querySelectorAll('.tag-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tag-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterTag = btn.dataset.tag;
    renderInventory();
  });
});

/* Search clear button */
const _searchInput = document.getElementById('stockSearch');
const _searchClear = document.getElementById('searchClearBtn');
_searchInput.addEventListener('input', () => {
  _searchClear.hidden = _searchInput.value === '';
});
_searchClear.addEventListener('click', () => {
  _searchInput.value = '';
  _searchClear.hidden = true;
  inventorySearch = '';
  renderInventory();
});

/* (gramsInfoRow removed — gramsInfo is a standalone optional field) */

/* ─── Inventory: Change Stock Status ────────────────────── */
async function handleChangeStockStatus(id, status) {
  const item = allStock.find(i => i.id === id);
  if (!item) return;
  try {
    await setStockStatus(id, status);
    item.stockStatus = status;
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast('Failed to update status', 'error');
  }
}

/* ─── Inventory: Delete Item ─────────────────────────────── */
async function handleDeleteItem(id, name) {
  if (!confirm(`Delete "${name}" from stock? This cannot be undone.`)) return;
  try {
    await deleteStockItem(id);
    allStock = allStock.filter(i => i.id !== id);
    renderInventory();
    showToast(`"${name}" removed`);
  } catch (err) {
    console.error(err);
    showToast('Failed to delete item', 'error');
  }
}

/* ─── Inventory: Toggle Hidden ───────────────────────────── */
async function handleToggleHidden(id) {
  const item = allStock.find(i => i.id === id);
  if (!item) return;
  const newVal = !item.hiddenFromMenu;
  try {
    await setHiddenFromMenu(id, newVal);
    item.hiddenFromMenu = newVal;
    renderInventory();
    showToast(newVal ? 'Hidden from menu & sell' : 'Now visible on menu & sell');
  } catch (err) {
    console.error(err);
    showToast('Failed to update visibility', 'error');
  }
}

/* ─── Sales History: Reverse Sale ────────────────────────── */
async function handleReversePurchase(purchaseId) {
  const purchase = allPurchases.find(p => p.id === purchaseId);
  if (!purchase) return;
  const names = purchase.items.map(i => `"${i.itemName}"`).join(', ');
  const memberNote = purchase.memberId ? '\n• Reverse member purchase stats' : '';
  if (!confirm(`Reverse this purchase?\n\n${names}\n\nThis will:\n• Remove the purchase record${memberNote}`)) return;
  try {
    await reversePurchase(purchase);
    allPurchases = allPurchases.filter(p => p.id !== purchaseId);
    renderHistory();
    showToast('Purchase reversed');
  } catch (err) {
    console.error(err);
    showToast('Failed to reverse purchase', 'error');
  }
}

/* ─── Add Item Form ──────────────────────────────────────── */

document.getElementById('itemForm').addEventListener('submit', async e => {
  e.preventDefault();

  const nameVal = document.getElementById('itemName').value.trim();
  if (!nameVal) { showToast('Please enter an item name', 'error'); return; }

  const submitBtn = document.getElementById('itemSubmitBtn');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Saving…';

  const tagMap = {};
  document.querySelectorAll('input[name="tag"]:checked').forEach(cb => { tagMap[cb.value] = true; });

  const data = {
    name:        nameVal,
    category:    document.querySelector('input[name="category"]:checked').value,
    strain:      document.querySelector('input[name="strain"]:checked')?.value || null,
    stockStatus: document.querySelector('input[name="stockStatus"]:checked')?.value || 'in-stock',
    hasGrams:    document.getElementById('itemHasGrams').checked,
    gramsInfo:   document.getElementById('itemGramsInfo').value.trim() || null,
    price:       document.getElementById('itemPrice').value || 0,
    icon:        selectedIcon,
    tags:        tagMap,
    infoMessage: document.getElementById('itemInfoMessage').value.trim() || null
  };

  try {
    await addStockItem(data);
    showToast(`"${data.name}" added to stock`);
    document.getElementById('itemForm').reset();
    document.getElementById('itemHasGrams').checked = false;
    document.getElementById('itemGramsInfo').value = '';
    document.getElementById('itemInfoMessage').value = '';
    document.querySelectorAll('input[name="tag"]').forEach(cb => cb.checked = false);
    /* Reset stockStatus to default */
    const defStatus = document.querySelector('input[name="stockStatus"][value="in-stock"]');
    if (defStatus) defStatus.checked = true;
    /* Reset icon picker to 'None' */
    selectedIcon = null;
    buildIconPicker('iconPicker', false, null);
    /* Refresh and switch to inventory */
    allStock = await getAllStock();
    switchTab('inventory');
  } catch (err) {
    console.error(err);
    showToast('Failed to add item', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add to Stock`;
  }
});

/* ─── Edit Modal ─────────────────────────────────────────── */
function openEditModal(item) {
  document.getElementById('editName').value  = item.name;
  document.getElementById('editHasGrams').checked = item.unit === 'g';
  document.getElementById('editGramsInfo').value = item.gramsInfo || '';
  document.getElementById('editPrice').value = item.price || '';
  document.getElementById('editItemId').value = item.id;

  /* Stock status */
  const statusVal   = item.stockStatus || 'in-stock';
  const statusRadio = document.querySelector(`input[name="editStockStatus"][value="${statusVal}"]`);
  if (statusRadio) statusRadio.checked = true;

  /* Category */
  const catRadio = document.querySelector(`input[name="editCategory"][value="${item.category}"]`);
  if (catRadio) catRadio.checked = true;

  /* Strain */
  const strainVal   = item.strain || '';
  const strainRadio = document.querySelector(`input[name="editStrain"][value="${strainVal}"]`);
  if (strainRadio) strainRadio.checked = true;

  /* Tags */
  const tags = item.tags || {};
  document.querySelectorAll('input[name="editTag"]').forEach(cb => {
    cb.checked = !!tags[cb.value];
  });

  /* Icon */
  editSelectedIcon = item.icon || null;
  buildIconPicker('editIconPicker', true, editSelectedIcon);

  /* Info message & stock status */
  document.getElementById('editInfoMessage').value = item.infoMessage || '';

  document.getElementById('editModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  document.getElementById('editModal').hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
document.getElementById('editModal').addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeEditModal();
});

/* Edit icon picker is built dynamically in openEditModal via buildIconPicker() */

document.getElementById('editForm').addEventListener('submit', async e => {
  e.preventDefault();

  const id   = document.getElementById('editItemId').value;
  const editTagMap = {};
  document.querySelectorAll('input[name="editTag"]:checked').forEach(cb => { editTagMap[cb.value] = true; });
  const data = {
    name:        document.getElementById('editName').value.trim(),
    category:    document.querySelector('input[name="editCategory"]:checked').value,
    strain:      document.querySelector('input[name="editStrain"]:checked')?.value || null,
    stockStatus: document.querySelector('input[name="editStockStatus"]:checked')?.value || 'in-stock',
    hasGrams:    document.getElementById('editHasGrams').checked,
    gramsInfo:   document.getElementById('editGramsInfo').value.trim() || null,
    price:       Number(document.getElementById('editPrice').value) || 0,
    icon:        editSelectedIcon,
    tags:        editTagMap,
    infoMessage: document.getElementById('editInfoMessage').value.trim() || null
  };

  if (!data.name) { showToast('Please enter an item name', 'error'); return; }

  const submitBtn = document.getElementById('editSubmitBtn');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Saving…';

  try {
    await updateStockItem(id, data);
    closeEditModal();
    showToast('Item updated');
    allStock = await getAllStock();
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast('Failed to save changes', 'error');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Save Changes';
  }
});

/* ─── Sell Tab ───────────────────────────────────────────── */
function renderSellGrid() {
  const grid  = document.getElementById('sellItemGrid');
  const empty = document.getElementById('sellEmpty');

  if (allStock.length === 0) {
    grid.innerHTML = '';
    empty.hidden   = false;
    empty.innerHTML = `<div class="empty-icon">🛒</div>
      <p class="empty-title">No items in stock</p>
      <p class="empty-sub">Add stock items first</p>`;
    return;
  }

  /* Out-of-stock and hidden items never appear in sell grid */
  let filtered = (sellFilter === 'all'
    ? [...allStock]
    : allStock.filter(i => i.category === sellFilter)
  ).filter(i => !i.hiddenFromMenu && i.stockStatus !== 'out-of-stock');

  /* Name search */
  if (sellSearch) {
    filtered = filtered.filter(i => i.name.toLowerCase().includes(sellSearch));
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-icon">🔍</div>
      <p class="empty-title">No results</p>
      <p class="empty-sub">Try a different search or category</p>`;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = filtered.map(item => {
    const src       = iconSrc(item.icon);
    const isLow     = item.stockStatus === 'low-stock';
    const cartEntry = cart.find(c => c.item.id === item.id);

    return `
      <div class="stock-card sell-card cat-${esc(item.category)}"
           data-sell-id="${esc(item.id)}"
           role="button" tabindex="0"
           aria-label="${esc(item.name)}">
        ${cartEntry ? `<div class="sell-cart-badge">${esc(fmtQty(cartEntry.qty, item.unit))} in cart</div>` : ''}
        <div class="card-icon-area">
          ${src
            ? `<img src="${esc(src)}" alt="${esc(item.name)}" class="card-icon-img">`
            : `<div class="card-icon-placeholder"></div>`}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="card-name">${esc(item.name)}</span>
            <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          </div>
          ${item.strain ? `<div class="card-meta"><span class="strain-badge strain-${esc(item.strain)}">${esc(strainLabel(item.strain))}</span></div>` : ''}
          ${renderTagBadges(item.tags) ? `<div class="card-tags">${renderTagBadges(item.tags)}</div>` : ''}
          ${item.gramsInfo ? `<div class="card-meta"><span class="grams-label">${esc(item.gramsInfo)}g</span></div>` : ''}
          ${isLow ? '<div class="sell-low-badge">⚠ Low Stock</div>' : ''}
          ${item.price ? `<div class="card-price">${esc(fmt(item.price))}${item.unit ? ` / ${esc(item.unit)}` : ''}</div>` : ''}
          <div class="sell-tap-hint">Tap to add to cart</div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.sell-card').forEach(card => {
    const activate = () => {
      const item = allStock.find(i => i.id === card.dataset.sellId);
      if (item) openAddToCartModal(item);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });
}

/* Sell: category filter */
document.querySelectorAll('[data-sell-cat]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sell-cat]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sellFilter = btn.dataset.sellCat;
    renderSellGrid();
  });
});

/* Sell: search bar */
document.getElementById('sellSearchInput').addEventListener('input', e => {
  sellSearch = e.target.value.trim().toLowerCase();
  document.getElementById('sellSearchClearBtn').hidden = !e.target.value;
  renderSellGrid();
});
document.getElementById('sellSearchClearBtn').addEventListener('click', () => {
  document.getElementById('sellSearchInput').value = '';
  document.getElementById('sellSearchClearBtn').hidden = true;
  sellSearch = '';
  renderSellGrid();
});

/* ─── Cart System ────────────────────────────────────────── */

function openAddToCartModal(item) {
  selectedSellItem = item;
  const src = iconSrc(item.icon);
  document.getElementById('atcItemPreview').innerHTML = `
    <div class="selected-item-card">
      ${src ? `<img src="${esc(src)}" class="selected-item-icon" alt="">` : ''}
      <div>
        <div class="selected-item-name">${esc(item.name)}</div>
        <div class="selected-item-meta">
          <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          ${item.strain ? `<span class="strain-badge strain-${esc(item.strain)}">${esc(strainLabel(item.strain))}</span>` : ''}
          ${renderTagBadges(item.tags)}
          ${item.stockStatus === 'low-stock' ? '<span class="sell-low-badge">⚠ Low Stock</span>' : ''}
          ${item.price ? `<span>${esc(fmt(item.price))}${item.unit ? ` / ${esc(item.unit)}` : ''}</span>` : ''}
        </div>
      </div>
    </div>`;
  document.getElementById('atcQty').value = '';
  document.getElementById('atcNote').value = '';
  document.getElementById('atcTotalPreview').textContent = 'R\u202f0.00';
  document.getElementById('addToCartModal').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('atcQty').focus(), 80);
}

function closeAddToCartModal() {
  document.getElementById('addToCartModal').hidden = true;
  document.body.style.overflow = '';
  selectedSellItem = null;
}

document.getElementById('atcCancelBtn').addEventListener('click', closeAddToCartModal);
document.getElementById('addToCartModal').addEventListener('click', e => {
  if (e.target === document.getElementById('addToCartModal')) closeAddToCartModal();
});

document.getElementById('atcQty').addEventListener('input', () => {
  if (!selectedSellItem) return;
  const qty   = parseFloat(document.getElementById('atcQty').value) || 0;
  document.getElementById('atcTotalPreview').textContent = fmt(qty * (selectedSellItem.price || 0));
});

document.getElementById('atcForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!selectedSellItem) return;
  const qty = parseFloat(document.getElementById('atcQty').value);
  if (!qty || qty <= 0) { showToast('Enter a valid quantity', 'error'); return; }

  const existing = cart.find(c => c.item.id === selectedSellItem.id);
  if (existing) {
    existing.qty = +(existing.qty + qty).toFixed(2);
    if (document.getElementById('atcNote').value.trim()) {
      existing.note = document.getElementById('atcNote').value.trim();
    }
  } else {
    cart.push({
      item: { ...selectedSellItem },
      qty,
      note: document.getElementById('atcNote').value.trim()
    });
  }

  const itemName = selectedSellItem.name;
  updateCartBar();
  renderSellGrid();
  closeAddToCartModal();
  showToast(`${itemName} added to cart`);
});

/* ─── Cart Bar ───────────────────────────────────────────── */

function updateCartBar() {
  const bar = document.getElementById('cartBar');
  if (cart.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  const totalItems  = cart.reduce((s, c) => s + c.qty, 0);
  const totalAmount = cart.reduce((s, c) => s + c.qty * (c.item.price || 0), 0);
  document.getElementById('cartBarCount').textContent =
    `${cart.length} item${cart.length !== 1 ? 's' : ''} · ${fmtQty(totalItems, '')}`;
  document.getElementById('cartBarTotal').textContent = fmt(totalAmount);
}

document.getElementById('cartBarBtn').addEventListener('click', openCartModal);

/* ─── Cart Modal ─────────────────────────────────────────── */

function openCartModal() {
  renderCartModal();
  document.getElementById('cartModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeCartModal() {
  document.getElementById('cartModal').hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('closeCartBtn').addEventListener('click', closeCartModal);
document.getElementById('cartModal').addEventListener('click', e => {
  if (e.target === document.getElementById('cartModal')) closeCartModal();
});

function renderCartModal() {
  const listEl = document.getElementById('cartItems');
  const grandTotal = cart.reduce((s, c) => s + c.qty * (c.item.price || 0), 0);
  document.getElementById('cartGrandTotal').textContent = fmt(grandTotal);

  /* Show/hide member-required banner */
  const hasWeed = cart.some(e => e.item.category === 'weed');
  const memberBanner = document.getElementById('cartMemberRequiredBanner');
  if (memberBanner) memberBanner.hidden = !(hasWeed && !selectedMember);

  /* Update member label to reflect requirement */
  const memberLabel = document.querySelector('.cart-member-wrap .form-label');
  if (memberLabel) {
    if (hasWeed) {
      memberLabel.innerHTML = 'Link to Member <span class="member-required-badge">Required for weed</span>';
    } else {
      memberLabel.innerHTML = 'Link to Member <span class="form-optional">(optional)</span>';
    }
  }

  if (cart.length === 0) {
    listEl.innerHTML = '<div class="cart-empty-msg">Your cart is empty</div>';
    return;
  }

  listEl.innerHTML = cart.map((entry, idx) => {
    const lineTotal = entry.qty * (entry.item.price || 0);
    const src       = iconSrc(entry.item.icon);
    const step      = entry.item.unit === 'g' ? 0.5 : 1;
    return `
      <div class="cart-item">
        ${src
          ? `<img src="${esc(src)}" class="cart-item-icon" alt="">`
          : `<div class="cart-item-icon-placeholder"></div>`}
        <div class="cart-item-body">
          <div class="cart-item-name">${esc(entry.item.name)}</div>
          <div class="cart-item-meta">
            <span class="cat-badge cat-${esc(entry.item.category)}">${esc(catLabel(entry.item.category))}</span>
            ${entry.item.price ? `<span>${esc(fmtQty(entry.qty, entry.item.unit))} × ${esc(fmt(entry.item.price))} = <strong>${esc(fmt(lineTotal))}</strong></span>` : `<span>${esc(fmtQty(entry.qty, entry.item.unit))}</span>`}
          </div>
          ${entry.note ? `<div class="cart-item-note">"${esc(entry.note)}"</div>` : ''}
        </div>
        <div class="cart-item-actions">
          <button class="cart-qty-btn" data-ci-minus="${idx}" aria-label="Decrease" ${entry.qty <= step ? 'disabled' : ''}>−</button>
          <span class="cart-qty-num">${esc(String(entry.qty % 1 === 0 ? entry.qty : entry.qty.toFixed(2)))}</span>
          <button class="cart-qty-btn" data-ci-plus="${idx}" aria-label="Increase">+</button>
          <button class="cart-remove-btn" data-ci-remove="${idx}" aria-label="Remove item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');

  /* Bind buttons */
  listEl.querySelectorAll('[data-ci-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      cart.splice(Number(btn.dataset.ciRemove), 1);
      updateCartBar(); renderCartModal(); renderSellGrid();
    });
  });
  listEl.querySelectorAll('[data-ci-minus]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = cart[Number(btn.dataset.ciMinus)];
      if (!entry) return;
      const step = entry.item.unit === 'g' ? 0.5 : 1;
      entry.qty  = Math.max(step, +(entry.qty - step).toFixed(2));
      updateCartBar(); renderCartModal(); renderSellGrid();
    });
  });
  listEl.querySelectorAll('[data-ci-plus]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = cart[Number(btn.dataset.ciPlus)];
      if (!entry) return;
      const step   = entry.item.unit === 'g' ? 0.5 : 1;
      entry.qty = +(entry.qty + step).toFixed(2);
      updateCartBar(); renderCartModal(); renderSellGrid();
    });
  });
}

document.getElementById('clearCartBtn').addEventListener('click', () => {
  if (!confirm('Clear all items from cart?')) return;
  cart = [];
  clearCartMember();
  document.getElementById('cartMemberSearch').value = '';
  updateCartBar(); renderCartModal(); renderSellGrid();
  closeCartModal();
});

document.getElementById('recordAllSalesBtn').addEventListener('click', async () => {
  if (cart.length === 0) { showToast('Cart is empty', 'error'); return; }
  /* Weed requires a linked member */
  const hasWeed = cart.some(e => e.item.category === 'weed');
  if (hasWeed && !selectedMember) {
    showToast('❌ Weed requires a member card — Scan member card to continue', 'error');
    return;
  }
  /* Animate first so feedback is instant */
  const cartSnapshot = [...cart];
  playSaleAnimation(cartSnapshot);

  const btn = document.getElementById('recordAllSalesBtn');
  btn.disabled    = true;
  btn.textContent = 'Recording...';
  try {
    const grandTotal = cart.reduce((s, e) => s + e.qty * (e.item.price || 0), 0);
    const purchaseData = {
      items: cart.map(entry => ({
        itemId:       entry.item.id,
        itemName:     entry.item.name,
        category:     entry.item.category,
        quantity:     entry.qty,
        unit:         entry.item.unit || '',
        pricePerUnit: entry.item.price || 0,
        total:        +(entry.qty * (entry.item.price || 0)).toFixed(2),
        note:         entry.note || ''
      })),
      grandTotal:   +grandTotal.toFixed(2),
      memberId:     selectedMember ? selectedMember.id           : null,
      memberNumber: selectedMember ? selectedMember.memberNumber : null,
      memberName:   selectedMember ? selectedMember.memberName   : null
    };
    await recordPurchase(purchaseData);
    showToast(`Purchase recorded — ${cart.length} item${cart.length !== 1 ? 's' : ''}!`);
    cart = [];
    clearCartMember();
    document.getElementById('cartMemberSearch').value = '';
    updateCartBar();
    closeCartModal();
    renderSellGrid();
  } catch (err) {
    console.error(err);
    showToast('Failed to record purchase', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/></svg> Record All Sales`;
  }
});

/* ─── Cart Member Search ─────────────────────────────────── */
let cartMemberTimer = null;

function clearCartMember() {
  selectedMember = null;
  document.getElementById('cartSelectedMemberChip').hidden = true;
  document.getElementById('cartSelectedMemberLabel').textContent = '';
}

function selectCartMember(member) {
  selectedMember = member;
  document.getElementById('cartMemberSearch').value = '';
  document.getElementById('cartMemberResults').hidden = true;
  document.getElementById('cartSelectedMemberLabel').textContent =
    `${member.memberNumber} — ${member.memberName} (${member.phoneNumber})`;
  document.getElementById('cartSelectedMemberChip').hidden = false;
}

document.getElementById('cartClearMemberBtn').addEventListener('click', clearCartMember);

document.getElementById('scanMemberCardBtn').addEventListener('click', openMemberScanner);

document.getElementById('cartMemberSearch').addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(cartMemberTimer);
  if (q.length < 2) { document.getElementById('cartMemberResults').hidden = true; return; }
  cartMemberTimer = setTimeout(async () => {
    const results = await searchMembers(q);
    const box = document.getElementById('cartMemberResults');
    if (!results.length) {
      box.innerHTML = '<div class="member-result-empty">No members found</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = results.map(m => `
      <button type="button" class="member-result-row" data-mid="${esc(m.id)}">
        <span class="mr-number">${esc(m.memberNumber)}</span>
        <span class="mr-name">${esc(m.memberName)}</span>
        <span class="mr-phone">${esc(m.phoneNumber)}</span>
      </button>`).join('');
    box.hidden = false;
    box.querySelectorAll('.member-result-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const found = results.find(m => m.id === btn.dataset.mid);
        if (found) selectCartMember(found);
      });
    });
  }, 280);
});

/* ─── Purchase History ─────────────────────────────────────── */
async function loadAndRenderPurchases() {
  const loader = document.getElementById('historyLoader');
  loader.hidden = false;
  try {
    allPurchases = await getAllPurchases();
    renderHistory();
  } catch (err) {
    console.error(err);
    showToast('Failed to load history', 'error');
  } finally {
    loader.hidden = true;
  }
}

function renderHistory() {
  const listEl    = document.getElementById('salesList');
  const emptyEl   = document.getElementById('historyEmpty');
  const summaryEl = document.getElementById('salesSummary');

  if (allPurchases.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden   = false;
    summaryEl.hidden = true;
    return;
  }

  emptyEl.hidden   = true;
  summaryEl.hidden = false;

  const totalRevenue = allPurchases.reduce((s, p) => s + p.grandTotal, 0);
  document.getElementById('salesTotalCount').textContent   = allPurchases.length;
  document.getElementById('salesTotalRevenue').textContent = fmt(totalRevenue);

  listEl.innerHTML = allPurchases.map(purchase => {
    const itemLines = purchase.items.map(item => {
      const qty = fmtQty(item.quantity, item.unit);
      const piTotal = item.pricePerUnit
        ? `<span class="pi-total">${esc(fmt(item.total))}</span>`
        : '';
      const piNote = item.note
        ? `<span class="pi-note">"${esc(item.note)}"</span>`
        : '';
      return `
        <div class="purchase-item-line">
          <span class="pi-name">${esc(item.itemName)}</span>
          <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          <span class="pi-qty">${esc(qty)}</span>
          ${piTotal}${piNote}
        </div>`;
    }).join('');

    const memberHtml = purchase.memberNumber
      ? `<div class="sale-member"><span class="sale-member-badge">${esc(purchase.memberNumber)}</span> ${esc(purchase.memberName || '')}</div>`
      : '';

    return `
    <div class="sale-row purchase-row">
      <div class="sale-info">
        <div class="purchase-items">${itemLines}</div>
        ${memberHtml}
        <div class="purchase-footer">
          <span class="sale-total">Total: ${esc(fmt(purchase.grandTotal))}</span>
          <span class="sale-date">${esc(fmtDate(purchase.soldAt))}</span>
        </div>
      </div>
      <button class="sale-reverse-btn" data-purchase-id="${esc(purchase.id)}"
              aria-label="Reverse purchase" title="Undo this purchase">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-3.67"/>
        </svg>
      </button>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.sale-reverse-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReversePurchase(btn.dataset.purchaseId));
  });
}

/* ─── Barcode Generation ───────────────────────────────────── */

let currentBarcodeItem = null;

function openBarcodeModal(item) {
  currentBarcodeItem = item;
  
  // Check if item has a product code
  if (!item.productCode) {
    showToast('⚠️ This item doesn\'t have a product code. Please re-add it to generate one.', 'error');
    return;
  }
  
  const modal = document.getElementById('barcodeModal');
  const canvas = document.getElementById('barcodeCanvas');
  const itemNameEl = document.getElementById('barcodeItemName');
  const itemIdEl = document.getElementById('barcodeItemId');

  itemNameEl.textContent = item.name;
  itemIdEl.textContent = `Product Code: ${item.productCode}`;

  // Generate barcode using product code (6 digits)
  const success = BarcodeUtils.generateBarcode(item.productCode, canvas, {
    height: 80,
    width: 2,
    displayValue: true,
    fontSize: 14
  });

  if (success) {
    modal.hidden = false;
    setTimeout(() => modal.classList.add('active'), 10);
  } else {
    showToast('Failed to generate barcode', 'error');
  }
}

function closeBarcodeModal() {
  const modal = document.getElementById('barcodeModal');
  modal.classList.remove('active');
  setTimeout(() => {
    modal.hidden = true;
    currentBarcodeItem = null;
  }, 250);
}

function downloadCurrentBarcode() {
  if (!currentBarcodeItem) return;

  const sanitizedName = currentBarcodeItem.name.replace(/[^a-z0-9]/gi, '_');
  const filename = `barcode_${sanitizedName}_${currentBarcodeItem.productCode}.png`;

  BarcodeUtils.downloadBarcode(currentBarcodeItem.productCode, filename, {
    height: 80,
    width: 2,
    displayValue: true,
    fontSize: 14
  });

  // Update Firebase to mark barcode as generated
  updateBarcodeTimestamp(currentBarcodeItem.id).catch(err => {
    console.error('Failed to update barcode timestamp:', err);
  });

  showToast('Barcode downloaded successfully', 'success');
  closeBarcodeModal();
  
  // Refresh stock to show barcode badge
  setTimeout(() => renderInventory(), 500);
}

// Barcode modal event listeners
document.getElementById('closeBarcodeModal').addEventListener('click', closeBarcodeModal);
document.getElementById('downloadBarcodeBtn').addEventListener('click', downloadCurrentBarcode);
document.getElementById('barcodeModal').addEventListener('click', e => {
  if (e.target.id === 'barcodeModal') closeBarcodeModal();
});

/* ─── Barcode Scanner ───────────────────────────────────────── */

let isScannerOpen = false;

async function openScanner() {
  if (isScannerOpen) return;

  const modal = document.getElementById('scannerModal');
  const readerEl = document.getElementById('scannerReader');
  const statusEl = document.getElementById('scannerStatus');

  // Check camera availability
  const hasCamera = await BarcodeScanner.isCameraAvailable();
  if (!hasCamera) {
    showToast('No camera available', 'error');
    return;
  }

  modal.hidden = false;
  setTimeout(() => modal.classList.add('active'), 10);
  isScannerOpen = true;

  statusEl.textContent = 'Starting camera...';

  try {
    await BarcodeScanner.startScanner(
      readerEl,
      handleBarcodeScanned,
      (error) => {
        console.error('Scanner error:', error);
        statusEl.textContent = 'Error: ' + error.message;
      }
    );
    statusEl.textContent = 'Position barcode within the frame';
  } catch (error) {
    console.error('Failed to start scanner:', error);
    showToast('Failed to access camera', 'error');
    closeScanner();
  }
}

async function closeScanner() {
  if (!isScannerOpen) return;

  await BarcodeScanner.stopScanner();
  
  const modal = document.getElementById('scannerModal');
  modal.classList.remove('active');
  setTimeout(() => {
    modal.hidden = true;
    document.getElementById('scannerReader').innerHTML = '';
  }, 250);

  isScannerOpen = false;
}

async function handleBarcodeScanned(decodedText) {
  console.log('Barcode scanned:', decodedText);
  
  // Check if this looks like a member auth key (5 digits)
  if (/^\d{5}$/.test(decodedText)) {
    showToast('⚠️ This is a member card! Use "Scan Member Card" in the cart instead', 'error');
    return;
  }
  
  // Check if this looks like a product code (6 digits)
  if (!/^\d{6}$/.test(decodedText)) {
    showToast('❌ Invalid barcode format. Product codes should be 6 digits.', 'error');
    return;
  }
  
  // Find item by product code
  const item = await findItemByProductCode(decodedText);
  
  if (item) {
    // Check if item is available for sale
    if (item.stockStatus === 'out-of-stock' || item.hiddenFromMenu) {
      showToast(`${item.name} is not available`, 'error');
      return;
    }

    // Auto-add 1 item to cart without prompting
    const existing = cart.find(c => c.item.id === item.id);
    if (existing) {
      const step = item.unit === 'g' ? 0.5 : 1;
      existing.qty = +(existing.qty + step).toFixed(2);
    } else {
      cart.push({
        item: { ...item },
        qty: item.unit === 'g' ? 0.5 : 1,
        note: ''
      });
    }

    updateCartBar();
    renderSellGrid();
    
    // Show success message with pause
    showToast(`✓ ${item.name} added to cart`, 'success');
    
    // Pause briefly then resume scanning
    await new Promise(resolve => setTimeout(resolve, 1200));
  } else {
    showToast('❌ Item not found. Make sure you generated a barcode for this item first.', 'error');
  }
}

// Scanner event listeners
document.getElementById('openScannerBtn').addEventListener('click', openScanner);
document.getElementById('closeScannerBtn').addEventListener('click', closeScanner);
document.getElementById('scannerModal').addEventListener('click', e => {
  if (e.target.id === 'scannerModal') closeScanner();
});

/* ─── Member Barcode Scanner (in Cart) ───────────────────────── */

async function openMemberScanner() {
  if (isScannerOpen) return;

  const modal = document.getElementById('scannerModal');
  const readerEl = document.getElementById('scannerReader');
  const statusEl = document.getElementById('scannerStatus');
  const titleEl = document.getElementById('scannerModalTitle');

  // Temporarily change title
  const originalTitle = titleEl.innerHTML;
  titleEl.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
    Scan Member Card
  `;

  const hasCamera = await BarcodeScanner.isCameraAvailable();
  if (!hasCamera) {
    showToast('No camera available', 'error');
    titleEl.innerHTML = originalTitle;
    return;
  }

  modal.hidden = false;
  setTimeout(() => modal.classList.add('active'), 10);
  isScannerOpen = true;

  statusEl.textContent = 'Starting camera...';

  try {
    await BarcodeScanner.startScanner(
      readerEl,
      async (decodedText) => {
        console.log('Member barcode scanned:', decodedText);
        
        // Show progress indicator
        statusEl.textContent = '🔍 Looking up member...';
        showToast('🔍 Looking up member...', 'info');
        
        // Find member by auth key
        const member = await findMemberByAuthKey(decodedText);
        
        if (member) {
          selectedMember = member;
          selectCartMember(member);
          showToast(`✓ Member linked: ${member.memberName}`, 'success');
          await closeScanner();
          titleEl.innerHTML = originalTitle;
        } else {
          showToast('❌ Member not found - Try scanning again', 'error');
          statusEl.textContent = 'Ready to scan member card';
        }
      },
      (error) => {
        console.error('Scanner error:', error);
        statusEl.textContent = 'Error: ' + error.message;
      }
    );
    statusEl.textContent = 'Position member card barcode within the frame';
  } catch (error) {
    console.error('Failed to start scanner:', error);
    showToast('Failed to access camera', 'error');
    await closeScanner();
    titleEl.innerHTML = originalTitle;
  }
}

/* ─── Init ───────────────────────────────────────────────── */

/**
 * Preload all icon images into the browser's image cache.
 * Resolves when every image has either loaded or errored —
 * so it never blocks the UI indefinitely.
 */
function preloadImages(icons) {
  return Promise.all(
    icons.map(icon => new Promise(resolve => {
      const img    = new Image();
      img.onload   = resolve;
      img.onerror  = resolve; /* don't stall on a missing file */
      img.src      = `icons/${icon.file}`;
    }))
  );
}

(async () => {
  const loaderEl   = document.getElementById('appLoader');
  const barFill    = document.getElementById('loaderBarFill');
  const statusEl   = document.getElementById('loaderStatus');

  function setProgress(pct, label) {
    barFill.style.width = `${pct}%`;
    if (label) statusEl.textContent = label;
  }

  setProgress(8, 'Loading icons…');
  await loadIcons();

  setProgress(35, 'Building UI…');
  buildIconPicker('iconPicker', false, null);

  setProgress(55, 'Caching images…');
  await preloadImages(stockIcons);

  setProgress(75, 'Loading stock…');
  await loadAndRenderStock();

  setProgress(100, 'Ready');

  /* Small pause so the bar visibly hits 100% before fading */
  await new Promise(r => setTimeout(r, 220));

  loaderEl.classList.add('done');
  /* Remove from DOM after fade completes so it can't block touches */
  loaderEl.addEventListener('transitionend', () => { loaderEl.hidden = true; }, { once: true });
})();
