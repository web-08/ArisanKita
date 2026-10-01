/**
 * ============================================================
 * ARISANKITA - FIREBASE GROUPS CRUD
 * ============================================================
 * Semua operasi terkait kelompok (groups collection)
 * Termasuk auto-generate tagihan saat create group
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
  Timestamp,
  writeBatch,
  generateId,
  nowTimestamp
} from './firebase-config.js';

import {
  getGroupMembers,
  addMemberToGroupInternal
} from './firebase-group-members.js';

// ============================================================
// GET ALL GROUPS
// ============================================================
export async function getGroups() {
  try {
    const ref = collection(db, COLLECTIONS.GROUPS);
    const snap = await getDocs(ref);
    const list = [];
    snap.forEach(d => {
      list.push({ id: d.id, ...d.data() });
    });

    // Enrich dengan statistik
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      try {
        const members = await getGroupMembers(g.id);
        g.member_count = members.length;

        // Hitung payment stats (kalau ada)
        const payRef = collection(db, COLLECTIONS.PAYMENTS);
        const payQ = query(payRef, where('group_id', '==', g.id));
        const paySnap = await getDocs(payQ);
        const payments = [];
        paySnap.forEach(d => payments.push(d.data()));
        g.payment_count = payments.length;
        g.paid_count = payments.filter(p => p.status === 'paid').length;
        g.unpaid_count = payments.length - g.paid_count;

        // Putaran aktif
        g.putaran_aktif = hitungPutaranAktif(g.start_date, Number(g.period_days) || 7);
      } catch (e) {
        g.member_count = 0;
        g.payment_count = 0;
        g.paid_count = 0;
        g.unpaid_count = 0;
        g.putaran_aktif = 1;
      }
    }

    return { ok: true, data: list };
  } catch (e) {
    console.error('getGroups error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// GET GROUP BY ID
// ============================================================
export async function getGroupById(id) {
  try {
    const ref = doc(db, COLLECTIONS.GROUPS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Kelompok tidak ditemukan.' };

    const g = { id: snap.id, ...snap.data() };

    // Get members detail
    try {
      const members = await getGroupMembers(id);
      g.members = members;
      g.member_count = members.length;
    } catch (e) {
      g.members = [];
      g.member_count = 0;
    }

    // Putaran aktif
    g.putaran_aktif = hitungPutaranAktif(g.start_date, Number(g.period_days) || 7);
    g.can_add_member = g.putaran_aktif <= 1;

    return { ok: true, data: g };
  } catch (e) {
    console.error('getGroupById error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// CREATE GROUP + AUTO-GENERATE TAGIHAN
// ============================================================
export async function createGroup(data) {
  try {
    const name = String(data.name || '').trim();
    if (!name) return { ok: false, message: 'Nama kelompok wajib diisi.' };

    const amount = Number(data.amount) || 0;
    if (amount <= 0) return { ok: false, message: 'Jumlah iuran harus lebih dari 0.' };

    const period = Number(data.period_days) || 7;
    if (period < 1 || period > 365) return { ok: false, message: 'Periode harus 1-365 hari.' };

    const groupId = generateId('grp');
    const startDate = data.start_date || new Date().toISOString().slice(0, 10);

    const obj = {
      name: name,
      description: String(data.description || '').trim(),
      period_days: period,
      amount: amount,
      start_date: startDate,
      status: data.status === 'inactive' ? 'inactive' : 'active',
      allow_repeat_winner: String(data.allow_repeat_winner) === 'true' ? 'true' : 'false',
      created_at: nowTimestamp(),
      updated_at: nowTimestamp()
    };

    await setDoc(doc(db, COLLECTIONS.GROUPS, groupId), obj);

    const memberIds = data.member_ids || [];
    if (memberIds.length > 0) {
      // Batch write untuk semua members sekaligus (lebih cepat & atomic)
      for (const mid of memberIds) {
        try {
          await addMemberToGroupInternal(groupId, mid);
        } catch (e) {
          console.warn('Add member error:', e);
        }
      }

      // Tunggu sebentar untuk memastikan semua group_members ter-commit
      await new Promise(r => setTimeout(r, 500));

      // Auto-generate tagihan
      try {
        await autoGeneratePayments(groupId);
      } catch (e) {
        console.warn('Auto-generate payments error:', e);
      }
    }

    return { ok: true, message: 'Kelompok berhasil dibuat.', data: { id: groupId, ...obj } };
  } catch (e) {
    console.error('createGroup error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// UPDATE GROUP
// ============================================================
export async function updateGroup(id, data) {
  try {
    const name = String(data.name || '').trim();
    if (!name) return { ok: false, message: 'Nama wajib diisi.' };

    const amount = Number(data.amount) || 0;
    const period = Number(data.period_days) || 7;
    if (period < 1 || period > 365) return { ok: false, message: 'Periode harus 1-365 hari.' };

    const ref = doc(db, COLLECTIONS.GROUPS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Kelompok tidak ditemukan.' };

    await updateDoc(ref, {
      name: name,
      description: String(data.description || '').trim(),
      period_days: period,
      amount: amount,
      start_date: data.start_date || '',
      status: data.status === 'inactive' ? 'inactive' : 'active',
      allow_repeat_winner: String(data.allow_repeat_winner) === 'true' ? 'true' : 'false',
      updated_at: nowTimestamp()
    });

    return { ok: true, message: 'Kelompok diperbarui.' };
  } catch (e) {
    console.error('updateGroup error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// DELETE GROUP
// ============================================================
export async function deleteGroup(id) {
  try {
    const ref = doc(db, COLLECTIONS.GROUPS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Kelompok tidak ditemukan.' };

    const name = snap.data().name;

    // Hapus semua group_members terkait
    const members = await getGroupMembers(id);
    const batch = writeBatch(db);
    for (const m of members) {
      const gmRef = doc(db, COLLECTIONS.GROUP_MEMBERS, m.gm_id);
      batch.delete(gmRef);
    }
    await batch.commit();

    // Hapus group
    await deleteDoc(ref);

    return { ok: true, message: 'Kelompok ' + name + ' dihapus.' };
  } catch (e) {
    console.error('deleteGroup error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// HELPER: HITUNG PUTARAN AKTIF
// ============================================================
export function hitungPutaranAktif(startDateStr, periodDays) {
  if (!startDateStr) return 1;
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return 1;
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 1;
  return Math.floor(diffDays / periodDays) + 1;
}

// ============================================================
// HELPER: HITUNG JATUH TEMPO
// ============================================================
export function hitungJatuhTempo(startDateStr, periodDays, periodNumber) {
  const d = new Date(startDateStr);
  d.setDate(d.getDate() + (periodNumber - 1) * periodDays);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// AUTO-GENERATE TAGIHAN (max putaran = jumlah anggota)
// ============================================================
export async function autoGeneratePayments(groupId) {
  try {
    const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
    if (!groupSnap.exists()) return { ok: false, message: 'Kelompok tidak ditemukan.' };
    const group = groupSnap.data();

    const members = await getGroupMembers(groupId);
    if (!members.length) return { ok: false, message: 'Belum ada anggota.' };

    const periodDays = Number(group.period_days) || 7;
    const maxPutaran = members.length;
    const putaranAktif = hitungPutaranAktif(group.start_date, periodDays);
    const targetPutaran = Math.min(putaranAktif, maxPutaran);

    // Cek existing payments
    const payRef = collection(db, COLLECTIONS.PAYMENTS);
    const payQ = query(payRef, where('group_id', '==', groupId));
    const paySnap = await getDocs(payQ);
    const existingKeys = {};
    paySnap.forEach(d => {
      const p = d.data();
      existingKeys[p.member_id + '|' + p.period_number] = true;
    });

    // Batch create
    const batch = writeBatch(db);
    let created = 0;

    for (let period = 1; period <= targetPutaran; period++) {
      const dueDate = hitungJatuhTempo(group.start_date, periodDays, period);

      for (const m of members) {
        const key = m.member_id + '|' + period;
        if (existingKeys[key]) continue;

        const payId = generateId('pay');
        const payRefDoc = doc(db, COLLECTIONS.PAYMENTS, payId);
        batch.set(payRefDoc, {
          group_id: groupId,
          member_id: m.member_id,
          period_number: period,
          due_date: dueDate,
          amount: group.amount,
          paid_amount: 0,
          status: 'unpaid',
          paid_at: null,
          created_at: nowTimestamp(),
          notes: ''
        });
        created++;
      }
    }

    if (created > 0) {
      await batch.commit();
    }

    return { ok: true, created: created };
  } catch (e) {
    console.error('autoGeneratePayments error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// PREVIEW PERIODE (untuk form)
// ============================================================
export function previewGroupPeriods(data) {
  try {
    const period = Number(data.period_days) || 7;
    const startDate = data.start_date || new Date().toISOString().slice(0, 10);
    const maxPeriods = Math.max(1, Math.min(52, Number(data.max_periods) || 12));

    const periods = [];
    for (let i = 1; i <= maxPeriods; i++) {
      periods.push({
        period_number: i,
        due_date: hitungJatuhTempo(startDate, period, i)
      });
    }
    return { ok: true, data: periods };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Groups loaded');