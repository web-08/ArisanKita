/**
 * ============================================================
 * ARISANKITA - FIREBASE GROUP MEMBERS (Junction Table)
 * ============================================================
 * Relasi many-to-many antara anggota dan kelompok
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
  generateId,
  nowTimestamp
} from './firebase-config.js';

// ============================================================
// GET GROUP MEMBERS (OPTIMIZED — bulk enrich)
// ============================================================
export async function getGroupMembers(groupId) {
  try {
    // 1. Ambil group_members + semua members sekaligus
    const [gmSnap, membersSnap] = await Promise.all([
      getDocs(collection(db, COLLECTIONS.GROUP_MEMBERS)),
      getDocs(collection(db, COLLECTIONS.MEMBERS))
    ]);

    const membersMap = {};
    membersSnap.forEach(d => { membersMap[d.id] = { id: d.id, ...d.data() }; });

    const list = [];
    gmSnap.forEach(d => {
      const gm = { gm_id: d.id, ...d.data() };
      if (gm.group_id !== groupId) return;
      if (gm.status !== 'active') return;

      const m = membersMap[gm.member_id] || {};
      list.push({
        gm_id: gm.gm_id,
        member_id: gm.member_id,
        number: m.number || '-',
        name: m.name || '(anggota dihapus)',
        phone: m.phone || '',
        status: m.status || 'unknown',
        joined_at: gm.joined_at
      });
    });

    list.sort((a, b) => Number(a.number) - Number(b.number));
    return list;
  } catch (e) {
    console.error('getGroupMembers error:', e);
    throw e;
  }
}

// ============================================================
// GET MEMBER GROUPS (OPTIMIZED)
// ============================================================
export async function getGroupMembersByMember(memberId) {
  try {
    const [gmSnap, groupsSnap] = await Promise.all([
      getDocs(collection(db, COLLECTIONS.GROUP_MEMBERS)),
      getDocs(collection(db, COLLECTIONS.GROUPS))
    ]);

    const groupsMap = {};
    groupsSnap.forEach(d => { groupsMap[d.id] = { id: d.id, ...d.data() }; });

    const list = [];
    gmSnap.forEach(d => {
      const gm = { gm_id: d.id, ...d.data() };
      if (gm.member_id !== memberId) return;
      if (gm.status !== 'active') return;

      const g = groupsMap[gm.group_id] || {};
      list.push({
        gm_id: gm.gm_id,
        group_id: gm.group_id,
        group_name: g.name || '?',
        period_days: g.period_days || 0,
        amount: g.amount || 0
      });
    });

    return list;
  } catch (e) {
    console.error('getGroupMembersByMember error:', e);
    throw e;
  }
}

// ============================================================
// 3. GET ALL GROUP MEMBERS
// ============================================================
export async function getAllGroupMembers() {
  try {
    const ref = collection(db, COLLECTIONS.GROUP_MEMBERS);
    const snap = await getDocs(ref);
    const list = [];
    snap.forEach(d => {
      list.push({ gm_id: d.id, ...d.data() });
    });
    return list.filter(g => g.status === 'active');
  } catch (e) {
    console.error('getAllGroupMembers error:', e);
    return [];
  }
}

// ============================================================
// 4. ADD MEMBER TO GROUP (internal) ← INI YANG HILANG
// ============================================================
export async function addMemberToGroupInternal(groupId, memberId) {
  try {
    const ref = collection(db, COLLECTIONS.GROUP_MEMBERS);
    const q = query(ref, where('group_id', '==', groupId), where('member_id', '==', memberId));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const existingDoc = snap.docs[0];
      const data = existingDoc.data();
      if (data.status !== 'active') {
        await updateDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, existingDoc.id), {
          status: 'active',
          joined_at: Timestamp.now()
        });
      }
      return { ok: true, gm_id: existingDoc.id, existed: true };
    }

    const gmId = generateId('gmb');
    await setDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, gmId), {
      group_id: groupId,
      member_id: memberId,
      joined_at: Timestamp.now(),
      status: 'active'
    });

    return { ok: true, gm_id: gmId, existed: false };
  } catch (e) {
    console.error('addMemberToGroupInternal error:', e);
    throw e;
  }
}

// ============================================================
// 5. REMOVE MEMBER FROM GROUP (internal)
// ============================================================
export async function removeMemberFromGroupInternal(groupId, memberId) {
  try {
    const ref = collection(db, COLLECTIONS.GROUP_MEMBERS);
    const q = query(ref, where('group_id', '==', groupId), where('member_id', '==', memberId));
    const snap = await getDocs(q);

    if (snap.empty) return { ok: true, existed: false };

    // Hapus semua group_members yang match
    for (const d of snap.docs) {
      await deleteDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, d.id));
    }

    // HAPUS juga tagihan terkait (payments)
    try {
      const payRef = collection(db, COLLECTIONS.PAYMENTS);
      const payQ = query(payRef, where('group_id', '==', groupId), where('member_id', '==', memberId));
      const paySnap = await getDocs(payQ);
      for (const pd of paySnap.docs) {
        await deleteDoc(doc(db, COLLECTIONS.PAYMENTS, pd.id));
      }
    } catch (e) {
      console.warn('Delete related payments error:', e);
    }

    return { ok: true, existed: true };
  } catch (e) {
    console.error('removeMemberFromGroupInternal error:', e);
    throw e;
  }
}

// ============================================================
// 6. ADD MEMBER(S) TO GROUP (publik)
// ============================================================
export async function addMemberToGroup(groupId, memberIds) {
  try {
    if (!groupId) return { ok: false, message: 'Kelompok belum dipilih.' };
    if (!memberIds || !memberIds.length) return { ok: false, message: 'Tidak ada anggota yang dipilih.' };

    const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
    if (!groupSnap.exists()) return { ok: false, message: 'Kelompok tidak ditemukan.' };
    const group = groupSnap.data();

    const putaranAktif = hitungPutaranAktifLocal(group.start_date, Number(group.period_days) || 7);
    if (putaranAktif > 1) {
      return {
        ok: false,
        message: 'Tidak bisa tambah anggota. Kelompok sudah masuk Putaran ' + putaranAktif + '.'
      };
    }

    let added = 0;
    for (const mid of memberIds) {
      try {
        const res = await addMemberToGroupInternal(groupId, mid);
        if (!res.existed) added++;
      } catch (e) {
        console.warn('Add error:', e);
      }
    }

    // AUTO-GENERATE TAGIHAN untuk anggota baru
    if (added > 0) {
      try {
        const { autoGeneratePayments } = await import('./firebase-payments.js');
        await autoGeneratePayments(groupId);
      } catch (e) {
        console.warn('Auto-generate after addMember error:', e);
      }
    }

    return { ok: true, message: added + ' anggota ditambahkan.', added: added };
  } catch (e) {
    console.error('addMemberToGroup error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// 7. REMOVE MEMBER FROM GROUP (publik)
// ============================================================
export async function removeMemberFromGroup(groupId, memberId) {
  try {
    // Hapus relasi
    await removeMemberFromGroupInternal(groupId, memberId);

    // Hapus tagihan unpaid anggota ini
    try {
      const payRef = collection(db, COLLECTIONS.PAYMENTS);
      const payQ = query(payRef, where('group_id', '==', groupId), where('member_id', '==', memberId));
      const paySnap = await getDocs(payQ);
      for (const d of paySnap.docs) {
        const p = d.data();
        if (p.status !== 'paid') {
          // Hanya hapus yang belum bayar
          await deleteDoc(doc(db, COLLECTIONS.PAYMENTS, d.id));
        }
      }
    } catch (e) {
      console.warn('Delete orphan payments error:', e);
    }

    return { ok: true, message: 'Anggota dikeluarkan dari kelompok.' };
  } catch (e) {
    console.error('removeMemberFromGroup error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// HELPER
// ============================================================
function hitungPutaranAktifLocal(startDateStr, periodDays) {
  if (!startDateStr) return 1;
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return 1;
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 1;
  return Math.floor(diffDays / periodDays) + 1;
}

console.log('✅ Firebase GroupMembers loaded');