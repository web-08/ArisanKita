/**
 * ============================================================
 * ARISANKITA - FIREBASE WINNERS (Undian Pemenang)
 * ============================================================
 * 3 metode: random, number, predetermined
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
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  generateId,
  nowTimestamp
} from './firebase-config.js';

import { getGroupMembers } from './firebase-group-members.js';

// ============================================================
// GET CANDIDATES (dengan logging + robustness)
// ============================================================
export async function getCandidates(groupId, periodNumber) {
  try {
    console.log('🔍 getCandidates:', { groupId, periodNumber });

    if (!groupId) return { ok: false, message: 'Data kelompok belum dipilih.' };

    const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
    if (!groupSnap.exists()) {
      console.warn('❌ Group not found:', groupId);
      return { ok: false, message: 'Kelompok tidak ditemukan.' };
    }
    const group = groupSnap.data();
    console.log('✅ Group found:', group.name);

    // Ambil anggota kelompok
    const members = await getGroupMembers(groupId);
    console.log('👥 Members:', members.length, members.map(m => m.name));

    // Ambil winners yang sudah ada
    const winRef = collection(db, COLLECTIONS.WINNERS);
    const winQ = query(winRef, where('group_id', '==', groupId));
    const winSnap = await getDocs(winQ);
    const winners = [];
    winSnap.forEach(d => winners.push({ id: d.id, ...d.data() }));
    console.log('🏆 Winners:', winners.length);

    const wonIds = winners.map(w => w.member_id);
    const allowRepeat = String(group.allow_repeat_winner) === 'true';
    console.log('🔄 Allow repeat:', allowRepeat);

    const candidates = members.filter(m => allowRepeat || wonIds.indexOf(m.member_id) === -1);
    console.log('✅ Candidates:', candidates.length);

    return {
      ok: true,
      data: {
        candidates: candidates.map(c => ({
          id: c.member_id,
          number: c.number,
          name: c.name,
          phone: c.phone
        })),
        totalMembers: members.length,
        totalWinners: wonIds.length,
        remaining: candidates.length,
        allowRepeat: allowRepeat
      }
    };
  } catch (e) {
    console.error('❌ getCandidates error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// DRAW RANDOM WINNER
// ============================================================
export async function drawRandomWinner(groupId, periodNumber, notes) {
  try {
    if (!groupId) return { ok: false, message: 'Data kelompok belum dipilih.' };
    const period = Number(periodNumber) || 1;

    console.log('🎲 drawRandomWinner called:');
    console.log('   groupId:', groupId);
    console.log('   period:', period);

    // Cek existing
    const winRef = collection(db, COLLECTIONS.WINNERS);
    const winQ = query(winRef, 
      where('group_id', '==', groupId), 
      where('period_number', '==', period)
    );
    const winSnap = await getDocs(winQ);
    
    console.log('   existing winners:', winSnap.size);
    
    if (!winSnap.empty) {
      const existing = winSnap.docs[0].data();
      console.log('   ⚠️ Existing winner:', existing.member_name, 'at', existing.drawn_at);
      return { 
        ok: false, 
        message: `Putaran ${period} sudah ada pemenang: ${existing.member_name}. Hapus dulu kalau mau undi ulang.` 
      };
    }

    // Ambil candidates
    const cRes = await getCandidates(groupId, period);
    if (!cRes.ok) return cRes;
    const candidates = cRes.data.candidates;
    if (!candidates.length) return { ok: false, message: 'Belum ada kandidat yang tersedia.' };

    // Random
    const idx = Math.floor(Math.random() * candidates.length);
    const winner = candidates[idx];

    console.log('   🏆 Winner:', winner.name, '(#' + winner.number + ')');

    const winnerId = generateId('win');
    await setDoc(doc(db, COLLECTIONS.WINNERS, winnerId), {
      group_id: groupId,
      period_number: period,
      member_id: winner.id,
      member_number: winner.number,
      member_name: winner.name,
      draw_method: 'random',
      draw_order: cRes.data.totalWinners + 1,
      drawn_at: Timestamp.now(),
      notes: notes || ''
    });

    console.log('   ✅ Winner saved:', winnerId);

    return {
      ok: true,
      message: 'Pemenang dipilih.',
      data: {
        id: winnerId,
        group_id: groupId,
        period_number: period,
        member_id: winner.id,
        member_number: winner.number,
        member_name: winner.name,
        draw_method: 'random',
        drawn_at: new Date().toISOString()
      }
    };
  } catch (e) {
    console.error('❌ drawRandomWinner error:', e);
    return { ok: false, message: e.message };
  }
}
// ============================================================
// DRAW WINNER BY NUMBER
// ============================================================
export async function drawWinnerByNumber(groupId, periodNumber, memberNumber, notes) {
  try {
    if (!groupId) return { ok: false, message: 'Data kelompok belum dipilih.' };
    const num = Number(memberNumber);
    if (!num) return { ok: false, message: 'Nomor anggota tidak valid.' };
    const period = Number(periodNumber) || 1;

    // Cek existing
    const winRef = collection(db, COLLECTIONS.WINNERS);
    const winQ = query(winRef, where('group_id', '==', groupId), where('period_number', '==', period));
    const winSnap = await getDocs(winQ);
    if (!winSnap.empty) return { ok: false, message: 'Putaran ini sudah memiliki pemenang.' };

    // Cari anggota
    const cRes = await getCandidates(groupId, period);
    if (!cRes.ok) return cRes;
    const winner = cRes.data.candidates.find(c => Number(c.number) === num);
    if (!winner) return { ok: false, message: 'Nomor anggota tidak ditemukan di kelompok ini.' };

    // Cek sudah pernah menang
    const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
    const allowRepeat = String(groupSnap.data().allow_repeat_winner) === 'true';
    if (!allowRepeat) {
      const allWinQ = query(winRef, where('group_id', '==', groupId));
      const allWinSnap = await getDocs(allWinQ);
      let alreadyWon = false;
      allWinSnap.forEach(d => {
        if (d.data().member_id === winner.id) alreadyWon = true;
      });
      if (alreadyWon) return { ok: false, message: 'Anggota tersebut sudah pernah menjadi pemenang.' };
    }

    const winnerId = generateId('win');
    await setDoc(doc(db, COLLECTIONS.WINNERS, winnerId), {
      group_id: groupId,
      period_number: period,
      member_id: winner.id,
      member_number: winner.number,
      member_name: winner.name,
      draw_method: 'number',
      draw_order: cRes.data.totalWinners + 1,
      drawn_at: Timestamp.now(),
      notes: notes || ''
    });

    return {
      ok: true,
      message: 'Pemenang ditetapkan.',
      data: {
        id: winnerId,
        group_id: groupId,
        period_number: period,
        member_id: winner.id,
        member_number: winner.number,
        member_name: winner.name,
        draw_method: 'number',
        drawn_at: new Date().toISOString()
      }
    };
  } catch (e) {
    console.error('drawWinnerByNumber error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// SET PREDETERMINED WINNER
// ============================================================
export async function setPredeterminedWinner(groupId, periodNumber, memberId, notes) {
  try {
    if (!groupId) return { ok: false, message: 'Data kelompok belum dipilih.' };
    if (!memberId) return { ok: false, message: 'Anggota belum dipilih.' };
    const period = Number(periodNumber) || 1;

    // Cek existing
    const winRef = collection(db, COLLECTIONS.WINNERS);
    const winQ = query(winRef, where('group_id', '==', groupId), where('period_number', '==', period));
    const winSnap = await getDocs(winQ);
    if (!winSnap.empty) return { ok: false, message: 'Putaran ini sudah memiliki pemenang.' };

    // Cek anggota terdaftar di group
    const memberSnap = await getDoc(doc(db, COLLECTIONS.MEMBERS, memberId));
    if (!memberSnap.exists()) return { ok: false, message: 'Anggota tidak ditemukan.' };
    const member = memberSnap.data();

    const groupSnap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
    const allowRepeat = String(groupSnap.data().allow_repeat_winner) === 'true';
    if (!allowRepeat) {
      const allWinQ = query(winRef, where('group_id', '==', groupId));
      const allWinSnap = await getDocs(allWinQ);
      let alreadyWon = false;
      allWinSnap.forEach(d => {
        if (d.data().member_id === memberId) alreadyWon = true;
      });
      if (alreadyWon) return { ok: false, message: 'Anggota tersebut sudah pernah menjadi pemenang.' };
    }

    const totalWinners = winSnap.size;
    const winnerId = generateId('win');
    await setDoc(doc(db, COLLECTIONS.WINNERS, winnerId), {
      group_id: groupId,
      period_number: period,
      member_id: memberId,
      member_number: member.number,
      member_name: member.name,
      draw_method: 'predetermined',
      draw_order: totalWinners + 1,
      drawn_at: Timestamp.now(),
      notes: notes || ''
    });

    return {
      ok: true,
      message: 'Pemenang ditetapkan.',
      data: {
        id: winnerId,
        group_id: groupId,
        period_number: period,
        member_id: memberId,
        member_number: member.number,
        member_name: member.name,
        draw_method: 'predetermined',
        drawn_at: new Date().toISOString()
      }
    };
  } catch (e) {
    console.error('setPredeterminedWinner error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// GET WINNER HISTORY (enriched)
// ============================================================
export async function getWinnerHistory(filter = {}) {
  try {
    const winRef = collection(db, COLLECTIONS.WINNERS);
    const snap = await getDocs(winRef);
    let list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));

    // Enrich dengan group name
    const groupsRef = collection(db, COLLECTIONS.GROUPS);
    const groupsSnap = await getDocs(groupsRef);
    const groupMap = {};
    groupsSnap.forEach(d => { groupMap[d.id] = { id: d.id, ...d.data() }; });

    list = list.map(w => ({
      ...w,
      group_name: groupMap[w.group_id] ? groupMap[w.group_id].name : '-'
    }));

    // Sort by drawn_at desc
    list.sort((a, b) => {
      const da = a.drawn_at?.toDate ? a.drawn_at.toDate() : new Date(a.drawn_at || 0);
      const db2 = b.drawn_at?.toDate ? b.drawn_at.toDate() : new Date(b.drawn_at || 0);
      return db2 - da;
    });

    if (filter) {
      if (filter.group_id && filter.group_id !== 'all') list = list.filter(w => w.group_id === filter.group_id);
      if (filter.method && filter.method !== 'all') list = list.filter(w => w.draw_method === filter.method);
    }

    return { ok: true, data: list };
  } catch (e) {
    console.error('getWinnerHistory error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// REAL-TIME LISTENER untuk winners
// ============================================================
export function subscribeWinners(callback) {
  const winRef = collection(db, COLLECTIONS.WINNERS);
  return onSnapshot(winRef, async (snap) => {
    try {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));

      const groupsRef = collection(db, COLLECTIONS.GROUPS);
      const groupsSnap = await getDocs(groupsRef);
      const groupMap = {};
      groupsSnap.forEach(d => { groupMap[d.id] = { id: d.id, ...d.data() }; });

      const enriched = list.map(w => ({
        ...w,
        group_name: groupMap[w.group_id] ? groupMap[w.group_id].name : '-'
      }));

      enriched.sort((a, b) => {
        const da = a.drawn_at?.toDate ? a.drawn_at.toDate() : new Date(a.drawn_at || 0);
        const db2 = b.drawn_at?.toDate ? b.drawn_at.toDate() : new Date(b.drawn_at || 0);
        return db2 - da;
      });

      callback(enriched);
    } catch (e) {
      console.error('subscribeWinners enrich error:', e);
      callback([]);
    }
  }, (error) => {
    console.error('subscribeWinners error:', error);
  });
}

// ============================================================
// DELETE WINNER
// ============================================================
export async function deleteWinner(id) {
  try {
    const ref = doc(db, COLLECTIONS.WINNERS, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'Data pemenang tidak ditemukan.' };
    await deleteDoc(ref);
    return { ok: true, message: 'Pemenang dihapus.' };
  } catch (e) {
    console.error('deleteWinner error:', e);
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Winners loaded');
