/**
 * KRS Scheduler Engine - Universitas AMIKOM Purwokerto Student Portal
 * Modul Komputasi Matematika & Optimasi Penjadwalan KRS
 *
 * Fitur Utama:
 * 1. Algoritma Block Kelas (A/B/C) dengan Multi-Tier Fallback Cerdas
 * 2. Algoritma Minimal Hari / Rapel Hari (Compact Days Optimizer) via Branch-and-Bound CSP
 * 3. Deteksi Tabrakan Waktu (Interval Collision Detection) dengan dukungan buffer & multi-sesi
 * 4. Multi-Criteria Tie-Breakers (Total Hari -> Idle Gap -> Span Harian -> Block Uniformity -> Kuota)
 * 5. Generator Visualisasi Timetable Grid untuk UI Simulator
 * 6. Conflict Auto-Fixer & Resolution Suggester
 *
 * @license MIT
 */

(function (global) {
  'use strict';

  // =========================================================================
  // 1. KONSTANTA & KAMUS DATA
  // =========================================================================

  const HARI_MAP = {
    'SENIN': 1, 'SELASA': 2, 'RABU': 3, 'KAMIS': 4, 'JUMAT': 5, 'SABTU': 6, 'MINGGU': 7,
    'SEN': 1, 'SEL': 2, 'RAB': 3, 'KAM': 4, 'JUM': 5, 'SAB': 6, 'MIN': 7,
    'MONDAY': 1, 'TUESDAY': 2, 'WEDNESDAY': 3, 'THURSDAY': 4, 'FRIDAY': 5, 'SATURDAY': 6, 'SUNDAY': 7,
    'MON': 1, 'TUE': 2, 'WED': 3, 'THU': 4, 'FRI': 5, 'SAT': 6, 'SUN': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };

  const HARI_NAMES = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const HARI_SHORT = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  const PALETTE = [
    '#3B82F6', // Biru
    '#10B981', // Hijau
    '#F59E0B', // Kuning/Amber
    '#8B5CF6', // Ungu
    '#EC4899', // Merah Muda
    '#06B6D4', // Cyan
    '#F97316', // Oranye
    '#6366F1', // Indigo
    '#14B8A6', // Teal
    '#84CC16'  // Lime
  ];

  const TIERS = {
    TIER_1_PURE_BLOCK: {
      code: 'TIER_1_PURE_BLOCK',
      name: 'Pure Block (100% Target)',
      badgeClass: 'badge-success',
      desc: 'Semua mata kuliah 100% di kelas target dan kuota tersedia'
    },
    TIER_2_SMART_FALLBACK: {
      code: 'TIER_2_SMART_FALLBACK',
      name: 'Partial Block (Minimal Deviation)',
      badgeClass: 'badge-primary',
      desc: 'Mayoritas kelas target, matkul bentrok/penuh dialihkan ke alternatif terbaik'
    },
    TIER_3_ALTERNATIVE_COHESIVE: {
      code: 'TIER_3_ALTERNATIVE_COHESIVE',
      name: 'Cohesive Alternative Block',
      badgeClass: 'badge-warning',
      desc: 'Blok kelas alternatif (misal semua B atau C) agar tetap satu rombel'
    },
    TIER_4_STANDBY_FULL: {
      code: 'TIER_4_STANDBY_FULL',
      name: 'Standby / Sniper Mode',
      badgeClass: 'badge-danger',
      desc: 'Kombinasi ideal namun ada kursi 0 kuota (disarankan auto-snipe saat kursi dilepas)'
    }
  };

  // =========================================================================
  // 2. PARSING & NORMALISASI
  // =========================================================================

  /**
   * Mengonversi nama hari atau representasi hari ke integer (1 = Senin, 7 = Minggu)
   * @param {string|number} d
   * @returns {number} 1..7 atau 0 jika tidak valid
   */
  function parseDay(d) {
    if (typeof d === 'number') return (d >= 1 && d <= 7) ? d : 0;
    if (!d) return 0;
    const clean = String(d).trim().toUpperCase();
    return HARI_MAP[clean] || 0;
  }

  /**
   * Mengonversi string waktu (e.g. "07:30", "07.30", "7:30") ke menit sejak 00:00
   * @param {string|number} t
   * @returns {number} Menit (0..1440)
   */
  function parseTimeToMinutes(t) {
    if (typeof t === 'number') return Math.max(0, Math.min(1440, t));
    if (!t || typeof t !== 'string') return 0;
    const clean = t.trim().replace('.', ':');
    const parts = clean.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return Math.max(0, Math.min(1440, h * 60 + m));
  }

  /**
   * Mengonversi menit sejak 00:00 kembali ke format string "HH:mm"
   * @param {number} mins
   * @returns {string} Contoh: "07:30"
   */
  function minutesToTime(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '00:00';
    const clamped = Math.max(0, Math.min(1440, mins));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Parsing rentang waktu seperti "07:30 - 09:10", "07.00-08.40", atau "07:00 - 08:40 WIB"
   * Menangani edge cases portal AMIKOM: &nbsp;, \xa0, WIB, spasi ganda, dan baris praktek kosong "-"
   * @param {string} timeStr
   * @returns {{ startMin: number, endMin: number, timeStr: string, isPlaceholder: boolean }}
   */
  function parseTimeRange(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
      return { startMin: 0, endMin: 0, timeStr: '', isPlaceholder: true };
    }
    // Bersihkan karakter khusus portal Amikom (&nbsp;, \xa0, WIB, titik dua ganda)
    const clean = timeStr
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s*WIB\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Edge Case AMIKOM: Komponen praktek kosong pada MK tanpa praktikum (e.g. "-", "--", "")
    if (!clean || clean === '-' || clean === '--' || /^(ONLINE|TBA|PRAKTEK|PRAKTIK)$/i.test(clean)) {
      return { startMin: 0, endMin: 0, timeStr: '-', isPlaceholder: true };
    }

    const parts = clean.split(/\s*[-–—]\s*/);
    if (parts.length >= 2) {
      const s = parseTimeToMinutes(parts[0]);
      const e = parseTimeToMinutes(parts[1]);
      return {
        startMin: s,
        endMin: e,
        timeStr: `${minutesToTime(s)} - ${minutesToTime(e)}`,
        isPlaceholder: false
      };
    }
    const single = parseTimeToMinutes(clean);
    return {
      startMin: single,
      endMin: single + 100, // Default durasi 100 menit (2 SKS)
      timeStr: clean,
      isPlaceholder: false
    };
  }

  /**
   * Mengekstrak huruf kelas dari string mentah
   * Contoh: "3_2036311_PSSIP055 _C " -> "C", "IF-A" -> "A", "22-IF-01" -> "01"
   * @param {string} kelasStr
   * @returns {string}
   */
  function extractClassLetter(kelasStr) {
    if (!kelasStr) return '';
    const clean = String(kelasStr).trim().toUpperCase();

    // Pola Amikom: "sks_id_kode _KELAS "
    const underscoreParts = clean.split('_');
    if (underscoreParts.length >= 4) {
      const last = underscoreParts[3].trim();
      if (last) return last;
    }

    // Pola umum huruf kelas tunggal di akhir atau kata: "KELAS A", "IF-A", "A"
    const letterMatch = clean.match(/\b([A-Z])\b/) || clean.match(/([A-Z0-9]+)$/);
    return letterMatch ? letterMatch[1] : clean;
  }

  /**
   * Menormalisasi urutan prioritas kelas dari input array atau string fleksibel
   * Contoh: ['B', 'C', 'A'] atau "B -> C -> A" atau "B, C, A, D"
   * @param {Array<string>|string} priorityInput
   * @returns {Array<string>} Array huruf kelas unik dalam huruf kapital
   */
  function normalizePrioritySequence(priorityInput) {
    if (Array.isArray(priorityInput)) {
      const list = priorityInput
        .map(item => String(item || '').trim().toUpperCase())
        .filter(item => item.length > 0);
      return Array.from(new Set(list));
    }
    if (typeof priorityInput === 'string') {
      const clean = priorityInput.trim().toUpperCase();
      if (!clean) return [];
      const parts = clean
        .replace(/->|→|>|-/g, ',')
        .split(/[,;|/\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
      return Array.from(new Set(parts));
    }
    return [];
  }

  /**
   * Menghitung rank penalti peringkat huruf kelas terhadap urutan prioritas mahasiswa (0-indexed)
   * rank = 0: Pilihan utama / prioritas #1 (tanpa penalti)
   * rank = 1: Pilihan ke-2 (penalti 1)
   * rank = n: Pilihan ke-(n+1) (penalti n)
   * Jika kelas tidak ada dalam daftar urutan, diberi penalti tertinggi
   * @param {string} classLetter Huruf kelas (e.g. 'A', 'B', 'C')
   * @param {Array<string>} classPriority Daftar urutan prioritas
   * @returns {number}
   */
  function getClassPriorityRank(classLetter, classPriority = []) {
    if (!classLetter) return 999;
    const clean = String(classLetter).trim().toUpperCase();
    if (!Array.isArray(classPriority) || classPriority.length === 0) {
      const code = clean.charCodeAt(0);
      return (code >= 65 && code <= 90) ? (code - 65) : 99;
    }
    const idx = classPriority.findIndex(p => p === clean);
    if (idx !== -1) {
      return idx;
    }
    const code = clean.charCodeAt(0);
    const offset = (code >= 65 && code <= 90) ? (code - 64) : 10;
    return classPriority.length + offset;
  }

  /**
   * Membandingkan dua kombinasi secara leksikografis berdasarkan sebaran rank prioritas kelas
   * Kombinasi dengan kelas lebih banyak pada rank lebih tinggi (rank 0, rank 1, ...) lebih diutamakan
   * @param {Object} combA
   * @param {Object} combB
   * @param {number} [maxRank=10]
   * @returns {number}
   */
  function comparePriorityRanks(combA, combB, maxRank = 10) {
    const countsA = (combA.metrics && combA.metrics.rankCounts) || {};
    const countsB = (combB.metrics && combB.metrics.rankCounts) || {};
    for (let r = 0; r < maxRank; r++) {
      const cA = countsA[r] || 0;
      const cB = countsB[r] || 0;
      if (cA !== cB) {
        return cB - cA;
      }
    }
    return 0;
  }

  /**
   * Menormalisasi satu slot jadwal perkuliahan
   * @param {Object} rawSlot
   * @param {'TEORI'|'PRAKTIK'} [defaultType='TEORI']
   * @returns {Object|null}
   */
  function normalizeSlot(rawSlot, defaultType = 'TEORI') {
    if (!rawSlot) return null;
    const dayNum = parseDay(rawSlot.hari || rawSlot.day || rawSlot.dayNum);
    const dayName = HARI_NAMES[dayNum] || 'Lainnya';

    let startMin = 0;
    let endMin = 0;
    let timeStr = '';

    let isPlaceholder = false;
    if (rawSlot.jam) {
      const parsed = parseTimeRange(rawSlot.jam);
      startMin = parsed.startMin;
      endMin = parsed.endMin;
      timeStr = parsed.timeStr;
      isPlaceholder = parsed.isPlaceholder;
    } else {
      startMin = parseTimeToMinutes(rawSlot.jam_mulai || rawSlot.start || rawSlot.startMin);
      endMin = parseTimeToMinutes(rawSlot.jam_selesai || rawSlot.end || rawSlot.endMin);
      if (endMin <= startMin && startMin > 0) {
        endMin = startMin + 100;
      }
      timeStr = (startMin && endMin) ? `${minutesToTime(startMin)} - ${minutesToTime(endMin)}` : '';
    }

    const ruang = (rawSlot.ruang || rawSlot.room || '').replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ').trim();
    // Edge Case AMIKOM: Komponen Praktek dengan jam "-" atau hari kosong BUKAN tabrakan / constraint
    const isAsync = isPlaceholder || !dayNum || (!startMin && !endMin) || rawSlot.jam === '-';

    // Deteksi tipe sesi (TEORI vs PRAKTIK)
    let sessionType = rawSlot.sessionType || rawSlot.type || rawSlot.jenis || defaultType;
    if (typeof sessionType === 'string') {
      const upper = sessionType.toUpperCase();
      sessionType = upper.includes('PRAK') ? 'PRAKTIK' : 'TEORI';
    } else {
      sessionType = defaultType;
    }

    return {
      dayNum,
      dayName,
      dayShort: HARI_SHORT[dayNum] || 'Lain',
      startMin,
      endMin,
      durationMin: Math.max(0, endMin - startMin),
      ruang,
      timeStr,
      sessionType,
      isAsync
    };
  }

  /**
   * Menormalisasi satu opsi kelas dari mata kuliah
   * Mendukung variasi representasi:
   * - Matkul 2-komponen (Teori + Praktik back-to-back pada hari yang sama): interval majemuk [start_T, end_T] & [start_P, end_P]
   * - Matkul 1-komponen (Murni Teori): interval tunggal [start_T, end_T]
   * - Validasi SKS: SKS diambil dari metadata matkul (courseInfo.sks), bukan penjumlahan slot sesi
   * @param {Object} cls
   * @param {Object} [courseInfo={}]
   * @returns {Object}
   */
  function normalizeClass(cls, courseInfo = {}) {
    let rawSlots = [];

    // 1. Dukungan multi-sesi via array sessions / slots
    if (Array.isArray(cls.sessions) && cls.sessions.length > 0) {
      rawSlots = cls.sessions;
    } else if (Array.isArray(cls.slots) && cls.slots.length > 0) {
      rawSlots = cls.slots;
    } else if (cls.teori || cls.praktik || cls.praktek) {
      // 2. Dukungan objek terpisah teori & praktik
      if (cls.teori) {
        rawSlots.push({ ...cls.teori, sessionType: 'TEORI' });
      }
      const prak = cls.praktik || cls.praktek;
      if (prak && prak.jam !== '-' && prak.jam !== '--') {
        rawSlots.push({ ...prak, sessionType: 'PRAKTIK' });
      }
    } else if (cls.hari_teori || cls.jam_teori || cls.hari_praktek || cls.jam_praktek || cls.hari_praktik || cls.jam_praktik) {
      // 3. Dukungan flat fields dari tabel portal Amikom
      if (cls.hari_teori || cls.jam_teori) {
        rawSlots.push({
          hari: cls.hari_teori,
          jam: cls.jam_teori,
          ruang: cls.ruang_teori,
          sessionType: 'TEORI'
        });
      }
      const hariPrak = cls.hari_praktik || cls.hari_praktek;
      const jamPrak = cls.jam_praktik || cls.jam_praktek;
      const ruangPrak = cls.ruang_praktik || cls.ruang_praktek;
      if ((hariPrak || jamPrak) && jamPrak !== '-' && jamPrak !== '--') {
        rawSlots.push({
          hari: hariPrak,
          jam: jamPrak,
          ruang: ruangPrak,
          sessionType: 'PRAKTIK'
        });
      }
    } else if (cls.hari || cls.jam || cls.jam_mulai) {
      // 4. Dukungan format tunggal / murni teori (atau jam dengan slash)
      const jamStr = String(cls.jam || '').trim();
      const slashParts = jamStr.split(/\s*[\/&]\s*/);
      if (slashParts.length >= 2 && !/^(ONLINE|TBA|-)$/i.test(slashParts[0])) {
        rawSlots.push({
          hari: cls.hari,
          jam: slashParts[0],
          ruang: cls.ruang,
          sessionType: 'TEORI'
        });
        rawSlots.push({
          hari: cls.hari,
          jam: slashParts[1],
          ruang: cls.ruang,
          sessionType: 'PRAKTIK'
        });
      } else {
        rawSlots.push({
          hari: cls.hari,
          jam: cls.jam,
          jam_mulai: cls.jam_mulai,
          jam_selesai: cls.jam_selesai,
          ruang: cls.ruang,
          sessionType: cls.sessionType || 'TEORI'
        });
      }
    }

    const slots = rawSlots.map((s, idx) => {
      const defaultType = idx === 0 ? 'TEORI' : 'PRAKTIK';
      return normalizeSlot(s, s.sessionType || defaultType);
    }).filter(Boolean);

    const kuota = parseInt(cls.kuota, 10) || 0;
    const terisi = parseInt(cls.terisi, 10) || 0;
    let sisaKuota = (typeof cls.kuotaSisa !== 'undefined') ? parseInt(cls.kuotaSisa, 10) :
                    (typeof cls.sisaKuota !== 'undefined') ? parseInt(cls.sisaKuota, 10) :
                    (typeof cls.sisa_kuota !== 'undefined') ? parseInt(cls.sisa_kuota, 10) :
                    (kuota > 0 ? Math.max(0, kuota - terisi) : 99);

    const rawKelas = String(cls.kelas || cls.nama_kelas || '').trim();
    const classLetter = extractClassLetter(rawKelas);

    // Filter slot aktif (non-async dan memiliki waktu valid)
    const activeSlots = slots.filter(s => !s.isAsync && s.dayNum > 0 && s.startMin < s.endMin);

    // Identifikasi slot Teori & Praktik
    const teoriSlot = activeSlots.find(s => s.sessionType === 'TEORI') || (activeSlots.length > 0 ? activeSlots[0] : null);
    const praktikSlot = activeSlots.find(s => s.sessionType === 'PRAKTIK') || (activeSlots.length > 1 && activeSlots[1] !== teoriSlot ? activeSlots[1] : null);

    const isTwoComponent = Boolean(teoriSlot && praktikSlot && teoriSlot !== praktikSlot);
    const componentCount = isTwoComponent ? 2 : (activeSlots.length > 0 ? 1 : 0);

    // Representasi interval majemuk [start_T, end_T] & [start_P, end_P]
    const intervals = activeSlots.map(s => [s.startMin, s.endMin]);

    // Interval harian majemuk per hari
    const dayIntervals = {};
    for (const s of activeSlots) {
      if (!dayIntervals[s.dayNum]) {
        dayIntervals[s.dayNum] = [];
      }
      dayIntervals[s.dayNum].push({
        sessionType: s.sessionType,
        startMin: s.startMin,
        endMin: s.endMin,
        interval: [s.startMin, s.endMin],
        timeStr: s.timeStr,
        ruang: s.ruang
      });
    }

    // VALIDASI SKS: SKS mutlak diambil dari metadata matkul (courseInfo.sks),
    // BUKAN dari akumulasi durasi waktu atau jumlah sesi slot!
    const sks = parseInt(courseInfo.sks, 10) || parseInt(cls.sks, 10) || 0;

    return {
      id: cls.id || cls.id_kelas || cls.value || `${courseInfo.kode || 'MK'}_${rawKelas}`,
      value: cls.value || cls.id || '',
      kelas: rawKelas,
      classLetter,
      dosen: cls.dosen || '',
      kuota,
      terisi,
      sisaKuota,
      isFull: sisaKuota <= 0,
      slots,
      activeSlots,
      intervals,
      dayIntervals,
      teoriSlot,
      praktikSlot,
      isTwoComponent,
      componentCount,
      courseKode: courseInfo.kode || cls.courseKode || '',
      courseNama: courseInfo.nama || cls.courseNama || '',
      sks
    };
  }

  /**
   * Menormalisasi himpunan mata kuliah beserta seluruh opsi kelasnya
   * @param {Array<Object>} courses
   * @returns {Array<Object>}
   */
  function normalizeCourses(courses) {
    if (!Array.isArray(courses)) return [];
    return courses.map((course, idx) => {
      const nama = (course.nama || course.makul || `Mata Kuliah ${idx + 1}`).trim();
      const kode = (course.kode || `MK_${idx + 1}`).trim();
      const sks = parseInt(course.sks, 10) || 0;

      // Edge Case AMIKOM: Matkul otomatis (Skripsi, Tugas Praktik) atau status MBKM
      const isAuto = Boolean(course.isAuto || course.isAutoFilled);
      const isMbkm = Boolean(course.isMbkm || course.ket === 'MBKM' || String(course.ket || '').toUpperCase().includes('MBKM'));
      const isSpecialExcluded = isAuto || isMbkm || /skripsi|tugas praktik|magang/i.test(nama);

      const info = {
        kode,
        nama,
        sks,
        isMbkm,
        isCore: (typeof course.isCore === 'boolean')
          ? course.isCore
          : (!course.isPilihan && !course.isKonsentrasi && !isSpecialExcluded)
      };
      const classes = (Array.isArray(course.classes) ? course.classes : []).map(cls => normalizeClass(cls, info));
      return {
        ...info,
        id: course.id || info.kode,
        classes
      };
    });
  }

  // =========================================================================
  // 3. DETEKSI TABRAKAN (COLLISION / CONFLICT DETECTION)
  // =========================================================================

  /**
   * Formula Matematika Deteksi Overlap Interval Waktu:
   * Dua interval [s1, e1) dan [s2, e2) overlap jika dan hanya jika:
   *   max(s1, s2) < min(e1, e2) + bufferMinutes
   * Ekivalen dengan: (s1 < e2 + buffer) && (s2 < e1 + buffer)
   *
   * Catatan Khusus Jadwal Akademik:
   * Jika bufferMinutes = 0, kelas yang berakhir tepat saat kelas berikutnya mulai
   * (e.g. 07:30 - 09:10 dan 09:10 - 10:50) bernilai max(450, 550) = 550, min(550, 650) = 550.
   * Karena 550 < 550 adalah FALSE, kelas back-to-back TIDAK bentrok.
   *
   * @param {number} s1 Start time 1 (menit)
   * @param {number} e1 End time 1 (menit)
   * @param {number} s2 Start time 2 (menit)
   * @param {number} e2 End time 2 (menit)
   * @param {number} [bufferMinutes=0]
   * @returns {boolean}
   */
  function isIntervalOverlap(s1, e1, s2, e2, bufferMinutes = 0) {
    const overlapStart = Math.max(s1, s2);
    const overlapEnd = Math.min(e1, e2);
    return overlapStart < (overlapEnd + bufferMinutes);
  }

  /**
   * Memeriksa apakah dua slot sesi bertabrakan
   * @param {Object} sA Slot A
   * @param {Object} sB Slot B
   * @param {number} [bufferMinutes=0]
   * @returns {boolean}
   */
  function checkSlotConflict(sA, sB, bufferMinutes = 0) {
    if (!sA || !sB || sA.isAsync || sB.isAsync) return false;
    if (sA.dayNum !== sB.dayNum) return false;
    return isIntervalOverlap(sA.startMin, sA.endMin, sB.startMin, sB.endMin, bufferMinutes);
  }

  /**
   * Memeriksa apakah dua kelas bertabrakan (mendukung multi-slot perkuliahan)
   * @param {Object} classA
   * @param {Object} classB
   * @param {number} [bufferMinutes=0]
   * @returns {Object|null} Objek detail bentrok jika ada tabrakan, atau null jika aman
   */
  function checkClassConflict(classA, classB, bufferMinutes = 0) {
    if (!classA || !classB || !Array.isArray(classA.slots) || !Array.isArray(classB.slots)) {
      return null;
    }

    for (const sA of classA.slots) {
      if (sA.isAsync) continue;
      for (const sB of classB.slots) {
        if (sB.isAsync) continue;
        if (sA.dayNum === sB.dayNum && isIntervalOverlap(sA.startMin, sA.endMin, sB.startMin, sB.endMin, bufferMinutes)) {
          const overlapMinutes = Math.min(sA.endMin, sB.endMin) - Math.max(sA.startMin, sB.startMin);
          const typeALabel = sA.sessionType ? `[${sA.sessionType}] ` : '';
          const typeBLabel = sB.sessionType ? `[${sB.sessionType}] ` : '';
          return {
            conflict: true,
            day: sA.dayName,
            dayNum: sA.dayNum,
            overlapMinutes: Math.max(0, overlapMinutes),
            classA: {
              id: classA.id,
              kode: classA.courseKode,
              nama: classA.courseNama,
              kelas: classA.kelas,
              slot: sA,
              sessionType: sA.sessionType || 'TEORI'
            },
            classB: {
              id: classB.id,
              kode: classB.courseKode,
              nama: classB.courseNama,
              kelas: classB.kelas,
              slot: sB,
              sessionType: sB.sessionType || 'TEORI'
            },
            message: `Bentrok ${sA.dayName}: ${classA.courseKode} ${typeALabel}(${classA.kelas} / ${sA.timeStr}) vs ${classB.courseKode} ${typeBLabel}(${classB.kelas} / ${sB.timeStr})`
          };
        }
      }
    }
    return null;
  }

  /**
   * Melakukan deteksi tabrakan menyeluruh pada suatu susunan kelas terpilih
   * @param {Array<Object>} selectedClasses
   * @param {number} [bufferMinutes=0]
   * @returns {{ hasConflict: boolean, conflictCount: number, conflicts: Array<Object>, conflictingClassIds: Array<string> }}
   */
  function detectConflicts(selectedClasses, bufferMinutes = 0) {
    const classesList = Array.isArray(selectedClasses)
      ? selectedClasses
      : (selectedClasses && Array.isArray(selectedClasses.selectedClasses)
          ? selectedClasses.selectedClasses
          : (selectedClasses && Array.isArray(selectedClasses.classes) ? selectedClasses.classes : []));

    const conflicts = [];
    const conflictingClassIds = new Set();

    for (let i = 0; i < classesList.length; i++) {
      for (let j = i + 1; j < classesList.length; j++) {
        const cA = classesList[i];
        const cB = classesList[j];
        const res = checkClassConflict(cA, cB, bufferMinutes);
        if (res) {
          conflicts.push(res);
          conflictingClassIds.add(cA.id);
          conflictingClassIds.add(cB.id);
        }
      }
    }
    return {
      hasConflict: conflicts.length > 0,
      conflictCount: conflicts.length,
      conflicts,
      conflictingClassIds: Array.from(conflictingClassIds)
    };
  }

  // =========================================================================
  // 4. METRIK JADWAL & KOMPUTASI EVALUASI
  // =========================================================================

  /**
   * Menghitung seluruh metrik jadwal (total hari, jeda kosong / gap, rentang harian / span,
   * persentase block kelas, serta status kuota)
   *
   * @param {Array<Object>} selectedClasses
   * @param {Object} [options={}]
   * @param {string} [options.targetClass='']
   * @param {number} [options.bufferMinutes=0]
   * @returns {Object}
   */
  function evaluateSchedule(selectedClasses, options = {}) {
    const rawPriority = options.classPriority || options.priorityOrder || options.targetClassOrder || options.targetClass;
    let classPriority = normalizePrioritySequence(rawPriority);
    if (classPriority.length === 0) {
      if (options.targetClass) {
        classPriority = [String(options.targetClass).trim().toUpperCase()];
      } else {
        classPriority = ['A', 'B', 'C', 'D', 'E', 'F'];
      }
    }
    const targetClass = classPriority[0] || 'A';

    const rawPrefDays = options.preferredDays || options.preferredDaysSet;
    const preferredDaysSet = new Set();
    if (rawPrefDays instanceof Set) {
      rawPrefDays.forEach(d => preferredDaysSet.add(d));
    } else if (Array.isArray(rawPrefDays)) {
      rawPrefDays.forEach(d => {
        const p = parseDay(d);
        if (p > 0) preferredDaysSet.add(p);
      });
    }

    const daySlotsMap = {};
    const daysSet = new Set();
    const rankCounts = {};
    const priorityFrequency = {};

    let rankPenalty = 0;
    let blockMatches = 0;
    let fullClassCount = 0;
    let totalSks = 0;
    let minRemainingQuota = Infinity;
    let singleComponentCount = 0;
    let twoComponentCount = 0;
    let totalTheorySessions = 0;
    let totalPracticumSessions = 0;

    const classesList = Array.isArray(selectedClasses)
      ? selectedClasses
      : (selectedClasses && Array.isArray(selectedClasses.selectedClasses)
          ? selectedClasses.selectedClasses
          : (selectedClasses && Array.isArray(selectedClasses.classes) ? selectedClasses.classes : []));

    classesList.forEach((cls) => {
      // Validasi SKS: Menggunakan metadata matkul asli, bukan dari penjumlahan slot sesi!
      const sksVal = parseInt(cls.sks, 10) || 0;
      totalSks += sksVal;

      if (cls.isFull || cls.sisaKuota <= 0) fullClassCount++;
      if (cls.sisaKuota < minRemainingQuota) minRemainingQuota = cls.sisaKuota;

      const cLet = cls.classLetter || extractClassLetter(cls.kelas);
      const rank = getClassPriorityRank(cLet, classPriority);
      rankPenalty += rank;
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
      priorityFrequency[cLet] = (priorityFrequency[cLet] || 0) + 1;

      if (cLet === targetClass) {
        blockMatches++;
      }

      // Evaluasi komponen sesi Teori & Praktikum
      let hasTeori = false;
      let hasPraktik = false;

      for (const slot of cls.slots) {
        if (slot.isAsync) continue;
        if (slot.sessionType === 'PRAKTIK') {
          hasPraktik = true;
          totalPracticumSessions++;
        } else {
          hasTeori = true;
          totalTheorySessions++;
        }

        daysSet.add(slot.dayNum);
        if (!daySlotsMap[slot.dayNum]) daySlotsMap[slot.dayNum] = [];
        daySlotsMap[slot.dayNum].push({
          startMin: slot.startMin,
          endMin: slot.endMin,
          sessionType: slot.sessionType || 'TEORI',
          slot,
          cls
        });
      }

      if (hasTeori && hasPraktik) {
        twoComponentCount++;
      } else if (hasTeori || hasPraktik) {
        singleComponentCount++;
      }
    });

    let totalGapMinutes = 0;
    let totalSpanMinutes = 0;
    const dailyStats = {};
    const sortedDays = Array.from(daysSet).sort((a, b) => a - b);

    for (const dayNum of sortedDays) {
      const slots = daySlotsMap[dayNum];
      // Urutkan slot secara kronologis dari pagi ke sore
      slots.sort((a, b) => a.startMin - b.startMin);

      const dayMinStart = slots[0].startMin;
      const dayMaxEnd = slots[slots.length - 1].endMin;
      const daySpan = dayMaxEnd - dayMinStart;
      totalSpanMinutes += daySpan;

      let dayGap = 0;
      for (let i = 0; i < slots.length - 1; i++) {
        const gap = Math.max(0, slots[i + 1].startMin - slots[i].endMin);
        dayGap += gap;
      }
      totalGapMinutes += dayGap;

      dailyStats[HARI_NAMES[dayNum]] = {
        dayNum,
        dayName: HARI_NAMES[dayNum],
        slotCount: slots.length,
        startTime: minutesToTime(dayMinStart),
        endTime: minutesToTime(dayMaxEnd),
        spanMinutes: daySpan,
        gapMinutes: dayGap,
        slots
      };
    }
    let preferredDayMatches = 0;
    let nonPreferredDayCount = 0;
    for (const dayNum of daysSet) {
      if (preferredDaysSet.has(dayNum)) {
        preferredDayMatches++;
      } else if (preferredDaysSet.size > 0) {
        nonPreferredDayCount++;
      }
    }

    const totalDays = daysSet.size;
    const blockMatchPercentage = classesList.length > 0
      ? Math.round((blockMatches / classesList.length) * 100)
      : 0;

    // Rincian distribusi kelas berdasarkan prioritas mahasiswa
    const priorityBreakdown = Object.keys(priorityFrequency).map(letter => {
      const rank = getClassPriorityRank(letter, classPriority);
      return {
        letter,
        rank,
        count: priorityFrequency[letter],
        isTopPriority: rank === 0
      };
    }).sort((a, b) => a.rank - b.rank);

    return {
      totalDays,
      activeDays: sortedDays.map(d => HARI_NAMES[d]),
      dailyStats,
      totalGapMinutes,
      totalSpanMinutes,
      totalSks,
      sksValidation: {
        totalSks,
        courseCount: classesList.length,
        isSksFromMetadata: true
      },
      classPriority,
      targetClass,
      rankPenalty,
      rankCounts,
      priorityBreakdown,
      blockMatches,
      blockTotalCount: classesList.length,
      blockMatchPercentage,
      singleComponentCount,
      twoComponentCount,
      preferredDayMatches,
      nonPreferredDayCount,
      totalTheorySessions,
      totalPracticumSessions,
      fullClassCount,
      minRemainingQuota: minRemainingQuota === Infinity ? 0 : minRemainingQuota
    };
  }

  // =========================================================================
  // 5. SOLVER KOMBINATORIAL (CSP & BRANCH-AND-BOUND)
  // =========================================================================

  /**
   * Solver utama: Mencari kombinasi jadwal optimal berdasarkan strategi yang dipilih
   *
   * @param {Object} params
   * @param {Array<Object>} params.courses Daftar matkul yang diambil beserta kelasnya
   * @param {'COMPACT_DAYS'|'BLOCK_CLASS'|'CUSTOM'} [params.strategy='COMPACT_DAYS']
   * @param {Object} [params.preferences={}]
   * @param {string} [params.preferences.targetClass='A'] Huruf kelas target untuk Block Kelas
   * @param {Array<string>} [params.preferences.preferredDays=[]] Hari yang diprioritaskan
   * @param {number} [params.preferences.bufferMinutes=0] Buffer waktu antar kelas
   * @param {boolean} [params.filterFullQuota=false] Abaikan kelas yang kuotanya 0
   * @param {number} [params.maxResults=10] Jumlah kombinasi teratas yang dikembalikan
   * @returns {Object} Hasil komputasi kombinasi, fallback, dan rekomendasi
   */
  function solve({
    courses = [],
    strategy = 'COMPACT_DAYS',
    preferences = {},
    filterFullQuota = false,
    maxResults = 10
  } = {}) {
    const normCourses = normalizeCourses(courses);

    if (normCourses.length === 0) {
      return {
        success: false,
        message: 'Tidak ada mata kuliah yang diberikan',
        combinations: []
      };
    }

    // Edge Case AMIKOM: Pisahkan MK yang terjadwal vs MK Auto (Skripsi, Tugas Praktik, MBKM)
    const schedulableCourses = normCourses.filter(c => !c.isAuto || c.classes.length > 0);
    const autoAssignedCourses = normCourses.filter(c => c.isAuto && c.classes.length === 0);

    // Periksa apakah ada mata kuliah terjadwal yang tidak memiliki opsi kelas sama sekali
    const emptyCourses = schedulableCourses.filter(c => c.classes.length === 0);
    if (emptyCourses.length > 0) {
      return {
        success: false,
        message: `Mata kuliah berikut tidak memiliki pilihan kelas yang tersedia: ${emptyCourses.map(c => c.kode).join(', ')}`,
        infeasibleCourses: emptyCourses.map(c => c.kode),
        combinations: []
      };
    }

    const rawPriority = preferences.classPriority || preferences.priorityOrder || preferences.targetClassOrder || preferences.targetClass;
    let classPriority = normalizePrioritySequence(rawPriority);
    if (classPriority.length === 0) {
      if (preferences.targetClass) {
        classPriority = [String(preferences.targetClass).trim().toUpperCase()];
      } else {
        classPriority = ['A', 'B', 'C', 'D', 'E', 'F'];
      }
    }
    const targetClass = classPriority[0] || 'A';
    const bufferMinutes = preferences.bufferMinutes || 0;
    const maxDays = (typeof preferences.maxDays === 'number' && preferences.maxDays > 0) ? preferences.maxDays : 0;
    const blockFallbackPolicy = preferences.blockFallbackPolicy;
    const isStrictFallback = blockFallbackPolicy === 'STRICT';

    const rawPrefDays = preferences.preferredDays;
    const preferredDaysSet = new Set();
    if (rawPrefDays instanceof Set) {
      rawPrefDays.forEach(d => preferredDaysSet.add(d));
    } else if (Array.isArray(rawPrefDays)) {
      rawPrefDays.forEach(d => {
        const p = parseDay(d);
        if (p > 0) preferredDaysSet.add(p);
      });
    }

    // Aturan filter kelas AMIKOM: Mahasiswa reguler pagi dilarang kelas S (MK Inti) dan kelas K (Karyawan)
    const disallowClassSForCore = preferences.disallowClassSForCore ?? true;
    const disallowClassK = preferences.disallowClassK ?? true;
    // Dynamic Rejection Feedback: Blacklist offering yang ditolak server saat war
    const blacklistedSet = new Set(
      Array.isArray(preferences.blacklistedOfferingIds) ? preferences.blacklistedOfferingIds : []
    );

    // Filter helper untuk mencegah kebocoran kelas K/S pada mahasiswa reguler
    function isClassAllowedForStudent(cls, course) {
      if (blacklistedSet.has(cls.id) || blacklistedSet.has(cls.value)) {
        return false;
      }
      if (disallowClassK && cls.classLetter === 'K') {
        return false;
      }
      if (disallowClassSForCore && course.isCore && cls.classLetter === 'S') {
        return false;
      }
      return true;
    }

    // Filter opsi kelas per matkul dengan aturan portal Amikom
    const preparedCourses = schedulableCourses.map(c => {
      let availableClasses = c.classes.filter(cls => {
        if (!isClassAllowedForStudent(cls, c)) {
          return false;
        }
        if (isStrictFallback && classPriority.length > 0 && !classPriority.includes(cls.classLetter)) {
          return false;
        }
        return true;
      });

      // Filter kuota jika diminta
      if (filterFullQuota) {
        const withQuota = availableClasses.filter(cls => !cls.isFull && cls.sisaKuota > 0);
        if (withQuota.length > 0) {
          availableClasses = withQuota;
        }
      }

      // Fallback jika semua kelas terfilter karena kuota: JANGAN masukkan kembali kelas K atau S bagi reguler!
      if (availableClasses.length === 0) {
        availableClasses = c.classes.filter(cls => {
          if (!isClassAllowedForStudent(cls, c)) return false;
          if (isStrictFallback && classPriority.length > 0 && !classPriority.includes(cls.classLetter)) return false;
          return true;
        });
      }

      // Urutkan opsi kelas berdasarkan urutan prioritas dinamis mahasiswa:
      // Kelas dengan rank lebih rendah (prioritas lebih tinggi) dievaluasi terlebih dahulu.
      // Jika kelas pertama penuh atau bentrok, algoritma secara alami turun ke kelas berikutnya dalam urutan prioritas.
      availableClasses.sort((a, b) => {
        const rankA = getClassPriorityRank(a.classLetter, classPriority);
        const rankB = getClassPriorityRank(b.classLetter, classPriority);
        if (rankA !== rankB) {
          return rankA - rankB;
        }
        return b.sisaKuota - a.sisaKuota;
      });

      return {
        ...c,
        availableClasses
      };
    });

    // Periksa jika ada mata kuliah yang kehabisan opsi karena aturan STRICT atau filter
    const noOptionCourses = preparedCourses.filter(c => c.availableClasses.length === 0);
    if (noOptionCourses.length > 0) {
      return {
        success: false,
        message: `Mata kuliah berikut tidak memiliki pilihan kelas yang memenuhi kriteria/prioritas: ${noOptionCourses.map(c => c.kode).join(', ')}`,
        infeasibleCourses: noOptionCourses.map(c => c.kode),
        combinations: []
      };
    }
    // Urutkan mata kuliah menggunakan Heuristik MRV (Minimum Remaining Values / Fail-First Principle)
    const sortedCourseIndices = preparedCourses
      .map((c, idx) => ({ idx, count: c.availableClasses.length }))
      .sort((a, b) => a.count - b.count)
      .map(x => x.idx);

    const validCombinations = [];
    let bestDaysFound = 7;
    let bestPenaltyFound = Infinity;

    // Algoritma Backtracking dengan Pruning Cerdas (< 10ms Branch-and-Bound)
    function backtrack(depth, currentSelected, currentDaysSet, currentPenalty = 0) {
      // Prune jika total hari terakumulasi sudah melampaui maxDays
      if (maxDays > 0 && currentDaysSet.size > maxDays) {
        return;
      }
      // Branch and Bound untuk COMPACT_DAYS:
      // Jika jumlah hari yang sudah terakumulasi melebihi solusi terbaik saat ini + 1, prune cabang ini!
      if (strategy === 'COMPACT_DAYS' && currentDaysSet.size > bestDaysFound + 1) {
        return;
      }

      // Branch and Bound untuk BLOCK_CLASS:
      // Prune cabang jika penalti sudah melampaui solusi terbaik saat kandidat telah mencukupi
      if (strategy === 'BLOCK_CLASS') {
        if (bestPenaltyFound === 0 && validCombinations.length >= maxResults * 3 && currentPenalty > 0) {
          return;
        }
        if (validCombinations.length >= maxResults * 5 && currentPenalty > bestPenaltyFound) {
          return;
        }
        if (validCombinations.length >= 120) {
          return;
        }
      }

      // Basis rekursi: semua mata kuliah telah terpilih
      if (depth === sortedCourseIndices.length) {
        // Kembalikan urutan kelas sesuai urutan asli array input schedulableCourses
        const ordered = new Array(schedulableCourses.length);
        for (let i = 0; i < sortedCourseIndices.length; i++) {
          const courseIdx = sortedCourseIndices[i];
          ordered[courseIdx] = currentSelected[i];
        }

        const metrics = evaluateSchedule(ordered, { classPriority, targetClass, bufferMinutes, preferredDays: preferredDaysSet });

        if (maxDays > 0 && metrics.totalDays > maxDays) {
          return;
        }

        if (metrics.totalDays < bestDaysFound) {
          bestDaysFound = metrics.totalDays;
        }
        if (typeof metrics.rankPenalty === 'number' && metrics.rankPenalty < bestPenaltyFound) {
          bestPenaltyFound = metrics.rankPenalty;
        }

        // Tentukan Tier untuk Block Kelas berdasarkan evaluasi prioritas dinamis
        let tier = TIERS.TIER_2_SMART_FALLBACK;
        if (metrics.fullClassCount > 0) {
          tier = TIERS.TIER_4_STANDBY_FULL;
        } else if (metrics.rankPenalty === 0 && metrics.blockMatches === schedulableCourses.length) {
          tier = TIERS.TIER_1_PURE_BLOCK;
        } else {
          // Periksa apakah alternatifnya kohesif (semua seragam di huruf kelas yang sama di luar target utama)
          const allSame = ordered.length > 0 && ordered.every(c => c.classLetter === ordered[0].classLetter);
          if (allSame && ordered[0].classLetter !== targetClass) {
            tier = TIERS.TIER_3_ALTERNATIVE_COHESIVE;
          } else {
            tier = TIERS.TIER_2_SMART_FALLBACK;
          }
        }

        validCombinations.push({
          selectedClasses: ordered,
          metrics,
          tier
        });
        return;
      }

      const courseIdx = sortedCourseIndices[depth];
      const course = preparedCourses[courseIdx];

      for (const cls of course.availableClasses) {
        // Pemeriksaan tabrakan dengan kelas yang sudah terpilih di rantai ini
        let hasConflict = false;
        for (const prevCls of currentSelected) {
          if (checkClassConflict(cls, prevCls, bufferMinutes)) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) continue;

        // Hitung penambahan hari aktif
        const addedDays = [];
        for (const slot of cls.slots) {
          if (!slot.isAsync && !currentDaysSet.has(slot.dayNum)) {
            currentDaysSet.add(slot.dayNum);
            addedDays.push(slot.dayNum);
          }
        }

        const rank = getClassPriorityRank(cls.classLetter, classPriority);
        const nextPenalty = currentPenalty + rank;

        currentSelected.push(cls);
        backtrack(depth + 1, currentSelected, currentDaysSet, nextPenalty);
        currentSelected.pop();

        for (const d of addedDays) {
          currentDaysSet.delete(d);
        }
      }
    }

    backtrack(0, [], new Set(), 0);

    // Jika tidak ada kombinasi yang ditemukan dan filterFullQuota aktif:
    // Coba relaksasi kuota (cari solusi dengan mengizinkan kelas penuh)
    if (validCombinations.length === 0 && filterFullQuota) {
      return solve({
        courses,
        strategy,
        preferences,
        filterFullQuota: false,
        maxResults
      });
    }

    if (validCombinations.length === 0) {
      return {
        success: false,
        message: 'Tidak ditemukan kombinasi jadwal tanpa bentrok untuk seluruh mata kuliah yang dipilih.',
        combinations: []
      };
    }

    // =========================================================================
    // MULTI-CRITERIA SORTING & TIE-BREAKERS
    // =========================================================================
    validCombinations.sort((a, b) => {
      if (strategy === 'BLOCK_CLASS') {
        // 1. Evaluasi Urutan Prioritas Dinamis (Lexicographical Priority Rank)
        // Utamakan kombinasi yang paling banyak mendapatkan prioritas tertinggi (#1, lalu #2, dst.)
        const priorityComp = comparePriorityRanks(a, b);
        if (priorityComp !== 0) {
          return priorityComp;
        }

        // 2. Minimalkan total penalti rank (semakin kecil penalti, semakin dekat ke urutan ideal)
        if (a.metrics.rankPenalty !== b.metrics.rankPenalty) {
          return a.metrics.rankPenalty - b.metrics.rankPenalty;
        }
        // 3. Preferensi Hari Pilihan Pengguna (preferredDays bonus)
        if (preferredDaysSet.size > 0 && a.metrics.preferredDayMatches !== b.metrics.preferredDayMatches) {
          return b.metrics.preferredDayMatches - a.metrics.preferredDayMatches;
        }

        // 4. Minimize kelas penuh (kuota habis)
        if (a.metrics.fullClassCount !== b.metrics.fullClassCount) {
          return a.metrics.fullClassCount - b.metrics.fullClassCount;
        }

        // 4. Minimize total hari
        if (a.metrics.totalDays !== b.metrics.totalDays) {
          return a.metrics.totalDays - b.metrics.totalDays;
        }

        // 5. Tie-Breaker: Minimize jeda antar jam (gap)
        if (a.metrics.totalGapMinutes !== b.metrics.totalGapMinutes) {
          return a.metrics.totalGapMinutes - b.metrics.totalGapMinutes;
        }

        // 6. Maximize sisa kuota teraman
        if (b.metrics.minRemainingQuota !== a.metrics.minRemainingQuota) {
          return b.metrics.minRemainingQuota - a.metrics.minRemainingQuota;
        }

        // 7. Minimize total span harian
        return a.metrics.totalSpanMinutes - b.metrics.totalSpanMinutes;
      } else {
        // COMPACT_DAYS (Minimal Hari / Rapel Hari Optimizer)
        // 1. Kriteria Utama: Minimize total hari aktif
        if (a.metrics.totalDays !== b.metrics.totalDays) {
          return a.metrics.totalDays - b.metrics.totalDays;
        }
        // 2. Preferensi Hari Pilihan Pengguna (preferredDays bonus)
        if (preferredDaysSet.size > 0 && a.metrics.preferredDayMatches !== b.metrics.preferredDayMatches) {
          return b.metrics.preferredDayMatches - a.metrics.preferredDayMatches;
        }
        // 3. Tie-Breaker 1: Minimize total jeda kosong (idle time) antar jam kuliah
        if (a.metrics.totalGapMinutes !== b.metrics.totalGapMinutes) {
          return a.metrics.totalGapMinutes - b.metrics.totalGapMinutes;
        }
        // 3. Tie-Breaker 2: Minimize total span harian (selesai lebih cepat)
        if (a.metrics.totalSpanMinutes !== b.metrics.totalSpanMinutes) {
          return a.metrics.totalSpanMinutes - b.metrics.totalSpanMinutes;
        }
        // 4. Tie-Breaker 3: Utamakan urutan prioritas kelas mahasiswa
        const priorityComp = comparePriorityRanks(a, b);
        if (priorityComp !== 0) {
          return priorityComp;
        }
        if (a.metrics.rankPenalty !== b.metrics.rankPenalty) {
          return a.metrics.rankPenalty - b.metrics.rankPenalty;
        }
        // 5. Tie-Breaker 4: Maximize sisa kuota teraman
        return b.metrics.minRemainingQuota - a.metrics.minRemainingQuota;
      }
    });

    // Pangkas ke jumlah hasil maksimal
    const topCombinations = validCombinations.slice(0, maxResults).map((comb, index) => {
      const timetable = generateTimetable(comb.selectedClasses);
      return {
        rank: index + 1,
        id: `comb_${index + 1}`,
        tier: comb.tier,
        metrics: comb.metrics,
        selectedClasses: comb.selectedClasses,
        timetable,
        summaryText: formatScheduleSummary(comb, classPriority)
      };
    });

    return {
      success: true,
      strategy,
      classPriority,
      targetClass,
      totalSolutionsFound: validCombinations.length,
      bestDays: validCombinations[0].metrics.totalDays,
      combinations: topCombinations
    };
  }

  // =========================================================================
  // 6. TIMETABLE GRID GENERATOR UNTUK SIMULATOR VISUAL
  // =========================================================================

  /**
   * Menghasilkan struktur data tabel jadwal untuk dirender oleh antarmuka visual
   * @param {Array<Object>} selectedClasses
   * @returns {Object}
   */
  function generateTimetable(selectedClasses) {
    const daysGrid = {
      'Senin': [],
      'Selasa': [],
      'Rabu': [],
      'Kamis': [],
      'Jumat': [],
      'Sabtu': []
    };

    const courseColorMap = {};
    let colorCursor = 0;

    const classesList = Array.isArray(selectedClasses)
      ? selectedClasses
      : (selectedClasses && Array.isArray(selectedClasses.selectedClasses)
          ? selectedClasses.selectedClasses
          : (selectedClasses && Array.isArray(selectedClasses.classes) ? selectedClasses.classes : []));

    classesList.forEach((cls) => {
      if (!courseColorMap[cls.courseKode]) {
        courseColorMap[cls.courseKode] = PALETTE[colorCursor % PALETTE.length];
        colorCursor++;
      }
      const color = courseColorMap[cls.courseKode];

      for (const slot of cls.slots) {
        if (slot.isAsync) continue;
        const dayName = slot.dayName;
        if (daysGrid[dayName]) {
          daysGrid[dayName].push({
            id: cls.id,
            classId: cls.id,
            courseKode: cls.courseKode,
            courseNama: cls.courseNama,
            kelas: cls.kelas,
            classLetter: cls.classLetter,
            sessionType: slot.sessionType || 'TEORI',
            isPraktik: slot.sessionType === 'PRAKTIK',
            isTwoComponent: cls.isTwoComponent || false,
            componentCount: cls.componentCount || 1,
            isPureTheory: Boolean(cls.isPureTheory || cls.componentCount === 1),
            dosen: cls.dosen,
            ruang: slot.ruang,
            startMin: slot.startMin,
            endMin: slot.endMin,
            startTime: minutesToTime(slot.startMin),
            endTime: minutesToTime(slot.endMin),
            timeStr: slot.timeStr,
            durationMin: slot.durationMin,
            color,
            sks: cls.sks
          });
        }
      }
    });

    // Urutkan setiap hari berdasarkan jam mulai
    Object.keys(daysGrid).forEach(day => {
      daysGrid[day].sort((a, b) => a.startMin - b.startMin);
    });

    // Enrich deteksi Teori + Praktik back-to-back vs Murni Teori per hari
    Object.keys(daysGrid).forEach(day => {
      const slots = daysGrid[day];
      const courseSlotsMap = {};
      slots.forEach(s => {
        if (!courseSlotsMap[s.courseKode]) courseSlotsMap[s.courseKode] = [];
        courseSlotsMap[s.courseKode].push(s);
      });

      Object.values(courseSlotsMap).forEach(courseSlots => {
        if (courseSlots.length >= 2) {
          // Sesi ganda/majemuk (Teori + Praktik) pada hari yang sama (Back-to-Back)
          courseSlots.sort((a, b) => a.startMin - b.startMin);
          courseSlots.forEach((s, idx) => {
            s.isBackToBack = true;
            s.isPureTheory = false;
            if (idx === 0) {
              s.isB2bHead = true;
              s.isB2bTail = false;
              s.b2bLabel = 'Bersambung ke Praktik';
              s.sksDisplay = `${s.sks} SKS (Paket)`;
            } else {
              s.isB2bHead = false;
              s.isB2bTail = true;
              s.b2bLabel = 'Bersambung dari Teori';
              s.sksDisplay = '🔗 1 Paket';
            }
          });
        } else if (courseSlots.length === 1) {
          const s = courseSlots[0];
          s.isBackToBack = false;
          s.isB2bHead = false;
          s.isB2bTail = false;
          s.b2bLabel = '';
          const isPure = Boolean(s.componentCount === 1 || s.isPureTheory);
          s.isPureTheory = isPure;
          s.sksDisplay = isPure ? `${s.sks} SKS (Murni)` : `${s.sks} SKS`;
        }
      });
    });

    return daysGrid;
  }

  /**
   * Memformat ringkasan jadwal menjadi teks yang mudah dipahami mahasiswa
   * @param {Object} comb
   * @returns {string}
   */
  function formatScheduleSummary(comb, classPriority = []) {
    const m = comb.metrics;
    const daysStr = m.activeDays.join(', ');
    const gapStr = m.totalGapMinutes > 0 ? `${m.totalGapMinutes} mnt` : 'Tanpa Jeda';

    let priorityStr = '';
    if (m.priorityBreakdown && m.priorityBreakdown.length > 0) {
      priorityStr = m.priorityBreakdown.map(p => `${p.count}${p.letter}`).join('+');
    } else {
      priorityStr = `${m.blockMatchPercentage}%`;
    }

    const componentStr = m.twoComponentCount > 0
      ? ` • ${m.twoComponentCount} MK Teori+Praktik, ${m.singleComponentCount} Murni Teori (${m.totalSks} SKS)`
      : ` • ${m.singleComponentCount} MK (${m.totalSks} SKS)`;

    return `${m.totalDays} Hari (${daysStr}) • Jeda: ${gapStr} • Prioritas: ${priorityStr}${componentStr}`;
  }

  // =========================================================================
  // 7. AUTO-FIXER & CONFLICT RESOLUTION SUGGESTER
  // =========================================================================

  /**
   * Menganalisis susunan kelas pilihan pengguna yang bentrok dan memberikan saran resolusi
   * @param {Array<Object>} courses
   * @param {Array<Object>} currentSelectedClasses
   * @returns {Array<Object>} Rekomendasi pergantian kelas
   */
  function suggestResolution(courses, currentSelectedClasses, preferences = {}) {
    const conflictReport = detectConflicts(currentSelectedClasses);
    if (!conflictReport.hasConflict) return [];

    const rawPriority = preferences.classPriority || preferences.priorityOrder || preferences.targetClassOrder || preferences.targetClass;
    const classPriority = normalizePrioritySequence(rawPriority);

    const suggestions = [];
    const normCourses = normalizeCourses(courses);

    for (const conflict of conflictReport.conflicts) {
      const { classA, classB } = conflict;
      const courseA = normCourses.find(c => c.kode === classA.kode);
      const courseB = normCourses.find(c => c.kode === classB.kode);

      // Cari alternatif untuk kelas A, urutkan sesuai prioritas mahasiswa
      if (courseA) {
        const sortedAltsA = [...courseA.classes].sort((x, y) => {
          return getClassPriorityRank(x.classLetter, classPriority) - getClassPriorityRank(y.classLetter, classPriority);
        });
        const altA = sortedAltsA.find(alt => {
          if (alt.id === classA.id) return false;
          const testList = currentSelectedClasses.filter(c => c.id !== classA.id).concat(alt);
          return !detectConflicts(testList).hasConflict;
        });
        if (altA) {
          const rank = getClassPriorityRank(altA.classLetter, classPriority);
          suggestions.push({
            courseKode: courseA.kode,
            courseNama: courseA.nama,
            replaceFrom: classA.kelas,
            replaceTo: altA.kelas,
            targetPriorityRank: rank,
            reason: `Mengganti kelas ${classA.kelas} ke ${altA.kelas} (Prioritas #${rank + 1}) menghilangkan tabrakan pada hari ${conflict.day}`
          });
        }
      }

      // Cari alternatif untuk kelas B
      if (courseB) {
        const sortedAltsB = [...courseB.classes].sort((x, y) => {
          return getClassPriorityRank(x.classLetter, classPriority) - getClassPriorityRank(y.classLetter, classPriority);
        });
        const altB = sortedAltsB.find(alt => {
          if (alt.id === classB.id) return false;
          const testList = currentSelectedClasses.filter(c => c.id !== classB.id).concat(alt);
          return !detectConflicts(testList).hasConflict;
        });
        if (altB) {
          const rank = getClassPriorityRank(altB.classLetter, classPriority);
          suggestions.push({
            courseKode: courseB.kode,
            courseNama: courseB.nama,
            replaceFrom: classB.kelas,
            replaceTo: altB.kelas,
            targetPriorityRank: rank,
            reason: `Mengganti kelas ${classB.kelas} ke ${altB.kelas} (Prioritas #${rank + 1}) menghilangkan tabrakan pada hari ${conflict.day}`
          });
        }
      }
    }

    return suggestions;
  }


  // =========================================================================
  // 7. DATASET KURIKULUM REALISTIS AMIKOM (SAMPLE_COURSES - 21 SKS)
  // =========================================================================

  const SAMPLE_COURSES = [
    {
      id: 'MK1',
      kode: 'FSSIW040',
      nama: 'Aljabar Linear dan Matriks',
      sks: 3,
      classes: [
        {
          id: 'FSSIW040_A',
          kelas: 'A',
          sessions: [
            { type: 'TEORI', hari: 'Senin', jam: '07:00 - 08:40', ruang: 'R.2.1' },
            { type: 'PRAKTIK', hari: 'Senin', jam: '08:45 - 10:25', ruang: 'Lab 1' }
          ],
          hari: 'Senin',
          jam: '07:00 - 10:25',
          ruang: 'R.2.1 / Lab 1',
          kuotaSisa: 12
        },
        {
          id: 'FSSIW040_B',
          kelas: 'B',
          sessions: [
            { type: 'TEORI', hari: 'Senin', jam: '08:45 - 10:25', ruang: 'R.2.2' },
            { type: 'PRAKTIK', hari: 'Senin', jam: '10:30 - 12:10', ruang: 'Lab 1' }
          ],
          hari: 'Senin',
          jam: '08:45 - 12:10',
          ruang: 'R.2.2 / Lab 1',
          kuotaSisa: 15
        },
        {
          id: 'FSSIW040_C',
          kelas: 'C',
          sessions: [
            { type: 'TEORI', hari: 'Kamis', jam: '07:00 - 08:40', ruang: 'R.2.1' },
            { type: 'PRAKTIK', hari: 'Kamis', jam: '08:45 - 10:25', ruang: 'Lab 2' }
          ],
          hari: 'Kamis',
          jam: '07:00 - 10:25',
          ruang: 'R.2.1 / Lab 2',
          kuotaSisa: 8
        },
        {
          id: 'FSSIW040_D',
          kelas: 'D',
          sessions: [
            { type: 'TEORI', hari: 'Rabu', jam: '08:45 - 10:25', ruang: 'R.2.3' },
            { type: 'PRAKTIK', hari: 'Rabu', jam: '10:30 - 12:10', ruang: 'Lab 2' }
          ],
          hari: 'Rabu',
          jam: '08:45 - 12:10',
          ruang: 'R.2.3 / Lab 2',
          kuotaSisa: 18
        }
      ]
    },
    {
      id: 'MK2',
      kode: 'FSSIW041',
      nama: 'Bahasa Inggris lanjut',
      sks: 2,
      isPureTheory: true,
      classes: [
        {
          id: 'FSSIW041_A',
          kelas: 'A',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Senin', jam: '10:30 - 12:10', ruang: 'R.3.1' }],
          hari: 'Senin',
          jam: '10:30 - 12:10',
          ruang: 'R.3.1',
          kuotaSisa: 14
        },
        {
          id: 'FSSIW041_B',
          kelas: 'B',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Senin', jam: '13:00 - 14:40', ruang: 'R.3.2' }],
          hari: 'Senin',
          jam: '13:00 - 14:40',
          ruang: 'R.3.2',
          kuotaSisa: 20
        },
        {
          id: 'FSSIW041_C',
          kelas: 'C',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Kamis', jam: '10:30 - 12:10', ruang: 'R.3.1' }],
          hari: 'Kamis',
          jam: '10:30 - 12:10',
          ruang: 'R.3.1',
          kuotaSisa: 16
        },
        {
          id: 'FSSIW041_D',
          kelas: 'D',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Jumat', jam: '07:30 - 09:10', ruang: 'R.3.2' }],
          hari: 'Jumat',
          jam: '07:30 - 09:10',
          ruang: 'R.3.2',
          kuotaSisa: 10
        }
      ]
    },
    {
      id: 'MK3',
      kode: 'NSSIW038',
      nama: 'Bahasa Indonesia',
      sks: 3,
      isPureTheory: true,
      classes: [
        {
          id: 'NSSIW038_A',
          kelas: 'A',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Kamis', jam: '07:00 - 09:30', ruang: 'R.3.3' }],
          hari: 'Kamis',
          jam: '07:00 - 09:30',
          ruang: 'R.3.3',
          kuotaSisa: 22
        },
        {
          id: 'NSSIW038_B',
          kelas: 'B',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Kamis', jam: '08:45 - 11:15', ruang: 'R.3.2' }],
          hari: 'Kamis',
          jam: '08:45 - 11:15',
          ruang: 'R.3.2',
          kuotaSisa: 17
        },
        {
          id: 'NSSIW038_C',
          kelas: 'C',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Jumat', jam: '07:30 - 10:00', ruang: 'R.3.3' }],
          hari: 'Jumat',
          jam: '07:30 - 10:00',
          ruang: 'R.3.3',
          kuotaSisa: 12
        },
        {
          id: 'NSSIW038_D',
          kelas: 'D',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Selasa', jam: '07:00 - 09:30', ruang: 'R.3.3' }],
          hari: 'Selasa',
          jam: '07:00 - 09:30',
          ruang: 'R.3.3',
          kuotaSisa: 15
        }
      ]
    },
    {
      id: 'MK4',
      kode: 'PSSIW071',
      nama: 'Information Technology ethic, Regulation and Cyber Law',
      sks: 3,
      classes: [
        {
          id: 'PSSIW071_A',
          kelas: 'A',
          sessions: [
            { type: 'TEORI', hari: 'Kamis', jam: '10:30 - 12:10', ruang: 'R.3.4' },
            { type: 'PRAKTIK', hari: 'Kamis', jam: '13:00 - 14:40', ruang: 'Lab 3' }
          ],
          hari: 'Kamis',
          jam: '10:30 - 14:40',
          ruang: 'R.3.4 / Lab 3',
          kuotaSisa: 16
        },
        {
          id: 'PSSIW071_B',
          kelas: 'B',
          sessions: [
            { type: 'TEORI', hari: 'Kamis', jam: '13:00 - 14:40', ruang: 'R.3.4' },
            { type: 'PRAKTIK', hari: 'Kamis', jam: '14:50 - 16:30', ruang: 'Lab 3' }
          ],
          hari: 'Kamis',
          jam: '13:00 - 16:30',
          ruang: 'R.3.4 / Lab 3',
          kuotaSisa: 19
        },
        {
          id: 'PSSIW071_C',
          kelas: 'C',
          sessions: [
            { type: 'TEORI', hari: 'Rabu', jam: '13:00 - 14:40', ruang: 'R.3.4' },
            { type: 'PRAKTIK', hari: 'Rabu', jam: '14:45 - 16:25', ruang: 'Lab 3' }
          ],
          hari: 'Rabu',
          jam: '13:00 - 16:25',
          ruang: 'R.3.4 / Lab 3',
          kuotaSisa: 20
        },
        {
          id: 'PSSIW071_D',
          kelas: 'D',
          sessions: [
            { type: 'TEORI', hari: 'Senin', jam: '14:45 - 16:25', ruang: 'R.3.4' },
            { type: 'PRAKTIK', hari: 'Senin', jam: '16:30 - 18:10', ruang: 'Lab 3' }
          ],
          hari: 'Senin',
          jam: '14:45 - 18:10',
          ruang: 'R.3.4 / Lab 3',
          kuotaSisa: 14
        }
      ]
    },
    {
      id: 'MK5',
      kode: 'PSSIW072',
      nama: 'Teori Sistem Informasi',
      sks: 3,
      isPureTheory: true,
      classes: [
        {
          id: 'PSSIW072_A',
          kelas: 'A',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Senin', jam: '14:45 - 17:15', ruang: 'R.3.5' }],
          hari: 'Senin',
          jam: '14:45 - 17:15',
          ruang: 'R.3.5',
          kuotaSisa: 14
        },
        {
          id: 'PSSIW072_B',
          kelas: 'B',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Senin', jam: '14:50 - 17:20', ruang: 'R.3.5' }],
          hari: 'Senin',
          jam: '14:50 - 17:20',
          ruang: 'R.3.5',
          kuotaSisa: 18
        },
        {
          id: 'PSSIW072_C',
          kelas: 'C',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Kamis', jam: '14:45 - 17:15', ruang: 'R.3.5' }],
          hari: 'Kamis',
          jam: '14:45 - 17:15',
          ruang: 'R.3.5',
          kuotaSisa: 16
        },
        {
          id: 'PSSIW072_D',
          kelas: 'D',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Jumat', jam: '13:30 - 16:00', ruang: 'R.3.5' }],
          hari: 'Jumat',
          jam: '13:30 - 16:00',
          ruang: 'R.3.5',
          kuotaSisa: 11
        }
      ]
    },
    {
      id: 'MK6',
      kode: 'USSIW048',
      nama: 'Projek Mandiri',
      sks: 3,
      isPureTheory: true,
      classes: [
        {
          id: 'USSIW048_A',
          kelas: 'A',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Kamis', jam: '16:30 - 19:00', ruang: 'R.2.4' }],
          hari: 'Kamis',
          jam: '16:30 - 19:00',
          ruang: 'R.2.4',
          kuotaSisa: 25
        },
        {
          id: 'USSIW048_B',
          kelas: 'B',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Kamis', jam: '16:40 - 19:10', ruang: 'R.2.4' }],
          hari: 'Kamis',
          jam: '16:40 - 19:10',
          ruang: 'R.2.4',
          kuotaSisa: 20
        },
        {
          id: 'USSIW048_C',
          kelas: 'C',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Jumat', jam: '09:20 - 11:50', ruang: 'R.2.1' }],
          hari: 'Jumat',
          jam: '09:20 - 11:50',
          ruang: 'R.2.1',
          kuotaSisa: 19
        },
        {
          id: 'USSIW048_D',
          kelas: 'D',
          componentCount: 1,
          isPureTheory: true,
          sessions: [{ type: 'TEORI', hari: 'Rabu', jam: '14:45 - 17:15', ruang: 'R.2.1' }],
          hari: 'Rabu',
          jam: '14:45 - 17:15',
          ruang: 'R.2.1',
          kuotaSisa: 22
        }
      ]
    }
  ];

  // =========================================================================
  // 8. PUBLIC EXPORTS
  // =========================================================================

  const KrsScheduler = {
    HARI_MAP,
    HARI_NAMES,
    HARI_SHORT,
    PALETTE,
    TIERS,
    parseDay,
    parseTimeToMinutes,
    minutesToTime,
    parseTimeRange,
    extractClassLetter,
    normalizeSlot,
    normalizeClass,
    normalizeCourses,
    normalizePrioritySequence,
    getClassPriorityRank,
    comparePriorityRanks,
    isIntervalOverlap,
    checkSlotConflict,
    checkClassConflict,
    detectConflicts,
    evaluateSchedule,
    solve,
    generateTimetable,
    formatScheduleSummary,
    suggestResolution,
    SAMPLE_COURSES
  };

  // UMD / Global export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KrsScheduler;
  }
  global.KrsScheduler = KrsScheduler;

})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
