/* ============================================================
   firebase.js — Budologist Stock App
   Uses the SAME Firebase Realtime Database as the main app.
   Firebase Compat SDK loaded via CDN in index.html.
   ============================================================ */

const _firebaseConfig = {
  apiKey:            "AIzaSyCW625XFVSBubJXeg7TOgjiiCNVg9ESipc",
  authDomain:        "budmemberapp.firebaseapp.com",
  databaseURL:       "https://budmemberapp-default-rtdb.firebaseio.com",
  projectId:         "budmemberapp",
  storageBucket:     "budmemberapp.firebasestorage.app",
  messagingSenderId: "269040218229",
  appId:             "1:269040218229:web:3ca449a0b0dd1801ce083c"
};

firebase.initializeApp(_firebaseConfig);
const db = firebase.database();

/* ============================================================
   STOCK CRUD
   /stock/{itemId}
   ============================================================ */

async function addStockItem(data) {
  const ref = await db.ref('stock').push({
    name:        data.name.trim(),
    category:    data.category,
    stockStatus: data.stockStatus || 'in-stock',
    unit:        data.hasGrams ? 'g' : '',
    gramsInfo:   data.gramsInfo   || null,
    price:       Number(data.price) || 0,
    icon:        data.icon          || null,
    strain:      data.strain        || null,
    tags:        data.tags          || {},
    infoMessage: data.infoMessage   || null,
    createdAt:   firebase.database.ServerValue.TIMESTAMP,
    updatedAt:   firebase.database.ServerValue.TIMESTAMP
  });
  return ref.key;
}

async function getAllStock() {
  const snap = await db.ref('stock').orderByChild('createdAt').once('value');
  const items = [];
  snap.forEach(child => {
    const d = child.val();
    /* Backward-compat: derive stockStatus from legacy quantity/soldOut fields */
    let stockStatus = d.stockStatus || null;
    if (!stockStatus) {
      if (d.soldOut)                              stockStatus = 'out-of-stock';
      else if ((d.quantity ?? 0) <= 0)            stockStatus = 'out-of-stock';
      else if ((d.quantity ?? 0) <= 5)            stockStatus = 'low-stock';
      else                                        stockStatus = 'in-stock';
    }
    items.push({
      id:             child.key,
      name:           d.name          || '',
      category:       d.category      || 'weed',
      stockStatus,
      unit:           d.unit          || '',
      gramsInfo:      d.gramsInfo     || null,
      price:          d.price         || 0,
      icon:           d.icon          || null,
      strain:         d.strain        || null,
      tags:           d.tags          || {},
      hiddenFromMenu: d.hiddenFromMenu || false,
      infoMessage:    d.infoMessage   || null,
      createdAt:      d.createdAt     || 0
    });
  });
  return items.reverse(); /* newest first */
}

async function updateStockItem(id, data) {
  await db.ref('stock').child(id).update({
    name:        data.name.trim(),
    category:    data.category,
    stockStatus: data.stockStatus || 'in-stock',
    unit:        data.hasGrams ? 'g' : '',
    gramsInfo:   data.gramsInfo   || null,
    price:       Number(data.price) || 0,
    icon:        data.icon          || null,
    strain:      data.strain        || null,
    tags:        data.tags          || {},
    infoMessage: data.infoMessage   || null,
    updatedAt:   firebase.database.ServerValue.TIMESTAMP
  });
}

/**
 * Directly update only the stockStatus of a product.
 * Used by the inline status picker in the inventory grid.
 */
async function setStockStatus(id, status) {
  await db.ref('stock').child(id).update({
    stockStatus: status,
    updatedAt:   firebase.database.ServerValue.TIMESTAMP
  });
}

async function deleteStockItem(id) {
  await db.ref('stock').child(id).remove();
}



/* ============================================================
   SALES
   /sales/{saleId}
   ============================================================ */

/**
 * Search members by name, member number, or phone number.
 * Returns up to 10 matches from the local members list.
 */
async function searchMembers(query) {
  if (!query || query.trim().length < 2) return [];
  const snap = await db.ref('members').once('value');
  const q    = query.trim().toLowerCase();
  const results = [];
  snap.forEach(child => {
    const d = child.val();
    if (
      (d.memberName   || '').toLowerCase().includes(q) ||
      (d.memberNumber || '').toLowerCase().includes(q) ||
      (d.phoneNumber  || '').toLowerCase().includes(q)
    ) {
      results.push({
        id:           child.key,
        memberNumber: d.memberNumber || '',
        memberName:   d.memberName   || '',
        phoneNumber:  d.phoneNumber  || '',
        membershipType: d.membershipType || ''
      });
    }
    if (results.length >= 10) return true; /* stop iterating */
  });
  return results;
}

