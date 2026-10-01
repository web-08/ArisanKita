/**
 * ============================================================
 * ARISANKITA - FIREBASE PAYMENTS
 * ============================================================
 * CRUD pembayaran + partial payment + WA reminder
 * + auto-generate + real-time listener
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
  writeBatch,
  generateId,
  nowTimestamp
} from './firebase-config.js';

import { getGroupMembers } from './firebase-group-members.js';
import { hitungPutaranAktif, hitungJatuhTempo } from './firebase-groups.js';

// ============================================================
// GET ALL PAYMENTS (enriched with member + group info)
// ============================================================
export async function getPayments(filter = {}) {
  try {
    const payRef = collection(db, COLLECTIONS.PAYMENTS);
    const snap = await getDocs(payRef);
    let list = [];
    snap.forEach(d => {
      list.push({ id: d.id, ...d.data() });
    });

    // Enrich dengan member + group info
    const membersRef = collection(db, COLLECTIONS.MEMBERS);
    const membersSnap = await getDocs(membersRef);
    const memberMap = {};
    membersSnap.forEach(d => { memberMap[d.id] = { id: d.id, ...d.data() }; });

    const groupsRef = collection(db, COLLECTIONS.GROUPS);
    const groupsSnap = await getDocs(groupsRef);
    const groupMap = {};
    groupsSnap.forEach(d => { groupMap[d.id] = { id: d.id, ...d.data() }; });

    list = list.map(p => {
      const amount = Number(p.amount || 0);
      const paidAmount = Number(p.paid_amount || 0);
      const m = memberMap[p.member_id] || {};
      const g = groupMap[p.group_id] || {};
      return {
        ...p,
        amount: amount,
        paid_amount: paidAmount,
        remaining: amount - paidAmount,
        member_name: m.name || '(dihapus)',
        member_number: m.number || '-',
        member_phone: m.phone || '',
        group_name: g.name || '(dihapus)'
      };
    });

    // Sort: by due_date then member_number
    list.sort((a, b) => {
      const d = new Date(a.due_date) - new Date(b.due_date);
      if (d !== 0) return d;
      return Number(a.member_number) - Number(b.member_number);
    });

    // Apply filter
    if (filter) {
      if (filter.group_id && filter.group_id !== 'all') list = list.filter(p => p.group_id === filter.group_id);
      if (filter.member_id && filter.member_id !== 'all') list = list.filter(p => p.member_id === filter.member_id);
      if (filter.period && filter.period !== 'all') list = list.filter(p => String(p.period_number) === String(filter.period));
      if (filter.status && filter.status !== 'all') list = list.filter(p => p.status === filter.status);
    }

    return { ok: true, data: list };
  } catch (e) {
    console.error('getPayments error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// REAL-TIME LISTENER untuk payments
// ============================================================
export function subscribePayments(callback) {
  const payRef = collection(db, COLLECTIONS.PAYMENTS);
  return onSnapshot(payRef, async (snap) => {
    try {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));

      // Enrich
      const membersRef = collection(db, COLLECTIONS.MEMBERS);
      const membersSnap = await getDocs(membersRef);
      const memberMap = {};
      membersSnap.forEach(d => { memberMap[d.id] = { id: d.id, ...d.data() }; });

      const groupsRef = collection(db, COLLECTIONS.GROUPS);
      const groupsSnap = await getDocs(groupsRef);
      const groupMap = {};
      groupsSnap.forEach(d => { groupMap[d.id] = { id: d.id, ...d.data() }; });

      const enriched = list.map(p => {
        const amount = Number(p.amount || 0);
        const paidAmount = Number(p.paid_amount || 0);
        const m = memberMap[p.member_id] || {};
        const g = groupMap[p.group_id] || {};
        return {
          ...p,
          amount: amount,
          paid_amount: paidAmount,
          remaining: amount - paidAmount,
          member_name: m.name || '(dihapus)',
          member_number: m.number || '-',
          member_phone: m.phone || '',
          group_name: g.name || '(dihapus)'
        };
      });

      enriched.sort((a, b) => {
        const d = new Date(a.due_date) - new Date(b.due_date);
        if (d !== 0) return d;
        return Number(a.member_number) - Number(b.member_number);
      });

      callback(enriched);
    } catch (e) {
      console.error('subscribePayments enrich error:', e);
      callback([]);
    }
  }, (error) => {
    console.error('subscribePayments error:', error);
  });
}

// ============================================================
// GET PAYMENT BY ID
// ============================================================
export async function getPaymentById(id) {
  try {
    const ref = doc(db, COLLECTIONS.PAYMENTS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Pembayaran tidak ditemukan.' };
    return { ok: true, data: { id: snap.id, ...snap.data() } };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ============================================================
// UPDATE PAYMENT STATUS
// ============================================================
export async function updatePaymentStatus(id, status) {
  try {
    if (['unpaid', 'pending', 'paid', 'rejected', 'partial'].indexOf(status) === -1) {
      return { ok: false, message: 'Status tidak valid.' };
    }

    const ref = doc(db, COLLECTIONS.PAYMENTS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Pembayaran tidak ditemukan.' };

    const p = snap.data();
    const wasAlreadyPaid = p.status === 'paid';
    const nowPaid = status === 'paid';

    const updates = { status };

    if (nowPaid) {
      updates.paid_at = Timestamp.now();
      updates.paid_amount = p.amount;

      // Buat transaksi income hanya jika sebelumnya belum paid
      if (!wasAlreadyPaid) {
        try {
          const trxId = generateId('trx');
          // Ambil info member & group untuk deskripsi
          const memberSnap = await getDoc(doc(db, COLLECTIONS.MEMBERS, p.member_id));
          const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, p.group_id));
          const memberName = memberSnap.exists() ? memberSnap.data().name : 'Anggota';
          const groupName = groupSnap.exists() ? groupSnap.data().name : 'Kelompok';
          const desc = 'Iuran ' + groupName + ' P' + p.period_number + ' - ' + memberName;

          await setDoc(doc(db, COLLECTIONS.TRANSACTIONS, trxId), {
            type: 'income',
            category: 'iuran_arisan',
            description: desc,
            amount: p.amount,
            group_id: p.group_id,
            transaction_date: new Date().toISOString().slice(0, 10),
            created_at: Timestamp.now(),
            payment_id: id
          });
        } catch (e) {
          console.warn('Create transaction error:', e);
        }
      }
    } else if (status === 'partial') {
      updates.paid_at = p.paid_at || Timestamp.now();
    } else {
      updates.paid_at = null;
      updates.paid_amount = 0;
      // Hapus transaksi terkait
      try {
        const trxRef = collection(db, COLLECTIONS.TRANSACTIONS);
        const trxQ = query(trxRef, where('payment_id', '==', id));
        const trxSnap = await getDocs(trxQ);
        for (const d of trxSnap.docs) {
          await deleteDoc(doc(db, COLLECTIONS.TRANSACTIONS, d.id));
        }
      } catch (e) {
        console.warn('Delete transaction error:', e);
      }
    }

    await updateDoc(ref, updates);

    return { ok: true, message: 'Status pembayaran diperbarui.' };
  } catch (e) {
    console.error('updatePaymentStatus error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// UPDATE PAYMENT PARTIAL (cicilan)
// ============================================================
export async function updatePaymentPartial(id, paidAmount, notes) {
  try {
    const amt = Number(paidAmount);
    if (!amt || amt <= 0) return { ok: false, message: 'Jumlah pembayaran tidak valid.' };

    const ref = doc(db, COLLECTIONS.PAYMENTS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Pembayaran tidak ditemukan.' };

    const p = snap.data();
    const currentPaid = Number(p.paid_amount || 0);
    const target = Number(p.amount || 0);
    const remaining = target - currentPaid;

    if (remaining <= 0) return { ok: false, message: 'Pembayaran sudah lunas.' };
    if (amt > remaining) {
      return { ok: false, message: 'Jumlah melebihi sisa tagihan (Rp ' + remaining.toLocaleString('id-ID') + ').' };
    }

    const newPaid = currentPaid + amt;
    const isFullPaid = newPaid >= target;

    await updateDoc(ref, {
      paid_amount: newPaid,
      status: isFullPaid ? 'paid' : 'partial',
      paid_at: Timestamp.now(),
      notes: notes || p.notes || ''
    });

    // Buat transaksi cicilan
    try {
      const trxId = generateId('trx');
      const memberSnap = await getDoc(doc(db, COLLECTIONS.MEMBERS, p.member_id));
      const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, p.group_id));
      const memberName = memberSnap.exists() ? memberSnap.data().name : 'Anggota';
      const groupName = groupSnap.exists() ? groupSnap.data().name : 'Kelompok';
      const desc = 'Cicilan ' + groupName + ' P' + p.period_number + ' - ' + memberName + ' (' + amt.toLocaleString('id-ID') + ')';

      await setDoc(doc(db, COLLECTIONS.TRANSACTIONS, trxId), {
        type: 'income',
        category: 'iuran_arisan',
        description: desc,
        amount: amt,
        group_id: p.group_id,
        transaction_date: new Date().toISOString().slice(0, 10),
        created_at: Timestamp.now(),
        payment_id: id
      });
    } catch (e) {
      console.warn('Create cicilan transaction error:', e);
    }

    const remainingAfter = target - newPaid;
    return {
      ok: true,
      message: isFullPaid ? '🎉 Pembayaran LUNAS!' : 'Cicilan diterima. Sisa: Rp ' + remainingAfter.toLocaleString('id-ID'),
      data: { newPaid, target, remaining: remainingAfter, isFullPaid }
    };
  } catch (e) {
    console.error('updatePaymentPartial error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// SYNC PAYMENTS (generate + hapus yang tidak sesuai)
// ============================================================
export async function autoGeneratePayments(groupId) {
  try {
    const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
    if (!groupSnap.exists()) return { ok: false, message: 'Kelompok tidak ditemukan.' };
    const group = groupSnap.data();

    const members = await getGroupMembers(groupId);
    const memberIds = members.map(m => m.member_id);

    const periodDays = Number(group.period_days) || 7;
    const maxPutaran = members.length;  // Max putaran = jumlah anggota
    const putaranAktif = hitungPutaranAktif(group.start_date, periodDays);
    const targetPutaran = Math.min(putaranAktif, maxPutaran);

    // Ambil existing payments
    const payRef = collection(db, COLLECTIONS.PAYMENTS);
    const payQ = query(payRef, where('group_id', '==', groupId));
    const paySnap = await getDocs(payQ);
    const existingPayments = [];
    paySnap.forEach(d => {
      existingPayments.push({ id: d.id, ...d.data() });
    });

    const batch = writeBatch(db);
    let created = 0;
    let deleted = 0;

    // ============================================================
    // A. HAPUS tagihan yang member_id tidak ada di group lagi
    // ============================================================
    for (const p of existingPayments) {
      if (memberIds.indexOf(p.member_id) === -1) {
        batch.delete(doc(db, COLLECTIONS.PAYMENTS, p.id));
        deleted++;
      }
    }

    // ============================================================
    // B. HAPUS tagihan yang period_number > maxPutaran
    // ============================================================
    for (const p of existingPayments) {
      if (memberIds.indexOf(p.member_id) !== -1 && Number(p.period_number) > maxPutaran) {
        batch.delete(doc(db, COLLECTIONS.PAYMENTS, p.id));
        deleted++;
      }
    }

    // ============================================================
    // C. TAMBAH tagihan yang belum ada
    // ============================================================
    const existingKeys = {};
    existingPayments.forEach(p => {
      existingKeys[p.member_id + '|' + p.period_number] = true;
    });

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
          created_at: Timestamp.now(),
          notes: ''
        });
        created++;
      }
    }

    if (created > 0 || deleted > 0) {
      await batch.commit();
    }

    return { ok: true, created, deleted };
  } catch (e) {
    console.error('autoGeneratePayments error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// GET PAYMENT REMINDERS (belum lunas)
// ============================================================
export async function getPaymentReminders(groupId, period) {
  try {
    const allRes = await getPayments({});
    if (!allRes.ok) return allRes;

    let list = allRes.data;
    if (groupId) list = list.filter(p => p.group_id === groupId);
    if (period) list = list.filter(p => String(p.period_number) === String(period));
    list = list.filter(p => p.status !== 'paid' && p.status !== 'rejected');

    return { ok: true, data: list };
  } catch (e) {
    console.error('getPaymentReminders error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// BULK MARK PERIOD AS PAID (dengan auto-create transaksi)
// ============================================================
export async function bulkMarkPeriodPaid(groupId, periodNumber) {
  try {
    const payRef = collection(db, COLLECTIONS.PAYMENTS);
    const payQ = query(payRef, where('group_id', '==', groupId), where('period_number', '==', Number(periodNumber)));
    const paySnap = await getDocs(payQ);

    // Ambil existing transactions untuk cek duplikat
    const trxRef = collection(db, COLLECTIONS.TRANSACTIONS);
    const trxSnap = await getDocs(trxRef);
    const existingPaymentIds = new Set();
    trxSnap.forEach(d => {
      const t = d.data();
      if (t.payment_id) existingPaymentIds.add(t.payment_id);
    });

    // Ambil members & groups untuk deskripsi
    const membersRef = collection(db, COLLECTIONS.MEMBERS);
    const membersSnap = await getDocs(membersRef);
    const memberMap = {};
    membersSnap.forEach(d => { memberMap[d.id] = d.data(); });

    const groupsRef = collection(db, COLLECTIONS.GROUPS);
    const groupsSnap = await getDocs(groupsRef);
    const groupMap = {};
    groupsSnap.forEach(d => { groupMap[d.id] = d.data(); });

    const batch = writeBatch(db);
    let updated = 0;
    let trxCreated = 0;

    for (const d of paySnap.docs) {
      const p = d.data();
      const payId = d.id;

      // Skip kalau sudah paid
      if (p.status === 'paid') continue;

      // 1. Update payment status
      batch.update(doc(db, COLLECTIONS.PAYMENTS, payId), {
        status: 'paid',
        paid_amount: p.amount,
        paid_at: Timestamp.now()
      });
      updated++;

      // 2. Create transaction (kalau belum ada)
      if (!existingPaymentIds.has(payId)) {
        const memberName = memberMap[p.member_id]?.name || 'Anggota';
        const groupName = groupMap[p.group_id]?.name || 'Kelompok';
        const desc = 'Iuran ' + groupName + ' P' + p.period_number + ' - ' + memberName;

        const trxId = generateId('trx');
        const trxDocRef = doc(db, COLLECTIONS.TRANSACTIONS, trxId);

        const trxDate = new Date().toISOString().slice(0, 10);

        batch.set(trxDocRef, {
          type: 'income',
          category: 'iuran_arisan',
          description: desc,
          amount: Number(p.amount || 0),
          group_id: p.group_id,
          transaction_date: trxDate,
          created_at: Timestamp.now(),
          payment_id: payId
        });
        trxCreated++;
      }
    }

    if (updated > 0 || trxCreated > 0) {
      await batch.commit();
    }

    console.log('✅ Bulk mark selesai:', updated, 'di-mark,', trxCreated, 'transaksi dibuat');

    return { ok: true, updated, trxCreated };
  } catch (e) {
    console.error('bulkMarkPeriodPaid error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// BACKFILL TRANSACTIONS (untuk data lama yang transaksinya hilang)
// ============================================================
export async function backfillTransactions() {
  try {
    console.log('🔄 Mulai backfill transaksi...');

    // 1. Ambil semua payments
    const payRef = collection(db, COLLECTIONS.PAYMENTS);
    const paySnap = await getDocs(payRef);
    const payments = [];
    paySnap.forEach(d => payments.push({ id: d.id, ...d.data() }));

    // 2. Ambil semua transaksi existing
    const trxRef = collection(db, COLLECTIONS.TRANSACTIONS);
    const trxSnap = await getDocs(trxRef);
    const existingPaymentIds = new Set();
    trxSnap.forEach(d => {
      const t = d.data();
      if (t.payment_id) existingPaymentIds.add(t.payment_id);
    });

    // 3. Ambil members & groups
    const membersRef = collection(db, COLLECTIONS.MEMBERS);
    const membersSnap = await getDocs(membersRef);
    const memberMap = {};
    membersSnap.forEach(d => { memberMap[d.id] = d.data(); });

    const groupsRef = collection(db, COLLECTIONS.GROUPS);
    const groupsSnap = await getDocs(groupsRef);
    const groupMap = {};
    groupsSnap.forEach(d => { groupMap[d.id] = d.data(); });

    // 4. Filter: paid tapi belum ada transaksi
    const toBackfill = payments.filter(p =>
      p.status === 'paid' && !existingPaymentIds.has(p.id)
    );

    console.log('📊 Total payments:', payments.length);
    console.log('📊 Sudah ada transaksi:', existingPaymentIds.size);
    console.log('📊 Perlu backfill:', toBackfill.length);

    if (toBackfill.length === 0) {
      return { ok: true, message: 'Semua transaksi sudah lengkap.', created: 0 };
    }

    // 5. Buat transaksi
    const batch = writeBatch(db);
    let created = 0;

    for (const p of toBackfill) {
      const memberName = memberMap[p.member_id]?.name || 'Anggota';
      const groupName = groupMap[p.group_id]?.name || 'Kelompok';
      const desc = 'Iuran ' + groupName + ' P' + p.period_number + ' - ' + memberName;

      const trxId = generateId('trx');
      const trxDocRef = doc(db, COLLECTIONS.TRANSACTIONS, trxId);

      let trxDate = new Date().toISOString().slice(0, 10);
      if (p.paid_at) {
        try {
          const paidDate = p.paid_at.toDate ? p.paid_at.toDate() : new Date(p.paid_at);
          if (!isNaN(paidDate.getTime())) {
            trxDate = paidDate.toISOString().slice(0, 10);
          }
        } catch (e) {}
      }

      batch.set(trxDocRef, {
        type: 'income',
        category: 'iuran_arisan',
        description: desc,
        amount: Number(p.amount || 0),
        group_id: p.group_id,
        transaction_date: trxDate,
        created_at: Timestamp.now(),
        payment_id: p.id
      });
      created++;
    }

    await batch.commit();
    console.log('✅ Backfill selesai:', created, 'transaksi dibuat');

    return { ok: true, message: created + ' transaksi berhasil dibuat.', created };
  } catch (e) {
    console.error('backfillTransactions error:', e);
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Payments loaded');