/**
 * Amikom Student Assistant - Popup Modul INIT/BOOT (v2.0 Modular)
 * Namespace App.boot: refreshSessionStatus, bindEvents, init().
 * Satu-satunya modul yang mendaftarkan DOMContentLoaded (memanggil init()).
 * Hasil modularisasi popup/popup.js (closure DOMContentLoaded) -> popup/js/*.
 */
(function () {
  'use strict';

  async function init() {
    const App = window.AppKrs;
    if (chrome?.storage?.local) {
      chrome.storage.local.get(['dosenRating', 'asdosPreset', 'delayMs'], (res) => {
        if (res.dosenRating && App.core.$('select-dosen-rating')) App.core.$('select-dosen-rating').value = res.dosenRating;
        if (res.asdosPreset && App.core.$('select-asdos-preset')) App.core.$('select-asdos-preset').value = res.asdosPreset;
        if (res.delayMs && App.core.$('input-delay')) App.core.$('input-delay').value = res.delayMs;
      });
    }
    bindEvents();
    App.krsControls.initWarKrs();
    await refreshSessionStatus();
  }

  async function refreshSessionStatus() {
    const App = window.AppKrs;
    const badge = App.core.$('session-badge');
    const text = App.core.$('session-text');
    if (text) text.textContent = 'Memeriksa...';
    if (badge) badge.className = 'badge badge-outline';

    try {
      const session = await App.core.api.checkSession();
      App.core.state.isLoggedIn = session.isLoggedIn;

      if (session.isLoggedIn) {
        if (badge) badge.className = 'badge badge-success';
        if (text) text.textContent = 'Terhubung';
        App.core.$('login-alert-banner')?.classList.add('hidden');
        await App.presensi.refreshPresensiData();
      } else {
        if (badge) badge.className = 'badge badge-danger';
        if (text) text.textContent = 'Belum Login';
        App.core.$('login-alert-banner')?.classList.remove('hidden');
        if (App.core.$('presensi-status-badge')) {
          App.core.$('presensi-status-badge').className = 'badge badge-danger';
          App.core.$('presensi-status-badge').textContent = 'Perlu Login';
        }
        if (App.core.$('unvalidated-count')) App.core.$('unvalidated-count').textContent = '0';
      }
    } catch (err) {
      if (badge) badge.className = 'badge badge-warning';
      if (text) text.textContent = 'Koneksi Error';
      App.util.log('error', `Gagal periksa sesi: ${err.message}`);
    }
  }

  // =========================================================================
  // 6. EVENT BINDINGS & LISTENERS
  // =========================================================================

  function bindEvents() {
    const App = window.AppKrs;

    // Global Refresh
    App.core.$('btn-refresh-global')?.addEventListener('click', async () => {
      const btn = App.core.$('btn-refresh-global');
      if (btn) {
        btn.style.transform = 'rotate(180deg)';
        setTimeout(() => (btn.style.transform = 'rotate(0deg)'), 300);
      }
      await refreshSessionStatus();
      const activeTabBtn = document.querySelector('.tab-btn.active');
      if (activeTabBtn?.dataset.tab === 'tab-krs') {
        await App.krsData.loadKrsData();
      } else if (activeTabBtn?.dataset.tab === 'tab-akademik') {
        const activeSub = document.querySelector('.sub-tab-btn.active')?.dataset.sub;
        if (activeSub) await App.akademik.loadAkademikData(activeSub);
      }
    });

    // Login Redirect
    App.core.$('btn-go-login')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://student.amikompurwokerto.ac.id/auth' });
    });

    // Tabs Navigation
    App.core.$$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        App.core.$$('.tab-btn').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        App.core.$$('.tab-pane').forEach((p) => p.classList.remove('active'));

        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        const targetId = btn.dataset.tab;
        App.core.$(targetId)?.classList.add('active');

        if (targetId === 'tab-krs') await App.krsData.loadKrsData();
        else if (targetId === 'tab-akademik') {
          const activeSub = document.querySelector('.sub-tab-btn.active')?.dataset.sub;
          if (activeSub) await App.akademik.loadAkademikData(activeSub);
        }
      });
    });

    // Presensi Actions
    App.core.$('btn-start-validation')?.addEventListener('click', App.presensi.runValidation);
    App.core.$('btn-stop-validation')?.addEventListener('click', App.presensi.stopValidation);
    App.core.$('btn-clear-logs')?.addEventListener('click', () => {
      const terminal = App.core.$('terminal-console');
      if (terminal) terminal.innerHTML = '';
      App.util.log('info', 'Log dibersihkan.');
    });
    // Radio Strategy Cards (Libur Maksimal vs Satu Rombel)
    App.core.$$('input[name="krs-main-strategy"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        App.krsControls.switchStrategyRadio(e.target.value);
      });
    });

    // Minimal Hari Target Pills (2, 3, 4, 0)
    App.core.$$('#compact-days-selector .choice-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        App.krsControls.setCompactDaysTarget(btn.dataset.days);
        App.krsControls.saveWarKrsSettings();
      });
    });

    // Prioritas Hari Chips
    App.core.$$('#preferred-days-selector .day-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        App.krsControls.togglePreferredDay(btn.dataset.day);
        App.krsControls.saveWarKrsSettings();
      });
    });

    // Fallback Policy Select
    App.core.$('block-fallback-policy')?.addEventListener('change', (e) => {
      App.core.warKrsState.blockFallbackPolicy = e.target.value;
      App.util.warLog('info', `Kebijakan fallback diubah ke: ${e.target.value}`);
      App.krsControls.optimizeIfOfferingReleased();
      App.krsControls.saveWarKrsSettings();
    });

    // Refresh Portal Data & Web Halaman
    App.core.$('btn-refresh-portal-data')?.addEventListener('click', App.krsWar.refreshPortalAndWeb);
    App.core.$('btn-sync-all-web')?.addEventListener('click', App.krsWar.refreshPortalAndWeb);
    // Action Buttons: Eksekusi Instant & Arm Auto-Snipe
    App.core.$('btn-execute-war-instant')?.addEventListener('click', App.krsWar.executeWarInstant);
    App.core.$('btn-toggle-arm-snipe')?.addEventListener('click', App.krsWar.toggleArmSnipe);
    App.core.$('btn-stop-war-instant')?.addEventListener('click', App.krsWar.stopWarInstant);
    App.core.$('btn-clear-war-logs')?.addEventListener('click', () => {
      const terminal = App.core.$('war-terminal-console');
      if (terminal) terminal.innerHTML = '';
      App.util.warLog('info', 'Log War KRS dibersihkan.');
    });

    // Akademik Subtabs (Scoped to #tab-akademik to avoid collision with War KRS subtabs)
    App.core.$$('#tab-akademik .sub-tab-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        App.core.$$('#tab-akademik .sub-tab-btn').forEach((b) => b.classList.remove('active'));
        App.core.$$('#tab-akademik .sub-pane').forEach((p) => p.classList.add('hidden'));

        btn.classList.add('active');
        const subId = btn.dataset.sub;
        App.core.$(subId)?.classList.remove('hidden');
        await App.akademik.loadAkademikData(subId);
      });
    });

    App.core.$('btn-filter-uas')?.addEventListener('click', async () => {
      App.core.$('btn-filter-uas')?.classList.add('active');
      App.core.$('btn-filter-uts')?.classList.remove('active');
      App.core.state.activeExamType = 'uas';
      await App.akademik.loadJadwalUjian('uas');
    });

    App.core.$('btn-filter-uts')?.addEventListener('click', async () => {
      App.core.$('btn-filter-uts')?.classList.add('active');
      App.core.$('btn-filter-uas')?.classList.remove('active');
      App.core.state.activeExamType = 'uts';
      await App.akademik.loadJadwalUjian('uts');
    });

    // Shortcuts in Settings
    App.core.$('btn-open-student')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://student.amikompurwokerto.ac.id/main' });
    });
    App.core.$('btn-open-presensi')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://student.amikompurwokerto.ac.id/presensi' });
    });
    App.core.$('btn-open-krs')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://student.amikompurwokerto.ac.id/krs' });
    });
  }

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.boot = {
    refreshSessionStatus,
    bindEvents,
    init
  };

  // Jalankan inisialisasi (satu-satunya DOMContentLoaded di seluruh modul popup)
  document.addEventListener('DOMContentLoaded', () => {
    init();
  });
})();
