/**
 * Amikom Student Assistant - Popup: Modul Data KRS (App.krsData)
 * Sumber data KRS & penawaran:
 *  - Tab 2 (/akademik/makul_pengajuan_diambil) -> warKrsState.verifiedCourses. Selalu dimuat,
 *    tidak bergantung status KRS; portal tidak merilis kelas/hari/jam di tab ini.
 *  - Tab 3 (/akademik/makul_belum_diisi_mbkm)  -> form "Isi KRS / Pilih Kelas Perkuliahan":
 *    penawaran kelas + hari/jam/ruang, value untuk act=rencana_studi.
 *    -> warKrsState.offeringSource = 'tab3'.
 *  - Tab 4 (/akademik/get_jadwal?mod=kuliah_mbkm) -> pelengkap hari/jam/ruang (matching kode).
 *  - Tab 1 (/akademik/get_mkl_ditawarkan)      -> fallback paket pengajuan matkul, value untuk
 *    act=rencana_pengajuan_maba -> warKrsState.offeringSource = 'tab1'.
 * Tidak ada data kelas/jadwal yang difabrikasi: hasOfferingData/hasScheduleData hanya true bila
 * portal benar-benar mengirimnya.
 * Dimuat setelah core.js, app-util.js, krs-plan.js, krs-controls.js.
 */
