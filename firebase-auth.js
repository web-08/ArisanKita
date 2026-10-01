/**
 * ============================================================
 * ARISANKITA - FIREBASE AUTH (ES MODULE)
 * ============================================================
 */

import {
  auth,
  db,
  COLLECTIONS,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from './firebase-config.js';

// ============================================================
// LOGIN
// ============================================================
export async function loginAdmin(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log('✅ Login berhasil:', user.email);

    // Update last login ke Firestore
    try {
      const settingsRef = doc(db, COLLECTIONS.SETTINGS, 'app');
      const settingsSnap = await getDoc(settingsRef);
      const updateData = {
        last_login: Timestamp.now(),
        last_login_user: user.email
      };
      if (settingsSnap.exists()) {
        await setDoc(settingsRef, updateData, { merge: true });
      } else {
        await setDoc(settingsRef, {
          app_name: 'ArisanKita',
          currency: 'IDR',
          timezone: 'Asia/Jakarta',
          ...updateData
        });
      }
    } catch (e) {
      console.warn('Update last login error:', e);
    }

    return { ok: true, user: { email: user.email, uid: user.uid } };
  } catch (error) {
    console.error('❌ Login error:', error);
    let message = 'Terjadi kesalahan. Coba lagi.';
    switch (error.code) {
      case 'auth/invalid-email':
        message = 'Format email tidak valid.';
        break;
      case 'auth/user-not-found':
        message = 'Email tidak terdaftar.';
        break;
      case 'auth/wrong-password':
        message = 'Password salah.';
        break;
      case 'auth/invalid-credential':
        message = 'Email atau password salah.';
        break;
      case 'auth/user-disabled':
        message = 'Akun dinonaktifkan.';
        break;
      case 'auth/too-many-requests':
        message = 'Terlalu banyak percobaan. Coba lagi nanti.';
        break;
      case 'auth/network-request-failed':
        message = 'Koneksi internet bermasalah.';
        break;
      case 'auth/unauthorized-domain':
        message = 'Domain ini belum diizinkan di Firebase Console. Hubungi developer.';
        break;
      default:
        message = error.message || 'Login gagal.';
    }
    return { ok: false, message: message };
  }
}

// ============================================================
// LOGOUT
// ============================================================
export async function logoutAdmin(reason) {
  try {
    await signOut(auth);
    try {
      if (reason) localStorage.setItem('arisan_logout_reason', reason);
    } catch (e) {}
    console.log('✅ Logout berhasil');
    window.location.href = 'login.html';
  } catch (error) {
    console.error('❌ Logout error:', error);
    window.location.href = 'login.html';
  }
}

// ============================================================
// CEK SESSION
// ============================================================
export function checkAuth() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user ? { ok: true, user: { email: user.email, uid: user.uid } } : { ok: false });
    });
  });
}

// ============================================================
// REQUIRE AUTH
// ============================================================
export async function requireAuth() {
  const result = await checkAuth();
  if (!result.ok) {
    console.log('❌ Not logged in, redirect to login');
    window.location.href = 'login.html';
    return false;
  }
  return result.user;
}

console.log('✅ Firebase Auth loaded');