/**
 * Amikom Student Assistant - Popup: Modul Optimasi & Jadwal (App.krsPlan)
 * Eksekusi algoritma optimasi penjadwalan via window.KrsScheduler.solve,
 * enrich info slot (Teori/Praktik, Back-to-Back, Murni Teori), dan render
 * grid jadwal mini + indikator bentrok.
 * Dimuat setelah core.js, app-util.js.
 */
(function () {
  'use strict';

  const App = window.AppKrs;
  const $ = App.core.$;
  const warKrsState = App.core.warKrsState;

  // Eksekusi Algoritma Optimasi Penjadwalan
  function runWarKrsOptimization() {
    // Tanpa penawaran kelas nyata dari portal (Tab 1), tidak ada jadwal/kelas
    // yang bisa dioptimasi. Jangan pernah menyusun rencana di atas data kosong.
    if (!warKrsState.hasOfferingData) {
      warKrsState.combinations = [];
      warKrsState.activePlan = null;
      const emptyResultCard = $('krs-result-card');
      if (emptyResultCard) emptyResultCard.classList.add('hidden');
      App.util.warLog('warn', 'Jadwal/kelas belum dirilis portal — perencana jadwal dinonaktifkan, tidak ada kombinasi kelas yang dibuat.');
      return;
    }

    const Scheduler = window.KrsScheduler;
    if (!Scheduler) {
      App.util.warLog('warn', 'Modul KrsScheduler belum termuat, menunggu...');
      return;
    }

    // Mode Libur Maksimal (COMPACT_DAYS) & Mode Satu Rombel (BLOCK_CLASS)
    const prefs = {};
    if (warKrsState.strategy === 'BLOCK_CLASS') {
      prefs.classPriority = warKrsState.classPriority;
      prefs.targetClass = warKrsState.classPriority[0] || 'A';
      prefs.blockFallbackPolicy = warKrsState.blockFallbackPolicy;
    } else {
      prefs.maxDays = warKrsState.compactDaysTarget;
      prefs.preferredDays = warKrsState.preferredDays;
    }

    const result = Scheduler.solve({
      courses: warKrsState.offeringCourses,
      strategy: warKrsState.strategy,
      preferences: prefs,
      filterFullQuota: true,
      maxResults: 5
    });

    if (result && result.combinations && result.combinations.length > 0) {
      warKrsState.combinations = result.combinations;
      warKrsState.activePlan = result.combinations[0];
    } else {
      App.util.warLog('warn', 'Tidak ditemukan kombinasi bebas bentrok sempurna. Mengizinkan alternatif...');
      warKrsState.combinations = [];
      warKrsState.activePlan = null;
    }

    // Tandai keandalan jadwal tiap kombinasi: klaim "bebas bentrok" hanya sah
    // bila portal benar-benar merilis hari/jam DAN solver menemukan slot nyata.
    warKrsState.combinations.forEach(annotatePlanReliability);
    annotatePlanReliability(warKrsState.activePlan);
    if (warKrsState.activePlan && !warKrsState.activePlan.hasSchedule) {
      App.util.warLog('warn', 'Rencana tersusun dari paket kelas tanpa hari/jam dari portal — rencana ditandai "paket tanpa jadwal", klaim bebas bentrok tidak ditampilkan.');
    }
    if (warKrsState.activePlan && warKrsState.activePlan.hasConflict) {
      App.util.warLog('warn', `Rencana terpilih masih mengandung ${warKrsState.activePlan.conflictCount} bentrok jadwal — ${warKrsState.activePlan.conflictSummary}. Klaim bebas bentrok tidak ditampilkan.`);
    }

    // Update SKS status text dinamis di kartu overview
    const statusTextEl = $('krs-sks-status-text');
    if (statusTextEl && warKrsState.activePlan?.metrics) {
      const mkCount = (warKrsState.activePlan.selectedClasses || warKrsState.activePlan.classes || []).length;
      statusTextEl.textContent = `${mkCount} Matkul • ${warKrsState.activePlan.metrics.totalSks} SKS`;
    }
  }

  // Tandai keandalan sebuah rencana: apakah ia punya jadwal riil, dan apakah ia
  // benar-benar bebas bentrok. `hasSchedule === false` berarti rencana hanyalah
  // "paket kelas" (matkul + huruf kelas) yang masih sah dikirim ke portal, tetapi
  // TIDAK boleh dipresentasikan sebagai jadwal bebas bentrok.
  // `canClaimConflictFree` adalah satu-satunya gate klaim "Bebas Bentrok"/"0% Bentrok":
  // `hasSchedule` saja tidak cukup karena solver bisa mengembalikan kombinasi fallback
  // yang masih bertabrakan (lihat lib/krs-scheduler.js jalur BLOCK_CLASS).
  function annotatePlanReliability(plan) {
    if (!plan) return false;
    const report = resolveConflictReport(plan);
    const totalDays = (plan.metrics && Number(plan.metrics.totalDays)) || 0;
    plan.hasSchedule = Boolean(warKrsState.hasScheduleData) && totalDays > 0;
    plan.conflictReport = report;
    plan.hasConflict = Boolean(report.hasConflict);
    plan.conflictCount = report.conflictCount || 0;
    plan.conflictSummary = describeConflict(report);
    plan.canClaimConflictFree = plan.hasSchedule && !plan.hasConflict;
    return plan.hasSchedule;
  }

  // Laporan bentrok untuk kelas terpilih; pakai laporan yang sudah tersimpan di plan
  // agar UI tidak menghitung ulang dan hasilnya konsisten lintas modul.
  function resolveConflictReport(plan) {
    if (!plan) return { hasConflict: false, conflictCount: 0, conflicts: [] };
    if (plan.conflictReport) return plan.conflictReport;
    const Scheduler = window.KrsScheduler;
    const planClasses = (plan.selectedClasses || plan.classes) || [];
    if (!Scheduler || planClasses.length === 0) return { hasConflict: false, conflictCount: 0, conflicts: [] };
    return Scheduler.detectConflicts(planClasses) || { hasConflict: false, conflictCount: 0, conflicts: [] };
  }

  // Deskripsi singkat tabrakan pertama untuk log/narasi banner.
  function describeConflict(report) {
    if (!report || !report.hasConflict || !Array.isArray(report.conflicts) || report.conflicts.length === 0) return '';
    const first = report.conflicts[0];
    if (!first || !first.classA || !first.classB) return '';
    return `Tabrakan jam pada hari ${first.day}: ${first.classA.nama} (${first.classA.kelas}) vs ${first.classB.nama} (${first.classB.kelas})`;
  }

  // Enrich informasi slot: identifikasi Teori vs Praktik, Back-to-Back, dan Murni Teori
  function enrichSlotInfo(slot, daySlots = [], courseMap = {}) {
    const course = courseMap[slot.courseKode] || {};
    let sessionType = (slot.sessionType || '').toUpperCase();

    // Fallback deteksi jika sessionType belum ada dari scheduler
    if (!sessionType) {
      const ruangLower = String(slot.ruang || '').toLowerCase();
      if (ruangLower.includes('lab') || ruangLower.includes('praktik') || /praktek|praktik/i.test(slot.courseNama || '')) {
        sessionType = 'PRAKTIK';
      } else {
        sessionType = 'TEORI';
      }
    }

    // Cari slot lain dari matkul yang sama di hari ini
    const sameCourseSlots = daySlots.filter((s) => s.courseKode === slot.courseKode);

    // Murni teori jika matkul ini murni teori (1 sesi/komponen)
    const isPureTheory = Boolean(
      slot.componentCount === 1 ||
      slot.isPureTheory ||
      course.isPureTheory ||
      (sameCourseSlots.length === 1 && sessionType === 'TEORI' && !course.classes?.some((c) => c.sessions?.length > 1))
    );

    // Deteksi back-to-back: jika ada 2 sesi untuk matkul yang sama di hari yang sama
    let isB2bHead = false;
    let isB2bTail = false;
    if (sameCourseSlots.length >= 2) {
      const sorted = sameCourseSlots.slice().sort((a, b) => (a.startMin || 0) - (b.startMin || 0));
      if (sorted[0] === slot) isB2bHead = true;
      if (sorted[sorted.length - 1] === slot) isB2bTail = true;
    }

    return {
      sessionType,
      isPureTheory,
      isB2bHead,
      isB2bTail,
      isBackToBack: isB2bHead || isB2bTail
    };
  }

  // Render Mini Jadwal Simulator & Indikator Bentrok Visual (Senin - Sabtu)
  function renderTimetableGrid(plan) {
    const grid = $('timetable-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Rencana yang belum dianotasi (mis. kombinasi mentah dari modul lain) dianotasi
    // di sini supaya keputusan klaim selalu berbasis data yang sama.
    if (plan && plan.hasSchedule === undefined) annotatePlanReliability(plan);

    // Bentrok riil dihitung sekali; dipakai badge, kartu slot, dan narasi banner.
    const conflictReport = resolveConflictReport(plan);
    const planHasSchedule = Boolean(plan && plan.hasSchedule);
    const planHasConflict = Boolean(conflictReport.hasConflict);

    // Badge klaim jadwal hanya boleh menyatakan "Bebas Bentrok" bila jadwal nyata ada
    // DAN tidak ada tabrakan. Selain itu teksnya netral atau jujur menyebut bentrok.
    const resultBadge = $('krs-result-badge');
    if (resultBadge) {
      if (planHasSchedule && !planHasConflict) {
        resultBadge.className = 'badge badge-success';
        resultBadge.textContent = '✓ 100% Bebas Bentrok';
      } else if (planHasSchedule && planHasConflict) {
        resultBadge.className = 'badge badge-danger';
        resultBadge.textContent = `⚠️ ${conflictReport.conflictCount || plan.conflictCount || 0} Bentrok Terdeteksi`;
      } else {
        resultBadge.className = 'badge badge-outline';
        resultBadge.textContent = 'Belum ada jadwal';
      }
    }

    const daysList = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const timetable = (plan && plan.timetable) ? plan.timetable : {};

    // Tanpa satu pun slot berhari/jam, tidak ada jadwal yang bisa digambar.
    // Grid kosong menyiratkan "bebas bentrok" — jelaskan apa adanya.
    const hasAnySlot = daysList.some((dayName) => Array.isArray(timetable[dayName]) && timetable[dayName].length > 0);
    if (!hasAnySlot) {
      const emptyNote = document.createElement('div');
      emptyNote.className = 'loading-state';
      emptyNote.style.gridColumn = '1 / -1';
      emptyNote.textContent = '📭 Jadwal kelas belum dirilis portal. Rencana ini baru berupa paket mata kuliah & kelas tanpa hari/jam, jadi simulator jadwal dan status bebas bentrok belum bisa ditampilkan.';
      grid.appendChild(emptyNote);
      return;
    }

    const courseMap = {};
    (warKrsState.offeringCourses || []).forEach((c) => {
      courseMap[c.kode] = c;
    });

    // Tandai kelas yang bertabrakan untuk highlight kartu slot
    const clashingClassNames = new Set();
    if (planHasConflict) {
      (conflictReport.conflicts || []).forEach((c) => {
        if (c.classA) {
          if (c.classA.id) clashingClassNames.add(c.classA.id);
          if (c.classA.kode) clashingClassNames.add(c.classA.kode);
          if (c.classA.nama) clashingClassNames.add(c.classA.nama);
        }
        if (c.classB) {
          if (c.classB.id) clashingClassNames.add(c.classB.id);
          if (c.classB.kode) clashingClassNames.add(c.classB.kode);
          if (c.classB.nama) clashingClassNames.add(c.classB.nama);
        }
      });
    }

    // Buat Kolom Hari (Senin - Sabtu)
    daysList.forEach((dayName, dayIdx) => {
      const col = document.createElement('div');
      col.className = 'day-column';

      const slots = timetable[dayName] || [];
      const hasCourses = slots.length > 0;

      const header = document.createElement('div');
      header.className = `day-header ${hasCourses ? 'has-courses' : ''}`;
      const shortName = dayName.slice(0, 3).toUpperCase();
      header.textContent = `${shortName} (${slots.length})`;
      col.appendChild(header);

      const body = document.createElement('div');
      body.className = 'day-body';

      // Urutkan slot berdasarkan startMin
      const sortedSlots = slots.slice().sort((a, b) => (a.startMin || 0) - (b.startMin || 0));

      sortedSlots.forEach((slot, slotIdx) => {
        const card = document.createElement('div');
        const isClashing = planHasConflict && (
          clashingClassNames.has(slot.classId) ||
          clashingClassNames.has(slot.id) ||
          clashingClassNames.has(slot.courseKode) ||
          clashingClassNames.has(slot.courseNama)
        );
        const colorClass = `course-c-${(slotIdx + dayIdx) % 8}`;

        // Deteksi tipe sesi dan hubungan back-to-back
        const slotDetail = enrichSlotInfo(slot, sortedSlots, courseMap);
        
        let sessionClass = '';
        if (slotDetail.isPureTheory) {
          sessionClass = 'is-pure-theory';
        } else if (slotDetail.sessionType === 'PRAKTIK') {
          sessionClass = 'is-practice';
        } else {
          sessionClass = 'is-theory';
        }

        let b2bClass = '';
        if (slotDetail.isB2bHead) b2bClass = 'b2b-head';
        else if (slotDetail.isB2bTail) b2bClass = 'b2b-tail';

        card.className = `class-slot-card ${colorClass} ${sessionClass} ${b2bClass} ${isClashing ? 'slot-conflict' : ''}`;
        if (slot.color && !isClashing) {
          card.style.borderLeftColor = slot.color;
        }

        // Header: Nama Matkul & SKS Tag
        const titleRow = document.createElement('div');
        titleRow.style.display = 'flex';
        titleRow.style.justifyContent = 'space-between';
        titleRow.style.alignItems = 'center';
        titleRow.style.gap = '4px';

        const title = document.createElement('div');
        title.className = 'slot-title';
        title.textContent = slot.courseNama || slot.courseKode;
        title.title = `${slot.courseNama} (${slot.courseKode}) - Kelas ${slot.kelas || 'A'}`;

        const sksBadge = document.createElement('span');
        sksBadge.className = 'slot-sks-tag';
        const sksVal = slot.sks || (courseMap[slot.courseKode]?.sks) || 3;

        const isB2bHead = Boolean(slot.isB2bHead || slotDetail.isB2bHead);
        const isB2bTail = Boolean(slot.isB2bTail || slotDetail.isB2bTail);
        const isBackToBack = Boolean(slot.isBackToBack || slotDetail.isBackToBack || isB2bHead || isB2bTail);
        const isPureTheory = Boolean(slot.isPureTheory || slotDetail.isPureTheory);

        if (isB2bHead) {
          sksBadge.textContent = `${sksVal} SKS (Paket)`;
          sksBadge.title = `Total ${sksVal} SKS mencakup sesi Teori & Praktik (tidak dihitung dobel)`;
        } else if (isB2bTail) {
          sksBadge.className = 'slot-sks-tag slot-sks-linked';
          sksBadge.textContent = '🔗 1 Paket';
          sksBadge.title = `SKS praktikum sudah termasuk dalam ${sksVal} SKS paket matkul`;
        } else if (isPureTheory) {
          sksBadge.textContent = `${sksVal} SKS (Murni)`;
          sksBadge.title = `${sksVal} SKS Murni Teori`;
        } else {
          sksBadge.textContent = `${sksVal} SKS`;
        }

        titleRow.appendChild(title);
        titleRow.appendChild(sksBadge);

        // Jam Kuliah
        const time = document.createElement('div');
        time.className = 'slot-time';
        time.textContent = `${slot.startTime || slot.timeStr || ''}`;

        // Label Sesi Jelas: [Teori: Ruang] vs [Praktik: Lab]
        const sessionTag = document.createElement('div');
        if (slotDetail.isPureTheory) {
          sessionTag.className = 'slot-session-tag tag-pure';
          sessionTag.textContent = `📄 Teori: ${slot.ruang || '-'}`;
        } else if (slotDetail.sessionType === 'PRAKTIK') {
          sessionTag.className = 'slot-session-tag tag-practice';
          sessionTag.textContent = `🧪 Praktik: ${slot.ruang || 'Lab'}`;
        } else {
          sessionTag.className = 'slot-session-tag tag-theory';
          sessionTag.textContent = `📘 Teori: ${slot.ruang || '-'}`;
        }

        // Back-to-back indicator jika bersambung di hari yang sama
        let b2bTag = null;
        if (slot.isBackToBack || slotDetail.isBackToBack || isBackToBack) {
          b2bTag = document.createElement('div');
          b2bTag.className = 'slot-b2b-badge';
          const b2bLbl = slot.b2bLabel || (isB2bHead ? 'Bersambung ke Praktik' : 'Bersambung dari Teori');
          b2bTag.innerHTML = `<span>🔗</span> ${b2bLbl}`;
        }

        // Meta Footer: Kelas & Ruangan
        const meta = document.createElement('div');
        meta.className = 'slot-meta';

        const clsBadge = document.createElement('span');
        clsBadge.className = 'slot-class-badge';
        clsBadge.textContent = `[${slot.kelas || slot.classLetter || 'A'}]`;

        const room = document.createElement('span');
        room.textContent = slot.ruang || '-';

        meta.appendChild(clsBadge);
        meta.appendChild(room);

        card.appendChild(titleRow);
        card.appendChild(time);
        card.appendChild(sessionTag);
        if (b2bTag) card.appendChild(b2bTag);
        card.appendChild(meta);

        if (isClashing) {
          const conflictTag = document.createElement('div');
          conflictTag.className = 'conflict-tag-mini';
          conflictTag.textContent = '⚠️ BENTROK';
          card.appendChild(conflictTag);
        }

        body.appendChild(card);
      });

      col.appendChild(body);
      grid.appendChild(col);
    });
  }

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.krsPlan = {
    runWarKrsOptimization,
    enrichSlotInfo,
    renderTimetableGrid
  };
})();