(function () {
  'use strict';

  const App = window.AppKrs;
  const $ = App.core.$;
  const api = App.core.api;
  const state = App.core.state;
  const warKrsState = App.core.warKrsState;

  // Sentinel: portal tidak mengirim sisa kuota untuk kelas ini. Nilai 99 berarti
  // "kuota tidak diketahui" — BUKAN konfirmasi bahwa kelas masih terbuka.
  const UNKNOWN_QUOTA_SENTINEL = 99;

  // Ekstraksi huruf kelas dari label apa pun (Tab 3/Tab 1). Kosong -> '' (tidak di-default 'A').
  function toClassLetter(rawKelas) {
    const raw = String(rawKelas || '').trim();
    if (!raw) return '';
    if (typeof KrsScheduler !== 'undefined' && KrsScheduler && typeof KrsScheduler.extractClassLetter === 'function') {
      return String(KrsScheduler.extractClassLetter(raw) || '').trim();
    }
    const upper = raw.toUpperCase();
    const match = upper.match(/\b([A-Z])\b/) || upper.match(/([A-Z0-9]+)$/);
    return match ? match[1] : upper;
  }

  // Normalisasi SATU opsi kelas nyata dari portal. Field yang tidak dikenal diteruskan apa adanya
  // agar data portal (mis. jam_mulai/jam_selesai/sessions) tidak hilang.
  function normalizeClassEntry(rawClass, course) {
    const rawKelas = String(rawClass.kelas || rawClass.nama_kelas || '').trim();
    const entry = Object.assign({}, rawClass);

    entry.id = rawClass.id || (rawKelas ? `${course.kode}_${rawKelas}` : course.kode);
    // value dikirim apa adanya ke portal (tanpa trim) agar token form tidak berubah;
    // kekosongan diperiksa terpisah lewat hasSubmittableClassValue().
    entry.value = (rawClass.value === undefined || rawClass.value === null) ? '' : String(rawClass.value);
    // Kelas tanpa label ditandai eksplisit sebagai kosong (tidak lagi disenyapkan jadi 'A').
    entry.kelas = rawKelas;
    entry.nama_kelas = rawKelas;
    entry.classLetter = toClassLetter(rawKelas);
    entry.sks = parseInt(rawClass.sks, 10) || course.sks || 0;
    const rawQuota = (typeof rawClass.sisaKuota !== 'undefined') ? rawClass.sisaKuota
      : (typeof rawClass.kuotaSisa !== 'undefined') ? rawClass.kuotaSisa
      : (typeof rawClass.sisa_kuota !== 'undefined') ? rawClass.sisa_kuota
      : null;
    // null = portal tidak mengirim kuota -> sentinel "kuota tidak diketahui" (99),
    // bukan 0 (yang akan salah dianggap kelas penuh) dan bukan klaim kelas terbuka.
    entry.sisaKuota = (rawQuota === null || rawQuota === '') ? UNKNOWN_QUOTA_SENTINEL : rawQuota;
    entry.disabled = Boolean(rawClass.disabled);
    entry.hari = String(rawClass.hari || '').trim();
    entry.jam = String(rawClass.jam || '').trim();
    entry.ruang = String(rawClass.ruang || '').trim();
    entry.sessions = Array.isArray(rawClass.sessions) ? rawClass.sessions : [];

    return entry;
  }

  // Mengonversi penawaran mata kuliah nyata dari portal (Tab 3/Tab 1) ke struktur
  // warKrsState.offeringCourses. Menerima baris datar (satu kelas per baris) maupun
  // struktur yang sudah berisi .classes.
  function transformOfferingsToCourses(offeredCourses) {
    if (!Array.isArray(offeredCourses) || offeredCourses.length === 0) {
      return [];
    }

    const courseMap = new Map();
    offeredCourses.forEach((item) => {
      if (!item) return;
      const kode = String(item.kode || item.kode_mk || '').trim();
      // Baris tanpa kode mata kuliah tidak bisa dipetakan/direncanakan -> dilewati.
      // Tidak ada lagi default 'MK' secara senyap.
      if (!kode) return;

      if (!courseMap.has(kode)) {
        courseMap.set(kode, {
          id: item.id || kode,
          kode: kode,
          nama: String(item.nama || kode).trim(),
          sks: parseInt(item.sks, 10) || 0,
          isUlang: Boolean(item.isUlang),
          classes: []
        });
      }

      const course = courseMap.get(kode);
      const rawClasses = (Array.isArray(item.classes) && item.classes.length > 0) ? item.classes : [item];
      rawClasses.forEach((rawClass) => {
        course.classes.push(normalizeClassEntry(rawClass || {}, course));
      });
    });

    return Array.from(courseMap.values());
  }

  // Mengonversi mata kuliah yang sudah diambil & terverifikasi (Tab 2: makul_pengajuan_diambil).
  // Hanya field riil dari portal; kelas/jadwal TIDAK difabrikasi (classes selalu kosong di sini).
  function transformTakenCoursesToCourses(makulDiajukan) {
    if (!Array.isArray(makulDiajukan) || makulDiajukan.length === 0) {
      return [];
    }
    return makulDiajukan.map((m) => {
      const kode = String(m.KODE || '').trim();
      const nama = String(m.MKL || kode).trim();
      const sks = parseInt(m.SKS, 10) || 0;

      return {
        id: `MK_${kode}`,
        kode,
        nama,
        sks,
        aktivasi: m.AKTIVASI,
        idKrs: m.ID_KRS,
        classes: []
      };
    });
  }

  // true bila minimal satu kelas punya value form non-kosong — syarat data benar-benar
  // bisa diajukan ke portal (rencana_studi untuk Tab 3, rencana_pengajuan_maba untuk Tab 1).
  function hasSubmittableClassValue(courses) {
    return (courses || []).some((c) =>
      Array.isArray(c.classes) && c.classes.some((cls) => String(cls.value || '').trim() !== '')
    );
  }

  // Tab 3 — form "Isi KRS / Pilih Kelas Perkuliahan". api.getKelasForm() mengembalikan
  // { ok, raw, hasForm, options } (options = hasil api.parseKelasForm); array atau HTML mentah
  // juga diterima agar kontrak tetap toleran. Kegagalan di sini bukan error fatal:
  // Tab 1 masih bisa jadi fallback.
  async function fetchKelasFormCourses() {
    if (typeof api.getKelasForm !== 'function') return [];
    try {
      const raw = await api.getKelasForm();
      let items = [];
      if (Array.isArray(raw)) {
        items = raw;
      } else if (raw && Array.isArray(raw.options)) {
        // Form benar-benar ada -> pakai opsi kelasnya; hasForm false berarti portal belum merilis.
        if (raw.hasForm !== false) items = raw.options;
      } else if (raw && Array.isArray(raw.courses)) {
        items = raw.courses;
      } else if (typeof raw === 'string' && typeof api.parseKelasForm === 'function') {
        const parsed = api.parseKelasForm(raw);
        items = Array.isArray(parsed) ? parsed : [];
      }
      return transformOfferingsToCourses(items);
    } catch (err) {
      App.util.warLog('warn', `Form pemilihan kelas (Tab 3) tidak dapat dibaca: ${err.message}`);
      return [];
    }
  }

  // Tab 4 — tabel jadwal kuliah: pelengkap hari/jam/ruang. Hanya mengisi field yang masih
  // kosong; data dari Tab 3 tidak pernah ditimpa. Tanpa Tab 4, hasScheduleData tetap false.
  async function enrichScheduleFromTab4(courses) {
    if (typeof api.getJadwalKuliah !== 'function') return courses;

    let rows = [];
    try {
      const raw = await api.getJadwalKuliah();
      if (Array.isArray(raw)) {
        rows = raw;
      } else if (raw && Array.isArray(raw.rows)) {
        rows = raw.rows;
      } else if (typeof raw === 'string' && typeof api.parseJadwalKuliah === 'function') {
        const parsed = api.parseJadwalKuliah(raw);
        rows = Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      App.util.warLog('warn', `Jadwal kuliah (Tab 4) tidak dapat dibaca: ${err.message}`);
      return courses;
    }

    if (rows.length === 0) return courses;

    const rowsByKode = new Map();
    rows.forEach((row) => {
      if (!row) return;
      const kode = String(row.kode || row.kode_mk || '').trim().toUpperCase();
      if (!kode) return;
      if (!rowsByKode.has(kode)) rowsByKode.set(kode, []);
      rowsByKode.get(kode).push(row);
    });

    courses.forEach((course) => {
      const matches = rowsByKode.get(String(course.kode || '').trim().toUpperCase());
      if (!matches || matches.length === 0) return;

      course.classes.forEach((cls) => {
        const clsKelas = String(cls.kelas || '').trim().toUpperCase();
        const row = matches.find((r) => String(r.kelas || r.nama_kelas || '').trim().toUpperCase() === clsKelas) || matches[0];
        if (!String(cls.hari || '').trim()) cls.hari = String(row.hari || '').trim();
        if (!String(cls.jam || '').trim()) cls.jam = String(row.jam || '').trim();
        if (!String(cls.ruang || '').trim()) cls.ruang = String(row.ruang || '').trim();
      });
    });

    return courses;
  }

  // Auto-detect seluruh huruf kelas unik yang ditawarkan
  function detectAvailableClassLetters(courses = []) {
    const letterSet = new Set();
    (courses || []).forEach((course) => {
      if (Array.isArray(course.classes)) {
        course.classes.forEach((cls) => {
          const raw = cls.kelas || cls.nama_kelas || '';
          const match = String(raw).trim().toUpperCase().match(/\b([A-Z])\b/) || String(raw).trim().toUpperCase().match(/([A-Z0-9]+)$/);
          const letter = match ? match[1] : String(raw).trim().toUpperCase();
          if (letter && letter !== '-' && letter !== 'LAIN') letterSet.add(letter);
        });
      }
      if (course.kelas) {
        const match = String(course.kelas).trim().toUpperCase().match(/\b([A-Z])\b/) || String(course.kelas).trim().toUpperCase().match(/([A-Z0-9]+)$/);
        const letter = match ? match[1] : String(course.kelas).trim().toUpperCase();
        if (letter && letter !== '-' && letter !== 'LAIN') letterSet.add(letter);
      }
    });

    const sorted = Array.from(letterSet).sort();
    return sorted.length > 0 ? sorted : ['A', 'B', 'C', 'D'];
  }

  // Render daftar mata kuliah yang sudah terverifikasi milik mahasiswa (selalu dari verifiedCourses)
  function renderVerifiedCoursesList() {
    const container = $('krs-verified-courses-list');
    const summaryBadge = $('verified-courses-summary');
    const list = Array.isArray(warKrsState.verifiedCourses) ? warKrsState.verifiedCourses : [];
    const totalSks = list.reduce((acc, c) => acc + (parseInt(c.sks, 10) || 0), 0);

    if (summaryBadge) {
      summaryBadge.textContent = `${totalSks} SKS Terverifikasi`;
    }

    if (!container) return;
    container.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'verified-course-item';
      empty.textContent = 'Belum ada mata kuliah terdaftar pada semester ini.';
      container.appendChild(empty);
      return;
    }

    list.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'verified-course-item';
      item.innerHTML = `
        <div class="verified-course-title">${c.kode} - ${c.nama}</div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="badge badge-outline">${c.sks} SKS</span>
          <span class="badge badge-success">✓ Terdaftar</span>
        </div>
      `;
      container.appendChild(item);
    });
  }

  // Muat ulang data KRS: Tab 2 (selalu), lalu penawaran dua tingkat Tab 3 -> Tab 1.
  async function loadKrsData() {
    if (!state.isLoggedIn) return;

    // --- Tab 2 — daftar mata kuliah terdaftar; satu-satunya sumber verifiedCourses ---
    let overview = null;
    try {
      overview = await api.getKrsOverview();
    } catch (err) {
      App.util.warLog('error', `Gagal memuat daftar mata kuliah terdaftar (Tab 2): ${err.message}`);
    }

    warKrsState.verifiedCourses = transformTakenCoursesToCourses(overview && overview.makulDiajukan);

    const totalSks = warKrsState.verifiedCourses.reduce((acc, c) => acc + (parseInt(c.sks, 10) || 0), 0);
    const statusTextEl = $('krs-sks-status-text');
    if (statusTextEl) {
      statusTextEl.textContent = `${warKrsState.verifiedCourses.length} Matkul • ${totalSks} SKS Terverifikasi`;
    }
    // Render hasil Tab 2 sebelum menunggu penawaran portal: daftar terverifikasi tidak boleh
    // tertahan oleh lambat/gagalnya Tab 3 atau Tab 1.
    renderVerifiedCoursesList();

    // --- Penawaran kelas: Tab 3 (utama, punya hari/jam/ruang) -> Tab 1 (fallback paket) ---
    let offerings = [];
    let offeringSource = null;

    const tab3Courses = await fetchKelasFormCourses();
    if (hasSubmittableClassValue(tab3Courses)) {
      offerings = await enrichScheduleFromTab4(tab3Courses);
      offeringSource = 'tab3';
    } else {
      let tab1Courses = [];
      try {
        tab1Courses = transformOfferingsToCourses(await api.getMakulDitawarkan());
      } catch (err) {
        App.util.warLog('warn', `Penawaran paket pengajuan tidak dapat dibaca (Tab 1): ${err.message}`);
      }

      if (hasSubmittableClassValue(tab1Courses)) {
        offerings = tab1Courses;
        offeringSource = 'tab1';
      } else {
        // Tidak ada nilai form yang bisa diajukan di kedua sumber: tetap tampilkan penawaran
        // yang terbaca (bila ada) tapi offeringSource null -> perencana jadwal dinonaktifkan.
        offerings = tab3Courses.length > 0 ? tab3Courses : tab1Courses;
        offeringSource = null;
      }
    }

    warKrsState.offeringCourses = offerings;
    warKrsState.offeringSource = offeringSource;
    warKrsState.hasOfferingData = offerings.length > 0 && hasSubmittableClassValue(offerings);
    // Klaim jadwal/bentrok hanya sah bila portal benar-benar mengirim hari DAN jam.
    warKrsState.hasScheduleData = offerings.some((c) =>
      Array.isArray(c.classes) && c.classes.some((cls) => String(cls.hari || '').trim() !== '' && String(cls.jam || '').trim() !== '')
    );

    const sourceLabel = offeringSource === 'tab3'
      ? 'Tab 3 (form pilih kelas)'
      : (offeringSource === 'tab1' ? 'Tab 1 (paket pengajuan matkul)' : 'tidak ada');
    App.util.warLog('info', `${warKrsState.verifiedCourses.length} mata kuliah terdaftar • ${totalSks} SKS (Tab 2). Sumber penawaran: ${sourceLabel} — ${offerings.length} mata kuliah.`);

    if (!warKrsState.hasScheduleData) {
      const suffix = warKrsState.hasOfferingData ? '' : ' Tidak ada paket kelas dengan nilai form yang bisa diajukan.';
      App.util.warLog('warn', `Jadwal kelas belum dirilis portal — rencana hanya berisi paket kelas, tanpa jam/hari.${suffix}`);
    }

    if (warKrsState.hasOfferingData) {
      const detected = detectAvailableClassLetters(warKrsState.offeringCourses);
      if (detected.length > 0) {
        warKrsState.availableClasses = detected;
        const validPriority = (warKrsState.classPriority || []).filter((c) => detected.includes(c));
        if (validPriority.length > 0) warKrsState.classPriority = validPriority;
      }
      if (App.krsControls && typeof App.krsControls.renderPriorityControls === 'function') {
        App.krsControls.renderPriorityControls();
      }
      App.krsPlan.runWarKrsOptimization();
    } else {
      warKrsState.combinations = [];
      warKrsState.activePlan = null;
      const resultCard = $('krs-result-card');
      if (resultCard) resultCard.classList.add('hidden');
    }
  }

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.krsData = {
    transformOfferingsToCourses,
    transformTakenCoursesToCourses,
    detectAvailableClassLetters,
    renderVerifiedCoursesList,
    loadKrsData
  };
})();
