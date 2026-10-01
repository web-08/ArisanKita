/**
 * ============================================================
 * ARISANKITA - FIREBASE TRANSACTIONS
 * ============================================================
 * CRUD transaksi keuangan + real-time listener
 * ============================================================
 */

import {
  db,
  COLLECTIONS,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  Timestamp,
  generateId,
  nowTimestamp
} from './firebase-config.js';

import { getLogsCollector } from './firebase-logs.js';

// ============================================================
// GET ALL TRANSACTIONS
// ============================================================
export async function getTransactions(filter = {}) {
  try {
    const ref = collection(db, COLLECTIONS.TRANSACTIONS);
    const snap = await getDocs(ref);
    let list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));

    // Enrich dengan group name
    const groupsRef = collection(db, COLLECTIONS.GROUPS);
    const groupsSnap = await getDocs(groupsRef);
    const groupMap = {};
    groupsSnap.forEach(d => { groupMap[d.id] = { id: d.id, ...d.data() }; });

    list = list.map(t => ({
      ...t,
      group_name: t.group_id ? (groupMap[t.group_id]?.name || '-') : '-'
    }));

    // Sort by transaction_date desc
    list.sort((a, b) => {
      const da = new Date(a.transaction_date || 0);
      const db2 = new Date(b.transaction_date || 0);
      return db2 - da;
    });

    // Filter
    if (filter) {
      if (filter.type && filter.type !== 'all') list = list.filter(t => t.type === filter.type);
      if (filter.group_id && filter.group_id !== 'all') list = list.filter(t => t.group_id === filter.group_id);
    }

    return { ok: true, data: list };
  } catch (e) {
    console.error('getTransactions error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// REAL-TIME LISTENER
// ============================================================
export function subscribeTransactions(callback) {
  const ref = collection(db, COLLECTIONS.TRANSACTIONS);
  return onSnapshot(ref, async (snap) => {
    try {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));

      const groupsRef = collection(db, COLLECTIONS.GROUPS);
      const groupsSnap = await getDocs(groupsRef);
      const groupMap = {};
      groupsSnap.forEach(d => { groupMap[d.id] = { id: d.id, ...d.data() }; });

      const enriched = list.map(t => ({
        ...t,
        group_name: t.group_id ? (groupMap[t.group_id]?.name || '-') : '-'
      }));

      enriched.sort((a, b) => {
        const da = new Date(a.transaction_date || 0);
        const db2 = new Date(b.transaction_date || 0);
        return db2 - da;
      });

      callback(enriched);
    } catch (e) {
      console.error('subscribeTransactions error:', e);
      callback([]);
    }
  }, (error) => {
    console.error('subscribeTransactions listen error:', error);
  });
}

// ============================================================
// CREATE TRANSACTION
// ============================================================
export async function createTransaction(data) {
  try {
    const type = data.type === 'expense' ? 'expense' : 'income';
    const amount = Number(data.amount) || 0;
    if (amount <= 0) return { ok: false, message: 'Jumlah harus lebih dari 0.' };

    const id = generateId('trx');
    const obj = {
      type: type,
      category: String(data.category || 'lain').trim(),
      description: String(data.description || '').trim(),
      amount: amount,
      group_id: data.group_id || '',
      transaction_date: data.transaction_date || new Date().toISOString().slice(0, 10),
      created_at: Timestamp.now(),
      payment_id: ''
    };

    await setDoc(doc(db, COLLECTIONS.TRANSACTIONS, id), obj);

    // Log
    try {
      await getLogsCollector().log('CREATE_TRANSACTION', 
        (type === 'income' ? 'Pemasukan' : 'Pengeluaran') + ' Rp ' + amount.toLocaleString('id-ID') + ' - ' + obj.description,
        'admin');
    } catch (e) {}

    return { ok: true, message: 'Transaksi disimpan.', data: { id, ...obj } };
  } catch (e) {
    console.error('createTransaction error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// UPDATE TRANSACTION
// ============================================================
export async function updateTransaction(id, data) {
  try {
    const amount = Number(data.amount) || 0;
    if (amount <= 0) return { ok: false, message: 'Jumlah harus lebih dari 0.' };

    const ref = doc(db, COLLECTIONS.TRANSACTIONS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Transaksi tidak ditemukan.' };

    await updateDoc(ref, {
      type: data.type === 'expense' ? 'expense' : 'income',
      category: String(data.category || 'lain').trim(),
      description: String(data.description || '').trim(),
      amount: amount,
      group_id: data.group_id || '',
      transaction_date: data.transaction_date || new Date().toISOString().slice(0, 10)
    });

    // Log
    try {
      await getLogsCollector().log('UPDATE_TRANSACTION', 'Update transaksi ' + id, 'admin');
    } catch (e) {}

    return { ok: true, message: 'Transaksi diperbarui.' };
  } catch (e) {
    console.error('updateTransaction error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// DELETE TRANSACTION
// ============================================================
export async function deleteTransaction(id) {
  try {
    const ref = doc(db, COLLECTIONS.TRANSACTIONS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Transaksi tidak ditemukan.' };

    await deleteDoc(ref);

    // Log
    try {
      await getLogsCollector().log('DELETE_TRANSACTION', 'Hapus transaksi ' + id, 'admin');
    } catch (e) {}

    return { ok: true, message: 'Transaksi dihapus.' };
  } catch (e) {
    console.error('deleteTransaction error:', e);
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Transactions loaded');