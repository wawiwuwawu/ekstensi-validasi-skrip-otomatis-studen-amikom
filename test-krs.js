/**
 * Test Suite: Smart War KRS & Scheduler Engine
 * Universitas AMIKOM Purwokerto Student Portal
 *
 * Menjalankan validasi komprehensif:
 * 1. Urutan prioritas dinamis N-panjang (B > C > A > D, dll)
 * 2. Teori + Praktik back-to-back & pencegahan dobel hitung SKS
 * 3. Deteksi tabrakan waktu (Interval Collision Detection)
 * 4. Auto-detect kelas yang ditawarkan
 * 5. Benchmark performa solver (< 10ms)
 * 6. Kontrak metode AmikomAPI
 */

const assert = require('assert');
const Scheduler = require('./lib/krs-scheduler.js');
const AmikomAPI = require('./lib/amikom-api.js');

console.log('====================================================');
console.log('🧪 MEMULAI TEST SUITE: SMART WAR KRS AMIKOM');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASSED: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAILED: ${name}`);
    console.error(`    ${err.message}`);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

// =========================================================================
// 1. URUTAN PRIORITAS DINAMIS N-PANJANG
// =========================================================================
console.log('--- 1. Urutan Prioritas Dinamis N-Panjang ---');

test('normalizePrioritySequence: Array dan string dengan berbagai delimiter', () => {
  const arr = Scheduler.normalizePrioritySequence(['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(arr, ['B', 'C', 'A', 'D']);

  const str1 = Scheduler.normalizePrioritySequence('B > C > A > D');
  assert.deepStrictEqual(str1, ['B', 'C', 'A', 'D']);

  const str2 = Scheduler.normalizePrioritySequence('B, C, A, D');
  assert.deepStrictEqual(str2, ['B', 'C', 'A', 'D']);

  const str3 = Scheduler.normalizePrioritySequence('B -> C -> A -> D');
  assert.deepStrictEqual(str3, ['B', 'C', 'A', 'D']);

  // Deduplikasi & pembersihan whitespace
  const dup = Scheduler.normalizePrioritySequence(['B', 'B', 'c ', 'A', 'D', ' ']);
  assert.deepStrictEqual(dup, ['B', 'C', 'A', 'D']);
});

test('getClassPriorityRank: Peringkat prioritas dan penalti yang akurat', () => {
  const priority = ['B', 'C', 'A', 'D'];
  assert.strictEqual(Scheduler.getClassPriorityRank('B', priority), 0); // Prioritas #1
  assert.strictEqual(Scheduler.getClassPriorityRank('C', priority), 1); // Prioritas #2
  assert.strictEqual(Scheduler.getClassPriorityRank('A', priority), 2); // Prioritas #3
  assert.strictEqual(Scheduler.getClassPriorityRank('D', priority), 3); // Prioritas #4
  // Kelas E tidak ada dalam prioritas -> penalti lebih tinggi
  assert.ok(Scheduler.getClassPriorityRank('E', priority) > 3);
});

test('comparePriorityRanks: Perbandingan leksikografis kombinasi kelas', () => {
  const combA = { metrics: { rankCounts: { 0: 5, 1: 1, 2: 1 } } }; // 5 MK di prioritas #1
  const combB = { metrics: { rankCounts: { 0: 4, 1: 3, 2: 0 } } }; // 4 MK di prioritas #1
  // combA lebih baik daripada combB karena memiliki lebih banyak rank 0
  const comp = Scheduler.comparePriorityRanks(combA, combB);
  assert.ok(comp < 0, 'Kombinasi dengan kelas rank 0 lebih banyak harus diutamakan (hasil < 0)');
});

test('solve(): Optimasi dengan urutan prioritas B > C > A > D', () => {
  const res = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'BLOCK_CLASS',
    preferences: {
      classPriority: ['B', 'C', 'A', 'D'],
      targetClass: 'B'
    },
    maxResults: 5
  });

  assert.strictEqual(res.success, true);
  assert.ok(res.combinations.length > 0);
  const top = res.combinations[0];
  assert.strictEqual(top.metrics.totalSks, 17);
  
  // Mayoritas kelas terpilih harus Kelas B
  const bCount = top.selectedClasses.filter(c => c.kelas === 'B').length;
  assert.ok(bCount >= 3, `Minimal 3 kelas harus Kelas B (ditemukan ${bCount})`);
});

test('solve(): Optimasi dengan urutan prioritas C > A > B > D', () => {
  const res = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'BLOCK_CLASS',
    preferences: {
      classPriority: ['C', 'A', 'B', 'D'],
      targetClass: 'C'
    },
    maxResults: 5
  });

  assert.strictEqual(res.success, true);
  const top = res.combinations[0];
  assert.strictEqual(top.metrics.totalSks, 17);
  const cCount = top.selectedClasses.filter(c => c.kelas === 'C').length;
  assert.ok(cCount >= 3, `Minimal 3 kelas harus Kelas C (ditemukan ${cCount})`);
});

// =========================================================================
// 2. TEORI + PRAKTIK BACK-TO-BACK & NO DOBEL HITUNG SKS
// =========================================================================
console.log('\n--- 2. Teori + Praktik Back-to-Back & Anti Dobel SKS ---');

test('SAMPLE_COURSES: Struktur dataset lengkap 6 Matkul & 17 SKS Sistem Informasi', () => {
  assert.strictEqual(Scheduler.SAMPLE_COURSES.length, 6);
  const totalCourseSks = Scheduler.SAMPLE_COURSES.reduce((acc, c) => acc + c.sks, 0);
  assert.strictEqual(totalCourseSks, 17, 'Total SKS 6 mata kuliah harus tepat 17 SKS');
});

test('evaluateSchedule: Menghitung tepat 17 SKS tanpa double-count sesi praktik', () => {
  // Ambil kelas A dari setiap mata kuliah
  const selected = Scheduler.SAMPLE_COURSES.map(c => Scheduler.normalizeClass(c.classes[0], c));
  const metrics = Scheduler.evaluateSchedule(selected, { classPriority: ['A', 'B', 'C', 'D'] });
  assert.strictEqual(metrics.totalSks, 17, 'Total SKS terhitung harus 17 SKS');
});

test('generateTimetable: Metadata slot Teori + Praktik back-to-back dan Murni Teori', () => {
  const res = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'COMPACT_DAYS',
    preferences: { maxDays: 2, preferredDays: ['Senin', 'Kamis'] }
  });

  assert.strictEqual(res.success, true);
  const top = res.combinations[0];
  assert.strictEqual(top.metrics.totalDays, 2);
  assert.strictEqual(top.metrics.totalSks, 17);

  const timetable = top.timetable;
  const seninSlots = timetable['Senin'];
  assert.ok(seninSlots.length >= 2, 'Senin harus memiliki jadwal');

  // Cari pasangan Teori + Praktik untuk Aljabar Linear dan Matriks (FSSIW040)
  const fssiwSlots = seninSlots.filter(s => s.courseKode === 'FSSIW040');
  assert.strictEqual(fssiwSlots.length, 2, 'FSSIW040 harus memiliki 2 sesi (Teori & Praktik)');
  const teoriSlot = fssiwSlots[0];
  const praktikSlot = fssiwSlots[1];

  // Verifikasi Head (Teori)
  assert.strictEqual(teoriSlot.isBackToBack, true);
  assert.strictEqual(teoriSlot.isB2bHead, true);
  assert.strictEqual(teoriSlot.isB2bTail, false);
  assert.strictEqual(teoriSlot.sksDisplay, '3 SKS (Paket)');
  assert.strictEqual(teoriSlot.b2bLabel, 'Bersambung ke Praktik');

  // Verifikasi Tail (Praktik)
  assert.strictEqual(praktikSlot.isBackToBack, true);
  assert.strictEqual(praktikSlot.isB2bHead, false);
  assert.strictEqual(praktikSlot.isB2bTail, true);
  assert.strictEqual(praktikSlot.sksDisplay, '🔗 1 Paket');
  assert.strictEqual(praktikSlot.b2bLabel, 'Bersambung dari Teori');

  // Verifikasi Murni Teori (Bahasa Indonesia NSSIW038 pada hari Kamis)
  const kamisSlots = timetable['Kamis'];
  const nssiwSlot = kamisSlots.find(s => s.courseKode === 'NSSIW038');
  assert.ok(nssiwSlot, 'NSSIW038 harus ada di hari Kamis');
  assert.strictEqual(nssiwSlot.isPureTheory, true);
  assert.strictEqual(nssiwSlot.isBackToBack, false);
  assert.strictEqual(nssiwSlot.sksDisplay, '3 SKS (Murni)');
});

// =========================================================================
// 3. DETEKSI TABRAKAN WAKTU (INTERVAL COLLISION DETECTION)
// =========================================================================
console.log('\n--- 3. Deteksi Tabrakan Waktu (Interval Collision) ---');

test('isIntervalOverlap: Deteksi tabrakan waktu matematis akurat', () => {
  // Overlap: 07:00-08:40 (420-520) vs 08:00-09:40 (480-580)
  assert.strictEqual(Scheduler.isIntervalOverlap(420, 520, 480, 580, 0), true);

  // Touching / Back-to-back: 07:00-08:40 (420-520) vs 08:40-10:20 (520-620)
  // Tidak overlap dengan buffer 0
  assert.strictEqual(Scheduler.isIntervalOverlap(420, 520, 520, 620, 0), false);

  // Touching dengan buffer 10 menit -> menjadi overlap
  assert.strictEqual(Scheduler.isIntervalOverlap(420, 520, 520, 620, 10), true);

  // Berjauhan: 07:00-08:40 (420-520) vs 10:30-12:10 (630-730)
  assert.strictEqual(Scheduler.isIntervalOverlap(420, 520, 630, 730, 0), false);
});

test('checkClassConflict: Deteksi konflik antar 2 kelas mata kuliah berbeda', () => {
  const classA = Scheduler.normalizeClass({
    id: 'MK1_A',
    kelas: 'A',
    sessions: [{ hari: 'Senin', jam: '07:00 - 08:40', ruang: 'R.3.1', type: 'TEORI' }]
  }, { kode: 'MK1', nama: 'Matkul 1' });

  // Class B tabrakan jam dengan Class A di hari yang sama
  const classB_bentrok = Scheduler.normalizeClass({
    id: 'MK2_A',
    kelas: 'A',
    sessions: [{ hari: 'Senin', jam: '08:00 - 09:40', ruang: 'R.3.2', type: 'TEORI' }]
  }, { kode: 'MK2', nama: 'Matkul 2' });

  // Class B aman (hari beda atau jam beda)
  const classB_aman = Scheduler.normalizeClass({
    id: 'MK2_B',
    kelas: 'B',
    sessions: [{ hari: 'Senin', jam: '08:45 - 10:25', ruang: 'R.3.2', type: 'TEORI' }]
  }, { kode: 'MK2', nama: 'Matkul 2' });

  const bentrokRes = Scheduler.checkClassConflict(classA, classB_bentrok);
  assert.ok(bentrokRes !== null);
  assert.strictEqual(bentrokRes.conflict, true);
  assert.strictEqual(bentrokRes.day, 'Senin');

  const amanRes = Scheduler.checkClassConflict(classA, classB_aman);
  assert.strictEqual(amanRes, null);
});

test('detectConflicts: Deteksi tabrakan menyeluruh pada array jadwal', () => {
  const classA = Scheduler.normalizeClass({
    id: 'MK1_A',
    kelas: 'A',
    sessions: [{ hari: 'Senin', jam: '07:00 - 08:40', type: 'TEORI' }]
  }, { kode: 'MK1' });

  const classB = Scheduler.normalizeClass({
    id: 'MK2_A',
    kelas: 'A',
    sessions: [{ hari: 'Senin', jam: '08:00 - 09:40', type: 'TEORI' }]
  }, { kode: 'MK2' });

  const report = Scheduler.detectConflicts([classA, classB]);
  assert.strictEqual(report.hasConflict, true);
  assert.strictEqual(report.conflictCount, 1);
  assert.ok(report.conflictingClassIds.includes('MK1_A'));
  assert.ok(report.conflictingClassIds.includes('MK2_A'));
});

// =========================================================================
// 4. AUTO-DETECT KELAS DARI PENAWARAN
// =========================================================================
console.log('\n--- 4. Auto-Detect Kelas Penawaran & Parsing ---');

test('extractClassLetter: Ekstraksi huruf kelas berbagai format Amikom', () => {
  assert.strictEqual(Scheduler.extractClassLetter('A'), 'A');
  assert.strictEqual(Scheduler.extractClassLetter('Kelas B'), 'B');
  assert.strictEqual(Scheduler.extractClassLetter('20IF01_C'), 'C');
  assert.strictEqual(Scheduler.extractClassLetter('IF201 - D'), 'D');
  assert.strictEqual(Scheduler.extractClassLetter('KELAS 21IF_A '), 'A');
});

test('AmikomAPI.parseMakulDitawarkan: Parsing HTML penawaran portal student', () => {
  const api = new AmikomAPI();
  const sampleHtml = `
    <div class="panel-body">
      <label>
        <input type="checkbox" name="makul[]" value="3_2036311_PSSIP055 _B " data-is_ulang="false">
        PSSIP055 Pemrograman Web Lanjut Baru
      </label>
      <label>
        <input type="checkbox" name="makul[]" value="3_2036312_PSSIP056 _C " data-is_ulang="false">
        PSSIP056 Basis Data Terdistribusi Baru
      </label>
    </div>
  `;

  const parsed = api.parseMakulDitawarkan(sampleHtml);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].kode, 'PSSIP055');
  assert.strictEqual(parsed[0].kelas, 'B');
  assert.strictEqual(parsed[0].sks, 3);
  assert.strictEqual(parsed[1].kode, 'PSSIP056');
  assert.strictEqual(parsed[1].kelas, 'C');
});

// =========================================================================
// 5. BENCHMARK PERFORMA SOLVER (< 10MS CONSTRAINT)
// =========================================================================
console.log('\n--- 5. Benchmark Performa Solver (< 10ms) ---');

test('Performa Solver BLOCK_CLASS: Waktu komputasi rata-rata < 10ms', () => {
  const runs = 10;
  const times = [];

  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    Scheduler.solve({
      courses: Scheduler.SAMPLE_COURSES,
      strategy: 'BLOCK_CLASS',
      preferences: {
        classPriority: ['B', 'C', 'A', 'D'],
        targetClass: 'B'
      },
      maxResults: 5
    });
    const t1 = process.hrtime.bigint();
    const durationMs = Number(t1 - t0) / 1e6;
    times.push(durationMs);
  }

  // Buang run pertama (JIT warm-up)
  const warmedTimes = times.slice(1);
  const avgTime = warmedTimes.reduce((a, b) => a + b, 0) / warmedTimes.length;
  console.log(`    Durasi Benchmark (9 runs): rata-rata ${avgTime.toFixed(3)} ms (Min: ${Math.min(...warmedTimes).toFixed(3)} ms, Max: ${Math.max(...warmedTimes).toFixed(3)} ms)`);
  assert.ok(avgTime < 10, `Waktu rata-rata ${avgTime.toFixed(3)}ms harus lebih kecil dari 10ms`);
});

test('Performa Solver COMPACT_DAYS: Waktu komputasi rata-rata < 10ms', () => {
  const runs = 10;
  const times = [];

  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    Scheduler.solve({
      courses: Scheduler.SAMPLE_COURSES,
      strategy: 'COMPACT_DAYS',
      preferences: {
        maxDays: 2,
        preferredDays: ['Senin', 'Kamis']
      },
      maxResults: 5
    });
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }

  const warmedTimes = times.slice(1);
  const avgTime = warmedTimes.reduce((a, b) => a + b, 0) / warmedTimes.length;
  console.log(`    Durasi Benchmark (9 runs): rata-rata ${avgTime.toFixed(3)} ms`);
  assert.ok(avgTime < 10, `Waktu rata-rata ${avgTime.toFixed(3)}ms harus lebih kecil dari 10ms`);
});

// =========================================================================
// 6. KONTRAK AMIKOM API
// =========================================================================
console.log('\n--- 6. Kontrak API War KRS (Tahap 1 & Tahap 3) ---');

test('AmikomAPI: Menyediakan metode lengkap submitPilihKelas dan submitKrsKelas', () => {
  const api = new AmikomAPI();
  assert.strictEqual(typeof api.submitPilihKelas, 'function');
  assert.strictEqual(typeof api.submitKrsKelas, 'function');
  assert.strictEqual(typeof api.submitRencanaPengajuanMaba, 'function');
  assert.strictEqual(typeof api.sinkronisasiMakul, 'function');
  assert.strictEqual(typeof api.parseMakulDitawarkan, 'function');
});

test('Dynamic Priority N-Panjang (6 elemen: E > D > C > B > A > F) dengan fallback bertingkat', () => {
  const seq = Scheduler.normalizePrioritySequence('E -> D -> C -> B -> A -> F');
  assert.deepStrictEqual(seq, ['E', 'D', 'C', 'B', 'A', 'F']);

  const res = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'BLOCK_CLASS',
    preferences: { classPriority: seq }
  });

  assert.strictEqual(res.success, true);
  const top = res.combinations[0];
  assert.strictEqual(top.metrics.totalSks, 17);
  // Karena kelas E tidak ada di penawaran, solver fallback ke prioritas rank berikutnya ('D')
  const dCount = top.selectedClasses.filter(c => c.kelas === 'D').length;
  assert.strictEqual(dCount, 6, 'Seluruh 6 MK harus fallback mulus ke Kelas D');
});

test('Defensive Input Handling: generateTimetable, evaluateSchedule, detectConflicts menerima objek kombinasi atau array', () => {
  const res = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'BLOCK_CLASS',
    preferences: { classPriority: ['B', 'C', 'A'] }
  });
  const top = res.combinations[0];

  // 1. Terima kombinasi langsung tanpa crash
  const ttFromComb = Scheduler.generateTimetable(top);
  assert.ok(ttFromComb && typeof ttFromComb === 'object');
  assert.ok(Array.isArray(ttFromComb['Senin']));

  const evalFromComb = Scheduler.evaluateSchedule(top);
  assert.strictEqual(evalFromComb.totalSks, 17);

  const confFromComb = Scheduler.detectConflicts(top);
  assert.strictEqual(confFromComb.hasConflict, false);

  // 2. Terima input kosong/undefined tanpa melempar TypeError
  assert.doesNotThrow(() => Scheduler.generateTimetable(null));
  assert.doesNotThrow(() => Scheduler.generateTimetable(undefined));
  assert.doesNotThrow(() => Scheduler.evaluateSchedule(null));
  assert.doesNotThrow(() => Scheduler.detectConflicts(null));
});

// =========================================================================
// 7. VERIFIKASI 5 PERBAIKAN CODE REVIEW
// =========================================================================
console.log('\n--- 7. Verifikasi 5 Perbaikan Code Review ---');

test('Temuan 5 - Exact Class Letter Match: SI23A tidak salah dicocokkan sebagai kelas A', () => {
  const clsSI23A = Scheduler.normalizeClass({
    id: 'MK_SI23A',
    kelas: 'SI23A',
    sessions: [{ hari: 'Senin', jam: '07:00 - 08:40', type: 'TEORI' }]
  }, { kode: 'MK1' });

  const metrics = Scheduler.evaluateSchedule([clsSI23A], { targetClass: 'A' });
  assert.strictEqual(metrics.blockMatches, 0, 'SI23A tidak boleh dihitung sebagai match untuk targetClass A');
});

test('Temuan 3 - singleComponentCount & formatScheduleSummary: Tidak menghasilkan undefined Murni Teori', () => {
  const selected = Scheduler.SAMPLE_COURSES.map(c => Scheduler.normalizeClass(c.classes[0], c));
  const metrics = Scheduler.evaluateSchedule(selected, { classPriority: ['A'] });
  assert.strictEqual(typeof metrics.singleComponentCount, 'number', 'singleComponentCount harus berupa tipe number');
  assert.ok(metrics.singleComponentCount > 0, 'Harus ada mata kuliah murni teori pada SAMPLE_COURSES');

  const summary = Scheduler.formatScheduleSummary({ metrics, selectedClasses: selected }, ['A']);
  assert.ok(!summary.includes('undefined Murni Teori'), 'Summary tidak boleh menghasilkan "undefined Murni Teori"');
  assert.ok(summary.includes('Murni Teori'), 'Summary harus valid memuat komponen Murni Teori');
});

test('Temuan 2 - maxDays & preferredDays: Solver membatasi maxDays dan mengutamakan hari pilihan', () => {
  const res2Days = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'COMPACT_DAYS',
    preferences: { maxDays: 2, preferredDays: ['Senin', 'Kamis'] }
  });
  assert.strictEqual(res2Days.success, true);
  assert.ok(res2Days.combinations.every(comb => comb.metrics.totalDays <= 2), 'Total hari tidak boleh melebihi maxDays: 2');
  assert.ok(res2Days.combinations[0].metrics.preferredDayMatches > 0, 'Kombinasi teratas harus memiliki hari yang cocok dengan preferredDays');

  // Jika maxDays dipaksa 1 hari untuk 21 SKS (mustahil tanpa bentrok) -> solver memangkas dan menghasilkan false
  const res1Day = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'COMPACT_DAYS',
    preferences: { maxDays: 1 }
  });
  assert.strictEqual(res1Day.success, false, 'maxDays yang mustahil harus mengembalikan success: false');
});

test('Temuan 2 - blockFallbackPolicy STRICT: Batasi opsi hanya pada kelas dalam urutan prioritas', () => {
  // Dalam mode STRICT dengan prioritas ['B', 'C'], hanya kelas B dan C yang boleh dipilih (tidak boleh A atau D)
  const resStrict = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'BLOCK_CLASS',
    preferences: {
      classPriority: ['B', 'C'],
      targetClass: 'B',
      blockFallbackPolicy: 'STRICT'
    }
  });
  assert.strictEqual(resStrict.success, true);
  const top = resStrict.combinations[0];
  assert.ok(top.selectedClasses.every(c => ['B', 'C'].includes(c.classLetter)), 'Semua kelas harus kelas B atau C pada mode STRICT');
  assert.ok(!top.selectedClasses.some(c => ['A', 'D'].includes(c.classLetter)), 'Tidak boleh ada kelas A atau D di luar prioritas pada mode STRICT');

  // Jika prioritas adalah kelas yang tidak ada di penawaran ('Z'), mode STRICT menolak kelas di luar prioritas
  const resInfeasible = Scheduler.solve({
    courses: Scheduler.SAMPLE_COURSES,
    strategy: 'BLOCK_CLASS',
    preferences: {
      classPriority: ['Z'],
      targetClass: 'Z',
      blockFallbackPolicy: 'STRICT'
    }
  });
  assert.strictEqual(resInfeasible.success, false, 'STRICT harus menolak fallback ke kelas di luar prioritas');
});

test('Temuan 4 - Filter K/S: Mahasiswa reguler tidak mendapatkan kelas K atau kelas S (MK Inti) pada fallback', () => {
  const dummyCourse = {
    id: 'MK_CORE',
    kode: 'CORE101',
    nama: 'Mata Kuliah Inti',
    sks: 3,
    isCore: true,
    classes: [
      {
        id: 'CORE101_K',
        kelas: 'K',
        hari: 'Senin',
        jam: '07:00 - 08:40',
        kuotaSisa: 20
      },
      {
        id: 'CORE101_S',
        kelas: 'S',
        hari: 'Selasa',
        jam: '17:00 - 18:40',
        kuotaSisa: 20
      }
    ]
  };

  const res = Scheduler.solve({
    courses: [dummyCourse],
    preferences: { disallowClassK: true, disallowClassSForCore: true }
  });
  assert.strictEqual(res.success, false, 'MK Inti hanya kelas K/S harus ditolak untuk mahasiswa reguler');
});

test('Temuan 1 - Wiring Penawaran Nyata Portal: Nilai value asli (3_2036311_PSSIP055 _C ) dipertahankan pada normalized class', () => {
  const rawPortalItem = {
    value: '3_2036311_PSSIP055 _C ',
    id: '2036311',
    kode: 'PSSIP055',
    nama: 'Pengembangan Aplikasi Web',
    sks: 3,
    kelas: 'C'
  };

  const norm = Scheduler.normalizeClass({
    id: rawPortalItem.id,
    value: rawPortalItem.value,
    kelas: rawPortalItem.kelas,
    hari: 'Senin',
    jam: '07:00 - 08:40'
  }, rawPortalItem);

  assert.strictEqual(norm.value, '3_2036311_PSSIP055 _C ', 'c.value asli harus dipertahankan untuk payload pengajuan');
  assert.strictEqual(norm.classLetter, 'C');
  assert.strictEqual(norm.sks, 3);
});

// =========================================================================
// REKAPITULASI HASIL TEST
// =========================================================================
console.log('\n====================================================');
console.log(`🎉 HASIL PENGUJIAN: ${passedTests}/${totalTests} TESTS BERHASIL!`);
console.log('====================================================\n');
