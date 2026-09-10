/**
 * Amikom Student Assistant - Popup: Modul War KRS Eksekusi (App.krsWar)
 * Sinkronisasi data portal + web, deteksi form kelas terbuka, bot siaga
 * auto-snipe, dan eksekusi War KRS instan dengan auto-retry & klasifikasi
 * outcome respon server.
 * Dimuat setelah core.js, app-util.js, krs-plan.js, krs-controls.js, krs-data.js.
 */
(function () {
  'use strict';

  const App = window.AppKrs;
  const $ = App.core.$;
  const api = App.core.api;
  const warKrsState = App.core.warKrsState;

  // Segarkan Data Portal & Halaman Web secara Sinkron
  async function refreshPortalAndWeb() {
    const btn = $('btn-sync-all-web');
    const btnTop = $('btn-refresh-portal-data');
    if (btn) btn.innerHTML = '<span>⏳ Menyegarkan Data Portal...</span>';
    if (btnTop) btnTop.innerHTML = '<span>⏳ Refresh...</span>';

    try {
      // 1. Cek langsung form pemilihan kelas di portal kampus (Tab 3, act=rencana_studi).
      // Lewat isKrsFormOpen() agar status "terbuka" selalu berasal dari satu sumber yang sama.
      const hasForm = await isKrsFormOpen();

      const phaseBadge = $('krs-phase-badge');
      const noticeIcon = $('portal-status-icon');
      const noticeText = $('portal-status-text');
      const mainWarBtn = $('btn-war-main-label');
      const snipeBtn = $('btn-snipe-label');

      if (hasForm) {
        if (phaseBadge) {
          phaseBadge.className = 'badge badge-success';
          phaseBadge.textContent = '🟢 FORM KELAS TERBUKA!';
        }
        if (noticeIcon) noticeIcon.textContent = '🟢';
        if (noticeText) noticeText.innerHTML = '<strong>Status KRS:</strong> FORM PEMILIHAN KELAS TELAH DIBUKA! Klik tombol eksekusi untuk langsung mengirim paket jadwal pilihan Anda.';
        if (mainWarBtn) mainWarBtn.textContent = '🔥 EKSEKUSI WAR KRS SEKARANG!';
        if (snipeBtn) snipeBtn.textContent = '⚡ JALANKAN AUTO-SNIPER CEPAT';
        App.util.warLog('success', '✓ Form kelas aktif terdeteksi dari portal kampus! Siap eksekusi.');
      } else {
        if (phaseBadge) {
          phaseBadge.className = 'badge badge-danger';
          phaseBadge.textContent = '🔴 KRS Sedang Ditutup';
        }
        if (noticeIcon) noticeIcon.textContent = '🔴';
        if (noticeText) noticeText.innerHTML = '<strong>Status KRS:</strong> Saat ini portal kampus belum membuka pengisian kelas. Pilihan strategi Anda sudah tersimpan permanen dan bot siap menembak saat jam war dibuka.';
        if (mainWarBtn) mainWarBtn.textContent = '🔥 EKSEKUSI WAR KRS SEKARANG';
        if (snipeBtn) snipeBtn.textContent = '🔒 KUNCI STRATEGI & SIAGAKAN BOT WAR';
        App.util.warLog('info', 'Status: Portal kampus masih menutup pengisian kelas (Di luar jadwal).');
      }

      // 2. Muat ulang data mata kuliah terverifikasi mahasiswa (juga memuat ulang daftar kelas)
      await App.krsData.loadKrsData();

      // 3. Jika pengguna membuka tab student di browser, segarkan tab tersebut
      if (chrome?.tabs?.query) {
        chrome.tabs.query({ url: '*://student.amikompurwokerto.ac.id/*' }, (tabs) => {
          if (Array.isArray(tabs) && tabs.length > 0) {
            tabs.forEach((t) => {
              if (t.id) chrome.tabs.reload(t.id);
            });
            App.util.warLog('info', `Menyegarkan ${tabs.length} tab portal student di browser.`);
          }
        });
      }

      App.util.showToast('✓ Data portal dan web berhasil disegarkan!', 'success');
    } catch (err) {
      App.util.warLog('error', `Gagal segarkan data: ${err.message}`);
      App.util.showToast(`Gagal refresh: ${err.message}`, 'error');
    } finally {
      if (btn) btn.innerHTML = '<span>🔄 Segarkan Data Portal & Halaman Web</span>';
      if (btnTop) btnTop.innerHTML = '<span>🔄 Refresh Data & Web</span>';
    }
  }

  // Periksa langsung dari server apakah form pemilihan kelas KRS (Tab 3) sudah terbuka.
  // getKelasForm() membaca endpoint yang sama dengan sumber nilai `value` untuk
  // act=rencana_studi, sehingga status "terbuka" tidak bisa lagi keliru berasal dari
  // HTML Tab 1 (paket pengajuan matkul). Gagal request / API tak dikenal = fail-closed.
  async function isKrsFormOpen() {
    try {
      if (!api || typeof api.getKelasForm !== 'function') return false;
      const form = await api.getKelasForm();
      return Boolean(form && form.hasForm);
    } catch (_) {
      return false;
    }
  }

  // Cegah tick polling bertumpuk: muat ulang data + eksekusi bisa lebih lama dari interval 10 detik.
  let snipeTickRunning = false;

  // Bot siaga: polling status buka form KRS dari server, eksekusi otomatis saat form muncul
  async function toggleArmSnipe() {
    const btn = $('btn-toggle-arm-snipe');

    if (warKrsState.isArmed) {
      warKrsState.isArmed = false;
      if (warKrsState.pollInterval) {
        clearInterval(warKrsState.pollInterval);
        warKrsState.pollInterval = null;
      }
      if (btn) {
        btn.className = 'btn btn-warning btn-block btn-arm';
        btn.innerHTML = '<span>🔒 KUNCI STRATEGI & SIAGAKAN BOT WAR</span>';
      }
      App.util.warLog('info', 'Bot War dinonaktifkan (Disarmed).');
      return;
    }

    // Arm hanya boleh bila sumber data portal dan rencana benar-benar siap.
    // Tanpa itu bot hanya akan menembak kosong — tolak dengan pesan apa adanya.
    if (!warKrsState.hasOfferingData) {
      App.util.warLog('warn', 'Bot War tidak bisa di-arm: portal belum merilis penawaran kelas/jadwal, jadi belum ada paket kelas yang bisa ditembak.');
      App.util.showToast('Penawaran kelas/jadwal belum dirilis portal — belum ada paket kelas yang bisa ditembak.', 'warn');
      return;
    }
    if (!warKrsState.activePlan) {
      App.util.warLog('warn', 'Bot War tidak bisa di-arm: penawaran kelas ada, tetapi belum ada rencana jadwal aktif yang tersusun.');
      App.util.showToast('Belum ada rencana jadwal aktif. Susun atau pilih rencana jadwal terlebih dahulu.', 'warn');
      return;
    }

    warKrsState.isArmed = true;
    if (btn) {
      btn.className = 'btn btn-danger btn-block btn-arm armed';
      btn.innerHTML = '<span>🔥 AUTO-SNIPE AKTIF (ARMED - KLIK UNTUK BATAL)</span>';
    }
    App.util.warLog('armed', 'Bot War ARMED! Memeriksa server tiap 10 detik, eksekusi otomatis begitu form kelas terbuka.');
    App.util.showToast('Bot War Aktif! Otomatis menembak saat KRS dibuka.', 'warn');

    // Segera cek sekali, lalu polling tiap 10 detik
    const fireWhenOpen = async () => {
      if (!warKrsState.isArmed) return;
      if (snipeTickRunning) return;
      if (warKrsState.isExecuting || warKrsState.shouldStop) return;
      snipeTickRunning = true;
      try {
        const open = await isKrsFormOpen();
        if (!open) {
          if (!warKrsState.isExecuting) {
            App.util.warLog('info', 'Form kelas belum terbuka di server. Cek ulang dalam 10 detik...');
          }
          return;
        }

        App.util.warLog('success', '✓ Form kelas TERBUKA terdeteksi! Menyegarkan penawaran kelas & menyiapkan eksekusi...');

        // Form terbuka berarti portal baru merilis kelas: muat ulang agar nilai `value`
        // yang ditembak benar-benar berasal dari form yang sedang terbuka sekarang.
        try {
          await App.krsData.loadKrsData();
        } catch (err) {
          App.util.warLog('warn', `Gagal menyegarkan penawaran kelas dari portal: ${err.message}`);
        }

        if (!warKrsState.activePlan) {
          App.util.warLog('warn', 'Form kelas terbuka, tetapi rencana jadwal masih kosong — Bot War belum menembak.');
          App.util.showToast('Form kelas terbuka, tetapi rencana jadwal belum tersusun.', 'warn');
          return;
        }

        await executeWarInstant();
      } finally {
        snipeTickRunning = false;
      }
    };
    await fireWhenOpen();
    // Tick pertama bisa langsung sukses & disarm bot — jangan pasang polling lagi.
    if (!warKrsState.isArmed) return;
    warKrsState.pollInterval = setInterval(fireWhenOpen, 10000);
  }

  // Eksekusi War KRS Instan dengan Auto-Retry & Outcome Classification
  async function executeWarInstant() {
    if (warKrsState.isExecuting) return;
    if (!warKrsState.activePlan) {
      const cause = warKrsState.hasOfferingData
        ? 'penawaran kelas sudah ada, tetapi rencana jadwal belum tersusun'
        : 'penawaran kelas/jadwal belum dirilis portal';
      App.util.warLog('error', `Tidak ada rencana jadwal aktif untuk dieksekusi — ${cause}.`);
      App.util.showToast(`Belum ada rencana jadwal aktif: ${cause}.`, 'error');
      return;
    }

    const plan = warKrsState.activePlan;
    const autoRetry = $('war-auto-retry-enabled')?.checked ?? true;
    const delayMs = Math.max(500, parseInt($('war-retry-delay')?.value || '600', 10));

    // Guard integritas: hanya kelas dengan `value` asli dari form portal yang boleh
    // dikirim. Kelas tanpa value berarti rencana tidak berasal dari penawaran nyata.
    const planClasses = (plan && (plan.selectedClasses || plan.classes)) || [];
    const fakeClasses = planClasses.filter((c) => !c || typeof c.value !== 'string' || c.value.trim() === '');
    if (fakeClasses.length > 0) {
      const names = fakeClasses.map((c) => (c && (c.nama || c.kode || c.kelas || c.id)) || '?').join(', ');
      App.util.warLog('warn', `Dibatalkan: ${fakeClasses.length} kelas pada rencana tidak punya nilai form asli dari portal (${names}). Tidak ada permintaan dikirim.`);
      App.util.showToast('Rencana berisi kelas tanpa data asli portal. War KRS dibatalkan.', 'error');
      return;
    }

    // Endpoint HARUS sesuai sumber penawaran yang menghasilkan nilai `value` kelas.
    // tab3 (form kelas, act=rencana_studi) vs tab1 (paket matkul, act=rencana_pengajuan_maba).
    const source = warKrsState.offeringSource;
    let submitFn = null;
    let submitLabel = '';
    if (source === 'tab3' && api && typeof api.submitPilihKelas === 'function') {
      submitFn = (values) => api.submitPilihKelas(values);
      submitLabel = 'rencana_studi (pilih kelas)';
    } else if (source === 'tab1' && api && typeof api.submitRencanaPengajuanMaba === 'function') {
      submitFn = (values) => api.submitRencanaPengajuanMaba(values);
      submitLabel = 'rencana_pengajuan_maba (paket matkul)';
    }
    if (!submitFn) {
      App.util.warLog('error', `Tidak ada endpoint submit yang cocok untuk sumber penawaran "${source || 'tidak diketahui'}". Tidak ada permintaan dikirim.`);
      App.util.showToast('Sumber penawaran kelas tidak dikenali — War KRS dibatalkan tanpa mengirim data.', 'error');
      return;
    }

    // Jangan tembak server kalau form kelas memang belum dibuka
    const formOpen = await isKrsFormOpen();
    if (!formOpen) {
      App.util.warLog('warn', 'Form pemilihan kelas belum dibuka di server. Coba "🔄 Refresh Data & Web" nanti — tidak ada permintaan dikirim.');
      App.util.showToast('Form KRS belum dibuka di server.', 'warn');
      return;
    }

    warKrsState.isExecuting = true;
    warKrsState.shouldStop = false;

    const execBtn = $('btn-execute-war-instant');
    const stopBtn = $('btn-stop-war-instant');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.innerHTML = '<span>⚡ Menembak Server Amikom...</span>';
    }
    if (stopBtn) {
      stopBtn.classList.remove('hidden');
      stopBtn.disabled = false;
    }

    App.util.warLog('fire', `Memulai eksekusi War KRS untuk ${planClasses.length} mata kuliah...`);
    const maxRetries = autoRetry ? 5 : 1;
    let attempts = 0;
    let success = false;

    while (attempts < maxRetries && !success && !warKrsState.shouldStop) {
      attempts++;
      try {
        App.util.warLog('fire', `[Req #${attempts}] Mengirim paket form pengisian KRS via ${submitLabel}...`);

        // Payload hanya boleh berisi value asli form portal (guard di atas menjamin ada)
        const payloadValues = planClasses.map((c) => c.value);
        const rawRes = await submitFn(payloadValues);

        // Klasifikasikan outcome HTML respon
        const outcomeInfo = App.util.classifyPortalHtmlResponse(rawRes);
        if (outcomeInfo.outcome === 'SUCCESS' || outcomeInfo.outcome === 'DUPLICATE') {
          success = true;
          // Tampilkan kartu hasil; grid jadwal hanya terisi bila portal merilis hari/jam.
          const resultCard = $('krs-result-card');
          const resultBanner = $('krs-execution-result-banner');
          if (resultCard) resultCard.classList.remove('hidden');
          // Grid + badge dirender lebih dulu agar status bentrok riil teranotasi di plan.
          App.krsPlan.renderTimetableGrid(plan);
          if (resultBanner) {
            if (plan.hasSchedule && plan.hasConflict) {
              resultBanner.innerHTML = `⚠️ <b>${planClasses.length} Mata Kuliah</b> tersimpan, tetapi terdeteksi <b>${plan.conflictCount} bentrok jadwal</b>. Status bebas bentrok tidak dapat diklaim — periksa simulator jadwal dan susun ulang rencana.`;
            } else if (plan.hasSchedule) {
              resultBanner.innerHTML = `✅ <b>Berhasil!</b> Seluruh <b>${planClasses.length} Mata Kuliah</b> telah tersimpan di sistem universitas dengan <b>0% Bentrok</b>.`;
            } else {
              resultBanner.innerHTML = `✅ <b>Paket kelas tersimpan</b> — ${planClasses.length} mata kuliah sudah dikirim ke portal, tetapi <b>jadwal belum dirilis portal</b> sehingga status bentrok belum bisa dipastikan.`;
            }
          }
          if (plan.hasSchedule && plan.hasConflict) {
            App.util.warLog('warn', `Rencana tersimpan tetapi masih bentrok: ${plan.conflictSummary || `${plan.conflictCount} bentrok`}`);
          }

          App.util.warLog('success', `✓ Respon server terverifikasi: ${outcomeInfo.message}!`);
          App.util.warLog('success', `✓ Sukses! Seluruh ${planClasses.length} mata kuliah berhasil tersimpan.`);
          App.util.showToast('KRS Berhasil Disimpan!', 'success');
        } else if (outcomeInfo.outcome === 'CLASS_FULL') {
          App.util.warLog('error', 'Respon server: Kelas target telah PENUH! Aktifkan fallback...');
          break;
        } else {
          throw new Error(outcomeInfo.message || 'Respon server belum sukses');
        }

        // Update Phase Badge
        const phaseBadge = $('krs-phase-badge');
        if (phaseBadge) {
          phaseBadge.className = 'badge badge-success';
          phaseBadge.textContent = '✓ WAR SUKSES (POST-WAR)';
        }
      } catch (err) {
        App.util.warLog('error', `Gagal pada percobaan ${attempts}: ${err.message}`);
        if (attempts < maxRetries && autoRetry && !warKrsState.shouldStop) {
          App.util.warLog('warn', `Server sibuk/error. Menunggu ${delayMs}ms sebelum auto-retry...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    if (warKrsState.shouldStop) {
      App.util.warLog('warn', '⏹️ Proses War KRS telah dihentikan.');
      App.util.showToast('War KRS dihentikan.', 'warn');
    }

    warKrsState.isExecuting = false;
    if (execBtn) {
      execBtn.disabled = false;
      execBtn.innerHTML = '<span>⚡ EKSEKUSI WAR KRS SEKARANG</span>';
    }
    if (stopBtn) {
      stopBtn.classList.add('hidden');
    }

    if (!success && !warKrsState.shouldStop) {
      App.util.warLog('error', 'Gagal mencapai server setelah batas maksimum percobaan.');
      App.util.showToast('War KRS gagal. Silakan coba lagi.', 'error');
    } else if (success && warKrsState.isArmed) {
      toggleArmSnipe();
    }
  }

  function stopWarInstant() {
    warKrsState.shouldStop = true;
    App.util.warLog('warn', 'Permintaan berhenti diterima. Menghentikan proses War KRS...');
    const stopBtn = $('btn-stop-war-instant');
    if (stopBtn) stopBtn.disabled = true;
  }

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.krsWar = {
    refreshPortalAndWeb,
    isKrsFormOpen,
    toggleArmSnipe,
    executeWarInstant,
    stopWarInstant
  };
})();
