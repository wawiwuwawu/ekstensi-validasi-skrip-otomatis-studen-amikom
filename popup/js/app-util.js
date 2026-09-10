/**
 * Amikom Student Assistant - Popup Modul APP-UTIL (v2.0 Modular)
 * Namespace App.util: showToast, log, warLog, classifyPortalHtmlResponse.
 * Hasil modularisasi popup/popup.js (closure DOMContentLoaded) -> popup/js/*.
 */
(function () {
  'use strict';

  function showToast(message, type = 'info') {
    const App = window.AppKrs;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    const container = App.core.$('toast-container');
    if (container) container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function log(type, message) {
    const App = window.AppKrs;
    const terminal = App.core.$('terminal-console');
    if (!terminal) return;

    const timeStr = new Date().toTimeString().split(' ')[0];
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const badgeMap = { success: '[OK]', warn: '[WARN]', error: '[ERR]' };
    const badge = badgeMap[type] || '[INFO]';

    entry.textContent = `[${timeStr}] ${badge} ${message}`;
    terminal.appendChild(entry);
    terminal.scrollTop = terminal.scrollHeight;
  }

  // Logger khusus Terminal War KRS
  function warLog(type, message) {
    const App = window.AppKrs;
    const terminal = App.core.$('war-terminal-console');
    if (!terminal) return;
    const timeStr = new Date().toTimeString().split(' ')[0];
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const badgeMap = {
      success: '[OK]',
      warn: '[WARN]',
      error: '[ERR]',
      fire: '[FIRE]',
      armed: '[ARMED]',
      sync: '[SYNC]'
    };
    const badge = badgeMap[type] || '[INFO]';
    entry.textContent = `[${timeStr}] ${badge} ${message}`;
    terminal.appendChild(entry);
    terminal.scrollTop = terminal.scrollHeight;
  }

  // Klasifikasi respon HTML dari act=rencana_studi
  function classifyPortalHtmlResponse(rawHtml) {
    const lower = (rawHtml || '').toLowerCase();
    if (lower.includes('alert-success') || lower.includes('berhasil') || lower.includes('sukses')) {
      return { outcome: 'SUCCESS', message: 'Berhasil' };
    }
    if (lower.includes('sudah terisi') || lower.includes('telah diambil') || lower.includes('duplikat')) {
      return { outcome: 'DUPLICATE', message: 'Sudah terisi' };
    }
    if (lower.includes('penuh') || lower.includes('kuota')) {
      return { outcome: 'CLASS_FULL', message: 'Kuota penuh' };
    }
    if (lower.includes('bentrok') || lower.includes('aturan') || lower.includes('tidak memenuhi')) {
      return { outcome: 'REJECTED', message: 'Bentrok jadwal' };
    }
    if (lower.includes('belum dibuka') || lower.includes('tutup')) {
      return { outcome: 'NOT_OPEN', message: 'Belum dibuka' };
    }
    if (lower.includes('name="pengguna"') || lower.includes('session_expired')) {
      return { outcome: 'SESSION_EXPIRED', message: 'Sesi habis' };
    }
    return { outcome: 'SUCCESS', message: 'Terkirim' };
  }

  window.AppKrs = window.AppKrs || {};
  window.AppKrs.util = {
    showToast,
    log,
    warLog,
    classifyPortalHtmlResponse
  };
})();
