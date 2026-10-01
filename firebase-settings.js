/**
 * ============================================================
 * ARISANKITA - FIREBASE SETTINGS
 * ============================================================
 * Baca/tulis settings aplikasi
 * ============================================================
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  Timestamp
} from './firebase-config.js';

const SETTINGS_DOC = 'app';

// ============================================================
// GET SETTINGS
// ============================================================
export async function getSettings() {
  try {
    const ref = doc(db, 'settings', SETTINGS_DOC);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      // Buat default
      const defaultSettings = {
        app_name: 'ArisanKita',
        currency: 'IDR',
        timezone: 'Asia/Jakarta',
        wa_template_reminder: 'Halo [nama] 👋\n\nMengingatkan iuran arisan *[kelompok]*:\n\n📅 Putaran: [putaran]\n💰 Jumlah: [jumlah]\n⏰ Jatuh tempo: [tanggal]\n\nMohon segera ditunaikan. Terima kasih 🙏\n\n— Admin',
        wa_template_lunas: 'Terima kasih [nama] ✅\n\nPembayaran iuran *[kelompok]* Putaran [putaran] sebesar [jumlah] telah kami terima.\n\nTerima kasih 🙏\n— Admin',
        wa_template_pemenang: 'Selamat [nama] 🎉\n\nAnda terpilih sebagai pemenang arisan *[kelompok]* Putaran [putaran]!\n\nSilakan hubungi admin untuk pengambilan hadiah.\n\n— Admin',
        created_at: Timestamp.now(),
        updated_at: Timestamp.now()
      };
      await setDoc(ref, defaultSettings);
      return { ok: true, data: defaultSettings };
    }
    return { ok: true, data: snap.data() };
  } catch (e) {
    console.error('getSettings error:', e);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// UPDATE SETTINGS
// ============================================================
export async function updateSettings(data) {
  try {
    const ref = doc(db, 'settings', SETTINGS_DOC);
    await setDoc(ref, {
      ...data,
      updated_at: Timestamp.now()
    }, { merge: true });
    return { ok: true, message: 'Pengaturan disimpan.' };
  } catch (e) {
    console.error('updateSettings error:', e);
    return { ok: false, message: e.message };
  }
}

console.log('✅ Firebase Settings loaded');