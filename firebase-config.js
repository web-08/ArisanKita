// ============================================================
// 1. FIREBASE CONFIG - GANTI DENGAN PUNYA ANDA
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyALBTCM1miyvL0vwEKaUjEwoR1fUO2EL9g",
  authDomain: "munira-arisan.firebaseapp.com",
  projectId: "munira-arisan",
  storageBucket: "munira-arisan.firebasestorage.app",
  messagingSenderId: "40867034873",
  appId: "1:40867034873:web:d5390a7bfd49ef97975428",
};

// ============================================================
// 2. IMPORT FIREBASE SDK
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
// 3. INISIALISASI
// ============================================================
const app = initializeApp(firebaseConfig);

// Firestore dengan persistent cache (API baru)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const auth = getAuth(app);

// Set persistence = LOCAL (biar login tetap setelah refresh)
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn('Auth persistence error:', err);
});

// ============================================================
// 4. COLLECTION REFERENCE
// ============================================================
const COLLECTIONS = {
  MEMBERS: 'members',
  GROUPS: 'groups',
  GROUP_MEMBERS: 'group_members',
  PAYMENTS: 'payments',
  WINNERS: 'winners',
  TRANSACTIONS: 'transactions',
  NOTIFICATIONS: 'notifications',
  LOGS: 'logs',
  SETTINGS: 'settings'
};

// ============================================================
// 5. EXPORT SEMUA
// ============================================================
export {
  app,
  db,
  auth,
  COLLECTIONS,
  // Firestore SDK
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
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  Timestamp,
  // Auth SDK
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
};

// ============================================================
// 6. HELPER FUNCTIONS (bisa diakses via import)
// ============================================================
export function generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

export function nowTimestamp() {
  return Timestamp.now();
}

export function timestampToString(ts) {
  if (!ts) return '';
  if (ts.toDate) {
    const d = ts.toDate();
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (ts instanceof Date) {
    return ts.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return String(ts);
}

export function timestampToDateTime(ts) {
  if (!ts) return '-';
  if (ts.toDate) {
    const d = ts.toDate();
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (ts instanceof Date) {
    return ts.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return String(ts);
}

export function formatIDR(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

export function normalizePhone(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '62' + p.substring(1);
  if (p.startsWith('8')) p = '62' + p;
  return p;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

export function fillTemplate(template, vars) {
  let t = template || '';
  Object.keys(vars).forEach(k => {
    t = t.replace(new RegExp('\\[' + k + '\\]', 'g'), vars[k]);
  });
  return t;
}

export function openWhatsApp(phone, message) {
  const p = normalizePhone(phone);
  if (!p) { alert('Nomor HP tidak valid.'); return false; }
  const url = 'https://wa.me/' + p + '?text=' + encodeURIComponent(message);
  window.open(url, '_blank');
  return true;
}

console.log('✅ Firebase initialized:', firebaseConfig.projectId);