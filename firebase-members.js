/**
 * ============================================================
 * ARISANKITA - FIREBASE MEMBERS CRUD
 * ============================================================
 * Semua operasi terkait anggota (members collection)
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
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch,
  generateId,
  nowTimestamp
} from './firebase-config.js';

import {
  getGroupMembersByMember,
  addMemberToGroupInternal,
  removeMemberFromGroupInternal
} from './firebase-group-members.js';

// ============================================================
// GET ALL MEMBERS (OPTIMIZED)
// ============================================================
export async function getMembers(filter = {}) {
  try {
    // 1. Ambil semua data sekaligus
    const [membersSnap, gmSnap, groupsSnap] = await Promise.all([
      getDocs(collection(db, COLLECTIONS.MEMBERS)),
      getDocs(collection(db, COLLECTIONS.GROUP_MEMBERS)),
      getDocs(collection(db, COLLECTIONS.GROUPS))
    ]);

    const groupsMap = {};
    groupsSnap.forEach(d => { groupsMap[d.id] = { id: d.id, ...d.data() }; });

    // 2. Group gm by member_id
    const gmByMember = {};
    gmSnap.forEach(d => {
      const gm = { gm_id: d.id, ...d.data() };
      if (gm.status !== 'active') return;
      if (!gmByMember[gm.member_id]) gmByMember[gm.member_id] = [];
      gmByMember[gm.member_id].push(gm);
    });

    // 3. Enrich members
    let list = [];
    membersSnap.forEach(d => {
      const m = { id: d.id, ...d.data() };
      const gms = gmByMember[m.id] || [];
      m.groups = gms.map(gm => ({
        group_id: gm.group_id,
        group_name: groupsMap[gm.group_id]?.name || '?'
      }));
      m.group_count = m.groups.length;
      list.push(m);
    });

    // 4. Sort by number
    list.sort((a, b) => Number(a.number) - Number(b.number));

    // 5. Apply filter
    if (filter) {
      if (filter.status && filter.status !== 'all') {
        list = list.filter(m => m.status === filter.status);
      }
      if (filter.group_id && filter.group_id !== 'all') {
        list = list.filter(m => (m.groups || []).some(g => g.group_id === filter.group_id));
      }
      if (filter.q) {
        const q = String(filter.q).toLowerCase();
        list = list.filter(m =>
          String(m.name || '').toLowerCase().includes(q) ||
          String(m.number || '').includes(q) ||
          String(m.phone || '').includes(q)
        );
      }
    }

    return { ok: true, data: list };
  } catch (e) {
    console.error('getMembers error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// GET MEMBER BY ID
// ============================================================
export async function getMemberById(id) {
  try {
    const ref = doc(db, COLLECTIONS.MEMBERS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Anggota tidak ditemukan.' };
    const data = { id: snap.id, ...snap.data() };
    // Enrich dengan groups
    try {
      data.groups = await getGroupMembersByMember(id);
      data.group_count = data.groups.length;
    } catch (e) {
      data.groups = [];
      data.group_count = 0;
    }
    return { ok: true, data: data };
  } catch (e) {
    console.error('getMemberById error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// CREATE MEMBER
// ============================================================
export async function createMember(data) {
  try {
    const name = String(data.name || '').trim();
    if (!name) return { ok: false, message: 'Nama anggota wajib diisi.' };

    // Cek nomor duplikat
    const allMembers = await getMembers({});
    let number = data.number ? Number(data.number) : 0;

    if (number > 0) {
      const dup = allMembers.data.find(m => Number(m.number) === number);
      if (dup) return { ok: false, message: 'Nomor anggota sudah digunakan.' };
    } else {
      let maxNum = 0;
      allMembers.data.forEach(m => {
        if (Number(m.number) > maxNum) maxNum = Number(m.number);
      });
      number = maxNum + 1;
    }

    const id = generateId('mbr');
    const obj = {
      number: number,
      name: name,
      phone: String(data.phone || '').trim(),
      email: String(data.email || '').trim(),
      address: String(data.address || '').trim(),
      status: data.status === 'inactive' ? 'inactive' : 'active',
      created_at: nowTimestamp(),
      updated_at: nowTimestamp()
    };

    await setDoc(doc(db, COLLECTIONS.MEMBERS, id), obj);

    // Assign ke kelompok kalau ada
    const groupIds = data.group_ids || [];
    if (groupIds.length > 0) {
      for (const gid of groupIds) {
        try {
          await addMemberToGroupInternal(gid, id);
        } catch (e) {
          console.warn('Add to group error:', e);
        }
      }

      // AUTO-GENERATE TAGIHAN untuk setiap kelompok yang di-assign
      for (const gid of groupIds) {
        try {
          const { autoGeneratePayments } = await import('./firebase-payments.js');
          await autoGeneratePayments(gid);
        } catch (e) {
          console.warn('Auto-generate after createMember error:', e);
        }
      }
    }

    return { ok: true, message: 'Anggota berhasil ditambahkan.', data: { id, ...obj } };
  } catch (e) {
    console.error('createMember error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// UPDATE MEMBER
// ============================================================
export async function updateMember(id, data) {
  try {
    const name = String(data.name || '').trim();
    if (!name) return { ok: false, message: 'Nama wajib diisi.' };

    const ref = doc(db, COLLECTIONS.MEMBERS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Anggota tidak ditemukan.' };

    const current = snap.data();
    const number = Number(data.number) || current.number;

    // Cek duplikat nomor
    const allMembers = await getMembers({});
    const dup = allMembers.data.find(m => m.id !== id && Number(m.number) === number);
    if (dup) return { ok: false, message: 'Nomor anggota sudah digunakan.' };

    await updateDoc(ref, {
      number: number,
      name: name,
      phone: String(data.phone || '').trim(),
      email: String(data.email || '').trim(),
      address: String(data.address || '').trim(),
      status: data.status === 'inactive' ? 'inactive' : 'active',
      updated_at: nowTimestamp()
    });

    // Update keanggotaan kelompok jika group_ids dikirim
    if (data.group_ids !== undefined) {
      const currentGroups = await getGroupMembersByMember(id);
      const currentIds = currentGroups.map(g => g.group_id);
      const targetIds = data.group_ids || [];

      // Hapus yang tidak ada di target
      for (const cg of currentGroups) {
        if (targetIds.indexOf(cg.group_id) === -1) {
          try {
            await removeMemberFromGroupInternal(cg.group_id, id);
          } catch (e) {
            console.warn('Remove from group error:', e);
          }
        }
      }

      // Tambahkan yang baru
      const addedGroupIds = [];
      for (const gid of targetIds) {
        if (currentIds.indexOf(gid) === -1) {
          try {
            await addMemberToGroupInternal(gid, id);
            addedGroupIds.push(gid);
          } catch (e) {
            console.warn('Add to group error:', e);
          }
        }
      }

      // AUTO-GENERATE TAGIHAN untuk setiap kelompok yang ditambahkan
      for (const gid of addedGroupIds) {
        try {
          const { autoGeneratePayments } = await import('./firebase-payments.js');
          await autoGeneratePayments(gid);
        } catch (e) {
          console.warn('Auto-generate after updateMember error:', e);
        }
      }
    }

    return { ok: true, message: 'Anggota diperbarui.' };
  } catch (e) {
    console.error('updateMember error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// DELETE MEMBER
// ============================================================
export async function deleteMember(id) {
  try {
    const ref = doc(db, COLLECTIONS.MEMBERS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Anggota tidak ditemukan.' };

    const name = snap.data().name;

    // Hapus semua relasi group_members
    const currentGroups = await getGroupMembersByMember(id);
    for (const cg of currentGroups) {
      try {
        await removeMemberFromGroupInternal(cg.group_id, id);
      } catch (e) {
        console.warn('Remove group_member error:', e);
      }
    }

    // Hapus member
    await deleteDoc(ref);

    return { ok: true, message: 'Anggota ' + name + ' dihapus.' };
  } catch (e) {
    console.error('deleteMember error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// GET MEMBER BY NUMBER (untuk draw undian)
// ============================================================
export async function getMemberByNumber(number) {
  try {
    const membersRef = collection(db, COLLECTIONS.MEMBERS);
    const q = query(membersRef, where('number', '==', Number(number)));
    const snap = await getDocs(q);
    if (snap.empty) return { ok: false, message: 'Anggota tidak ditemukan.' };
    const d = snap.docs[0];
    return { ok: true, data: { id: d.id, ...d.data() } };
  } catch (e) {
    console.error('getMemberByNumber error:', e);
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Members loaded');