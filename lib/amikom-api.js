/**
 * AmikomAPI Client
 * Modul terpadu untuk komunikasi langsung dengan endpoint Student AMIKOM Purwokerto
 * Bekerja baik di context Popup, Content Script, maupun Background Worker.
 */
(function (global) {
  'use strict';

  // =========================================================================
  // Regex bersama untuk parsing markup penawaran & jadwal portal.
  // Dikompilasi sekali; semua NON-global agar aman dipakai ulang lintas pemanggilan.
  // =========================================================================

  const pad2 = (value) => String(value).padStart(2, '0');

  /** Nama hari Indonesia beserta variasi penulisan portal. */
  const HARI_RE = /\b(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|ahad)\b/i;
  const HARI_CANON = {
    senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
    jumat: 'Jumat', "jum'at": 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu', ahad: 'Minggu'
  };

  /** Rentang jam: "07:30 - 09:10", "07.00-08.40", "07:30 s/d 09:10". */
  const JAM_RANGE_RE = /(\d{1,2})\s*[.:]\s*(\d{2})\s*(?:-|–|—|s\s*\/\s*d\.?|s\.d\.|sampai|hingga|to)\s*(\d{1,2})\s*[.:]\s*(\d{2})/i;
  /** Penanda satu jam tunggal "07:30" / "07.30". */
  const JAM_TOKEN_RE = /\d{1,2}\s*[.:]\s*\d{2}/;

  /** Ruang ber-kata kunci: "Ruang 2.1", "Lab. SI", "Gedung A", "GD. B". */
  const RUANG_KATA_RE = /(\bruang\b|\blab(?:oratorium)?\b|\bgedung\b|\bgd\b)\s*[.:]?\s*([A-Za-z0-9][A-Za-z0-9.\-/]{0,19})/i;
  /** Ruang ber-kata kunci yang diawali angka (dipakai saat membersihkan nama matkul). */
  const RUANG_KATA_ANGKA_RE = /(\bruang\b|\blab(?:oratorium)?\b|\bgedung\b|\bgd\b)\s*[.:]?\s*([0-9][A-Za-z0-9.\-/]{0,19})/gi;
  /** Ruang singkat "R.3.1" / "R 3.1" (wajib diawali angka agar tidak menangkap kata lain). */
  const RUANG_SINGKAT_RE = /\br\b\s*[.:]?\s*([0-9][A-Za-z0-9.\-/]{0,19})/i;

  /** Kode mata kuliah: "PSSIP055", "SI234101". */
  const KODE_MK_RE = /\b([A-Z]{2,}[A-Z0-9]{3,})\b/;
  /** Kode mata kuliah longgar (boleh diawali angka): "21IF01", "PSSIP055". */
  const KODE_MK_LOOSE_RE = /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{4,}$/;

  /** Penanda sisa kuota kelas. */
  const SISA_KUOTA_RE = /(?:sisa\s*kuota|kuota|tersedia|kapasitas)\s*[:\-=]?\s*(\d{1,3})/i;
  /** Teks yang tidak memuat nilai jam. */
  const TANPA_NILAI_RE = /^[-–—.\s]*$/;
  /** Sel tabel tanpa informasi. */
  const SEL_KOSONG_RE = /^(?:|-|–|—|n\/a|tba|belum ada)$/i;
  /** Label/header umum yang bukan nama matkul maupun huruf kelas. */
  const KATA_UMUM_RE = /^(sks|mk|no|nomor|nama|hari|jam|kelas|ruang|kode|mata|kuliah|teori|praktik|praktek|matakuliah|dosen|wali|status|kuota|sisa|waktu|pukul|pilih|aksi|semester)$/i;

  class AmikomAPI {
    constructor(baseURL = 'https://student.amikompurwokerto.ac.id') {
      this.baseURL = baseURL;
      this.timeoutMs = 20000;
    }

    /**
     * Engine fetch terpusat dengan penanganan timeout, kredensial cookie, dan session expired
     */
    async _request(endpoint, options = {}) {
      const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);

      const defaultHeaders = {
        'X-Requested-With': 'XMLHttpRequest'
      };

      if (options.body && typeof options.body === 'string') {
        defaultHeaders['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }

      try {
        const response = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
          ...options,
          headers: {
            ...defaultHeaders,
            ...(options.headers || {})
          }
        });

        clearTimeout(timer);

        // Deteksi Redirect ke Login
        if (response.redirected && response.url.includes('/auth')) {
          const err = new Error('SESSION_EXPIRED');
          err.code = 'SESSION_EXPIRED';
          throw err;
        }

        const rawText = await response.text();

        // Deteksi jika respon berupa halaman Login HTML
        if (rawText.includes('name="pengguna"') && rawText.includes('name="passw"')) {
          const err = new Error('SESSION_EXPIRED');
          err.code = 'SESSION_EXPIRED';
          throw err;
        }

        return {
          status: response.status,
          ok: response.ok,
          raw: rawText,
          json: () => {
            try {
              return JSON.parse(rawText);
            } catch (e) {
              throw new Error(`Gagal parse JSON dari respon: ${rawText.slice(0, 100)}...`);
            }
          }
        };
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          const timeoutErr = new Error(`Request timeout (${this.timeoutMs}ms) pada ${endpoint}`);
          timeoutErr.code = 'TIMEOUT';
          throw timeoutErr;
        }
        throw err;
      }
    }

    _toUrlEncoded(obj) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(obj || {})) {
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(`${key}[]`, v));
        } else if (value != null) {
          params.append(key, value);
        }
      }
      return params.toString();
    }

    // =========================================================================
    // 0b. UTILITAS PARSING HTML (dipakai parser penawaran & jadwal)
    // =========================================================================

    /** Merapikan teks HTML: buang tag, decode entitas dasar, normalisasi spasi. */
    _normalizeText(text) {
      return String(text == null ? '' : text)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /** Mengambil angka pertama dari teks ("3 SKS" -> 3). */
    _toInt(text, fallback = 0) {
      const match = String(text == null ? '' : text).match(/\d{1,3}/);
      return match ? parseInt(match[0], 10) : fallback;
    }

    /** Mengambil nilai atribut dari string tag HTML (toleran gaya tanda kutip). */
    _attrOf(tagHtml, attrName) {
      const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
      const match = String(tagHtml == null ? '' : tagHtml).match(re);
      if (!match) return '';
      if (match[1] != null) return match[1].trim();
      if (match[2] != null) return match[2].trim();
      return (match[3] || '').trim();
    }

    /** Teks sel pertama yang cocok dengan pola berpagar (^...$). */
    _firstCellMatching(cells, regex) {
      for (const cell of cells || []) {
        const text = this._normalizeText(cell);
        if (text && regex.test(text)) return text;
      }
      return '';
    }

    /** Kode mata kuliah dari sekumpulan sel tabel (sel kode khusus lebih diutamakan). */
    _extractKodeFromCells(cells) {
      const daftar = cells || [];
      for (const cell of daftar) {
        const text = this._normalizeText(cell);
        if (text && KODE_MK_LOOSE_RE.test(text)) return text;
      }
      for (const cell of daftar) {
        const match = this._normalizeText(cell).match(KODE_MK_RE);
        if (match) return match[1];
      }
      return '';
    }

    /** Huruf kelas dari teks ("Kelas : B", "Kelas 21IF-A"). */
    _extractKelasFromText(text) {
      const match = this._normalizeText(text).match(/\bkelas\s*[:\-]?\s*([A-Za-z0-9]{1,3})\b/i);
      return match ? match[1].toUpperCase() : '';
    }

    /** Normalisasi jam: rentang lebih diutamakan, lalu jam tunggal, selain itu kosong. */
    _normalizeJam(text) {
      const clean = this._normalizeText(text);
      if (!clean || TANPA_NILAI_RE.test(clean)) return '';
      const range = clean.match(JAM_RANGE_RE);
      if (range) return `${pad2(range[1])}:${range[2]} - ${pad2(range[3])}:${range[4]}`;
      const single = clean.match(JAM_TOKEN_RE);
      return single ? single[0].replace(/\s*[.:]\s*/, ':') : '';
    }

    /** Ekstraksi hari/jam/ruang dari teks bebas (label kelas maupun sel tabel). */
    _extractScheduleBits(text) {
      const clean = this._normalizeText(text);
      const bits = { hari: '', jam: '', ruang: '' };
      if (!clean) return bits;

      const hariMatch = clean.match(HARI_RE);
      if (hariMatch) bits.hari = HARI_CANON[hariMatch[1].toLowerCase()] || '';

      bits.jam = this._normalizeJam(clean);

      const ruangKata = clean.match(RUANG_KATA_RE);
      if (ruangKata) {
        const kandidat = ruangKata[2].replace(/[.,;:]+$/, '').trim();
        if (kandidat && !KATA_UMUM_RE.test(kandidat) && !HARI_RE.test(kandidat)) {
          bits.ruang = `${ruangKata[1]} ${kandidat}`.trim();
        }
      } else {
        const ruangSingkat = clean.match(RUANG_SINGKAT_RE);
        if (ruangSingkat) bits.ruang = `R.${ruangSingkat[1].replace(/[.,;:]+$/, '')}`;
      }
      return bits;
    }

    /** Membersihkan nama matkul dari kode, penanda kelas, jadwal, dan status. */
    _cleanCourseName(text, kode) {
      let out = this._normalizeText(text);
      if (!out) return '';
      if (kode) {
        out = out.replace(new RegExp(kode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
      }
      return out
        .replace(/\bkelas\s*[:\-]?\s*[A-Za-z0-9]{1,3}\b/gi, ' ')
        .replace(/\b\d{1,2}\s*sks\b/gi, ' ')
        .replace(/\bsks\b/gi, ' ')
        .replace(/(?:sisa\s*kuota|kuota|tersedia|kapasitas)\s*[:\-=]?\s*\d{1,3}/gi, ' ')
        .replace(/\b(Baru|Ulang)\b/gi, ' ')
        .replace(new RegExp(JAM_RANGE_RE.source, 'gi'), ' ')
        .replace(new RegExp(HARI_RE.source, 'gi'), ' ')
        .replace(RUANG_KATA_ANGKA_RE, ' ')
        .replace(new RegExp(RUANG_SINGKAT_RE.source, 'gi'), ' ')
        // Sisa tanda kurung kosong / pemisah ganda akibat penghapusan di atas.
        .replace(/\(\s*\)/g, ' ')
        .replace(/(?:\s*[-–—]\s*){2,}/g, ' - ')
        .replace(/^[\s|/\-–—:]+/, '')
        .replace(/[\s|/\-–—:]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // =========================================================================
    // 0. AUTHENTICATION & STATUS CEK
    // =========================================================================

    /**
     * Memeriksa apakah session student amikom saat ini aktif
     * @returns {Promise<{isLoggedIn: boolean, user?: string}>}
     */
    async checkSession() {
      try {
        const res = await this._request('/main/get_pengumuman', { method: 'GET' });
        if (res.ok) {
          const data = res.json();
          if (Array.isArray(data)) {
            return { isLoggedIn: true };
          }
        }
        return { isLoggedIn: false };
      } catch (err) {
        if (err.code === 'SESSION_EXPIRED' || err.message === 'SESSION_EXPIRED') {
          return { isLoggedIn: false };
        }
        // Jaringan atau error lain
        throw err;
      }
    }

    // =========================================================================
    // 1. PRESENSI & VALIDASI OTOMATIS
    // =========================================================================

    /**
     * Mengambil daftar matkul yang belum divalidasi
     * Format: { [kodeMakul]: { makul: string, count: number, id_presensi_mhs: string[], kelasgab: string[] } }
     */
    async listMakulBelumValidasi() {
      const res = await this._request('/pembelajaran/list_makul_belum_validasi', {
        method: 'POST'
      });
      return res.json();
    }

    /**
     * Mengambil tahun akademik & semester aktif dari halaman presensi
     */
    async getAcademicContext() {
      const res = await this._request('/presensi', { method: 'GET' });
      const html = res.raw;

      let thnAkademik = '';
      let semester = '';

      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const thnOpt = doc.querySelector('#thn_akademik option[selected]') || doc.querySelector('#thn_akademik option');
        if (thnOpt) thnAkademik = thnOpt.value;
        const semOpt = doc.querySelector('#semester option[selected]') || doc.querySelector('#semester option');
        if (semOpt) semester = semOpt.value;
      }

      if (!thnAkademik || !semester) {
        const thnMatch = html.match(/id="thn_akademik"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"[^>]*selected/i) ||
                         html.match(/id="thn_akademik"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"/i);
        if (thnMatch) thnAkademik = thnMatch[1];

        const semMatch = html.match(/id="semester"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"[^>]*selected/i) ||
                         html.match(/id="semester"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"/i);
        if (semMatch) semester = semMatch[1];
      }

      return { thnAkademik, semester };
    }

    /**
     * Mengambil daftar pilihan mata kuliah untuk thn_akademik & semester
     */
    async getMakulOptions(thnAkademik, semester) {
      const res = await this._request('/pembelajaran/getmakul', {
        method: 'POST',
        body: this._toUrlEncoded({ thn_akademik: thnAkademik, semester })
      });
      const html = res.raw;
      const options = [];

      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('option').forEach((opt) => {
          if (opt.value) {
            options.push({
              value: opt.value.trim(),
              text: (opt.textContent || '').trim()
            });
          }
        });
      }

      if (options.length === 0) {
        const regex = /<option\s+value=["']?([^"'>]+)["']?[^>]*>(.*?)<\/option>/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
          options.push({
            value: match[1].trim(),
            text: match[2].trim().replace(/&amp;/g, '&')
          });
        }
      }
      return options;
    }

    /**
     * Mengambil HTML tabel presensi mahasiswa untuk matkul tertentu
     */
    async getAbsenMhs(thnAkademik, semester, makulValue) {
      const res = await this._request('/pembelajaran/getabsenmhs', {
        method: 'POST',
        body: this._toUrlEncoded({
          thn_akademik: thnAkademik,
          semester,
          makul: makulValue
        })
      });
      return res.raw;
    }

    /**
     * Parse sesi yang belum divalidasi (tombol "B") dari tabel HTML getabsenmhs
     * Contoh tombol: onclick="edit_presensikehadiran(210685,'Bahasa Indonesia','18651','','teori')"
     */
    parseUnvalidatedSessions(htmlTable) {
      const sessions = [];
      // Regex mencocokkan fungsi edit_presensikehadiran dengan berbagai format argumen
      const regex = /onclick=["']edit_presensikehadiran\s*\(\s*(\d+)\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/gi;
      let match;
      while ((match = regex.exec(htmlTable)) !== null) {
        sessions.push({
          idPresensiDosen: match[1],
          matkulNama: match[2],
          kuliahTeori: match[3],
          kuliahPraktek: match[4] || '0',
          jenisPilih: match[5] || 'teori'
        });
      }
      return sessions;
    }

    /**
     * Mengambil detail kuesioner presensi untuk dosen dan asdos
     */
    async getDetailPresensi(idPresensiDosen) {
      const res = await this._request(`/pembelajaran/ajax_editpresensi/${idPresensiDosen}`, {
        method: 'GET'
      });
      return res.json();
    }

    /**
     * Submit validasi kehadiran dosen & asdos
     */
    async submitPresensiValidasi({
      jenisPilih = 'teori',
      idPresensiMhs,
      idPresensiDosen,
      kuliahTeori = '0',
      kuliahPraktek = '0',
      kesesuaianPerkuliahan = '1', // 1: Benar, 2: Tidak
      kesesuaianMateri = '1',       // 1: Ya sesuai, 2: Tidak
      penilaianMhs = '3',           // 3: Baik, 4: Sangat Baik
      kritikSaran = '-',
      asdoss = [],
      kriterias = [],
      asdosPreset = 'default'       // 'default' (Baik/Wajar) atau 'maksimal' (Sangat Baik)
    }) {
      const payload = {
        jenispilih: jenisPilih,
        idpresensimhstexs: idPresensiMhs,
        idpresensidosen: idPresensiDosen,
        kuliahteori: kuliahTeori,
        kuliahpraktek: kuliahPraktek,
        kesesuaian_perkuliahan: kesesuaianPerkuliahan,
        kesesuaian_materi: kesesuaianMateri,
        penilaianmhs: penilaianMhs,
        kritiksaran: kritikSaran
      };

      // Jika ada Asisten Dosen
      if (Array.isArray(asdoss) && asdoss.length > 0) {
        payload['asdos_npms'] = asdoss.map((a) => a.npm || a.nik || a.id || '');

        asdoss.forEach((asdos, idx) => {
          if (Array.isArray(kriterias) && kriterias.length > 0) {
            kriterias.forEach((krit) => {
              const kritId = krit.asdos_krit_id;
              let selectedNilaiId = '1';

              if (asdosPreset === 'maksimal') {
                // Ambil nilai tertinggi dari kriteria
                if (kritId === '1') selectedNilaiId = '1';  // Selalu Tepat Waktu
                else if (kritId === '2') selectedNilaiId = '5'; // Selalu sesuai
                else if (kritId === '3') selectedNilaiId = '9'; // Sangat Baik
                else if (kritId === '4') selectedNilaiId = '13'; // Sangat Baik
                else {
                  // Fallback ke nilai pertama
                  selectedNilaiId = (krit.nilai && krit.nilai[0]) ? krit.nilai[0].asdos_krit_nilai_id : '1';
                }
              } else {
                // Preset Default / Wajar (sesuai script v1.0 yang terbukti)
                if (kritId === '1') selectedNilaiId = '1';  // Selalu Tepat Waktu
                else if (kritId === '2') selectedNilaiId = '5'; // Selalu sesuai
                else if (kritId === '3') selectedNilaiId = '10'; // Baik
                else if (kritId === '4') selectedNilaiId = '14'; // Baik
                else {
                  selectedNilaiId = (krit.nilai && krit.nilai[1]) ? krit.nilai[1].asdos_krit_nilai_id : '1';
                }
              }

              payload[`asdospenilaian_${idx}_${kritId}`] = selectedNilaiId;
            });
          }
        });
      }

      const res = await this._request('/pembelajaran/update_presensimhs', {
        method: 'POST',
        body: this._toUrlEncoded(payload)
      });
      return res.json();
    }

    /**
     * Pipeline Otomasi Validasi Presensi Penuh (Direct API Runner)
     * Menjalankan seluruh proses secara cepat tanpa perlu reload halaman!
     */
    async autoValidateAll({
      onProgress = () => {},
      onLog = () => {},
      dosenRating = '3',
      asdosPreset = 'default',
      delayMs = 600,
      shouldStop = () => false
    } = {}) {
      onLog('info', 'Memulai pengecekan mata kuliah yang belum divalidasi...');

      const unvalidatedMap = await this.listMakulBelumValidasi();
      const kodeList = Object.keys(unvalidatedMap);

      if (kodeList.length === 0) {
        onLog('success', 'Semua kehadiran telah divalidasi! Tidak ada mata kuliah tertunda.');
        return { success: true, count: 0, message: 'Semua sudah tervalidasi' };
      }

      let totalSessions = 0;
      kodeList.forEach((k) => (totalSessions += unvalidatedMap[k].count || 0));
      onLog('info', `Ditemukan ${kodeList.length} mata kuliah (${totalSessions} sesi) belum divalidasi.`);

      // Ambil context thn_akademik & semester
      const context = await this.getAcademicContext();
      if (!context.thnAkademik || !context.semester) {
        throw new Error('Gagal mendeteksi tahun akademik atau semester aktif.');
      }
      onLog('info', `Tahun Akademik: ${context.thnAkademik}, Semester: ${context.semester}`);

      // Ambil opsi makul dropdown untuk mencocokkan kode/nama dengan value backend (e.g. 18651__NSSIW038)
      const makulOptions = await this.getMakulOptions(context.thnAkademik, context.semester);

      let processedCount = 0;

      for (let i = 0; i < kodeList.length; i++) {
        if (shouldStop()) {
          onLog('warn', 'Otomasi dihentikan oleh pengguna.');
          break;
        }

        const kode = kodeList[i];
        const info = unvalidatedMap[kode];
        onLog('info', `[${i + 1}/${kodeList.length}] Memproses Mata Kuliah: ${info.makul} (${kode})...`);

        // Cari opsi dropdown yang cocok
        const targetOption = makulOptions.find(
          (opt) => opt.value.includes(kode) || opt.text.toLowerCase().includes(info.makul.toLowerCase())
        );

        if (!targetOption) {
          onLog('warn', `Opsi dropdown untuk ${info.makul} tidak ditemukan. Melewati...`);
          continue;
        }

        // Ambil tabel absensi untuk mata kuliah ini
        const tableHtml = await this.getAbsenMhs(context.thnAkademik, context.semester, targetOption.value);
        const sessions = this.parseUnvalidatedSessions(tableHtml);

        if (sessions.length === 0) {
          onLog('info', `Tidak ditemukan tombol validasi aktif pada ${info.makul}.`);
          continue;
        }

        onLog('info', `Ditemukan ${sessions.length} sesi yang perlu validasi.`);

        for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
          if (shouldStop()) break;

          const sess = sessions[sIdx];
          onLog('info', `-> Mengambil data sesi #${sess.idPresensiDosen}...`);

          try {
            const detail = await this.getDetailPresensi(sess.idPresensiDosen);

            onLog(
              'info',
              `-> Memvalidasi ${detail.nama || 'Dosen'} | Materi: ${detail.judul_materi || '-'}...`
            );

            // Submit data validasi
            const submitResult = await this.submitPresensiValidasi({
              jenisPilih: sess.jenisPilih || 'teori',
              idPresensiMhs: detail.id_presensi_mhs,
              idPresensiDosen: sess.idPresensiDosen,
              kuliahTeori: sess.kuliahTeori || detail.kuliah_tp_id || '0',
              kuliahPraktek: sess.kuliahPraktek || '0',
              kesesuaianPerkuliahan: '1',
              kesesuaianMateri: '1',
              penilaianMhs: dosenRating,
              kritikSaran: '-',
              asdoss: detail.asdoss || [],
              kriterias: detail.kriterias || [],
              asdosPreset: asdosPreset
            });

            if (submitResult.status) {
              processedCount++;
              onLog('success', `✓ Sesi #${sess.idPresensiDosen} berhasil divalidasi!`);
            } else {
              onLog('error', `✗ Gagal validasi sesi #${sess.idPresensiDosen}: ${JSON.stringify(submitResult)}`);
            }
          } catch (err) {
            if (err.code === 'SESSION_EXPIRED') {
              throw err;
            }
            onLog('error', `Sesi #${sess.idPresensiDosen} gagal: ${err.message}`);
            continue;
          }

          onProgress({
            current: processedCount,
            total: totalSessions,
            percent: Math.min(100, Math.round((processedCount / totalSessions) * 100))
          });

          // Jeda antar-sesi
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }

      onLog('success', `Selesai! Total ${processedCount} sesi presensi berhasil divalidasi.`);
      return { success: true, count: processedCount };
    }

    // =========================================================================
    // 2. WAR KRS & RENCANA STUDI
    // =========================================================================

    /**
     * Mengambil ringkasan KRS mahasiswa (SKS diambil, SKS diisi, dan daftar matkul diajukan)
     */
    async getKrsOverview() {
      const [diambilRes, diisiRes, makulListRes] = await Promise.all([
        this._request('/akademik/hitung_pengajuan_diambil', { method: 'GET' }),
        this._request('/akademik/hitung_pengajuan_diisi', { method: 'GET' }),
        this._request('/akademik/makul_pengajuan_diambil', { method: 'GET' })
      ]);

      const diambil = diambilRes.json();
      const diisi = diisiRes.json();
      const makulList = makulListRes.json();

      return {
        sksDiajukan: diambil.total || 0,
        sksDiisi: diisi.total || 0,
        makulDiajukan: Array.isArray(makulList) ? makulList : []
      };
    }

    /**
     * Mengambil daftar seluruh mata kuliah yang ditawarkan untuk KRS
     */
    async getMakulDitawarkan() {
      const res = await this._request('/akademik/get_mkl_ditawarkan', { method: 'GET' });
      return this.parseMakulDitawarkan(res.raw);
    }

    /**
     * HTML mentah halaman "belum diisi MBKM" / pemilihan kelas (Tab 3).
     *
     * Fallback diam-diam ke /akademik/get_mkl_ditawarkan SUDAH DIHAPUS: markup Tab 1
     * memuat `value` paket pengajuan yang hanya valid untuk act=rencana_pengajuan_maba,
     * sehingga mengembalikannya dari sini membuat pemanggil mengira form pemilihan kelas
     * (act=rencana_studi) sedang terbuka. Bila permintaan gagal, error diteruskan agar
     * pemanggil tidak memakai sumber data yang salah. Untuk data terstruktur
     * (value asli + hari/jam/ruang), gunakan getKelasForm().
     */
    async getMakulBelumDiisiMbkm() {
      const res = await this._request('/akademik/makul_belum_diisi_mbkm', { method: 'GET' });
      return res.raw;
    }

    /**
     * Mengambil form "Isi KRS / Pilih Kelas Perkuliahan" (Tab 3) beserta opsi kelasnya.
     * Tanpa fallback ke endpoint lain (lihat catatan pada getMakulBelumDiisiMbkm).
     * @returns {Promise<{ok: boolean, raw: string, hasForm: boolean, options: Array<Object>}>}
     *          ok=false hanya bila portal merespons non-2xx; sesi kedaluwarsa tetap throw.
     */
    async getKelasForm() {
      const res = await this._request('/akademik/makul_belum_diisi_mbkm', { method: 'GET' });
      const raw = res.raw || '';
      const options = this.parseKelasForm(raw);
      // hasForm menandai halaman benar-benar memuat form pemilihan kelas — walau barisnya
      // belum tentu terparse (mis. markup berubah) — agar bisa dibedakan dari "tidak ada form".
      const hasForm = options.length > 0 ||
        /name=["']?makul/i.test(raw) ||
        /makul_belum_diisi/i.test(raw) ||
        /rencana_studi/i.test(raw);
      return { ok: !!res.ok, raw, hasForm, options };
    }

    /**
     * Parse HTML penawaran matkul menjadi list data terstruktur
     * Format checkbox: value="3_2036311_PSSIP055 _C " data-is_ulang="false"
     */
    parseMakulDitawarkan(html) {
      const courses = [];

      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const inputs = doc.querySelectorAll('input[name="makul[]"]');
        inputs.forEach((input) => {
          const val = (input.value || '').trim();
          if (!val) return;
          const parts = val.split('_');
          const sks = parts[0] ? parseInt(parts[0], 10) : 0;
          const id = parts[1] || '';
          const kode = parts[2] ? parts[2].trim() : '';
          const kelas = parts[3] ? parts[3].trim() : '';

          const isDisabled = input.disabled;
          const isUlang = input.getAttribute('data-is_ulang') === 'true';

          const parent = input.closest('label') || input.parentElement;
          const rawText = parent ? (parent.textContent || '') : '';
          const cleanText = rawText.replace(/\s+/g, ' ').trim();
          const nama = cleanText.replace(kode, '').replace(/\b(Baru|Ulang)\b/g, '').trim();

          // Aditif: Tab 1 umumnya tidak memuat jadwal, field tetap ada agar konsumen seragam.
          const jadwal = this._extractScheduleBits(cleanText);

          courses.push({
            value: val,
            id,
            kode,
            nama: nama || kode,
            sks,
            kelas,
            isUlang,
            disabled: isDisabled,
            hari: jadwal.hari,
            jam: jadwal.jam,
            ruang: jadwal.ruang
          });
        });
        if (courses.length > 0) return courses;
      }

      const regex = /<input[^>]*name=["']makul\[\]["'][^>]*value=["']([^"']+)["'][^>]*>(.*?)(?=<input|<div class="panel-heading"|$)/gis;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const fullTag = match[0];
        const val = match[1].trim();
        const rawContent = match[2] || '';

        const isDisabled = fullTag.includes('disabled');
        const isUlang = fullTag.includes('data-is_ulang="true"');

        const parts = val.split('_');
        const sks = parts[0] ? parseInt(parts[0], 10) : 0;
        const id = parts[1] || '';
        const kode = parts[2] ? parts[2].trim() : '';
        const kelas = parts[3] ? parts[3].trim() : '';

        const cleanText = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const nama = cleanText.replace(kode, '').trim();

        // Aditif: Tab 1 umumnya tidak memuat jadwal, field tetap ada agar konsumen seragam.
        const jadwal = this._extractScheduleBits(cleanText);

        courses.push({
          value: val,
          id,
          kode,
          nama: nama || kode,
          sks,
          kelas,
          isUlang,
          disabled: isDisabled,
          hari: jadwal.hari,
          jam: jadwal.jam,
          ruang: jadwal.ruang
        });
      }
      return courses;
    }

    /**
     * Nilai `value` khas form pemilihan kelas Amikom, mis. "3_2036311_PSSIP055 _C ".
     */
    _looksLikeKelasValue(value) {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return false;
      return /^\d{1,2}_/.test(raw) || KODE_MK_RE.test(raw);
    }

    /**
     * Memecah `value` pemilihan kelas: `<sks>_<id>_<kode> _<kelas> `.
     * Bagian yang tidak ada dibiarkan kosong (tanpa nilai default karangan).
     */
    _parseKelasValueParts(value) {
      const raw = String(value == null ? '' : value).trim();
      const parts = raw.split('_');
      const info = { sks: 0, id: '', kode: '', kelas: '' };

      if (parts.length >= 3) {
        const sks = parseInt(parts[0], 10);
        if (!isNaN(sks)) info.sks = sks;
        info.id = (parts[1] || '').trim();
        info.kode = (parts[2] || '').trim();
        info.kelas = (parts[3] || '').trim();
      } else if (parts.length === 1 && /^[A-Za-z]{1,2}$/.test(raw)) {
        info.kelas = raw.toUpperCase();
      }

      if (!info.kode) {
        const match = raw.match(KODE_MK_RE);
        if (match) info.kode = match[1];
      }
      return info;
    }

    /**
     * Menyusun satu entri kelas dari `value` mentah + konteks barisnya.
     * @param {string} value Nilai asli atribut value (dipakai apa adanya saat submit)
     * @param {{text?: string, cells?: string[], disabled?: boolean}} ctx
     */
    _buildKelasOption(value, ctx) {
      const raw = String(value == null ? '' : value).trim();
      const parts = this._parseKelasValueParts(raw);
      const cells = (ctx && ctx.cells) || [];
      const text = this._normalizeText((ctx && ctx.text) || cells.join(' '));

      const kode = parts.kode || this._extractKodeFromCells(cells);

      let kelas = parts.kelas || this._extractKelasFromText(text);
      if (!kelas) {
        const huruf = this._firstCellMatching(cells, /^[A-Z]{1,2}$/);
        if (huruf && !KATA_UMUM_RE.test(huruf)) kelas = huruf;
      }
      if (!kelas && /^[A-Za-z]{1,2}$/.test(raw)) kelas = raw.toUpperCase();

      const jadwal = this._extractScheduleBits(text);

      let nama = '';
      for (const cell of cells) {
        const bersih = this._normalizeText(cell);
        if (bersih.length <= 2) continue;
        if (kode && bersih.toUpperCase() === kode.toUpperCase()) continue;
        if (/^\d+$/.test(bersih)) continue;
        if (KATA_UMUM_RE.test(bersih) || HARI_RE.test(bersih) || JAM_TOKEN_RE.test(bersih)) continue;
        if (SEL_KOSONG_RE.test(bersih)) continue;
        if (bersih.length > nama.length) nama = bersih;
      }
      if (!nama) nama = text;
      nama = this._cleanCourseName(nama, kode);

      const kuota = text.match(SISA_KUOTA_RE);

      return {
        value: raw,
        // Tidak ada sentinel karangan: kode kosong bila memang tak terdeteksi.
        kode,
        nama: nama || kode,
        sks: parts.sks || this._toInt(this._firstCellMatching(cells, /^\d{1,2}\s*(?:sks)?$/i), 0),
        kelas,
        hari: jadwal.hari,
        jam: jadwal.jam,
        ruang: jadwal.ruang,
        // Sentinel eksplisit: null = kuota tidak diketahui dari markup (bukan 0).
        sisaKuota: kuota ? parseInt(kuota[1], 10) : null,
        disabled: !!(ctx && ctx.disabled)
      };
    }

    /**
     * Parse form "Isi KRS / Pilih Kelas Perkuliahan" (Tab 3: /akademik/makul_belum_diisi_mbkm).
     *
     * Ini satu-satunya sumber yang memuat hari/jam/ruang kelas sekaligus `value` asli
     * untuk act=rencana_studi. Parser sengaja toleran: mengenali checkbox/radio maupun
     * <option>, lalu membaca baris tabel, label, atau teks di sekitar input.
     * Baris tanpa value, atau tanpa kode DAN tanpa kelas, dilewati — tidak ada
     * kode 'MK' / kelas 'A' yang dikarang secara senyap.
     *
     * @param {string} html HTML mentah halaman
     * @returns {Array<{value: string, kode: string, nama: string, sks: number, kelas: string,
     *   hari: string, jam: string, ruang: string, sisaKuota: number|null, disabled: boolean}>}
     *   Array kosong bila tidak ada yang bisa diparse.
     */
    parseKelasForm(html) {
      const source = html == null ? '' : String(html);
      const options = [];
      const seen = new Set();

      const pushOption = (candidate) => {
        if (!candidate || !candidate.value || seen.has(candidate.value)) return;
        if (!candidate.kode && !candidate.kelas) return;
        seen.add(candidate.value);
        options.push(candidate);
      };

      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const nodes = [];
        doc.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((node) => nodes.push(node));
        doc.querySelectorAll('select').forEach((select) => {
          const namaSelect = (select.getAttribute('name') || '').toString();
          if (!/makul|kelas|pilih|krs/i.test(namaSelect)) return;
          select.querySelectorAll('option').forEach((option) => nodes.push(option));
        });

        nodes.forEach((node) => {
          const isOption = node.tagName === 'OPTION';
          const host = isOption ? node.closest('select') : node;
          const name = ((host && host.getAttribute('name')) || node.getAttribute('name') || '').toString();
          const value = (node.getAttribute('value') || '').trim();
          if (!value) return;
          if (!/makul|kelas|pilih|krs/i.test(name) && !this._looksLikeKelasValue(value)) return;

          const container = node.closest('tr') || node.closest('label') || node.closest('li') || node.parentElement;
          const cells = [];
          if (container && container.tagName === 'TR') {
            container.querySelectorAll('th,td').forEach((cell) => cells.push(this._normalizeText(cell.textContent)));
          }
          // textContent antar-<td> menempel tanpa pemisah ("CSenin"), jadi sel digabung
          // dengan pemisah agar batas kata (hari/jam/ruang) tetap terdeteksi.
          // Untuk <option>, hanya teks option itu sendiri (bukan seluruh <select>).
          const text = cells.length
            ? cells.join(' | ')
            : (isOption ? (node.textContent || '') : (container ? container.textContent : ''));

          pushOption(this._buildKelasOption(value, {
            text,
            cells,
            disabled: !!node.disabled
          }));
        });

        if (options.length > 0) return options;
      }

      // Fallback tanpa DOMParser: pindai tag <input> dan teks blok di sekitarnya.
      const inputTagRe = /<input\b[^>]*>/gi;
      let tagMatch;
      while ((tagMatch = inputTagRe.exec(source)) !== null) {
        const tag = tagMatch[0];
        const value = this._attrOf(tag, 'value');
        if (!value) continue;
        const name = this._attrOf(tag, 'name');
        if (!/makul|kelas|pilih|krs/i.test(name) && !this._looksLikeKelasValue(value)) continue;

        // Utamakan lingkup <tr> milik input ini agar data baris berikutnya tidak mencemari.
        const nextIdx = source.indexOf('<input', inputTagRe.lastIndex);
        const trStart = source.lastIndexOf('<tr', tagMatch.index);
        const trEnd = source.indexOf('</tr>', inputTagRe.lastIndex);
        const trSebelumnya = source.lastIndexOf('</tr>', tagMatch.index);
        let block;
        if (trStart !== -1 && trEnd !== -1 && trStart > trSebelumnya) {
          block = source.slice(trStart, trEnd);
        } else {
          const batas = nextIdx === -1
            ? Math.min(source.length, inputTagRe.lastIndex + 600)
            : Math.min(nextIdx, inputTagRe.lastIndex + 600);
          block = source.slice(inputTagRe.lastIndex, batas);
        }

        const cells = [];
        const cellRe = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
        let cellMatch;
        while ((cellMatch = cellRe.exec(block)) !== null) cells.push(this._normalizeText(cellMatch[1]));

        pushOption(this._buildKelasOption(value, {
          text: block,
          cells,
          disabled: /disabled/i.test(tag)
        }));
      }
      return options;
    }

    /**
     * Mengajukan mata kuliah terpilih (Step 1 War KRS)
     * @param {string[]} selectedMakulValues Array nilai checkbox (contoh: ["3_2036311_PSSIP055 _C "])
     */
    async submitRencanaPengajuanMaba(selectedMakulValues) {
      const formData = new FormData();
      selectedMakulValues.forEach((val) => formData.append('makul[]', val));

      const res = await this._request('/akademik/tambah_pengajuan?act=rencana_pengajuan_maba', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        throw new Error(`Server error (${res.status}) saat pengajuan KRS`);
      }

      let data;
      try {
        data = res.json();
      } catch (_) {
        // Respons bukan format JSON (misal HTML response)
      }

      if (data && data.status === false) {
        throw new Error(data.message || 'Pengajuan KRS gagal diproses');
      }

      return res.raw;
    }

    /**
     * Mengajukan pemilihan kelas perkuliahan (Tahap 3 War KRS - Pilih Kelas)
     * @param {string[]} selectedClassValues Array nilai form/checkbox kelas terpilih
     */
    async submitPilihKelas(selectedClassValues) {
      const formData = new FormData();
      (selectedClassValues || []).forEach((val) => formData.append('makul[]', val));

      const res = await this._request('/akademik/tambah_pengajuan?act=rencana_studi', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        throw new Error(`Server error (${res.status}) saat simpan kelas KRS`);
      }

      let data;
      try {
        data = res.json();
      } catch (_) {
        // Respons berupa HTML response
      }

      if (data && data.status === false) {
        throw new Error(data.message || 'Penyimpanan kelas KRS gagal diproses');
      }

      return res.raw;
    }

    /**
     * Alias untuk submitPilihKelas (Tahap 3 War KRS)
     */
    async submitKrsKelas(selectedClassValues) {
      return this.submitPilihKelas(selectedClassValues);
    }

    /**
     * Sinkronisasi data KRS dengan database
     */
    async sinkronisasiMakul() {
      const res = await this._request('/akademik/sinkronisasi_makul', { method: 'POST' });
      return res.raw;
    }


    // =========================================================================
    // 3. JADWAL UJIAN, AGENDA, & PENGUMUMAN
    // =========================================================================

    /**
     * Mengambil jadwal perkuliahan atau modul akademik lain
     * @param {string} mod Contoh: 'kuliah_mbkm', 'uas', 'uts'
     */
    async getJadwal(mod = 'kuliah_mbkm') {
      const res = await this._request(`/akademik/get_jadwal?mod=${mod}`, { method: 'POST' });
      return res.raw;
    }

    /**
     * Mengambil tabel jadwal kuliah (Tab 4) beserta baris yang sudah dinormalisasi.
     * Endpoint dibuktikan bekerja dengan GET (request `mode_kuliah` pada koleksi Postman);
     * POST hanya dicoba ulang bila GET merespons non-2xx.
     * @returns {Promise<{ok: boolean, raw: string, rows: Array<Object>}>}
     */
    async getJadwalKuliah() {
      const endpoint = '/akademik/get_jadwal?mod=kuliah_mbkm';
      let res = await this._request(endpoint, { method: 'GET' });
      if (!res.ok) {
        res = await this._request(endpoint, { method: 'POST' });
      }
      const raw = res.raw || '';
      return { ok: !!res.ok, raw, rows: this.parseJadwalKuliah(raw) };
    }

    /**
     * Baris tabel jadwal dianggap header bila memuat beberapa label kolom
     * dan bukan baris data (tidak memuat rentang jam).
     */
    _looksLikeJadwalHeader(cells) {
      const joined = (cells || []).join(' ').toLowerCase();
      if (!joined || JAM_RANGE_RE.test(joined)) return false;
      let hits = 0;
      if (/kode/.test(joined)) hits++;
      if (/hari/.test(joined)) hits++;
      if (/jam|waktu|pukul/.test(joined)) hits++;
      if (/ruang|lab|tempat|gedung/.test(joined)) hits++;
      if (/sks/.test(joined)) hits++;
      if (/nama|mata kuliah|matakuliah/.test(joined)) hits++;
      return hits >= 2;
    }

    /** Memetakan indeks kolom tabel jadwal berdasarkan teks header. */
    _mapJadwalHeader(cells) {
      const map = { kode: -1, nama: -1, sks: -1, kelas: -1, hari: -1, jam: -1, ruang: -1 };
      (cells || []).forEach((raw, idx) => {
        const text = this._normalizeText(raw).toLowerCase();
        if (!text) return;
        if (map.kode < 0 && /kode/.test(text)) { map.kode = idx; return; }
        if (map.nama < 0 && /nama|mata kuliah|matakuliah|(^|\W)mk(\W|$)/.test(text)) { map.nama = idx; return; }
        if (map.sks < 0 && /sks/.test(text)) { map.sks = idx; return; }
        if (map.kelas < 0 && /kelas/.test(text)) { map.kelas = idx; return; }
        if (map.hari < 0 && /hari/.test(text)) { map.hari = idx; return; }
        if (map.jam < 0 && /jam|waktu|pukul/.test(text)) { map.jam = idx; return; }
        if (map.ruang < 0 && /ruang|lab|tempat|gedung/.test(text)) { map.ruang = idx; return; }
      });
      return map;
    }

    /**
     * Menyusun satu baris jadwal terstruktur dari sel-sel tabel.
     * Sel kosong / "-" / "TBA" diperlakukan sebagai tidak ada data.
     * @returns {Object|null} null bila baris tidak memuat informasi apa pun.
     */
    _buildJadwalRow(cells, headerMap) {
      const clean = (cells || []).map((cell) => {
        const text = this._normalizeText(cell);
        return SEL_KOSONG_RE.test(text) ? '' : text;
      });
      if (clean.length === 0 || clean.every((cell) => !cell)) return null;

      const kolom = (key) => {
        const idx = headerMap ? headerMap[key] : -1;
        return idx >= 0 ? (clean[idx] || '') : '';
      };

      let kode = kolom('kode');
      let nama = kolom('nama');
      let kelas = kolom('kelas');
      let hari = kolom('hari');
      let jam = this._normalizeJam(kolom('jam'));
      let ruang = kolom('ruang');
      let sks = this._toInt(kolom('sks'), 0);

      // Heuristik posisional bila header tidak dikenali (tabel tanpa <th>).
      if (!kode) kode = this._extractKodeFromCells(clean);
      if (!kelas) kelas = this._extractKelasFromText(clean.join(' '));
      if (!kelas) {
        const huruf = this._firstCellMatching(clean, /^[A-Z]{1,2}$/);
        if (huruf && !KATA_UMUM_RE.test(huruf)) kelas = huruf;
      }

      // Lengkapi hari/jam/ruang dari teks baris (kolom bisa berbeda urutan atau tergabung).
      if (!hari || !jam || !ruang) {
        const bits = this._extractScheduleBits(clean.join(' | '));
        if (!hari) hari = bits.hari;
        if (!jam) jam = bits.jam;
        if (!ruang) ruang = bits.ruang;
      }
      if (hari) {
        const hariMatch = hari.match(HARI_RE);
        hari = hariMatch ? (HARI_CANON[hariMatch[1].toLowerCase()] || '') : '';
      }
      if (!sks) sks = this._toInt(this._firstCellMatching(clean, /^\d{1,2}\s*(?:sks)?$/i), 0);

      if (!nama) {
        let terpanjang = '';
        for (const cell of clean) {
          if (cell.length <= 2 || /^\d+$/.test(cell)) continue;
          if (kode && cell.toUpperCase() === kode.toUpperCase()) continue;
          if (KATA_UMUM_RE.test(cell) || HARI_RE.test(cell) || JAM_TOKEN_RE.test(cell)) continue;
          if (cell.length > terpanjang.length) terpanjang = cell;
        }
        nama = terpanjang;
      }
      nama = this._cleanCourseName(nama, kode);

      if (!kode && !nama && !hari && !jam) return null;
      return { kode, nama: nama || kode, sks, kelas, hari, jam, ruang };
    }

    /**
     * Parse tabel jadwal kuliah (Tab 4: /akademik/get_jadwal?mod=kuliah_mbkm).
     * Kolom yang dikenali: Kode MK, Nama, SKS, Kelas, Hari, JAM, Ruang.
     * Toleran terhadap header tak dikenal (heuristik posisional) dan sel kosong/"-".
     * @param {string} html HTML mentah tabel jadwal
     * @returns {Array<{kode: string, nama: string, sks: number, kelas: string,
     *   hari: string, jam: string, ruang: string}>}
     */
    parseJadwalKuliah(html) {
      const source = html == null ? '' : String(html);
      const rows = [];

      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        let headerMap = null;
        doc.querySelectorAll('tr').forEach((tr) => {
          const cells = [];
          tr.querySelectorAll('th,td').forEach((cell) => cells.push(this._normalizeText(cell.textContent)));
          if (cells.length === 0) return;
          // Header dipetakan ulang setiap kali ditemui: dokumen bisa memuat beberapa
          // tabel jadwal dan kolomnya belum tentu sama.
          if (this._looksLikeJadwalHeader(cells)) {
            headerMap = this._mapJadwalHeader(cells);
            return;
          }
          const row = this._buildJadwalRow(cells, headerMap);
          if (row) rows.push(row);
        });
        if (rows.length > 0) return rows;
      }

      // Fallback tanpa DOMParser.
      const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      let headerMap = null;
      while ((trMatch = trRe.exec(source)) !== null) {
        const cells = [];
        const cellRe = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
        let cellMatch;
        while ((cellMatch = cellRe.exec(trMatch[1])) !== null) cells.push(this._normalizeText(cellMatch[1]));
        if (cells.length === 0) continue;
        if (this._looksLikeJadwalHeader(cells)) {
          headerMap = this._mapJadwalHeader(cells);
          continue;
        }
        const row = this._buildJadwalRow(cells, headerMap);
        if (row) rows.push(row);
      }
      return rows;
    }

    /**
     * Mengambil jadwal ujian (UAS / UTS)
     * @param {'uas'|'uts'} type
     */
    async getJadwalUjian(type = 'uas') {
      const res = await this._request(`/akademik/get_jadwal?mod=${type}`, { method: 'POST' });
      return res.json();
    }

    /**
     * Mengambil agenda kalender akademik resmi
     */
    async getAgendaAkademik() {
      const res = await this._request('/akademik/get_agenda', { method: 'GET' });
      return res.json();
    }

    /**
     * Mengambil daftar pengumuman terkini
     */
    async getPengumuman() {
      const res = await this._request('/main/get_pengumuman', { method: 'GET' });
      return res.json();
    }
  }

  // Export ke global context (window / self)
  // Export ke UMD / Node / Browser context
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AmikomAPI;
  }
  global.AmikomAPI = AmikomAPI;

})(typeof self !== 'undefined' ? self : this);