/**
 * Record a sale and link it to a member if provided.
 * Stock quantity is NOT auto-deducted — it is managed manually
 * via the product system to reflect in-stock / low-stock on the menu.
 * If saleData.memberId is provided, also increments the member's
 * totalSpent and purchaseCount fields.
 */
async function recordSale(saleData) {
  /* Write sale record */
  const ref = await db.ref('sales').push({
    itemId:       saleData.itemId,
    itemName:     saleData.itemName,
    category:     saleData.category,
    quantity:     saleData.quantity,
    unit:         saleData.unit,
    pricePerUnit: saleData.pricePerUnit,
    total:        saleData.total,
    note:         saleData.note || '',
    memberId:     saleData.memberId     || null,
    memberNumber: saleData.memberNumber || null,
    memberName:   saleData.memberName   || null,
    soldAt:       firebase.database.ServerValue.TIMESTAMP
  });

  /* If a member is linked, atomically update their purchase stats */
  if (saleData.memberId) {
    await db.ref('members').child(saleData.memberId).transaction(member => {
      if (!member) return member;
      member.totalSpent    = (member.totalSpent    || 0) + saleData.total;
      member.purchaseCount = (member.purchaseCount || 0) + 1;
      return member;
    });
  }

  return ref.key;
}

/* ============================================================
   PURCHASES  (one record per cart checkout, replaces per-item sales)
   /purchases/{purchaseId}
   ============================================================ */

/**
 * Record a single purchase that bundles the entire cart.
 * data.items  = [{ itemId, itemName, category, quantity, unit, pricePerUnit, total, note }]
 * If data.memberId is set, totalSpent (+grandTotal) and purchaseCount (+1)
 * are atomically updated on the member.
 */
async function recordPurchase(data) {
  const ref = await db.ref('purchases').push({
    items:        data.items,
    grandTotal:   data.grandTotal   || 0,
    itemCount:    data.items.length,
    memberId:     data.memberId     || null,
    memberNumber: data.memberNumber || null,
    memberName:   data.memberName   || null,
    soldAt:       firebase.database.ServerValue.TIMESTAMP
  });

  if (data.memberId) {
    await db.ref('members').child(data.memberId).transaction(member => {
      if (!member) return member;
      member.totalSpent    = (member.totalSpent    || 0) + (data.grandTotal || 0);
      member.purchaseCount = (member.purchaseCount || 0) + 1;
      return member;
    });
  }

  return ref.key;
}

async function getAllPurchases() {
  const snap = await db.ref('purchases').orderByChild('soldAt').once('value');
  const purchases = [];
  snap.forEach(child => {
    const d = child.val();
    /* items may be stored as an array or as a Firebase object (numeric keys) */
    const items = d.items
      ? (Array.isArray(d.items) ? d.items : Object.values(d.items))
      : [];
    purchases.push({
      id:           child.key,
      items,
      grandTotal:   d.grandTotal   || 0,
      itemCount:    d.itemCount    || items.length,
      memberId:     d.memberId     || null,
      memberNumber: d.memberNumber || null,
      memberName:   d.memberName   || null,
      soldAt:       d.soldAt ? new Date(d.soldAt) : null
    });
  });
  return purchases.reverse(); /* newest first */
}

/**
 * Reverse a purchase: removes the record and rolls back member stats.
 * No stock changes — stock status is managed manually.
 */
async function reversePurchase(purchase) {
  if (purchase.memberId) {
    await db.ref('members').child(purchase.memberId).transaction(member => {
      if (!member) return member;
      member.totalSpent    = Math.max(0, +((member.totalSpent    || 0) - purchase.grandTotal).toFixed(2));
      member.purchaseCount = Math.max(0,  (member.purchaseCount  || 0) - 1);
      return member;
    });
  }
  await db.ref('purchases').child(purchase.id).remove();
}

/* ============================================================
   LEGACY: per-item sales (kept for reading old records only)
   ============================================================ */

async function getAllSales() {
  const snap = await db.ref('sales').orderByChild('soldAt').once('value');
  const sales = [];
  snap.forEach(child => {
    const d = child.val();
    sales.push({
      id:           child.key,
      itemId:       d.itemId       || '',
      itemName:     d.itemName     || '',
      category:     d.category     || '',
      quantity:     d.quantity     || 0,
      unit:         d.unit         || '',
      pricePerUnit: d.pricePerUnit || 0,
      total:        d.total        || 0,
      note:         d.note         || '',
      memberId:     d.memberId     || null,
      memberNumber: d.memberNumber || null,
      memberName:   d.memberName   || null,
      soldAt:       d.soldAt ? new Date(d.soldAt) : null
    });
  });
  return sales.reverse();
}

/* ============================================================
   VISIBILITY TOGGLE
   ============================================================ */

async function setHiddenFromMenu(id, hidden) {
  await db.ref('stock').child(id).update({
    hiddenFromMenu: hidden,
    updatedAt:      firebase.database.ServerValue.TIMESTAMP
  });
}

