/**
 * ============================================================
 * ARISANKITA - FIREBASE NOTIFICATIONS
 * ============================================================
 * Notifikasi internal + real-time listener + auto-generate
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
  query,
  where,
  orderBy,
  onSnapshot,
  limit,
  Timestamp,
  generateId,
  nowTimestamp
} from './firebase-config.js';

// ============================================================
// GET NOTIFICATIONS
// ============================================================
export async function getNotifications(filter = {}) {
  try {
    const ref = collection(db, COLLECTIONS.NOTIFICATIONS);
    const snap = await getDocs(ref);
    let list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));

    // Sort by created_at desc
    list.sort((a, b) => {
      const da = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
      const db2 = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
      return db2 - da;
    });

    if (filter && filter.status && filter.status !== 'all') {
      list = list.filter(n => n.status === filter.status);
    }

    return { ok: true, data: list.slice(0, 100) };
  } catch (e) {
    console.error('getNotifications error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// REAL-TIME LISTENER untuk notifications
// ============================================================
export function subscribeNotifications(callback) {
  const ref = collection(db, COLLECTIONS.NOTIFICATIONS);
  return onSnapshot(ref, (snap) => {
    try {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const da = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
        const db2 = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
        return db2 - da;
      });
      callback(list);
    } catch (e) {
      console.error('subscribeNotifications error:', e);
      callback([]);
    }
  }, (error) => {
    console.error('subscribeNotifications error:', error);
  });
}

// ============================================================
// ADD NOTIFICATION
// ============================================================
export async function addNotification(title, message, type) {
  try {
    const id = generateId('ntf');
    await setDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id), {
      title: title,
      message: message,
      type: type || 'system',
      status: 'unread',
      created_at: Timestamp.now()
    });
    return { ok: true, id };
  } catch (e) {
    console.error('addNotification error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// MARK AS READ
// ============================================================
export async function markNotificationAsRead(id) {
  try {
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id), { status: 'read' });
    return { ok: true };
  } catch (e) {
    console.error('markNotificationAsRead error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// MARK ALL AS READ
// ============================================================
export async function markAllNotificationsRead() {
  try {
    const ref = collection(db, COLLECTIONS.NOTIFICATIONS);
    const q = query(ref, where('status', '==', 'unread'));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, d.id), { status: 'read' });
    }
    return { ok: true };
  } catch (e) {
    console.error('markAllNotificationsRead error:', e);
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Notifications loaded');