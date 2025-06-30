# Asisten Validasi Presensi Amikom Purwokerto

![Versi](https://img.shields.io/badge/versi-1.0-brightgreen)
![Browser](https://img.shields.io/badge/browser-Chrome-blue)

Ekstensi browser ini adalah sebuah "asisten pribadi" yang dirancang untuk mengotomatiskan proses validasi kehadiran dosen yang repetitif di sistem student AMIKOM Purwokerto. Dibuat untuk menghemat waktu dan mengurangi kebosanan dari pekerjaan manual.

> **Peringatan:** Gunakan dengan bijak. Script ini dibuat untuk membantu mempercepat proses yang repetitif, bukan untuk tujuan lain. Risiko penggunaan ditanggung oleh pengguna.

---

## ✨ Fitur Utama
- **Otomatis Penuh:** Dengan satu klik, script akan menjalankan seluruh proses validasi untuk satu mata kuliah.
- **Pemilihan Cerdas:** Otomatis mendeteksi dan memilih mata kuliah pertama dari daftar yang belum divalidasi.
- **Simulasi Interaksi:** Mampu memunculkan daftar sesi perkuliahan yang tersembunyi dengan mensimulasikan interaksi pengguna secara akurat.
- **Pengisian Form Otomatis:** Otomatis mengisi kuesioner di dalam pop-up validasi dengan jawaban default (Benar, Sesuai, Baik).
- **Proses Berurutan:** Memvalidasi setiap sesi satu per satu dengan jeda yang cukup untuk memastikan stabilitas.

---

## 🚀 Cara Instalasi

Anda hanya perlu melakukan ini satu kali.

1.  **Download Folder Ekstensi**
    -   Pastikan Anda sudah memiliki folder ekstensi yang berisi 2 file: `manifest.json` dan `script.js`. Jika Anda menerimanya dalam format `.zip`, ekstrak terlebih dahulu.

2.  **Buka Halaman Ekstensi Chrome**
    -   Buka browser Google Chrome.
    -   Ketik `chrome://extensions` di address bar dan tekan Enter.

3.  **Aktifkan Mode Pengembang**
    -   Di pojok kanan atas halaman ekstensi, carilah dan aktifkan tombol **"Developer mode"** (Mode Pengembang).
    ![Developer Mode](https://i.imgur.com/g3wM3Fv.png)

4.  **Muat Ekstensi**
    -   Beberapa tombol baru akan muncul. Klik tombol **"Load unpacked"** (Muat yang belum dipaketkan) yang ada di pojok kiri atas.
    ![Load Unpacked](https://i.imgur.com/e4iY0m1.png)

5.  **Pilih Folder**
    -   Sebuah jendela file akan terbuka. Arahkan ke **folder ekstensi** yang sudah Anda siapkan (folder yang berisi `manifest.json` dan `script.js`), lalu klik tombol **"Select Folder"**.

6.  **Selesai!**
    -   Ekstensi "Asisten Validasi Presensi" akan muncul di daftar ekstensi Anda dan langsung aktif. Anda siap untuk menggunakannya.

---

## 📋 Cara Penggunaan

Setiap kali Anda ingin melakukan validasi:

1.  **Buka Halaman Rekap Presensi**
    -   **Login** ke akun student Anda dan buka halaman "Rekap Presensi Kehadiran" seperti biasa.

2.  **Pastikan Kondisi Bersih (Sangat Penting)**
    -   Untuk hasil yang paling stabil, selalu mulai dengan kondisi halaman yang 'bersih'. Lakukan **Hard Refresh** dengan menekan **`Ctrl + F5`** (atau `Cmd + Shift + R` di Mac). Jika menemui masalah, lakukan **Logout** lalu **Login** kembali.

3.  **Jalankan Asisten**
    -   Ekstensi akan secara otomatis menambahkan tombol hijau **"🚀 Jalankan Validasi TOTAL"** di pojok kanan bawah halaman.
    -   Klik tombol tersebut **satu kali saja**.

4.  **Biarkan Bekerja**
    -   Setelah tombol diklik, jangan sentuh mouse atau keyboard Anda.
    -   Anda akan melihat script memilih mata kuliah, memunculkan daftar sesi, dan memvalidasi satu per satu (ditandai dengan pop-up kuesioner yang muncul dan hilang dengan cepat).

5.  **Proses Selesai untuk Satu Matkul**
    -   Setelah semua sesi untuk satu mata kuliah selesai, script akan berhenti.
    -   Untuk lanjut ke mata kuliah berikutnya, cukup **Refresh halaman (F5)** dan klik lagi tombol "Jalankan Validasi TOTAL".

---

## ❓ Troubleshooting

-   **Tombol Hijau Tidak Muncul?**
    -   Pastikan Anda berada di URL halaman rekap presensi yang benar.
    -   Pastikan ekstensi sudah aktif di halaman `chrome://extensions`.
    -   Coba lakukan Hard Refresh (`Ctrl + F5`).

-   **Script 'Stuck' atau Gagal di Tengah Jalan?**
    -   Ini kemungkinan besar karena masalah timing. Solusi terbaik adalah memulai dari awal: Logout, Login kembali, lalu jalankan lagi.