// =========================================================
// GEETA AUDIO SYNC TOOL
// - Large JSON parsing via Worker
// - Batched row rendering
// - Global HTML handlers exposed safely
// - Presentation mode
// - Share sheet with QR
// - Elegant busy overlay
// - Audio error toast
// =========================================================

(function () {
  'use strict';

  const QR_LOGO_URL =
    'https://raw.githubusercontent.com/GEETAASHRAM/THAILAND/refs/heads/main/gat_library/images/swamiharihar_ji_maharaj_transparent.png';

  // -------------------------------------------------------
  // Built-in audio options for searchable dropdown
  // -------------------------------------------------------
  const AUDIO_OPTIONS = [
    {
      text: '0.1) Geeta Ashram Mission & Introduction',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/01%20-%20Introduction.mp3'
    },
    {
      text: '0.2) Geeta Mahatmyam',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/20%20-%20Geeta%20Mahatmyam.mp3'
    },
    {
      text: '1) Geeta Chapter 1',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/02%20-%20Chapter%201.mp3'
    },
    {
      text: '2) Geeta Chapter 2',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/03%20-%20Chapter%202.mp3'
    },
    {
      text: '3) Geeta Chapter 3',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/04%20-%20Chapter%203.mp3'
    },
    {
      text: '4) Geeta Chapter 4',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/05%20-%20Chapter%204.mp3'
    },
    {
      text: '5) Geeta Chapter 5',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/06%20-%20Chapter%205.mp3'
    },
    {
      text: '6) Geeta Chapter 6',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/07%20-%20Chapter%206.mp3'
    },
    {
      text: '7) Geeta Chapter 7',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/08%20-%20Chapter%207.mp3'
    },
    {
      text: '8) Geeta Chapter 8',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/09%20-%20Chapter%208.mp3'
    },
    {
      text: '9) Geeta Chapter 9',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/10%20-%20Chapter%209.mp3'
    },
    {
      text: '10) Geeta Chapter 10',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/11%20-%20Chapter%2010.mp3'
    },
    {
      text: '11) Geeta Chapter 11',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/12%20-%20Chapter%2011.mp3'
    },
    {
      text: '12) Geeta Chapter 12',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/13%20-%20Chapter%2012.mp3'
    },
    {
      text: '13) Geeta Chapter 13',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/14%20-%20Chapter%2013.mp3'
    },
    {
      text: '14) Geeta Chapter 14',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/15%20-%20Chapter%2014.mp3'
    },
    {
      text: '15) Geeta Chapter 15',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/16%20-%20Chapter%2015.mp3'
    },
    {
      text: '16) Geeta Chapter 16',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/17%20-%20Chapter%2016.mp3'
    },
    {
      text: '17) Geeta Chapter 17',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/18%20-%20Chapter%2017.mp3'
    },
    {
      text: '18) Geeta Chapter 18',
      value: 'https://github.com/GEETAASHRAM/THAILAND/raw/refs/heads/main/audio_files/19%20-%20Chapter%2018.mp3'
    }
  ];

  // -------------------------------------------------------
  // Global helper for strict chunk bounds
  // -------------------------------------------------------
  window.enforceChunkBounds = function (audioElem, start, end) {
    if (!audioElem) return;
    if (end > 0 && audioElem.currentTime >= end) {
      audioElem.pause();
      audioElem.currentTime = start;
    }
  };

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  let startTime = null;
  let activeVerseIndex = 0;
  let isGeetaMode = false;
  let historyStack = [];
  let redoStack = [];
  let activeRowElem = null;
  let presentationIndex = 0;
  let presentationMonitor = null;
  let stringifyTimer = null;

  let audioPlayer = null;
  let tableBody = null;
  let jsonInput = null;
  let prefixInput = null;
  let suffixInput = null;
  let fileUrlInput = null;
  let fileInput = null;
  let progressBar = null;
  let progressText = null;
  let tableSearch = null;
  let floatPlayBtn = null;
  let floatMarkBtn = null;
  let floatUndoBtn = null;
  let floatRedoBtn = null;
  let floatDeleteBtn = null;
  let searchCountDisplay = null;

  let currentGeetaData = null;
  let currentSystemFile = null;
  let jsonWorker = null;
  let currentSharePayload = null;

  let lastRenderedQrUrl = '';
  let currentQrRenderPromise = Promise.resolve();


  // -------------------------------------------------------
  // Utility
  // -------------------------------------------------------
  function safeNum(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(str = '') {
    return escapeHtml(str).replace(/\n/g, '<br>');
  }

  function formatTime(s) {
    if (!Number.isFinite(s)) return '00:00';
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  function generateName(i, v = null) {
    if (v) return `${v.Topic || 'Topic'}_C${v.Chapter}_V${v.VerseNum}`;
    return `${prefixInput?.value || ''}${i}${suffixInput?.value || ''}`;
  }

  function showToast(message, type = 'info', timeout = 3500) {
    const root = document.getElementById('toastRoot');
    if (!root) return;

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast--${type}`;
    toast.innerHTML = `
      <div class="app-toast__body">${message}</div>
      <button class="app-toast__close" aria-label="Close">×</button>
    `;

    const cleanup = () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    };

    toast.querySelector('.app-toast__close')?.addEventListener('click', cleanup);
    root.appendChild(toast);
    window.setTimeout(cleanup, timeout);
  }

  function showBusyOverlay(message = 'Loading...') {
    const overlay = document.getElementById('busyOverlay');
    const text = document.getElementById('busyText');
    if (text) text.textContent = message;
    if (overlay) overlay.classList.remove('hidden');
  }

  function hideBusyOverlay() {
    const overlay = document.getElementById('busyOverlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function idle(fn, timeout = 500) {
    if ('requestIdleCallback' in window) {
      return window.requestIdleCallback(fn, { timeout });
    }
    return setTimeout(fn, 60);
  }

  function setLoading(flag, text = 'Loading large JSON... Please wait.') {
    const loadingIndicator = document.getElementById('loadingIndicator');

    if (loadingIndicator) {
      loadingIndicator.textContent = text;
      loadingIndicator.classList.toggle('hidden', !flag);
    }

    if (flag) showBusyOverlay(text);
    else hideBusyOverlay();
  }

  function fitKaraokeTextToViewport(contentEl, lyricsEl, englishEl) {
    if (!contentEl || !lyricsEl || !englishEl) return;

    lyricsEl.style.fontSize = '';
    englishEl.style.fontSize = '';
    lyricsEl.style.lineHeight = '';
    englishEl.style.lineHeight = '';

    const contentMax = Math.max(220, window.innerHeight - 240);

    let lyricsSize = parseFloat(getComputedStyle(lyricsEl).fontSize) || 44;
    let englishSize = parseFloat(getComputedStyle(englishEl).fontSize) || 24;

    const minLyrics = 22;
    const minEnglish = 15;

    let guard = 0;
    while (contentEl.scrollHeight > contentMax && guard < 18) {
      if (lyricsSize > minLyrics) {
        lyricsSize -= 2;
        lyricsEl.style.fontSize = `${lyricsSize}px`;
        lyricsEl.style.lineHeight = '1.35';
      }

      if (contentEl.scrollHeight <= contentMax) break;

      if (englishSize > minEnglish) {
        englishSize -= 1;
        englishEl.style.fontSize = `${englishSize}px`;
        englishEl.style.lineHeight = '1.55';
      }

      guard++;
    }

    if (contentEl.scrollHeight > contentMax) {
      contentEl.style.overflowY = 'auto';
    } else {
      contentEl.style.overflowY = 'hidden';
    }
  }

  window.addEventListener('resize', () => {
    const content = document.getElementById('karaokeContent') || document.getElementById('kContent');
    const lyrics = document.getElementById('kLyrics');
    const english = document.getElementById('kEnglish');
    if (content && lyrics && english) {
      fitKaraokeTextToViewport(content, lyrics, english);
    }
  });

  // -------------------------------------------------------
  // JSON worker
  // -------------------------------------------------------
  function initWorker() {
    try {
      if ('Worker' in window) {
        jsonWorker = new Worker('gat_library/js/json_worker.js');
      }
    } catch (error) {
      console.warn('Worker init failed. Falling back to main thread.', error);
      jsonWorker = null;
    }
  }

  function workerRequest(type, payload) {
    return new Promise((resolve, reject) => {
      if (!jsonWorker) {
        try {
          if (type === 'parse') {
            resolve(typeof payload === 'string' ? JSON.parse(payload) : payload);
          } else if (type === 'stringify') {
            resolve(JSON.stringify(payload, null, 2));
          } else {
            reject(new Error(`Unsupported worker request type: ${type}`));
          }
        } catch (error) {
          reject(error);
        }
        return;
      }

      const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const listener = e => {
        if (!e.data || e.data.id !== id) return;

        jsonWorker.removeEventListener('message', listener);

        if (e.data.ok) resolve(e.data.data);
        else reject(new Error(e.data.error || 'Worker error'));
      };

      jsonWorker.addEventListener('message', listener);
      jsonWorker.postMessage({ id, type, payload });
    });
  }

  // -------------------------------------------------------
  // DOM caching
  // -------------------------------------------------------
  function cacheElements() {
    audioPlayer = document.getElementById('audioPlayer');
    tableBody = document.querySelector('#timestampsTable tbody');
    jsonInput = document.getElementById('jsonDataInput');
    prefixInput = document.getElementById('prefixInput');
    suffixInput = document.getElementById('suffixInput');
    fileUrlInput = document.getElementById('fileUrlInput');
    fileInput = document.getElementById('fileInput');
    progressBar = document.getElementById('progressBar');
    progressText = document.getElementById('progressText');
    tableSearch = document.getElementById('tableSearch');
    floatPlayBtn = document.getElementById('floatPlayBtn');
    floatMarkBtn = document.getElementById('floatMarkBtn');
    floatUndoBtn = document.getElementById('floatUndoBtn');
    floatRedoBtn = document.getElementById('floatRedoBtn');
    floatDeleteBtn = document.getElementById('floatDeleteBtn');

    if (tableSearch && !searchCountDisplay) {
      searchCountDisplay = document.createElement('div');
      searchCountDisplay.style.fontWeight = 'bold';
      searchCountDisplay.style.color = '#007BFF';
      searchCountDisplay.style.marginBottom = '10px';
      tableSearch.parentNode.insertBefore(searchCountDisplay, tableSearch.nextSibling);
    }
  }

  // -------------------------------------------------------
  // Global functions exposed for inline HTML handlers
  // -------------------------------------------------------
  async function loadAudio() {
    try {
      if ((!fileUrlInput || !fileUrlInput.value) && (!fileInput || !fileInput.files.length)) {
        showToast('Please provide an audio source first.', 'warning');
        return;
      }

      clearToolState({ keepJson: false });

      if (jsonInput) jsonInput.value = '';
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = 'Progress: 0/0 (0%)';
      if (searchCountDisplay) searchCountDisplay.textContent = '';

      if (!audioPlayer) return;

      audioPlayer.onloadedmetadata = () => {
        updateProgress();
      };

      if (fileUrlInput && fileUrlInput.value.trim()) {
        audioPlayer.src = fileUrlInput.value.trim();
        audioPlayer.load();
      } else if (fileInput && fileInput.files.length) {
        const reader = new FileReader();
        reader.onload = ev => {
          audioPlayer.src = ev.target.result;
          audioPlayer.load();
        };
        reader.readAsDataURL(fileInput.files[0]);
      }

      showToast('Audio source loaded.', 'success');
    } catch (error) {
      console.error('loadAudio error:', error);
      showToast('Failed to load audio source.', 'error');
    }
  }

  async function loadSystemJson(filePath) {
    if (!filePath) return;

    try {
      setLoading(true, 'Loading system JSON...');

      const response = await fetch(filePath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to load ${filePath} (${response.status})`);

      const text = await response.text();
      currentSystemFile = filePath;

      if (jsonInput) jsonInput.value = text;

      const parsed = await workerRequest('parse', text);
      await loadJsonData(parsed);

      showToast('System JSON loaded.', 'success');
    } catch (error) {
      console.error('loadSystemJson error:', error);
      showToast(`Failed to load ${filePath}.`, 'error', 5000);

      const select = document.getElementById('systemJsonSelect');
      if (select) select.selectedIndex = 0;
    } finally {
      setLoading(false);
    }
  }

  async function loadJsonFile(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      setLoading(true, 'Parsing local JSON...');

      const reader = new FileReader();
      reader.onload = async ev => {
        try {
          const text = ev.target.result;
          if (jsonInput) jsonInput.value = text;

          const parsed = await workerRequest('parse', text);
          await loadJsonData(parsed);

          showToast('Local JSON loaded.', 'success');
        } catch (error) {
          console.error('loadJsonFile parse error:', error);
          showToast('Failed to parse local JSON.', 'error');
        } finally {
          setLoading(false);
        }
      };

      reader.readAsText(file);
    } catch (error) {
      console.error('loadJsonFile error:', error);
      showToast('Failed to load local JSON file.', 'error');
      setLoading(false);
    }
  }

  async function loadJsonData(data) {
    try {
      setLoading(true, 'Rendering JSON...');

      if (typeof data === 'string') {
        data = await workerRequest('parse', data);
      }

      clearToolState({ keepJson: true });

      if (Array.isArray(data)) {
        isGeetaMode = true;
        currentGeetaData = data;
        await renderGeetaRowsBatched(data);
        focusFirstIncompleteVerse(data);
      } else {
        isGeetaMode = false;
        currentGeetaData = null;
        renderNormalJson(data);
      }

      updateProgress();
      scheduleJsonSync();
    } catch (error) {
      console.error('loadJsonData error:', error);
      showToast('Failed to load JSON data.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function copyShareLink() {
    try {
      if (!currentSystemFile) {
        showToast('Please load a system JSON first.', 'warning');
        return;
      }

      const shareUrl = `${window.location.origin}${window.location.pathname}?file=${encodeURIComponent(currentSystemFile)}`;
      const message =
        `🎧 Bhagavad Gita Audio Sync Tool\n\n` +
        `Open this JSON directly here:\n${shareUrl}\n\n` +
        `Shared from Geeta App`;

      openShareSheet({
        title: 'Bhagavad Gita Audio Sync Tool',
        text: message,
        url: shareUrl
      });
    } catch (error) {
      console.error('copyShareLink error:', error);
      showToast('Failed to create share message.', 'error');
    }
  }

  async function copyJsonData() {
    try {
      const payload = isGeetaMode ? currentGeetaData : buildNormalJsonObject();
      const text = await workerRequest('stringify', payload);

      await navigator.clipboard.writeText(text);
      showToast('JSON copied to clipboard.', 'success');
    } catch (error) {
      console.error('copyJsonData error:', error);
      showToast('Failed to copy JSON.', 'error');
    }
  }

  async function saveData() {
    try {
      const payload = isGeetaMode ? currentGeetaData : buildNormalJsonObject();
      const text = await workerRequest('stringify', payload);

      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = isGeetaMode ? 'geeta_sync.json' : 'audio_sync.json';
      document.body.appendChild(a);
      a.click();
      a.remove();

      showToast('JSON saved.', 'success');
    } catch (error) {
      console.error('saveData error:', error);
      showToast('Failed to save JSON.', 'error');
    }
  }

  window.loadAudio = loadAudio;
  window.loadSystemJson = loadSystemJson;
  window.loadJsonFile = loadJsonFile;
  window.loadJsonData = loadJsonData;
  window.copyShareLink = copyShareLink;
  window.copyJsonData = copyJsonData;
  window.saveData = saveData;

  // -------------------------------------------------------
  // Boot
  // -------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    try {
      cacheElements();
      initWorker();
      injectShareSheet();
      injectPresentationModal();
      bindAudioEvents();
      bindControls();
      populateAudioOptions();
      bindDropdownSearch();

      const params = new URLSearchParams(window.location.search);
      const sharedFile = params.get('file');

      if (sharedFile) {
        const select = document.getElementById('systemJsonSelect');
        if (select) {
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === sharedFile) {
              select.selectedIndex = i;
              break;
            }
          }
        }
        loadSystemJson(sharedFile);
      } else {
        loadAutoSave();
      }
    } catch (error) {
      console.error('Audio sync init error:', error);
      showToast('Failed to initialize Audio Sync Tool.', 'error');
    }
  });

  // -------------------------------------------------------
  // Share sheet with QR
  // -------------------------------------------------------
  function injectShareSheet() {
    const html = `
      <div id="shareSheet" class="share-sheet">
        <div class="share-sheet__panel">
          <div class="share-sheet__title">Share</div>

          <div class="share-sheet__layout">
            <div id="sharePreview" class="share-sheet__preview"></div>

            <div class="share-qr-card">
              <div class="share-qr-card__top">
                <div class="share-qr-title">Scan QR to open</div>
                <div class="share-qr-actions">
                  <button id="shareQrImageBtn" class="share-qr-mini-btn" type="button" title="Share QR image" aria-label="Share QR image">📤</button>
                  <button id="copyQrImageBtn" class="share-qr-mini-btn" type="button" title="Copy QR image" aria-label="Copy QR image">📋</button>
                </div>
              </div>
            
              <div class="share-qr-wrap">
                <div id="shareQrCanvas" width="180" height="180"></div>
                <img id="shareQrLogo" class="share-qr-logo" alt="QR Logo" />
              </div>
            
              <div id="shareQrUrl" class="share-qr-url"></div>
            </div>
          </div>

          <div class="share-grid">
            <button id="shareNativeBtn">📲 Share</button>
            <button id="shareCopyBtn">📋 Copy Message</button>
            <button id="shareWhatsappBtn">🟢 WhatsApp</button>
            <button id="shareTelegramBtn">🔵 Telegram</button>
            <button id="shareEmailBtn">✉️ Email</button>
            <button id="shareCopyLinkBtn">🔗 Copy Link Only</button>
          </div>

          <button id="shareSheetClose" class="share-sheet__close">Close</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const sheet = document.getElementById('shareSheet');

    sheet.addEventListener('click', e => {
      if (e.target === sheet) closeShareSheet();
    });

    document.getElementById('shareSheetClose')?.addEventListener('click', closeShareSheet);
  }

  function getShareQrElements() {
    return {
      wrap: document.querySelector('.share-qr-wrap'),
      canvas: document.getElementById('shareQrCanvas'),
      logo: document.getElementById('shareQrLogo'),
      urlText: document.getElementById('shareQrUrl')
    };
  }

  // function resetShareQrSurface() {
  //   const { wrap, canvas } = getShareQrElements();
  //   if (!wrap || !canvas) return;

  //   const legacy = document.getElementById('shareQrLegacy');
  //   if (legacy) legacy.remove();

  //   canvas.style.display = 'block';

  //   const ctx = canvas.getContext('2d');
  //   if (ctx) {
  //     ctx.clearRect(0, 0, canvas.width, canvas.height);
  //   }
  // }
  function resetShareQrSurface() {
    const { canvas } = getShareQrElements();
    if (!canvas) return;
  
    canvas.innerHTML = ''; // clear QR
  }

  async function renderShareQr(url) {
    const wrap = document.querySelector('.share-qr-wrap');
    const canvas = document.getElementById('shareQrCanvas');
    const logo = document.getElementById('shareQrLogo');
    const urlText = document.getElementById('shareQrUrl');
  
    if (!wrap || !canvas || !url) return;
  
    try {
      // Remove old QR (important)
      canvas.innerHTML = '';
  
      // Generate QR inside canvas container
      new QRCode(canvas, {
        text: url,
        width: 180,
        height: 180,
        colorDark: "#111827",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
  
      lastRenderedQrUrl = url;
  
      // Logo overlay (still works)
      if (logo) {
        logo.src = QR_LOGO_URL;
        logo.style.display = 'block';
      }
  
      if (urlText) {
        urlText.textContent = url;
      }
  
    } catch (error) {
      console.error('QR render error:', error);
  
      lastRenderedQrUrl = '';
  
      if (urlText) {
        urlText.textContent = url;
      }
  
      showToast('QR could not be generated. Link is still available to copy.', 'warning', 4500);
    }
  }

 function getQrShareLogoUrl() {
    // Use PNG for canvas export, keep .ico only as browser favicon
    return QR_LOGO_URL;
  }
  
  function loadImageForCanvas(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error('No image source provided.'));
        return;
      }
  
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }
  
  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
  
  async function buildShareQrPngBlob() {

     if (!lastRenderedQrUrl) {
      throw new Error('QR not ready yet.');
    }
      
    const container = document.getElementById('shareQrCanvas');
    if (!container) throw new Error('QR container not found.');
  
    // Find actual QR element (canvas OR img)
    const qrEl =
      container.querySelector('canvas') ||
      container.querySelector('img');
  
    if (!qrEl) {
      throw new Error('QR element not rendered yet.');
    }
  
    const size = 512;
  
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = size;
    exportCanvas.height = size;
  
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed.');
  
    // white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
  
    // draw QR (handles both canvas and img)
    const rect = qrEl.getBoundingClientRect();
    ctx.drawImage(qrEl, 0, 0, rect.width, rect.height, 0, 0, size, size);
    // ctx.drawImage(qrEl, 0, 0, size, size);
  
    // 🔥 overlay logo (your existing logic but safer)
    try {
      const logo = new Image();
      logo.crossOrigin = 'anonymous';
      logo.src = QR_LOGO_URL;
  
      await new Promise((res, rej) => {
        logo.onload = res;
        logo.onerror = rej;
      });
  
      const logoSize = size * 0.22;
      const x = (size - logoSize) / 2;
      const y = (size - logoSize) / 2;
  
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 4, y - 4, logoSize + 8, logoSize + 8);
  
      ctx.drawImage(logo, x, y, logoSize, logoSize);
    } catch (e) {
      console.warn('Logo overlay failed:', e);
    }
  
    return new Promise((resolve, reject) => {
      exportCanvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Blob generation failed.'));
      }, 'image/png');
    });
  }
  
  async function shareQrImageFile({ title, text }) {
    try {
      // const blob = await buildShareQrPngBlob();
      await currentQrRenderPromise;
      const blob = await buildShareQrPngBlob();
      const file = new File([blob], 'gita-qr.png', { type: 'image/png' });
  
      const data = {
        title: title || 'Gita QR',
        text: text || '',
        files: [file]
      };
  
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share(data);
        showToast('QR image shared.', 'success');
        return;
      }
  
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gita-qr.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
  
      showToast('QR image downloaded (file sharing not supported on this browser).', 'info', 5000);
    } catch (error) {
      console.error('shareQrImageFile error:', error);
      showToast('Unable to share QR image.', 'error');
    }
  }
  
  async function copyQrImageToClipboard() {
    try {
      // const blob = await buildShareQrPngBlob();
      await currentQrRenderPromise;
      const blob = await buildShareQrPngBlob();
  
      if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
        throw new Error('Clipboard image writing is not supported.');
      }
  
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);
  
      showToast('QR image copied to clipboard.', 'success');
    } catch (error) {
      console.error('copyQrImageToClipboard error:', error);
      showToast('Unable to copy QR image.', 'warning', 4500);
    }
  }

  function openShareSheet({ title, text, url }) {
    currentSharePayload = { title, text, url };

    const preview = document.getElementById('sharePreview');
    const sheet = document.getElementById('shareSheet');
    if (!preview || !sheet) return;

    preview.textContent = text;
    sheet.classList.add('active');
    // renderShareQr(url);
    currentQrRenderPromise = renderShareQr(url);

    document.getElementById('shareNativeBtn').onclick = async () => {
      if (!navigator.share) {
        showToast('Native share is not available on this device.', 'warning');
        return;
      }

      try {
        await navigator.share({ title, text, url });
      } catch (error) {
        console.warn('Native share canceled or failed:', error);
      }
    };

    document.getElementById('shareCopyBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Message copied.', 'success');
      } catch (error) {
        console.error('Copy message error:', error);
        showToast('Failed to copy message.', 'error');
      }
    };

    document.getElementById('shareCopyLinkBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied.', 'success');
      } catch (error) {
        console.error('Copy link error:', error);
        showToast('Failed to copy link.', 'error');
      }
    };

    document.getElementById('shareWhatsappBtn').onclick = () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    };

    document.getElementById('shareTelegramBtn').onclick = () => {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
    };

    document.getElementById('shareEmailBtn').onclick = () => {
      window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
    };

    document.getElementById('shareQrImageBtn').onclick = async () => {
      await shareQrImageFile({ title, text, url });
    };
    
    document.getElementById('copyQrImageBtn').onclick = async () => {
      await copyQrImageToClipboard();
    };
    
  }

  function closeShareSheet() {
    document.getElementById('shareSheet')?.classList.remove('active');
    currentSharePayload = null;
  }

  // -------------------------------------------------------
  // Presentation modal
  // -------------------------------------------------------
  function injectPresentationModal() {
    const html = `
      <div id="karaokeModal" class="karaoke-modal">
        <button id="kCloseBtn" class="k-close-btn" aria-label="Close">×</button>
        <button id="kShareBtn" class="k-share-btn">🔗 Share</button>

        <div class="k-close-hint">Tap outside the text area to close</div>

        <div id="karaokeContent" class="karaoke-content">
          <div id="kTitle" class="karaoke-title">Chapter 1, Verse 1</div>
          <div id="kLyrics" class="karaoke-lyrics">Sanskrit Text</div>
          <div id="kEnglish" class="karaoke-english">English Translation</div>
        </div>

        <div class="karaoke-controls" id="kControls">
          <button id="kPrevBtn" class="k-btn">⏮️ Prev</button>
          <button id="kNextBtn" class="k-btn">Next ⏭️</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const karaokeModal = document.getElementById('karaokeModal');

    document.getElementById('kCloseBtn')?.addEventListener('click', closePresentation);

    karaokeModal?.addEventListener('click', e => {
      if (e.target === karaokeModal) closePresentation();
    });

    document.getElementById('kPrevBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentGeetaData || presentationIndex <= 0) return;
      presentationIndex--;
      playPresentationVerse();
    });

    document.getElementById('kNextBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentGeetaData || presentationIndex >= currentGeetaData.length - 1) return;
      presentationIndex++;
      playPresentationVerse();
    });

    document.getElementById('kShareBtn')?.addEventListener('click', e => {
      e.stopPropagation();

      const v = currentGeetaData?.[presentationIndex];
      if (!v) return;

      const shareUrl =
        `${window.location.origin}${window.location.pathname}` +
        `${currentSystemFile ? `?file=${encodeURIComponent(currentSystemFile)}` : ''}`;

      const message =
        `🎧 Bhagavad Gita Sync Presentation\n\n` +
        `Chapter ${v.Chapter}, Verse ${v.VerseNum}\n\n` +
        `${v.OriginalText || ''}\n\n` +
        `${v.EnglishText || ''}\n\n` +
        `Open here:\n${shareUrl}`;

      openShareSheet({
        title: `Bhagavad Gita - Chapter ${v.Chapter}, Verse ${v.VerseNum}`,
        text: message,
        url: shareUrl
      });
    });
  }

  function openPresentation(startIndex) {
    if (!currentGeetaData || !currentGeetaData.length) return;

    presentationIndex = startIndex;
    document.getElementById('karaokeModal')?.classList.add('active');
    playPresentationVerse();
  }

  function closePresentation() {
    document.getElementById('karaokeModal')?.classList.remove('active');

    if (audioPlayer) audioPlayer.pause();

    if (presentationMonitor) {
      cancelAnimationFrame(presentationMonitor);
      presentationMonitor = null;
    }
  }

  function playPresentationVerse() {
    if (!currentGeetaData || !audioPlayer) return;

    const v = currentGeetaData[presentationIndex];
    if (!v) return;

    const karaokeContent = document.getElementById('karaokeContent');
    const kTitle = document.getElementById('kTitle');
    const kLyrics = document.getElementById('kLyrics');
    const kEnglish = document.getElementById('kEnglish');

    if (!karaokeContent || !kTitle || !kLyrics || !kEnglish) return;

    karaokeContent.classList.add('fade-out');

    if (presentationMonitor) {
      cancelAnimationFrame(presentationMonitor);
      presentationMonitor = null;
    }

    setTimeout(() => {
      kTitle.textContent = `${v.Topic || 'Geeta'} - Chapter ${v.Chapter}, Verse ${v.VerseNum}`;
      kLyrics.innerHTML = nl2br(v.OriginalText || 'No Text Available');
      kEnglish.innerHTML = nl2br(v.EnglishText || '');

      karaokeContent.classList.remove('fade-out');

      requestAnimationFrame(() => {
        fitKaraokeTextToViewport(karaokeContent, kLyrics, kEnglish);
      });

      if (v.AudioStart !== undefined && Number(v.AudioEnd) > Number(v.AudioStart)) {
        if (v.AudioFileURL && (!audioPlayer.src || audioPlayer.src.indexOf(v.AudioFileURL) === -1)) {
          audioPlayer.src = v.AudioFileURL;
        }

        audioPlayer.currentTime = Number(v.AudioStart) || 0;
        audioPlayer.play().catch(error => {
          console.warn('Presentation autoplay blocked:', error);
          showToast('Tap play if autoplay is blocked by your browser.', 'warning');
        });

        const endTime = Number(v.AudioEnd) || 0;

        const monitor = () => {
          if (audioPlayer.currentTime >= endTime) {
            if (presentationIndex < currentGeetaData.length - 1) {
              presentationIndex++;
              playPresentationVerse();
            } else {
              audioPlayer.pause();
            }
          } else if (!audioPlayer.paused) {
            presentationMonitor = requestAnimationFrame(monitor);
          }
        };

        presentationMonitor = requestAnimationFrame(monitor);
      }
    }, 180);
  }

  // -------------------------------------------------------
  // Audio / controls
  // -------------------------------------------------------
  function bindAudioEvents() {
    if (!audioPlayer) return;

    audioPlayer.addEventListener('error', () => {
      const err = audioPlayer.error;
      let msg = 'Unknown audio error.';
      if (err) {
        switch (err.code) {
          case 1:
            msg = 'Playback aborted.';
            break;
          case 2:
            msg = 'Network issue while loading audio.';
            break;
          case 3:
            msg = 'Audio decoding failed.';
            break;
          case 4:
            msg = 'Audio file not found or unreachable.';
            break;
        }
      }

      showToast(
        `${msg}<div style="font-size:12px;opacity:.85;margin-top:4px;word-break:break-all;">${escapeHtml(audioPlayer.src || '')}</div>`,
        'error',
        6000
      );
    });

    audioPlayer.addEventListener('timeupdate', () => {
      const timer = document.getElementById('floatTimer');
      if (timer) {
        timer.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration || 0)}`;
      }
      syncActiveRowToAudio();
    });
  }

  function bindControls() {
    document.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }

      if (e.key === ']' || e.key === '}') {
        e.preventDefault();
        if (isGeetaMode) markGeetaEnd();
        else markNormalMode();
      }

      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }

      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    });

    floatPlayBtn?.addEventListener('click', togglePlayPause);
    floatMarkBtn?.addEventListener('click', () => {
      if (isGeetaMode) markGeetaEnd();
      else markNormalMode();
    });
    floatUndoBtn?.addEventListener('click', undo);
    floatRedoBtn?.addEventListener('click', redo);
    floatDeleteBtn?.addEventListener('click', deleteLastRow);

    tableBody?.addEventListener('click', e => {
      const presBtn = e.target.closest('.pres-play-btn');
      if (presBtn) {
        const idx = Number(presBtn.getAttribute('data-index'));
        openPresentation(idx);
        return;
      }

      const row = e.target.closest('tr');
      if (row && !e.target.classList.contains('chunk-player')) {
        setFocusRow(row.rowIndex - 1);
      }
    });

    tableBody?.addEventListener('blur', handleManualCellEdit, true);

    let searchDebounce;
    tableSearch?.addEventListener('input', function () {
      clearTimeout(searchDebounce);
      const term = this.value.toLowerCase().trim();
      if (searchCountDisplay) searchCountDisplay.textContent = 'Searching...';

      searchDebounce = setTimeout(() => {
        const rows = Array.from(tableBody?.rows || []);
        let idx = 0;
        let count = 0;

        const batch = () => {
          const limit = Math.min(idx + 80, rows.length);

          for (; idx < limit; idx++) {
            const row = rows[idx];
            const haystack = row.dataset.searchStr || '';

            if (!term || haystack.includes(term)) {
              row.style.display = '';
              count++;
            } else {
              row.style.display = 'none';
            }
          }

          if (idx < rows.length) {
            requestAnimationFrame(batch);
          } else if (searchCountDisplay) {
            searchCountDisplay.textContent = term ? `Found ${count} results for "${term}"` : '';
          }
        };

        batch();
      }, 180);
    });
  }

  function populateAudioOptions() {
    const optionsContainer = document.getElementById('optionsContainer');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = AUDIO_OPTIONS.map(
      item => `<div data-value="${escapeHtml(item.value)}">${escapeHtml(item.text)}</div>`
    ).join('');
  }

  function bindDropdownSearch() {
    const searchSelect = document.getElementById('searchSelect');
    const optionsContainer = document.getElementById('optionsContainer');
    if (!searchSelect || !optionsContainer) return;

    const getOptions = () => optionsContainer.getElementsByTagName('div');

    searchSelect.addEventListener('focus', () => {
      optionsContainer.classList.remove('hidden');
      [...getOptions()].forEach(o => {
        o.style.display = '';
      });
    });

    searchSelect.addEventListener('input', () => {
      const filter = searchSelect.value.toLowerCase();
      let visible = false;

      [...getOptions()].forEach(o => {
        if (o.textContent.toLowerCase().includes(filter)) {
          o.style.display = '';
          visible = true;
        } else {
          o.style.display = 'none';
        }
      });

      optionsContainer.classList.toggle('hidden', !visible);
    });

    optionsContainer.addEventListener('click', e => {
      const target = e.target.closest('[data-value]');
      if (!target) return;

      const value = target.getAttribute('data-value');
      if (!value) return;

      fileUrlInput.value = value;
      searchSelect.value = target.textContent;
      optionsContainer.classList.add('hidden');
      loadAudio();
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.select-container')) {
        optionsContainer.classList.add('hidden');
      }
    });
  }

  function togglePlayPause() {
    if (!audioPlayer) return;

    if (audioPlayer.paused) {
      audioPlayer.play().catch(error => {
        console.warn('togglePlayPause blocked:', error);
        showToast('Tap again if playback is blocked.', 'warning');
      });
    } else {
      audioPlayer.pause();
    }
  }

  function syncActiveRowToAudio() {
    try {
      const t = audioPlayer.currentTime;
      let foundIndex = -1;

      if (isGeetaMode && currentGeetaData) {
        const cur = currentGeetaData[activeVerseIndex];
        const activeChapter = cur ? cur.Chapter : currentGeetaData[0]?.Chapter;

        if (
          cur &&
          Number(cur.AudioEnd) > Number(cur.AudioStart) &&
          t >= Number(cur.AudioStart) &&
          t <= Number(cur.AudioEnd)
        ) {
          foundIndex = activeVerseIndex;
        } else {
          for (let i = 0; i < currentGeetaData.length; i++) {
            const v = currentGeetaData[i];
            if (
              v.Chapter === activeChapter &&
              Number(v.AudioEnd) > Number(v.AudioStart) &&
              t >= Number(v.AudioStart) &&
              t <= Number(v.AudioEnd)
            ) {
              foundIndex = i;
              break;
            }
          }
        }
      } else if (tableBody) {
        for (let i = 0; i < tableBody.rows.length; i++) {
          const row = tableBody.rows[i];
          const s = safeNum(row.dataset.start);
          const e = safeNum(row.dataset.end);
          if (t >= s && t <= e) {
            foundIndex = i;
            break;
          }
        }
      }

      if (foundIndex !== -1 && tableBody) {
        const row = tableBody.rows[foundIndex];
        if (activeRowElem !== row) {
          if (activeRowElem) activeRowElem.classList.remove('active-row');
          row.classList.add('active-row');
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          activeRowElem = row;
        }
      } else if (activeRowElem) {
        activeRowElem.classList.remove('active-row');
        activeRowElem = null;
      }
    } catch (error) {
      console.warn('syncActiveRowToAudio warning:', error);
    }
  }

  // -------------------------------------------------------
  // Renderers
  // -------------------------------------------------------
  async function renderGeetaRowsBatched(data) {
    let idx = 0;
    const total = data.length;
    const batchSize = window.innerWidth >= 1200 ? 180 : 110;

    if (!tableBody) return;

    tableBody.innerHTML = '';

    return new Promise(resolve => {
      const batch = () => {
        let html = '';
        const limit = Math.min(idx + batchSize, total);

        for (; idx < limit; idx++) {
          const v = data[idx];
          const start = Number(v.AudioStart) || 0;
          const end = Number(v.AudioEnd) || 0;
          const isDone = end > start;
          const baseUrl = (v.AudioFileURL || '').split('#')[0];
          const chunkSrc = isDone ? `${baseUrl}#t=${start},${end}` : '';

          const searchString = `${v.VerseNum} ${v.Topic || ''} C${v.Chapter} V${v.VerseNum} ${v.OriginalText || ''} ${v.EnglishText || ''}`.toLowerCase();
          const lyricsBlock =
            `${nl2br(v.OriginalText || '')}${v.EnglishText ? '<br><br>' + nl2br(v.EnglishText) : ''}`;

          html += `
            <tr
              data-search-str="${escapeHtml(searchString)}"
              data-start="${start}"
              data-end="${end}"
            >
              <td>${v.VerseNum}</td>
              <td contenteditable class="startTime">${start}</td>
              <td contenteditable class="endTime">${end}</td>
              <td>${Number(v.ReadTimeInSeconds) || 0}</td>
              <td class="name-cell">${escapeHtml(generateName(v.VerseNum, v))}</td>
              <td>
                <div class="lyrics-text" style="max-height:100px; overflow-y:auto; background:#f9f9f9; padding:10px; border:1px solid #ccc; border-radius:8px;">
                  ${lyricsBlock}
                </div>
              </td>
              <td>
                <button
                  class="pres-play-btn"
                  data-index="${idx}"
                  style="display:${isDone ? 'inline-flex' : 'none'};"
                >
                  🎤 Play Presentation
                </button>

                <audio
                  class="chunk-player"
                  controls
                  style="height:35px; width:100%; display:${isDone ? 'block' : 'none'};"
                  src="${chunkSrc}"
                  ontimeupdate="enforceChunkBounds(this, ${start}, ${end})"
                ></audio>
              </td>
            </tr>
          `;
        }

        tableBody.insertAdjacentHTML('beforeend', html);

        if (idx < total) {
          requestAnimationFrame(batch);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(batch);
    });
  }

  function renderNormalJson(data) {
    if (!tableBody) return;

    let maxEndSaved = 0;
    let html = '';

    if (data.audioUrl && audioPlayer) {
      audioPlayer.src = data.audioUrl;
      audioPlayer.load();
    }

    (data.timestamps || []).forEach((t, i) => {
      const start = safeNum(t.start);
      const end = safeNum(t.end);
      maxEndSaved = Math.max(maxEndSaved, end);

      const searchString = `${t.name || generateName(i + 1)} ${t.lyrics || ''}`.toLowerCase();

      html += `
        <tr
          data-search-str="${escapeHtml(searchString)}"
          data-start="${start}"
          data-end="${end}"
        >
          <td>${i + 1}</td>
          <td contenteditable class="startTime">${start}</td>
          <td contenteditable class="endTime">${end}</td>
          <td>${(end - start).toFixed(2)}</td>
          <td class="name-cell">${escapeHtml(t.name || generateName(i + 1))}</td>
          <td>
            <textarea class="lyricsInput">${escapeHtml(t.lyrics || '')}</textarea>
          </td>
          <td>
            <audio
              controls
              class="chunk-player"
              style="height:35px; width:100%; display:block;"
              src="${data.audioUrl}#t=${start},${end}"
              ontimeupdate="enforceChunkBounds(this, ${start}, ${end})"
            ></audio>
          </td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;

    startTime = maxEndSaved;
    activeVerseIndex = (data.timestamps || []).length;

    const performSeek = () => {
      if (audioPlayer) audioPlayer.currentTime = maxEndSaved;
      updateProgress();
    };

    if (audioPlayer && audioPlayer.readyState >= 1) {
      performSeek();
    } else if (audioPlayer) {
      audioPlayer.addEventListener('loadedmetadata', function seek() {
        performSeek();
        audioPlayer.removeEventListener('loadedmetadata', seek);
      });
    }
  }

  function focusFirstIncompleteVerse(data) {
    const firstUnfinished = data.findIndex(v => !v.AudioEnd || Number(v.AudioEnd) === 0);

    if (firstUnfinished !== -1) {
      setFocusRow(firstUnfinished);

      const current = data[firstUnfinished];

      if (current.AudioFileURL && audioPlayer) {
        fileUrlInput.value = current.AudioFileURL;
        audioPlayer.src = current.AudioFileURL;

        audioPlayer.addEventListener('loadedmetadata', function seekOnce() {
          audioPlayer.currentTime = Number(current.AudioStart) || 0;
          audioPlayer.removeEventListener('loadedmetadata', seekOnce);
        });

        audioPlayer.load();
      }

      if (firstUnfinished > 0 && data[firstUnfinished].Chapter === data[firstUnfinished - 1].Chapter) {
        const prevEnd = Number(data[firstUnfinished - 1].AudioEnd) || 0;
        data[firstUnfinished].AudioStart = prevEnd;

        const row = tableBody.rows[firstUnfinished];
        if (row) {
          row.querySelector('.startTime').textContent = prevEnd.toFixed(2);
          row.dataset.start = prevEnd;
        }
      } else {
        data[firstUnfinished].AudioStart = 0;
        const row = tableBody.rows[firstUnfinished];
        if (row) {
          row.querySelector('.startTime').textContent = '0.00';
          row.dataset.start = 0;
        }
      }
    } else {
      setFocusRow(0);
    }
  }

  // -------------------------------------------------------
  // Marking engine
  // -------------------------------------------------------
  function markGeetaEnd() {
    if (!isGeetaMode || !currentGeetaData || !audioPlayer) return;

    const row = tableBody.rows[activeVerseIndex];
    if (!row) return;

    const t = Number(audioPlayer.currentTime.toFixed(2));
    if (t === 0 && audioPlayer.paused) {
      showToast('Please play the main audio first.', 'warning');
      return;
    }

    const startCell = row.querySelector('.startTime');
    const endCell = row.querySelector('.endTime');
    const durationCell = row.cells[3];

    const s = safeNum(startCell.textContent);
    const e = t;

    if (e <= s) {
      showToast(`End time (${e}s) must be greater than start time (${s}s).`, 'warning');
      return;
    }

    const duration = Number((e - s).toFixed(2));

    startCell.textContent = s.toFixed(2);
    endCell.textContent = e.toFixed(2);
    durationCell.textContent = duration.toFixed(2);

    row.dataset.start = s;
    row.dataset.end = e;

    const v = currentGeetaData[activeVerseIndex];
    v.AudioStart = s;
    v.AudioEnd = e;
    v.ReadTimeInSeconds = duration;

    const chunkPlayer = row.querySelector('.chunk-player');
    if (chunkPlayer) {
      const baseUrl = (v.AudioFileURL || audioPlayer.src).split('#')[0];
      chunkPlayer.src = `${baseUrl}#t=${s},${e}`;
      chunkPlayer.setAttribute('ontimeupdate', `enforceChunkBounds(this, ${s}, ${e})`);
      chunkPlayer.style.display = 'block';
      chunkPlayer.load();
    }

    const presBtn = row.querySelector('.pres-play-btn');
    if (presBtn) presBtn.style.display = 'inline-flex';

    flashRow(row);
    updateProgress();
    saveHistory();
    scheduleJsonSync();
    advanceToNextGeetaVerse(e);
  }

  function advanceToNextGeetaVerse(previousEndTime) {
    const nextIndex = activeVerseIndex + 1;

    if (!currentGeetaData || nextIndex >= currentGeetaData.length) {
      fireConfetti();
      return;
    }

    const current = currentGeetaData[activeVerseIndex];
    const next = currentGeetaData[nextIndex];
    const nextRow = tableBody.rows[nextIndex];

    setFocusRow(nextIndex);

    if (current.Chapter === next.Chapter) {
      next.AudioStart = previousEndTime;
      if (nextRow) {
        nextRow.querySelector('.startTime').textContent = previousEndTime.toFixed(2);
        nextRow.dataset.start = previousEndTime;
      }
    } else {
      fireConfetti();
      next.AudioStart = 0;

      if (nextRow) {
        nextRow.querySelector('.startTime').textContent = '0.00';
        nextRow.dataset.start = 0;
      }

      if (next.AudioFileURL && current.AudioFileURL !== next.AudioFileURL) {
        fileUrlInput.value = next.AudioFileURL;
        audioPlayer.src = next.AudioFileURL;
        audioPlayer.load();
      }
    }

    scheduleJsonSync();
  }

  function markNormalMode() {
    if (!audioPlayer) return;

    const t = audioPlayer.currentTime;
    if (startTime === null) startTime = 0;
    const end = t;

    const row = document.createElement('tr');
    row.dataset.start = startTime;
    row.dataset.end = end;
    row.dataset.searchStr = generateName(activeVerseIndex + 1).toLowerCase();

    row.innerHTML = `
      <td>${activeVerseIndex + 1}</td>
      <td contenteditable class="startTime">${startTime.toFixed(2)}</td>
      <td contenteditable class="endTime">${end.toFixed(2)}</td>
      <td>${(end - startTime).toFixed(2)}</td>
      <td class="name-cell">${escapeHtml(generateName(activeVerseIndex + 1))}</td>
      <td><textarea class="lyricsInput"></textarea></td>
      <td>
        <audio
          controls
          class="chunk-player"
          style="height:35px; width:100%; display:block;"
          src="${audioPlayer.src}#t=${startTime},${end}"
          ontimeupdate="enforceChunkBounds(this, ${startTime}, ${end})"
        ></audio>
      </td>
    `;

    tableBody.appendChild(row);

    startTime = end;
    activeVerseIndex++;

    updateProgress();
    saveHistory();
    scheduleJsonSync();
  }

  // -------------------------------------------------------
  // Manual edit handler
  // -------------------------------------------------------
  function handleManualCellEdit(event) {
    const cell = event.target;
    if (!cell.classList.contains('startTime') && !cell.classList.contains('endTime')) return;

    try {
      const row = cell.closest('tr');
      const s = safeNum(row.cells[1].textContent);
      const e = safeNum(row.cells[2].textContent);

      if (e < s && e !== 0) {
        showToast('Invalid time configuration. End must be greater than start.', 'warning');
        row.cells[2].textContent = row.dataset.end || '0.00';
        return;
      }

      const duration = Number((e - s).toFixed(2));
      if (e > 0) row.cells[3].textContent = duration;

      row.dataset.start = s;
      row.dataset.end = e;

      const audioEl = row.querySelector('.chunk-player');
      if (audioEl && e > 0) {
        const baseUrl = isGeetaMode
          ? ((currentGeetaData[row.rowIndex - 1]?.AudioFileURL || audioPlayer.src).split('#')[0])
          : ((audioPlayer.src || '').split('#')[0]);

        audioEl.src = `${baseUrl}#t=${s},${e}`;
        audioEl.setAttribute('ontimeupdate', `enforceChunkBounds(this, ${s}, ${e})`);
        audioEl.style.display = 'block';
        audioEl.load();

        const presBtn = row.querySelector('.pres-play-btn');
        if (presBtn) presBtn.style.display = 'inline-flex';
      }

      if (isGeetaMode) {
        const idx = row.rowIndex - 1;
        const v = currentGeetaData[idx];
        if (v) {
          v.AudioStart = s;
          v.AudioEnd = e;
          v.ReadTimeInSeconds = duration > 0 ? duration : 0;
        }
      }

      updateProgress();
      saveHistory();
      scheduleJsonSync();
    } catch (error) {
      console.error('handleManualCellEdit error:', error);
      showToast('Failed to update edited row.', 'error');
    }
  }

  // -------------------------------------------------------
  // Row focus / visuals
  // -------------------------------------------------------
  function setFocusRow(index) {
    if (!tableBody || index < 0 || index >= tableBody.rows.length) return;

    activeVerseIndex = index;

    const old = tableBody.querySelector('.focused-verse');
    if (old) old.classList.remove('focused-verse');

    const row = tableBody.rows[index];
    row.classList.add('focused-verse');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function flashRow(row) {
    const original = row.style.background;
    row.style.background = '#d4edda';
    setTimeout(() => {
      row.style.background = original;
    }, 350);
  }

  function fireConfetti() {
    try {
      const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

      for (let i = 0; i < 50; i++) {
        const conf = document.createElement('div');
        conf.style.position = 'fixed';
        conf.style.width = '10px';
        conf.style.height = '10px';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        conf.style.left = `${Math.random() * 100}vw`;
        conf.style.top = '-10px';
        conf.style.zIndex = '9999';
        conf.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';

        document.body.appendChild(conf);

        const duration = Math.random() * 1.4 + 0.8;
        conf.animate(
          [
            { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
            { transform: `translate3d(${Math.random() * 220 - 110}px, 100vh, 0) rotate(${Math.random() * 540}deg)`, opacity: 0 }
          ],
          { duration: duration * 1000, easing: 'cubic-bezier(.37,0,.63,1)' }
        );

        setTimeout(() => conf.remove(), duration * 1000);
      }
    } catch (error) {
      console.warn('Confetti warning:', error);
    }
  }

  // -------------------------------------------------------
  // History / autosave
  // -------------------------------------------------------
  function buildNormalJsonObject() {
    const data = {
      audioUrl: audioPlayer ? audioPlayer.src : '',
      timestamps: []
    };

    [...(tableBody?.rows || [])].forEach((row, i) => {
      const s = safeNum(row.cells[1].textContent);
      const e = safeNum(row.cells[2].textContent);

      data.timestamps.push({
        verse: i + 1,
        name: row.cells[4].textContent,
        start: s,
        end: e,
        duration: Number((e - s).toFixed(2)),
        lyrics: row.cells[5].querySelector('textarea')?.value || ''
      });
    });

    return data;
  }

  function saveHistory() {
    if (!jsonInput) return;
    historyStack.push(jsonInput.value || '');
    if (historyStack.length > 100) historyStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!historyStack.length || !jsonInput) return;
    redoStack.push(jsonInput.value || '');
    const snapshot = historyStack.pop();
    jsonInput.value = snapshot;
    loadJsonData(snapshot);
  }

  function redo() {
    if (!redoStack.length || !jsonInput) return;
    historyStack.push(jsonInput.value || '');
    const snapshot = redoStack.pop();
    jsonInput.value = snapshot;
    loadJsonData(snapshot);
  }

  function deleteLastRow() {
    try {
      if (!tableBody || !tableBody.rows.length) return;

      tableBody.deleteRow(-1);
      activeVerseIndex = Math.max(0, activeVerseIndex - 1);

      startTime = tableBody.rows.length
        ? safeNum(tableBody.rows[tableBody.rows.length - 1].cells[2].textContent)
        : null;

      if (isGeetaMode && currentGeetaData && currentGeetaData[activeVerseIndex]) {
        currentGeetaData[activeVerseIndex].AudioStart = 0;
        currentGeetaData[activeVerseIndex].AudioEnd = 0;
        currentGeetaData[activeVerseIndex].ReadTimeInSeconds = 0;
      }

      updateProgress();
      saveHistory();
      scheduleJsonSync();
    } catch (error) {
      console.error('deleteLastRow error:', error);
      showToast('Failed to delete last row.', 'error');
    }
  }

  function autoSave() {
    try {
      if (jsonInput?.value) {
        localStorage.setItem('geeta_progress', jsonInput.value);
      }
    } catch (error) {
      console.warn('autoSave warning:', error);
    }
  }

  function loadAutoSave() {
    try {
      const saved = localStorage.getItem('geeta_progress');
      if (saved) {
        loadJsonData(saved);
      }
    } catch (error) {
      console.warn('loadAutoSave warning:', error);
    }
  }

  setInterval(autoSave, 5000);

  // -------------------------------------------------------
  // Progress
  // -------------------------------------------------------
  function updateProgress() {
    try {
      if (!progressBar || !progressText) return;

      if (isGeetaMode && currentGeetaData) {
        const total = currentGeetaData.length;
        const done = currentGeetaData.filter(v => Number(v.AudioEnd) > Number(v.AudioStart)).length;
        const p = Math.round((done / total) * 100) || 0;

        progressBar.style.width = `${p}%`;
        progressText.textContent = `Progress: ${done}/${total} Verses (${p}%)`;
      } else {
        if (!audioPlayer || !audioPlayer.duration || !tableBody) return;

        let totalMarked = 0;
        [...tableBody.rows].forEach(row => {
          totalMarked += safeNum(row.cells[3].textContent);
        });

        const p = Math.min(100, Math.round((totalMarked / audioPlayer.duration) * 100) || 0);

        progressBar.style.width = `${p}%`;
        progressText.textContent = `Progress: ${formatTime(totalMarked)} / ${formatTime(audioPlayer.duration)} (${p}%)`;
      }
    } catch (error) {
      console.warn('updateProgress warning:', error);
    }
  }

  // -------------------------------------------------------
  // JSON sync
  // -------------------------------------------------------
  function scheduleJsonSync() {
    clearTimeout(stringifyTimer);

    stringifyTimer = setTimeout(() => {
      idle(async () => {
        try {
          const payload = isGeetaMode ? currentGeetaData : buildNormalJsonObject();
          const text = await workerRequest('stringify', payload);
          if (jsonInput) jsonInput.value = text;
        } catch (error) {
          console.error('scheduleJsonSync error:', error);
        }
      });
    }, 220);
  }

  // -------------------------------------------------------
  // Misc
  // -------------------------------------------------------
  function clearToolState({ keepJson = false } = {}) {
    if (tableBody) tableBody.innerHTML = '';
    startTime = null;
    activeVerseIndex = 0;
    isGeetaMode = false;
    currentGeetaData = null;
    activeRowElem = null;

    if (!keepJson && jsonInput) jsonInput.value = '';
  }
})();
