/**
 * Amikom Student Assistant - Popup Akademik Module (App.akademik)
 * Modul modularisasi dari popup/popup.js (bagian 5. JADWAL & AKADEMIK MODULE).
 * Akses state/helper lewat namespace: App.core & App.util.
 */
(function () {
  'use strict';

  window.AppKrs = window.AppKrs || {};
  const App = window.AppKrs;

  async function renderInfoList(container, fetcher, emptyMsg, formatItem) {
    if (!container) return;
    container.innerHTML = '<div class="loading-state">Memuat data...</div>';
    try {
      const data = await fetcher();
      container.innerHTML = '';

      if (!Array.isArray(data) || data.length === 0) {
        container.innerHTML = `<div class="loading-state">${emptyMsg}</div>`;
        return;
      }

      data.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'info-item';
        const formatted = formatItem(item);

        const title = document.createElement('div');
        title.className = 'info-item-title';
        title.textContent = formatted.title;

        const meta = document.createElement('div');
        meta.className = 'info-item-meta';
        if (formatted.metaHtml) meta.innerHTML = formatted.metaHtml;
        else meta.textContent = formatted.metaText || '';

        card.appendChild(title);
        card.appendChild(meta);
        container.appendChild(card);
      });
    } catch (err) {
      container.innerHTML = `<div class="loading-state" style="color:#f87171;">Gagal memuat: ${err.message}</div>`;
    }
  }

  const loadJadwalUjian = (type = 'uas') => {
    const { $, api } = App.core;
    return App.akademik.renderInfoList(
      $('list-jadwal-ujian'),
      () => api.getJadwalUjian(type),
      `Tidak ada jadwal ${type.toUpperCase()} yang ditemukan.`,
      (item) => ({
        title: `${item.MKL || 'Mata Kuliah'} (${item.KODE || '-'})`,
        metaHtml: `📅 <b>${item.HARI || '-'}, ${item.TANGGAL || '-'}</b> &nbsp;•&nbsp; ⏰ <b>${item.JAM_MULAI || '-'} - ${item.JAM_SELESAI || '-'}</b><br>📍 Ruang: <b>${item.RUANG || '-'}</b>`
      })
    );
  };

  const loadAgenda = () => {
    const { $, api } = App.core;
    return App.akademik.renderInfoList(
      $('list-agenda'),
      () => api.getAgendaAkademik(),
      'Tidak ada agenda akademik saat ini.',
      (item) => ({
        title: item.TITLE || 'Agenda',
        metaText: `Periode: ${item.MULAI || '-'} s/d ${item.SELESAI || '-'}`
      })
    );
  };

  const loadPengumuman = () => {
    const { $, api } = App.core;
    return App.akademik.renderInfoList(
      $('list-pengumuman'),
      () => api.getPengumuman(),
      'Tidak ada pengumuman saat ini.',
      (item) => ({
        title: item.JUDUL || 'Pengumuman',
        metaText: `Diterbitkan: ${item.TANGGAL || '-'}`
      })
    );
  };

  async function loadAkademikData(subTab) {
    const { state } = App.core;
    if (!state.isLoggedIn) return;
    if (subTab === 'sub-uas') await App.akademik.loadJadwalUjian(state.activeExamType);
    else if (subTab === 'sub-agenda') await App.akademik.loadAgenda();
    else if (subTab === 'sub-pengumuman') await App.akademik.loadPengumuman();
  }

  window.AppKrs.akademik = {
    renderInfoList,
    loadJadwalUjian,
    loadAgenda,
    loadPengumuman,
    loadAkademikData
  };
})();
