/**
 * Amikom Student Assistant - Popup: Modul Kontrol War KRS (App.krsControls)
 * Prioritas kelas dinamis, preset, render kontrol prioritas, simpan/pulihkan
 * pengaturan, strategi (Libur Maksimal vs Satu Rombel), target hari, dan init modul.
 * Dimuat setelah core.js, app-util.js, krs-plan.js.
 */
(function () {
  'use strict';

  const App = window.AppKrs;
  const $ = App.core.$;
  const $$ = App.core.$$;
  const warKrsState = App.core.warKrsState;

  // Hitung ulang rencana HANYA bila portal benar-benar merilis penawaran kelas
  // (Tab 3 /akademik/makul_belum_diisi_mbkm, atau fallback paket Tab 1
  // /akademik/get_mkl_ditawarkan) — lihat warKrsState.offeringSource.
  // Tanpa penawaran nyata tidak ada yang bisa dioptimasi; log peringatan jujur
  // cukup ditulis sekali oleh loadKrsData(), bukan diulang tiap interaksi pengguna.
  function optimizeIfOfferingReleased() {
    if (warKrsState.hasOfferingData) App.krsPlan.runWarKrsOptimization();
  }

  // Atur urutan prioritas kelas dan perbarui antarmuka
  function setClassPriority(newPriorityList, options = { runOpt: true }) {
    if (!Array.isArray(newPriorityList) || newPriorityList.length === 0) return;
    
    // Deduplikasi dan normalisasi uppercase
    const cleaned = [];
    newPriorityList.forEach((letter) => {
      const l = String(letter).trim().toUpperCase();
      if (l && !cleaned.includes(l)) cleaned.push(l);
    });
    if (cleaned.length === 0) return;

    warKrsState.classPriority = cleaned;
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ classPriority: cleaned });
    }

    renderPriorityControls();

    if (options.runOpt) {
      optimizeIfOfferingReleased();
    }
  }

  // Geser posisi prioritas ke kiri / kanan
  function movePriorityItem(fromIdx, direction) {
    const list = warKrsState.classPriority.slice();
    if (direction === 'left' && fromIdx > 0) {
      const temp = list[fromIdx];
      list[fromIdx] = list[fromIdx - 1];
      list[fromIdx - 1] = temp;
      App.util.warLog('info', `Prioritas Kelas ${temp} dinaikkan ke #${fromIdx}`);
    } else if (direction === 'right' && fromIdx < list.length - 1) {
      const temp = list[fromIdx];
      list[fromIdx] = list[fromIdx + 1];
      list[fromIdx + 1] = temp;
      App.util.warLog('info', `Prioritas Kelas ${temp} diturunkan ke #${fromIdx + 2}`);
    }
    setClassPriority(list);
  }

  // Keluarkan kelas dari daftar prioritas (jika > 1 item)
  function removePriorityItem(idx) {
    if (warKrsState.classPriority.length <= 1) return;
    const removed = warKrsState.classPriority[idx];
    const list = warKrsState.classPriority.slice();
    list.splice(idx, 1);
    App.util.warLog('warn', `Kelas ${removed} dikeluarkan dari daftar prioritas.`);
    setClassPriority(list);
  }

  // Jadikan kelas sebagai Prioritas #1 atau tambahkan ke list
  function promoteOrAddClassPriority(letter) {
    const list = warKrsState.classPriority.slice();
    const existingIdx = list.indexOf(letter);
    if (existingIdx > -1) {
      list.splice(existingIdx, 1);
      list.unshift(letter);
      App.util.warLog('info', `Kelas ${letter} dijadikan PRIORITAS UTAMA (#1).`);
    } else {
      list.unshift(letter);
      App.util.warLog('info', `Kelas ${letter} ditambahkan sebagai PRIORITAS UTAMA (#1).`);
    }
    setClassPriority(list);
  }

  // Eksekusi preset cepat prioritas
  function handlePresetClick(presetType) {
    const avail = warKrsState.availableClasses;
    let newList = [];

    if (['A', 'B', 'C', 'D', 'E'].includes(presetType)) {
      // Taruh presetType di index 0, diikuti sisanya sesuai alfabetis
      newList = [presetType, ...avail.filter((x) => x !== presetType)];
      App.util.warLog('info', `Preset dipilih: Mulai dari Kelas ${presetType} (${newList.join(' > ')})`);
    } else if (presetType === 'REVERSE') {
      newList = warKrsState.classPriority.slice().reverse();
      App.util.warLog('info', `Urutan prioritas dibalik: ${newList.join(' > ')}`);
    } else if (presetType === 'RESET') {
      newList = avail.slice();
      App.util.warLog('info', `Urutan prioritas di-reset ke standar: ${newList.join(' > ')}`);
    }

    if (newList.length > 0) {
      setClassPriority(newList);
    }
  }

  // Render seluruh komponen interaktif urutan prioritas & pool kelas
  function renderPriorityControls() {
    const seqContainer = $('priority-sequence-container');
    const countBadge = $('priority-count-badge');

    if (countBadge) {
      countBadge.textContent = `${warKrsState.classPriority.length} Kelas Diprioritaskan`;
    }

    // Render Dynamic Interactive Priority Sequence Tag List
    if (seqContainer) {
      seqContainer.innerHTML = '';

      warKrsState.classPriority.forEach((letter, idx) => {
        if (idx > 0) {
          const sep = document.createElement('span');
          sep.className = 'priority-sep-arrow';
          sep.textContent = '➔';
          seqContainer.appendChild(sep);
        }

        const tag = document.createElement('div');
        tag.className = `priority-tag ${idx === 0 ? 'is-top' : ''}`;

        const rankBadge = document.createElement('span');
        rankBadge.className = 'priority-rank-badge';
        rankBadge.textContent = `#${idx + 1}`;

        const text = document.createElement('span');
        text.className = 'priority-tag-text';
        text.textContent = `Kelas ${letter}`;

        const controls = document.createElement('div');
        controls.className = 'priority-tag-controls';

        if (idx > 0) {
          const leftBtn = document.createElement('button');
          leftBtn.type = 'button';
          leftBtn.className = 'priority-arrow-btn';
          leftBtn.title = 'Tingkatkan prioritas (geser kiri)';
          leftBtn.textContent = '◀';
          leftBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            movePriorityItem(idx, 'left');
          });
          controls.appendChild(leftBtn);
        }

        if (idx < warKrsState.classPriority.length - 1) {
          const rightBtn = document.createElement('button');
          rightBtn.type = 'button';
          rightBtn.className = 'priority-arrow-btn';
          rightBtn.title = 'Turunkan prioritas (geser kanan)';
          rightBtn.textContent = '▶';
          rightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            movePriorityItem(idx, 'right');
          });
          controls.appendChild(rightBtn);
        }

        if (warKrsState.classPriority.length > 1) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'priority-remove-btn';
          delBtn.title = 'Keluarkan dari daftar prioritas';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removePriorityItem(idx);
          });
          controls.appendChild(delBtn);
        }

        tag.appendChild(rankBadge);
        tag.appendChild(text);
        tag.appendChild(controls);
        seqContainer.appendChild(tag);
      });
    }
  }

  // Simpan seluruh pengaturan War KRS ke chrome.storage.local agar tidak pernah reset
  function saveWarKrsSettings() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({
      krs_strategy: warKrsState.strategy,
      krs_compact_days: warKrsState.compactDaysTarget,
      krs_preferred_days: warKrsState.preferredDays,
      krs_class_priority: warKrsState.classPriority,
      krs_fallback_policy: warKrsState.blockFallbackPolicy,
      krs_auto_retry: $('war-auto-retry-enabled')?.checked ?? true
    });
  }

  // Muat ulang pengaturan War KRS yang tersimpan dari chrome.storage.local
  function restoreWarKrsSettings() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get([
      'krs_strategy',
      'krs_compact_days',
      'krs_preferred_days',
      'krs_class_priority',
      'krs_fallback_policy',
      'krs_auto_retry'
    ], (saved) => {
      if (!saved) return;
      if (saved.krs_strategy) {
        warKrsState.strategy = saved.krs_strategy;
        const radio = document.querySelector(`input[name="krs-main-strategy"][value="${saved.krs_strategy}"]`);
        if (radio) {
          radio.checked = true;
          switchStrategyRadio(saved.krs_strategy, false);
        }
      }
      if (typeof saved.krs_compact_days !== 'undefined') {
        warKrsState.compactDaysTarget = saved.krs_compact_days;
        $$('#compact-days-selector .choice-pill').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.days === String(saved.krs_compact_days));
        });
      }
      if (Array.isArray(saved.krs_preferred_days)) {
        warKrsState.preferredDays = saved.krs_preferred_days;
        $$('#preferred-days-selector .day-chip').forEach((btn) => {
          btn.classList.toggle('active', warKrsState.preferredDays.includes(btn.dataset.day));
        });
      }
      if (Array.isArray(saved.krs_class_priority) && saved.krs_class_priority.length > 0) {
        warKrsState.classPriority = saved.krs_class_priority;
        renderPriorityControls();
      }
      if (saved.krs_fallback_policy) {
        warKrsState.blockFallbackPolicy = saved.krs_fallback_policy;
        const policySelect = $('block-fallback-policy');
        if (policySelect) policySelect.value = saved.krs_fallback_policy;
      }
      if (typeof saved.krs_auto_retry === 'boolean') {
        const retryChk = $('war-auto-retry-enabled');
        if (retryChk) retryChk.checked = saved.krs_auto_retry;
      }
    });
  }

  // Ganti mode strategi via Radio Card (Libur Maksimal vs Satu Rombel)
  function switchStrategyRadio(strat, shouldSave = true) {
    warKrsState.strategy = strat;
    const isCompact = strat === 'COMPACT_DAYS';

    $('card-strat-compact')?.classList.toggle('active', isCompact);
    $('card-strat-block')?.classList.toggle('active', !isCompact);

    const compactPane = $('strat-pane-compact');
    const blockPane = $('strat-pane-block');

    if (compactPane) compactPane.classList.toggle('hidden', !isCompact);
    if (blockPane) blockPane.classList.toggle('hidden', isCompact);

    App.util.warLog('info', `Strategi dipilih: ${isCompact ? '🏖️ Mode Libur Maksimal (Rapel Hari)' : '🏢 Mode Satu Rombel (Block Kelas)'}`);
    optimizeIfOfferingReleased();
    if (shouldSave) saveWarKrsSettings();
  }

  // Pilih Target Minimal Hari (2 / 3 / 4 / Fleksibel)
  function setCompactDaysTarget(days) {
    warKrsState.compactDaysTarget = parseInt(days, 10);
    $$('#compact-days-selector .choice-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.days === String(days));
    });
    App.util.warLog('info', `Target Hari Maksimal: ${days ? days + ' Hari' : 'Fleksibel'}`);
    optimizeIfOfferingReleased();
  }

  // Toggle Hari Prioritas
  function togglePreferredDay(day) {
    const idx = warKrsState.preferredDays.indexOf(day);
    if (idx > -1) {
      warKrsState.preferredDays.splice(idx, 1);
    } else {
      warKrsState.preferredDays.push(day);
    }
    $$('#preferred-days-selector .day-chip').forEach((btn) => {
      btn.classList.toggle('active', warKrsState.preferredDays.includes(btn.dataset.day));
    });
    App.util.warLog('info', `Prioritas Hari: ${warKrsState.preferredDays.join(', ') || 'Semua'}`);
    optimizeIfOfferingReleased();
  }

  // Inisialisasi Modul War KRS
  function initWarKrs() {
    // Auto-detect daftar kelas dari penawaran mata kuliah portal
    // (Tab 3 makul_belum_diisi_mbkm, fallback paket Tab 1 get_mkl_ditawarkan).
    // Bila portal belum merilis penawaran, offeringCourses kosong dan
    // hasil fallback hanya placeholder — baru bermakna saat hasOfferingData true.
    // Catatan: hari/jam/ruang hanya ada bila hasScheduleData true (sumber Tab 3/4).
    warKrsState.availableClasses = App.krsData.detectAvailableClassLetters(warKrsState.offeringCourses || []);
    
    // Sinkronkan classPriority dengan availableClasses jika ada kelas baru
    if (!warKrsState.classPriority || warKrsState.classPriority.length === 0) {
      warKrsState.classPriority = ['B', 'C', 'A', 'D'].filter((x) => warKrsState.availableClasses.includes(x));
      if (warKrsState.classPriority.length === 0) warKrsState.classPriority = warKrsState.availableClasses.slice();
    }

    // Sinkronkan strategi dengan radio yang tampak aktif di HTML (default COMPACT_DAYS)
    const activeRadio = document.querySelector('input[name="krs-main-strategy"]:checked');
    if (activeRadio) {
      switchStrategyRadio(activeRadio.value, false);
    }

    renderPriorityControls();
    App.krsData.renderVerifiedCoursesList();
    restoreWarKrsSettings();
    // Rencana jadwal tidak pernah dihitung saat boot tanpa data penawaran;
    // loadKrsData() yang menulis log jujurnya begitu data portal tiba.
    optimizeIfOfferingReleased();

    // Bind preset buttons
    $$('.preset-pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        handlePresetClick(btn.dataset.preset);
        saveWarKrsSettings();
      });
    });
  }

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.krsControls = {
    optimizeIfOfferingReleased,
    setClassPriority,
    movePriorityItem,
    removePriorityItem,
    promoteOrAddClassPriority,
    handlePresetClick,
    renderPriorityControls,
    saveWarKrsSettings,
    restoreWarKrsSettings,
    switchStrategyRadio,
    setCompactDaysTarget,
    togglePreferredDay,
    initWarKrs
  };
})();
