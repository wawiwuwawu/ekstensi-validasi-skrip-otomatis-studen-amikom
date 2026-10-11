/**
 * Amikom Student Assistant - Popup Presensi Module (App.presensi)
 * Modul modularisasi dari popup/popup.js (bagian 3. PRESENSI MODULE).
 * Akses state/helper lewat namespace: App.core & App.util.
 */
(function () {
  'use strict';

  window.AppKrs = window.AppKrs || {};
  const App = window.AppKrs;

  async function refreshPresensiData() {
    const { $, api, state } = App.core;
    const { log } = App.util;
    if (!state.isLoggedIn) return;

    const statusBadge = $('presensi-status-badge');
    const countEl = $('unvalidated-count');
    const listEl = $('unvalidated-courses-list');

    if (statusBadge) {
      statusBadge.className = 'badge badge-outline';
      statusBadge.textContent = 'Memuat...';
    }

    try {
      const data = await api.listMakulBelumValidasi();
      state.unvalidatedMap = data || {};
      const keys = Object.keys(state.unvalidatedMap);

      let totalCount = 0;
      if (listEl) listEl.innerHTML = '';

      if (keys.length === 0) {
        if (countEl) countEl.textContent = '0';
        if (statusBadge) {
          statusBadge.className = 'badge badge-success';
          statusBadge.textContent = 'Semua Tervalidasi';
        }
        if (listEl) listEl.innerHTML = '<span class="mini-tag" style="color:#34d399;">✓ Tidak ada kehadiran tertunda</span>';
      } else {
        keys.forEach((k) => {
          const item = state.unvalidatedMap[k];
          totalCount += item.count || 0;

          if (listEl) {
            const tag = document.createElement('span');
            tag.className = 'mini-tag';
            tag.textContent = `${item.makul} (${item.count})`;
            listEl.appendChild(tag);
          }
        });

        if (countEl) countEl.textContent = totalCount;
        if (statusBadge) {
          statusBadge.className = 'badge badge-warning';
          statusBadge.textContent = `${keys.length} Mata Kuliah`;
        }
      }
    } catch (err) {
      log('error', `Gagal memuat status presensi: ${err.message}`);
      if (statusBadge) {
        statusBadge.className = 'badge badge-danger';
        statusBadge.textContent = 'Gagal Muat';
      }
    }
  }

  async function runValidation() {
    const { $, api, state } = App.core;
    const { log, showToast } = App.util;
    if (!state.isLoggedIn) {
      showToast('Silakan login terlebih dahulu di Student Amikom!', 'warn');
      return;
    }

    const dosenRating = $('select-dosen-rating')?.value || '3';
    const asdosPreset = $('select-asdos-preset')?.value || 'default';
    const delayMs = parseInt($('input-delay')?.value, 10) || 600;

    if (chrome?.storage?.local) {
      chrome.storage.local.set({ dosenRating, asdosPreset, delayMs });
    }

    state.isRunning = true;
    state.isStopped = false;

    $('btn-start-validation')?.classList.add('hidden');
    $('btn-stop-validation')?.classList.remove('hidden');
    $('progress-container')?.classList.remove('hidden');

    const fill = $('progress-bar-fill');
    const percentEl = $('progress-percent');
    const labelEl = $('progress-label');

    if (fill) fill.style.width = '0%';
    if (percentEl) percentEl.textContent = '0%';
    if (labelEl) labelEl.textContent = 'Memulai proses otomasi...';

    try {
      const res = await api.autoValidateAll({
        dosenRating,
        asdosPreset,
        delayMs,
        shouldStop: () => state.isStopped,
        onProgress: (p) => {
          if (fill) fill.style.width = `${p.percent}%`;
          if (percentEl) percentEl.textContent = `${p.percent}%`;
          if (labelEl) labelEl.textContent = `Memproses (${p.current}/${p.total} sesi)...`;
        },
        onLog: (type, msg) => log(type, msg)
      });

      if (state.isStopped) {
        showToast('Otomasi dihentikan oleh pengguna.', 'warn');
      } else if (res.success) {
        const gagal = res.failedCount ? `, ${res.failedCount} gagal/dilewati` : '';
        const dilewati = res.skippedMatkul ? `, ${res.skippedMatkul} mata kuliah dilewati` : '';
        showToast(`Otomasi selesai! ${res.count} sesi berhasil divalidasi${gagal}${dilewati}.`, 'success');
      }
    } catch (err) {
      const pesan = (err.code === 'SESSION_EXPIRED' || err.message === 'SESSION_EXPIRED')
        ? 'Sesi login berakhir. Silakan login ulang di portal Student Amikom, lalu jalankan validasi kembali.'
        : err.message;
      log('error', `Otomasi terhenti: ${pesan}`);
      showToast(`Error: ${pesan}`, 'error');
    } finally {
      state.isRunning = false;
      $('btn-start-validation')?.classList.remove('hidden');
      $('btn-stop-validation')?.classList.add('hidden');
      await refreshPresensiData();
    }
  }

  function stopValidation() {
    const { $, state } = App.core;
    const { log } = App.util;
    state.isStopped = true;
    log('warn', 'Permintaan berhenti diterima. Menghentikan proses...');
    const btn = $('btn-stop-validation');
    if (btn) {
      btn.disabled = true;
      setTimeout(() => (btn.disabled = false), 1000);
    }
  }

  window.AppKrs.presensi = {
    refreshPresensiData,
    runValidation,
    stopValidation
  };
})();
