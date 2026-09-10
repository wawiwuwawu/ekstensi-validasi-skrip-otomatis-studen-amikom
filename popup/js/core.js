/**
 * Amikom Student Assistant - Popup Modul CORE (v2.0 Modular)
 * Namespace App.core: helper DOM, client API, state bersama.
 * Hasil modularisasi popup/popup.js (closure DOMContentLoaded) -> popup/js/*.
 */
(function () {
  'use strict';

  // Helper DOM Selectors
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Inisialisasi API client
  const api = new (window.AmikomAPI || AmikomAPI)();

  // App State
  const state = {
    isLoggedIn: false,
    isRunning: false,
    isStopped: false,
    unvalidatedMap: {},
    activeExamType: 'uas'
  };

  // State Komprehensif War KRS
  const warKrsState = {
    phase: 'PRE_WAR',
    strategy: 'COMPACT_DAYS', // 'COMPACT_DAYS' (Libur Maksimal) | 'BLOCK_CLASS' (Satu Rombel)
    classPriority: ['B', 'C', 'A', 'D'], // Urutan prioritas kelas dinamis N-panjang
    availableClasses: ['A', 'B', 'C', 'D'],
    get blockClassTarget() {
      return this.classPriority[0] || 'A';
    },
    set blockClassTarget(val) {
      if (!val) return;
      const idx = this.classPriority.indexOf(val);
      if (idx > -1) {
        this.classPriority.splice(idx, 1);
      }
      this.classPriority.unshift(val);
    },
    blockFallbackPolicy: 'BEST_FIT',
    compactDaysTarget: 2,
    preferredDays: ['Senin', 'Kamis'],
    // Mata kuliah terdaftar & terverifikasi mahasiswa (Tab 2: /akademik/makul_pengajuan_diambil).
    // Tanpa kelas/hari/jam/ruang — portal tidak merilis itu di tab ini.
    verifiedCourses: [],
    // Penawaran kelas resmi portal — Tab 3 (/akademik/makul_belum_diisi_mbkm, form pilih kelas)
    // diutamakan; Tab 1 (/akademik/get_mkl_ditawarkan, paket pengajuan) hanya fallback.
    offeringCourses: [],
    // Dari sumber mana offeringCourses berasal: 'tab3' (value -> act=rencana_studi) |
    // 'tab1' (value -> act=rencana_pengajuan_maba) | null (tidak ada yang bisa diajukan).
    offeringSource: null,
    // true hanya bila ada penawaran kelas nyata dengan value form asli.
    hasOfferingData: false,
    // true HANYA bila minimal satu kelas punya hari DAN jam non-kosong (Tab 3/Tab 4).
    // Gate tunggal untuk klaim "Bebas Bentrok"/persentase bentrok di UI.
    hasScheduleData: false,
    combinations: [],
    activePlan: null,
    isArmed: false,
    pollInterval: null,
    isExecuting: false,
    shouldStop: false
  };

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.core = {
    $,
    $$,
    api,
    state,
    warKrsState
  };
})();
