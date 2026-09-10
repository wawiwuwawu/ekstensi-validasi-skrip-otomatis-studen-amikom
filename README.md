# Amikom Student Assistant & Automation Suite (v2.0)

![Versi](https://img.shields.io/badge/versi-2.0.0-purple?style=for-the-badge)
![Manifest](https://img.shields.io/badge/manifest-V3-blue?style=for-the-badge)
![Target](https://img.shields.io/badge/portal-Student%20AMIKOM%20PWT-emerald?style=for-the-badge)
![Status](https://img.shields.io/badge/status-Production%20Ready-brightgreen?style=for-the-badge)

Ekstensi browser Google Chrome (Manifest V3) serbaguna yang dirancang untuk mengotomatiskan tugas-tugas administratif mahasiswa di portal **Student Universitas AMIKOM Purwokerto** (`student.amikompurwokerto.ac.id`). 

Dengan versi 2.0, Anda tidak perlu lagi repot bolak-balik halaman web secara manual. Cukup **login sekali**, lalu buka ekstensi dari toolbar Chrome atau gunakan **Floating Dock** langsung di halaman web!

---

## ✨ Fitur Utama v2.0

### 1. ⚡ Validasi Presensi Otomatis (Direct API Engine)
- **Super Cepat Tanpa Reload:** Memvalidasi seluruh kehadiran dosen dan asisten dosen langsung melalui API backend kampus dalam hitungan detik tanpa reload halaman berulang kali.
- **Deteksi Sesi Cerdas:** Otomatis memindai mata kuliah yang belum divalidasi, membaca sesi perkuliahan aktif (tombol 'B'), dan mengekstrak kuesioner evaluasi.
- **Penilaian Dosen & Asdos Sesuai Data Riil:**
  - **Nilai Dosen:** Pilihan antara *Baik (Opsi 3 - Standar/Wajar)* atau *Sangat Baik (Opsi 4 - Maksimal)*.
  - **Nilai Asisten Dosen:** Konfigurasi penilaian asdos 4 dimensi (*Kehadiran, Pakaian Seragam, Penguasaan Materi, Komunikasi*) dengan pilihan *Wajar (Tepat waktu & Baik)* atau *Maksimal*.
- **Fallback Visual DOM Resilient:** Jika sistem web berubah, tersedia mode simulasi visual interaksi DOM yang didukung `MutationObserver` cerdas (bebas race condition).

### 2. 🎯 War KRS & Rencana Studi Otomatis
- **Pemantau SKS Real-Time:** Menampilkan jumlah SKS yang diajukan dan terisi secara langsung.
- **Fast Snipe Matkul:** Cari kode/nama mata kuliah yang ditawarkan, pilih checkbox, dan ajukan paket KRS secara instan dengan 1 klik.
- **Auto-Retry Cerdas:** Otomatis mengulang pengiriman jika server kampus sedang *high-load*, *lag*, atau *timeout* saat jam rebutan kelas dibuka.
- **Sinkronisasi KRS:** Tombol 1-klik untuk menyinkronkan data rencana studi Anda dengan server universitas.

### 3. 📅 Jadwal Ujian & Kalender Akademik
- **Jadwal Ujian (UAS & UTS):** Lihat daftar mata kuliah yang diujikan lengkap dengan hari, tanggal, jam pelaksanaan, dan ruang ujian tanpa perlu mengunduh kartu manual.
- **Agenda Akademik:** Memantau batas waktu pengajuan KRS, pendaftaran seminar proposal, skripsi, dan cuti akademik.
- **Pengumuman Resmi Kampus:** Menampilkan pengumuman penting langsung di popup.

### 4. 🎨 Antarmuka Modern & Ergonomis (UI/UX)
- **Popup Dashboard (420x560px):** Bertema *Modern Dark Slate & Amikom Purple* yang elegan, bebas layout shift, dilengkapi status koneksi aktif, live progress bar, dan terminal log aktivitas.
- **In-Page Floating Dock:** Tombol mengambang di halaman student yang dapat dibuka/tutup kapan saja untuk menjalankan validasi cepat atau melihat sesi tertunda.

---

## 🚀 Cara Instalasi

Anda hanya perlu memasang ekstensi ini satu kali:

1. **Unduh / Siapkan Folder Ekstensi**
   Pastikan folder repositori ini berisi:
   ```plaintext
   ├── manifest.json
   ├── README.md
   ├── script.js
   ├── icons/
   │   ├── icon-16.png
   │   ├── icon-32.png
   │   ├── icon-48.png
   │   └── icon-128.png
   ├── lib/
   │   ├── amikom-api.js
   │   └── krs-scheduler.js
   └── popup/
       ├── popup.html
       ├── popup.css
       └── js/
           ├── core.js          (state, api, helper DOM)
           ├── app-util.js      (toast, log, klasifikasi respon)
           ├── tab-presensi.js  (validasi presensi)
           ├── tab-akademik.js  (jadwal, agenda, pengumuman)
           ├── krs-data.js      (load & transform matkul)
           ├── krs-controls.js  (prioritas kelas & pengaturan)
           ├── krs-plan.js      (optimasi jadwal & render timetable)
           ├── krs-war.js       (eksekusi & bot War KRS)
           └── init.js          (bootstrap & bind event)
   ```

2. **Buka Halaman Ekstensi Chrome**
   - Buka Google Chrome.
   - Ketik `chrome://extensions` pada address bar lalu tekan **Enter**.

3. **Aktifkan Developer Mode (Mode Pengembang)**
   - Nyalakan saklar **"Developer mode"** di pojok kanan atas.

4. **Muat Ekstensi (Load Unpacked)**
   - Klik tombol **"Load unpacked"** (Muat yang belum dipaketkan) di pojok kiri atas.
   - Pilih folder repositori ini.

5. **Pin Ekstensi ke Toolbar**
   - Klik ikon *Puzzle* (Extensions) di pojok kanan atas browser Anda, lalu klik ikon **Pin (Sematkan)** pada *Amikom Student Assistant*.

---

## 📋 Panduan Penggunaan

### Cara 1: Menggunakan Popup Dashboard (Direkomendasikan)
1. Buka tab browser dan **Login** ke `https://student.amikompurwokerto.ac.id`.
2. Klik ikon ekstensi **⚡ Amikom Assistant** di toolbar browser Anda.
3. Status ekstensi akan langsung berubah menjadi **"Terhubung"** (badge hijau).
4. Pilih tab yang Anda butuhkan:
   - **Tab Presensi:** Pilih opsi nilai dosen/asdos yang diinginkan, lalu klik **"🚀 Jalankan Validasi Otomatis (Cepat)"**. Sesi akan tervalidasi secara instan dengan log aktivitas langsung.
   - **Tab War KRS:** Pilih mata kuliah target dan klik **"🎯 Ajukan Rencana Mata Kuliah"**.
   - **Tab Jadwal & Info:** Lihat jadwal UAS/UTS dan agenda kalender akademik terkini.

### Cara 2: Menggunakan Floating Dock di Halaman Web
1. Buka halaman `https://student.amikompurwokerto.ac.id/pembelajaran/rekap_presensi` (atau halaman student lainnya).
2. Di pojok kanan bawah, Anda akan melihat tombol pill ungu **"⚡ Asisten Amikom"** lengkap dengan badge jumlah sesi yang belum divalidasi.
3. Klik tombol tersebut untuk membuka laci interaktif, lalu pilih **"🚀 Jalankan Validasi Cepat"** atau **"👁️ Mode Simulasi Visual"**.

---

## ⚙️ Detail Penilaian Default vs Maksimal

| Kategori | Pertanyaan | Opsi Default / Wajar | Opsi Maksimal |
| :--- | :--- | :--- | :--- |
| **Dosen** | Kesesuaian Perkuliahan | Benar (`value=1`) | Benar (`value=1`) |
| **Dosen** | Kesesuaian Materi | Ya sesuai (`value=1`) | Ya sesuai (`value=1`) |
| **Dosen** | Penilaian Umum | **Baik** (`value=3`) | **Sangat Baik** (`value=4`) |
| **Asdos** | Kehadiran Asisten | Selalu Tepat Waktu (`nilai=1`) | Selalu Tepat Waktu (`nilai=1`) |
| **Asdos** | Pakaian Seragam Rapi | Selalu sesuai (`nilai=5`) | Selalu sesuai (`nilai=5`) |
| **Asdos** | Penguasaan Materi | **Baik** (`nilai=10`) | **Sangat Baik** (`nilai=9`) |
| **Asdos** | Komunikatif | **Baik** (`nilai=14`) | **Sangat Baik** (`nilai=13`) |

> **Catatan:** Pengaturan penilaian dapat diubah kapan saja melalui menu dropdown di dalam tab Presensi pada Popup ekstensi.

---

## ❓ Troubleshooting & FAQ

- **Status menunjukkan "Belum Login"?**
  - Pastikan Anda sudah login di portal `https://student.amikompurwokerto.ac.id`.
  - Klik tombol **"Buka Halaman Login"** pada ekstensi, lakukan login, lalu klik tombol **↻ (Refresh)** di pojok kanan atas popup ekstensi.
- **Apakah perlu membiarkan tab rekap presensi tetap terbuka saat validasi?**
  - Tidak perlu! Direct API Engine berjalan langsung melalui background fetch dengan cookie login Anda. Anda bisa menjalankannya langsung dari Popup tanpa perlu membuka halaman rekap presensi.
- **Otomasi War KRS gagal submit?**
  - Pastikan periode KRS di sistem akademik kampus memang sudah dibuka.
  - Aktifkan fitur **"Auto-retry"** pada tab War KRS agar ekstensi otomatis mencoba kembali jika server sedang kelebihan beban (*high-traffic*).

---

## 🛡️ Disclaimer
Ekstensi ini dibuat semata-mata sebagai alat bantu untuk mempermudah kegiatan administratif mahasiswa. Seluruh risiko dan ketentuan penggunaan akun berada di bawah tanggung jawab masing-masing pengguna. Gunakan secara wajar dan bertanggung jawab.
