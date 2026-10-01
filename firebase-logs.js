/**
 * ============================================================
 * ARISANKITA - FIREBASE LOGS
 * ============================================================
 * Catat aktivitas admin + lihat riwayat
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
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  generateId,
  nowTimestamp
} from './firebase-config.js';

// ============================================================
// GET LOGS
// ============================================================
export async function getLogs(limitCount = 200) {
  try {
    const ref = collection(db, COLLECTIONS.LOGS);
    const snap = await getDocs(ref);
    let list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));

    // Sort by created_at desc
    list.sort((a, b) => {
      const da = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
      const db2 = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
      return db2 - da;
    });

    return { ok: true, data: list.slice(0, limitCount) };
  } catch (e) {
    console.error('getLogs error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// REAL-TIME LISTENER
// ============================================================
export function subscribeLogs(callback) {
  const ref = collection(db, COLLECTIONS.LOGS);
  return onSnapshot(ref, (snap) => {
    try {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const da = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
        const db2 = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
        return db2 - da;
      });
      callback(list.slice(0, 200));
    } catch (e) {
      console.error('subscribeLogs error:', e);
      callback([]);
    }
  }, (error) => {
    console.error('subscribeLogs listen error:', error);
  });
}

// ============================================================
// LOG COLLECTOR (untuk dipakai modul lain)
// ============================================================
let _logsCollector = null;

export function getLogsCollector() {
  if (_logsCollector) return _logsCollector;

  _logsCollector = {
    async log(action, description, user) {
      try {
        const id = generateId('log');
        await setDoc(doc(db, COLLECTIONS.LOGS, id), {
          action: action,
          description: description,
          user: user || 'admin',
          created_at: Timestamp.now()
        });
        return { ok: true, id };
      } catch (e) {
        console.warn('writeLog error:', e);
        return { ok: false, message: e.message };
      }
    }
  };

  return _logsCollector;
}

// ============================================================
// WRITE LOG (langsung, untuk dipakai internal)
// ============================================================
export async function writeLog(action, description, user) {
  return getLogsCollector().log(action, description, user);
}

console.log('✅ Firebase Logs loaded');