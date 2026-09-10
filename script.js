/**
 * Amikom Student Assistant - Content Script (v2.0 Minimalist)
 * Floating Action Pill di portal student.amikompurwokerto.ac.id
 * Direct API Engine: cepat, tanpa reload, tanpa simulasi DOM yang rentan.
 */
(function () {
  'use strict';

  if (window.__amikomAssistantInjected) return;
  window.__amikomAssistantInjected = true;

  console.log('%c⚡ Amikom Student Assistant Aktif', 'background: #6d28d9; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;');

  const api = window.AmikomAPI ? new window.AmikomAPI() : null;

  const state = {
    isRunning: false,
    unvalidatedTotal: 0
  };

  // Feedback visual non-blocking pengganti modal alert()
  function showInPageNotification(msg, type = 'success') {
    let toast = document.getElementById('ast-inpage-notification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ast-inpage-notification';
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000000;
        padding: 9px 15px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 10px 25px rgba(0,0,0,0.6);
        transition: opacity 0.25s ease, transform 0.25s ease;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }
    const isSuccess = type === 'success';
    toast.style.background = isSuccess ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #b91c1c)';
    toast.style.color = '#ffffff';
    toast.style.border = isSuccess ? '1px solid #34d399' : '1px solid #f87171';
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
      }
    }, 2800);
  }

  function injectFloatingWidget() {
    // Bersihkan elemen lama jika ada
    const oldPill = document.getElementById('amikom-assistant-widget');
    if (oldPill) oldPill.remove();
    const oldStyle = document.getElementById('amikom-assistant-styles');
    if (oldStyle) oldStyle.remove();

    // Style terpadu: Floating Action Pill
    const style = document.createElement('style');
    style.id = 'amikom-assistant-styles';
    style.textContent = `
      #amikom-assistant-widget {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        user-select: none;
      }
      .ast-dock {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #0b0f19;
        border: 1px solid #2b384e;
        padding: 5px 10px;
        border-radius: 9999px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .ast-dock:hover {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      }
      .ast-pill-brand {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #f8fafc;
        font-weight: 700;
        padding: 0 4px;
        cursor: pointer;
      }
      .ast-icon { font-size: 14px; }
      .ast-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 9999px;
        background: #ef4444;
        color: #ffffff;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .ast-badge.green { background: #10b981; }
      .ast-btn {
        border: none;
        border-radius: 9999px;
        padding: 6px 13px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #ffffff;
        transition: all 0.15s ease;
      }
      .ast-btn:hover:not(:disabled) {
        opacity: 0.92;
        transform: translateY(-1px);
      }
      .ast-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .ast-btn-purple {
        background: linear-gradient(135deg, #7c3aed, #9333ea);
        box-shadow: 0 2px 8px rgba(124, 58, 237, 0.35);
      }
      .ast-btn-refresh {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 12px;
        padding: 3px 6px;
        border-radius: 9999px;
        cursor: pointer;
        transition: color 0.15s ease, transform 0.25s ease;
      }
      .ast-btn-refresh:hover {
        color: #ffffff;
        transform: rotate(180deg);
      }
    `;
    document.head.appendChild(style);

    // Render Widget Dock
    const widget = document.createElement('div');
    widget.id = 'amikom-assistant-widget';
    widget.innerHTML = `
      <div class="ast-dock">
        <div class="ast-pill-brand" id="ast-brand-btn" title="Amikom Student Assistant (Klik untuk cek status)">
          <span class="ast-icon">⚡</span>
          <span id="ast-label-text">Amikom</span>
        </div>
        <span class="ast-badge" id="ast-badge" title="Status validasi presensi (Klik untuk segarkan)">...</span>
        <button class="ast-btn ast-btn-purple" id="ast-action-btn" title="Validasi presensi dosen & asdos otomatis via Direct API">
          🚀 Presensi
        </button>
        <button class="ast-btn-refresh" id="ast-refresh-btn" title="Segarkan status presensi">
          🔄
        </button>
      </div>
    `;
    document.body.appendChild(widget);

    // Event listeners
    document.getElementById('ast-action-btn')?.addEventListener('click', runValidation);
    document.getElementById('ast-refresh-btn')?.addEventListener('click', checkStatus);
    document.getElementById('ast-badge')?.addEventListener('click', checkStatus);
    document.getElementById('ast-brand-btn')?.addEventListener('click', checkStatus);

    // Cek status presensi awal
    checkStatus();
  }

  async function checkStatus() {
    const badge = document.getElementById('ast-badge');
    const actionBtn = document.getElementById('ast-action-btn');
    if (!badge || !actionBtn) return;
    if (!api) {
      badge.textContent = '!';
      badge.title = 'Modul AmikomAPI tidak terdeteksi';
      return;
    }

    try {
      const data = await api.listMakulBelumValidasi();
      const keys = Object.keys(data || {});
      let count = 0;
      keys.forEach((k) => (count += data[k].count || 0));
      state.unvalidatedTotal = count;

      if (count > 0) {
        badge.className = 'ast-badge';
        badge.textContent = `${count} Sesi`;
        actionBtn.disabled = false;
        actionBtn.innerHTML = `🚀 Validasi (${count})`;
      } else {
        badge.className = 'ast-badge green';
        badge.textContent = '✓ Bersih';
        actionBtn.disabled = true;
        actionBtn.innerHTML = '✓ Tervalidasi';
      }
    } catch (e) {
      badge.className = 'ast-badge';
      badge.textContent = '!';
      actionBtn.title = 'Gagal memuat status: periksa koneksi atau status login';
    }
  }

  async function runValidation() {
    if (state.isRunning || !api) return;
    state.isRunning = true;

    const actionBtn = document.getElementById('ast-action-btn');
    const labelText = document.getElementById('ast-label-text');
    if (actionBtn) actionBtn.disabled = true;

    try {
      showInPageNotification('⚡ Memulai validasi presensi otomatis...', 'success');
      await api.autoValidateAll({
        dosenRating: '3',
        asdosPreset: 'default',
        delayMs: 600,
        onProgress: (p) => {
          if (actionBtn) actionBtn.textContent = `⚙️ ${p.percent}%`;
          if (labelText) labelText.textContent = `${p.current}/${p.total}`;
        }
      });
      await checkStatus();
      showInPageNotification('🎉 Validasi presensi berhasil diselesaikan!', 'success');
    } catch (err) {
      showInPageNotification(`Kendala validasi: ${err.message}`, 'error');
    } finally {
      state.isRunning = false;
      if (labelText) labelText.textContent = 'Amikom';
      await checkStatus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingWidget);
  } else {
    injectFloatingWidget();
  }
})();
