/**
 * Test Suite: Pipeline Validasi Presensi (Direct API Engine)
 * Universitas AMIKOM Purwokerto Student Portal
 *
 * Fixture di test/fixtures/ menyalin respons/halaman portal student.
 * - getsem.html, getmakul.html, getabsenmhs.html: verbatim.
 * - ajax_editpresensi-lengkap.json: bentuk lengkap (ada id_presensi_mhs,
 *   id_presensi_dosen, nama, judul_materi, kuliah_tp_id).
 * - ajax_editpresensi-tanpa-id.json: variasi tanpa id_presensi_mhs, untuk
 *   menguji fallback dari list_makul_belum_validasi.
 * - presensi.html: sengaja diracuni (lihat komentar di dalam file).
 * Semua request di-mock; tidak ada akses jaringan.
 *
 * Yang dijaga:
 * 1. Semester TIDAK lagi dibaca dari <select id="semester"> (kosong/disabled di
 *    halaman asli -> autoValidateAll throw). Sumber: POST /pembelajaran/getSem.
 * 2. Payload update_presensimhs selalu memuat idpresensimhstexs (dari
 *    ajax_editpresensi, fallback list_makul_belum_validasi).
 * 3. Nama & bentuk field form asli: jenispilih, idpresensimhstexs, idpresensidosen,
 *    kuliahteori, kuliahpraktek, kesesuaian_*, penilaianmhs, kritiksaran,
 *    asdos_npms[], asdospenilaian_{index}_{krit}.
 * 4. Progres memakai jumlah sesi yang benar-benar ter-parse.
 * 5. Pencocokan matkul berdasarkan kode pada value option getmakul.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AmikomAPI = require('./lib/amikom-api.js');

const F = (n) => fs.readFileSync(path.join(__dirname, 'test', 'fixtures', n), 'utf8');

// state mock per-test
let getSemResponse = F('getsem.html');
let unvalidated = JSON.stringify({
  PSSIW034: {
    makul: 'Arsitektur Enterprise',
    count: 2,
    id_presensi_mhs: ['5614795', '5614829'],
    kelasgab: ['SI23A AE', 'SI23A AE']
  }
});
let editPresensiDetail = F('ajax_editpresensi-tanpa-id.json');
let updateResponse = '{"status":true}';
const calls = [];

function resetMock() {
  getSemResponse = F('getsem.html');
  unvalidated = JSON.stringify({
    PSSIW034: {
      makul: 'Arsitektur Enterprise',
      count: 2,
      id_presensi_mhs: ['5614795', '5614829'],
      kelasgab: ['SI23A AE', 'SI23A AE']
    }
  });
  editPresensiDetail = F('ajax_editpresensi-tanpa-id.json');
  updateResponse = '{"status":true}';
  calls.length = 0;
}

const posts = () => calls.filter((c) => c.url.includes('update_presensimhs'));
const paramsOf = (body) => {
  const p = new URLSearchParams(body);
  return {
    get: (k) => p.get(k),
    all: (k) => p.getAll(k),
    keys: () => [...new Set([...p.keys()])]
  };
};

function installMock() {
  global.fetch = async (url, opts = {}) => {
    const u = String(url).replace('https://student.amikompurwokerto.ac.id', '');
    const body = opts.body || null;
    calls.push({ url: u, method: (opts.method || 'GET').toUpperCase(), body });
    const text = async () => {
      if (u.includes('/pembelajaran/update_presensimhs')) return updateResponse;
      if (u.includes('/pembelajaran/getSem')) return getSemResponse;
      if (u.includes('/pembelajaran/list_makul_belum_validasi')) return unvalidated;
      if (u.includes('/pembelajaran/getmakul')) return F('getmakul.html');
      if (u.includes('/pembelajaran/getabsenmhs')) return F('getabsenmhs.html');
      if (u.includes('/pembelajaran/ajax_editpresensi/')) return editPresensiDetail;
      if (u === '/presensi') return F('presensi.html');
      return '{}';
    };
    return { status: 200, ok: true, redirected: false, url: u, text };
  };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  resetMock();
  installMock();
  try {
    await fn();
    passed++;
    console.log(`  \u2713 PASSED: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 FAILED: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('====================================================');
console.log('\u{1F9EA} TEST SUITE: PIPELINE VALIDASI PRESENSI');
console.log('====================================================\n');

(async () => {

await test('konteks akademik: semester dari getSem, bukan dari select #semester', async () => {
  const api = new AmikomAPI();
  const ctx = await api.getAcademicContext();
  assert.strictEqual(ctx.thnAkademik, '2026/2027', 'tahun akademik harus dari option selected');
  // fixture sengaja menaruh value penciri "9" pada #semester; nilai itu TIDAK boleh dipakai
  assert.strictEqual(ctx.semester, '1', `semester harus "1" dari getSem, dapat: ${ctx.semester}`);
});

await test('konteks akademik: getSem benar-benar dipanggil (POST, body thn_akademik)', async () => {
  const api = new AmikomAPI();
  await api.getAcademicContext();
  const call = calls.find((c) => c.url.includes('/pembelajaran/getSem'));
  assert.ok(call, 'endpoint /pembelajaran/getSem harus dipanggil');
  assert.strictEqual(call.method, 'POST');
  assert.match(call.body, /thn_akademik=2026%2F2027/);
});

await test('konteks akademik: fallback ke var currentSEMESTER bila getSem kosong', async () => {
  getSemResponse = '';
  const api = new AmikomAPI();
  const ctx = await api.getAcademicContext();
  assert.strictEqual(ctx.semester, '7', `harus jatuh ke currentSEMESTER, dapat: ${ctx.semester}`);
});

await test('parse sesi: field tabel getabsenmhs (kuliahPraktek tetap string kosong)', async () => {
  const api = new AmikomAPI();
  const sessions = api.parseUnvalidatedSessions(F('getabsenmhs.html'));
  assert.strictEqual(sessions.length, 2);
  assert.deepStrictEqual(sessions[0], {
    idPresensiDosen: '213719',
    matkulNama: 'Arsitektur Enterprise',
    kuliahTeori: '19630',
    kuliahPraktek: '',
    jenisPilih: 'teori'
  });
  assert.deepStrictEqual(sessions[1].idPresensiDosen, '213720');
});

await test('autoValidateAll: semua sesi tervalidasi walau detail tak berisi id_presensi_mhs', async () => {
  const api = new AmikomAPI();
  const res = await api.autoValidateAll({ onLog: () => {}, delayMs: 0 });
  assert.strictEqual(res.count, 2, `count harus 2, dapat ${res.count}`);
  assert.strictEqual(res.failedCount, 0, `tidak boleh ada sesi gagal, dapat ${res.failedCount}`);
  assert.strictEqual(posts().length, 2);
});

await test('payload submit: idpresensimhstexs terisi dari list_makul_belum_validasi (fallback)', async () => {
  const api = new AmikomAPI();
  await api.autoValidateAll({ onLog: () => {}, delayMs: 0 });
  const p = paramsOf(posts()[0].body);
  assert.strictEqual(p.get('idpresensimhstexs'), '5614795');
  assert.strictEqual(p.get('idpresensidosen'), '213719');
  assert.strictEqual(p.get('jenispilih'), 'teori');
  assert.strictEqual(p.get('kuliahteori'), '19630');
  assert.strictEqual(p.get('kuliahpraktek'), '', 'kuliahpraktek kosong harus tetap terkirim seperti form asli');
  assert.strictEqual(p.get('penilaianmhs'), '3');
  assert.strictEqual(p.get('kritiksaran'), '-');
  assert.strictEqual(p.get('kesesuaian_perkuliahan'), '1');
  assert.strictEqual(p.get('kesesuaian_materi'), '1');
  // sesi kedua memakai id presensi mhs yang berbeda, bukan id yang sama berulang
  assert.strictEqual(paramsOf(posts()[1].body).get('idpresensimhstexs'), '5614829');
});

await test('payload submit: idpresensimhstexs diutamakan dari ajax_editpresensi bila ada', async () => {
  editPresensiDetail = JSON.stringify({
    id_presensi_mhs: '9998887',
    nama: 'Andi Dwi Riyanto',
    asdoss: [],
    kriterias: JSON.parse(F('ajax_editpresensi-tanpa-id.json')).kriterias
  });
  const api = new AmikomAPI();
  await api.autoValidateAll({ onLog: () => {}, delayMs: 0 });
  assert.strictEqual(paramsOf(posts()[0].body).get('idpresensimhstexs'), '9998887');
});

await test('sesi tanpa id_presensi_mhs dari kedua sumber: dilewati, bukan dikirim cacat', async () => {
  unvalidated = JSON.stringify({
    PSSIW034: { makul: 'Arsitektur Enterprise', count: 2, id_presensi_mhs: [], kelasgab: [] }
  });
  const api = new AmikomAPI();
  const logs = [];
  const res = await api.autoValidateAll({ onLog: (t, m) => logs.push(`${t}:${m}`), delayMs: 0 });
  assert.strictEqual(posts().length, 0, 'tidak boleh ada POST ke update_presensimhs');
  assert.strictEqual(res.count, 0);
  assert.ok(
    logs.some((l) => /error/i.test(l) && /id_presensi_mhs/i.test(l)),
    `harus ada log error eksplisit, log: ${logs.join(' | ')}`
  );
});

await test('progres: denominator = sesi yang benar-benar ter-parse (100%)', async () => {
  const api = new AmikomAPI();
  const seen = [];
  await api.autoValidateAll({
    onLog: () => {},
    delayMs: 0,
    onProgress: (p) => seen.push(p)
  });
  assert.ok(seen.length > 0, 'onProgress harus terpanggil');
  assert.strictEqual(seen[seen.length - 1].percent, 100);
  assert.strictEqual(seen[seen.length - 1].total, 2, `total harus 2, dapat ${seen[seen.length - 1].total}`);
});

await test('progres: count makul > jumlah tombol tidak membuat total melompat', async () => {
  unvalidated = JSON.stringify({
    PSSIW034: {
      makul: 'Arsitektur Enterprise',
      count: 99,
      id_presensi_mhs: ['5614795', '5614829'],
      kelasgab: ['SI23A AE', 'SI23A AE']
    }
  });
  const api = new AmikomAPI();
  const seen = [];
  await api.autoValidateAll({ onLog: () => {}, delayMs: 0, onProgress: (p) => seen.push(p) });
  assert.strictEqual(seen[seen.length - 1].total, 2);
  assert.strictEqual(seen[seen.length - 1].percent, 100);
});

await test('pencocokan matkul: kode pada value option getmakul dipakai persis', async () => {
  const api = new AmikomAPI();
  const opts = await api.getMakulOptions('2026/2027', '1');
  // value portal berbentuk "<id>__<KODE>" dengan trailing space
  const byKode = (kode) =>
    opts.find((o) => (o.value.split('__')[1] || '').trim().toUpperCase() === kode);
  assert.strictEqual(byKode('PSSIW034').value.trim(), '19630__PSSIW034');
  assert.strictEqual(byKode('PSSIP056').text, 'Sistem Penunjang Keputusan');
  // near-miss tidak boleh cocok (bug lama: value.includes(kode))
  assert.strictEqual(byKode('SSIW03'), undefined, 'substring kode tidak boleh cocok');
  assert.strictEqual(byKode('ARSITEKTUR'), undefined, 'nama bukan kode');
});

await test('nilai asdos: preset default (1/5/10/14) dan maksimal (1/5/9/13)', async () => {
  const api = new AmikomAPI();
  const kriterias = JSON.parse(F('ajax_editpresensi-tanpa-id.json')).kriterias;
  const base = {
    jenisPilih: 'teori',
    idPresensiMhs: '5614795',
    idPresensiDosen: '213719',
    kuliahTeori: '19630',
    kuliahPraktek: '',
    asdoss: [{ npm: '22SA11A011', nama: 'Asdos A' }, { npm: '22SA11A012', nama: 'Asdos B' }],
    kriterias: kriterias
  };

  await api.submitPresensiValidasi({ ...base, asdosPreset: 'default' });
  let p = paramsOf(posts()[0].body);
  assert.deepStrictEqual(p.all('asdos_npms[]'), ['22SA11A011', '22SA11A012'], 'asdos_npms[] harus array berulang');
  assert.strictEqual(p.get('asdospenilaian_0_1'), '1');
  assert.strictEqual(p.get('asdospenilaian_0_2'), '5');
  assert.strictEqual(p.get('asdospenilaian_0_3'), '10');
  assert.strictEqual(p.get('asdospenilaian_0_4'), '14');
  assert.strictEqual(p.get('asdospenilaian_1_3'), '10', 'asdos kedua wajib ikut ternilai');

  await api.submitPresensiValidasi({ ...base, asdosPreset: 'maksimal' });
  p = paramsOf(posts()[1].body);
  assert.strictEqual(p.get('asdospenilaian_0_3'), '9');
  assert.strictEqual(p.get('asdospenilaian_0_4'), '13');
  assert.strictEqual(p.get('asdospenilaian_0_1'), '1');
  assert.strictEqual(p.get('asdospenilaian_0_2'), '5');
});

await test('gagal server (status:false) dilaporkan, bukan dianggap sukses', async () => {
  updateResponse = '{"status":false,"inputerror":["penilaianmhs"],"error_string":["wajib diisi"]}';
  const api = new AmikomAPI();
  const logs = [];
  const res = await api.autoValidateAll({ onLog: (t, m) => logs.push(`${t}:${m}`), delayMs: 0 });
  assert.strictEqual(res.count, 0, 'sesi ditolak server tidak boleh dihitung sukses');
  assert.ok(
    logs.some((l) => /error/i.test(l)),
    `harus ada log error, log: ${logs.join(' | ')}`
  );
});

await test('semester: opsi ganda + currentSEMESTER mengikuti presedensi portal', async () => {
  // fixture presensi.html memuat currentSEMESTER = "7"; opsi berisi 7 dan 8
  getSemResponse = '<option value=7>Ganjil</option><option value=8>Genap</option>';
  const api = new AmikomAPI();
  const ctx = await api.getAcademicContext();
  assert.strictEqual(ctx.semester, '7', `harus memilih opsi yang sama dengan currentSEMESTER, dapat ${ctx.semester}`);
});

await test('semester: opsi ganda tanpa currentSEMESTER -> opsi pertama', async () => {
  getSemResponse = '<option value=2>Genap</option><option value=1>Ganjil</option>';
  const fsMock = fs.readFileSync(path.join(__dirname, 'test', 'fixtures', 'presensi.html'), 'utf8')
    .replace(/var\s+currentSEMESTER[^;]*;/, '');
  const saved = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url).replace('https://student.amikompurwokerto.ac.id', '');
    const body = opts.body || null;
    calls.push({ url: u, method: (opts.method || 'GET').toUpperCase(), body });
    const text = async () => {
      if (u.includes('/pembelajaran/getSem')) return getSemResponse;
      if (u === '/presensi') return fsMock;
      return '{}';
    };
    return { status: 200, ok: true, redirected: false, url: u, text };
  };
  try {
    const api = new AmikomAPI();
    const ctx = await api.getAcademicContext();
    assert.strictEqual(ctx.semester, '2', `harus ambil opsi pertama, dapat ${ctx.semester}`);
    assert.strictEqual(typeof ctx.semester, 'string');
  } finally {
    global.fetch = saved;
  }
});

await test('semester: getSem gagal jaringan -> jatuh ke currentSEMESTER, bukan mati', async () => {
  const saved = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url).replace('https://student.amikompurwokerto.ac.id', '');
    if (u.includes('/pembelajaran/getSem')) throw new TypeError('Failed to fetch');
    const text = async () => {
      if (u.includes('/pembelajaran/list_makul_belum_validasi')) return unvalidated;
      if (u === '/presensi') return F('presensi.html');
      return '{}';
    };
    return { status: 200, ok: true, redirected: false, url: u, text };
  };
  try {
    const api = new AmikomAPI();
    const ctx = await api.getAcademicContext();
    assert.strictEqual(ctx.semester, '7', `harus pakai currentSEMESTER, dapat ${ctx.semester}`);
  } finally {
    global.fetch = saved;
  }
});

await test('fallback id: panjang list != jumlah sesi -> tidak dipetakan, sesi dilewati', async () => {
  // 2 tombol di tabel, list hanya menyediakan 1 id -> pemetaan posisi harus ditolak
  unvalidated = JSON.stringify({
    PSSIW034: {
      makul: 'Arsitektur Enterprise',
      count: 2,
      id_presensi_mhs: ['5614795'],
      kelasgab: ['SI23A AE']
    }
  });
  const api = new AmikomAPI();
  const logs = [];
  const res = await api.autoValidateAll({ onLog: (t, m) => logs.push(`${t}:${m}`), delayMs: 0 });
  assert.strictEqual(posts().length, 0, 'tidak boleh ada POST saat pemetaan ragu');
  assert.strictEqual(res.count, 0);
  assert.strictEqual(res.failedCount, 2, `dua sesi harus dihitung gagal, dapat ${res.failedCount}`);
  assert.ok(
    logs.some((l) => /tidak sama dengan sesi ter-parse/.test(l)),
    `harus ada log mismatch, log: ${logs.join(' | ')}`
  );
});

await test('asdos tanpa kuesioner kriteria: sesi dilewati, bukan kirim setengah jadi', async () => {
  editPresensiDetail = JSON.stringify({
    asdoss: [{ npm: '22SA11A011', nama: 'Asdos A' }],
    kriterias: []
  });
  const api = new AmikomAPI();
  const logs = [];
  const res = await api.autoValidateAll({ onLog: (t, m) => logs.push(`${t}:${m}`), delayMs: 0 });
  assert.strictEqual(posts().length, 0, 'payload asdos setengah jadi tidak boleh dikirim');
  assert.strictEqual(res.failedCount, 2);
  assert.ok(
    logs.some((l) => /asdos terdaftar tetapi kuesioner kriteria asdos kosong/.test(l)),
    `harus ada log penyebab, log: ${logs.join(' | ')}`
  );
});

await test('id_presensi_dosen dari ajax_editpresensi diutamakan atas onclick', async () => {
  editPresensiDetail = JSON.stringify({
    id_presensi_mhs: '5614795',
    id_presensi_dosen: '777001',
    nama: 'Andi Dwi Riyanto',
    asdoss: [],
    kriterias: JSON.parse(F('ajax_editpresensi-tanpa-id.json')).kriterias
  });
  const api = new AmikomAPI();
  await api.autoValidateAll({ onLog: () => {}, delayMs: 0 });
  assert.strictEqual(paramsOf(posts()[0].body).get('idpresensidosen'), '777001');
});

await test('ringkasan akhir melaporkan diproses/gagal/dilewati', async () => {
  updateResponse = '{"status":false,"inputerror":["penilaianmhs"],"error_string":["wajib dipilih"]}';
  const api = new AmikomAPI();
  const logs = [];
  const res = await api.autoValidateAll({ onLog: (t, m) => logs.push(`${t}:${m}`), delayMs: 0 });
  assert.strictEqual(res.count, 0);
  assert.strictEqual(res.failedCount, 2, 'sesi ditolak server harus dihitung gagal');
  // log harus memuat alasan mentah dari server, bukan JSON mentah
  assert.ok(
    logs.some((l) => /penilaianmhs/.test(l) && /wajib dipilih/.test(l)),
    `log harus memuat inputerror + error_string, log: ${logs.join(' | ')}`
  );
});

await test('matkul tanpa opsi dropdown dihitung sebagai dilewati', async () => {
  const api = new AmikomAPI();
  // paksa getmakul kosong supaya tidak ada opsi yang cocok
  const saved = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url).replace('https://student.amikompurwokerto.ac.id', '');
    const body = opts.body || null;
    calls.push({ url: u, method: (opts.method || 'GET').toUpperCase(), body });
    const text = async () => {
      if (u.includes('/pembelajaran/getmakul')) return '';
      if (u.includes('/pembelajaran/getSem')) return F('getsem.html');
      if (u.includes('/pembelajaran/list_makul_belum_validasi')) return unvalidated;
      if (u === '/presensi') return F('presensi.html');
      return '{}';
    };
    return { status: 200, ok: true, redirected: false, url: u, text };
  };
  try {
    const res = await api.autoValidateAll({ onLog: () => {}, delayMs: 0 });
    assert.strictEqual(res.count, 0);
    assert.strictEqual(res.skippedMatkul, 1, `matkul tanpa opsi harus dihitung dilewati, dapat ${res.skippedMatkul}`);
  } finally {
    global.fetch = saved;
  }
});

await test('progres multi-matkul: persen tidak pernah mundur walau denominator bertambah', async () => {
  unvalidated = JSON.stringify({
    PSSIW034: {
      makul: 'Arsitektur Enterprise',
      count: 2,
      id_presensi_mhs: ['5614795', '5614829'],
      kelasgab: ['SI23A AE', 'SI23A AE']
    },
    PSSIW047: {
      makul: 'Implementasi dan Pengujian Perangkat Lunak',
      count: 2,
      id_presensi_mhs: ['5614901', '5614902'],
      kelasgab: ['SI23A IPPL', 'SI23A IPPL']
    }
  });
  const api = new AmikomAPI();
  const seen = [];
  await api.autoValidateAll({ onLog: () => {}, delayMs: 0, onProgress: (p) => seen.push(p) });
  assert.strictEqual(seen.length, 4, `harus 4 laporan progres, dapat ${seen.length}`);
  const percents = seen.map((p) => p.percent);
  assert.ok(
    percents.every((v, i) => i === 0 || v >= percents[i - 1]),
    `persen tidak boleh mundur: ${percents.join(' -> ')}`
  );
  assert.strictEqual(percents[percents.length - 1], 100);
  assert.strictEqual(seen[seen.length - 1].total, 4);
});

await test('kontrak terkonfirmasi: respons lengkap jadi sumber utama, fallback tak dipakai', async () => {
  // ajax_editpresensi mengembalikan id_presensi_mhs/id_presensi_dosen/kuliah_tp_id;
  // pastikan itu yang dipakai, bukan fallback dari list_makul_belum_validasi.
  editPresensiDetail = F('ajax_editpresensi-lengkap.json');
  const api = new AmikomAPI();
  const logs = [];
  await api.autoValidateAll({ onLog: (t, m) => logs.push(`${t}:${m}`), delayMs: 0 });
  const p = paramsOf(posts()[0].body);
  assert.strictEqual(p.get('idpresensimhstexs'), '5524413', 'id harus dari ajax_editpresensi');
  assert.strictEqual(p.get('idpresensidosen'), '210685');
  assert.strictEqual(p.get('kuliahteori'), '19630', 'kuliahteori dari tombol tabel');
  assert.strictEqual(p.get('kuliahpraktek'), '', 'kuliahpraktek teori dikirim kosong seperti form asli');
  assert.deepStrictEqual(p.all('asdos_npms[]'), ['22SA11A011']);
  assert.ok(
    logs.some((l) => /Sesi #213719 <- id_presensi_mhs 5524413$/.test(l)),
    `log audit tidak boleh menandai fallback: ${logs.join(' | ')}`
  );
});

await test('semester tak terdeteksi dari sumber mana pun: tetap ada error tegas', async () => {
  getSemResponse = '';
  const html = fs
    .readFileSync(path.join(__dirname, 'test', 'fixtures', 'presensi.html'), 'utf8')
    .replace(/var\s+currentSEMESTER[^;]*;/, '');
  const savedFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url).replace('https://student.amikompurwokerto.ac.id', '');
    const text = async () => {
      if (u.includes('/pembelajaran/list_makul_belum_validasi')) return unvalidated;
      if (u === '/presensi') return html;
      return '';
    };
    return { status: 200, ok: true, redirected: false, url: u, text };
  };
  try {
    const api = new AmikomAPI();
    await assert.rejects(
      () => api.autoValidateAll({ onLog: () => {}, delayMs: 0 }),
      /tahun akademik|semester/i,
      'tanpa getSem maupun currentSEMESTER harus tetap melempar error'
    );
  } finally {
    global.fetch = savedFetch;
  }
});

console.log('\n====================================================');
console.log(
  `HASIL: ${passed} lulus, ${failed} gagal` + (failed === 0 ? ' \u{1F389}' : '')
);
console.log('====================================================');

})();
